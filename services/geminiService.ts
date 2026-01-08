
import { GoogleGenAI, Modality } from "@google/genai";
import { ImageData } from "../types";

const API_KEY = process.env.API_KEY || '';

// Helper for exponential backoff retry logic
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 2, delay: number = 2000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || 
                         error?.code === 429 || 
                         error?.response?.status === 429 ||
                         error?.message?.includes('429') || 
                         error?.message?.includes('RESOURCE_EXHAUSTED') ||
                         error?.message?.includes('quota');

    if (isQuotaError) {
      if (maxRetries > 0) {
        console.warn(`Quota hit, retrying in ${delay}ms... (Attempts left: ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryOperation(operation, maxRetries - 1, delay * 2);
      } else {
        throw new Error("API Usage Limit Exceeded. The system is busy. Please try again in a moment.");
      }
    }
    throw error;
  }
}

async function generateSingleRequest(ai: GoogleGenAI, parts: any[]): Promise<ImageData> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: parts,
    },
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig: {
        aspectRatio: "16:9" // Critical for WordPress Featured Images
      }
    },
  });

  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("No candidates returned from Gemini.");
  }

  const partsResponse = candidates[0].content?.parts;
  if (!partsResponse || partsResponse.length === 0) {
    throw new Error("No content parts returned.");
  }

  const imagePart = partsResponse.find(p => p.inlineData);

  if (!imagePart || !imagePart.inlineData) {
      throw new Error("No image data found in response.");
  }

  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const base64Data = imagePart.inlineData.data;
  const url = `data:${mimeType};base64,${base64Data}`;

  return {
    mimeType,
    data: base64Data,
    url
  };
}

export const generateOrEditImage = async (
  prompt: string,
  originalImage?: ImageData | null
): Promise<ImageData[]> => {
  if (!API_KEY) {
    throw new Error("API Key is missing in environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const commonRules = `
    You are a senior Visual Designer specialized in CORPORATE & WEB GRAPHICS.
    
    Task: Create a professional WordPress blog featured image.
    Style rules:
    - Clean, modern, and high-clarity professional aesthetic.
    - Strong focal point with a balanced composition.
    - Leave some "white space" or "copy space" for potential text overlays (like a blog title).
    - Avoid cluttered backgrounds or distracting small elements.
    - Use sophisticated color palettes appropriate for professional blogs (Tech, Finance, Lifestyle, Business).
    - NO music album art aesthetics. NO lo-fi noise or intentional distortion.
    - NO watermarks, logos, or UI elements.

    Technical:
    - Output MUST be 16:9 aspect ratio.
    - Crystal clear resolution, sharp details.
    - Realism or high-quality professional digital art style only.
  `;

  let finalPrompt = "";
  const parts: any[] = [];

  if (originalImage) {
     parts.push({
        inlineData: {
          data: originalImage.data,
          mimeType: originalImage.mimeType,
        },
      });
      finalPrompt = `
      ${commonRules}
      
      TASK: Transform this base image into a professional WordPress featured image/banner based on: ${prompt}.
      - Retain the core subject but enhance lighting, environment, and composition for a web banner.
      - Ensure the final result is 16:9.
      `.trim();
  } else {
      finalPrompt = `
      ${commonRules}
      
      TASK: Generate a brand-new professional 16:9 web banner for a blog post about: ${prompt}.
      - Focus on premium stock-photo quality or clean corporate 3D/flat illustration.
      `.trim();
  }

  parts.push({ text: finalPrompt });

  const requests = Array(4).fill(null).map(() => 
    retryOperation(() => generateSingleRequest(ai, parts))
  );

  const results = await Promise.allSettled(requests);

  const successfulImages: ImageData[] = results
    .filter((r): r is PromiseFulfilledResult<ImageData> => r.status === 'fulfilled')
    .map(r => r.value);

  if (successfulImages.length === 0) {
     const firstRejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
     throw firstRejected?.reason || new Error("Generation failed.");
  }

  return successfulImages;
};

export const generateEditSuggestions = async (
  originalImage?: ImageData | null
): Promise<string[]> => {
  if (!API_KEY) return [];

  if (!originalImage) {
    return [
      "Future of AI in business",
      "Modern minimalist home office workspace",
      "Sustainable energy and green technology",
      "Cryptocurrency and global finance trends",
      "Healthy lifestyle and wellness for professionals"
    ];
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  return retryOperation(async () => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: originalImage.data,
                mimeType: originalImage.mimeType,
              },
            },
            {
              text: "Analyze this image and suggest 3 professional blog topics it could illustrate as a featured image. Return ONLY a JSON array of strings. Example: [\"Remote work productivity\", \"Cybersecurity basics\"]",
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
        }
      });

      const text = response.text;
      if (!text) return [];
      
      try {
          const cleanedText = text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleanedText);
          return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
      } catch (e) {
          return [];
      }
    } catch (error) {
      return [];
    }
  }, 1, 1000);
};
