
import { ImageData } from '../types';

export const fileToImageData = (file: File): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const matches = result.match(/^data:(.+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        resolve({ mimeType: matches[1], data: matches[2], url: result });
      } else {
        reject(new Error('Invalid format'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const downloadImage = (dataUrl: string, filename: string = 'wp-banner.png') => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.setAttribute('crossOrigin', 'anonymous'); 
    image.src = url;
  });

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<ImageData> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No context');
  
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );
  
  const dataUrl = canvas.toDataURL('image/png', 0.95);
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (matches && matches.length === 3) {
    return { mimeType: matches[1], data: matches[2], url: dataUrl };
  }
  throw new Error('Canvas failed');
}

export const resizeImage = (url: string, targetWidth: number, targetHeight: number, fit: 'cover' | 'contain' | 'stretch' = 'cover'): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas error')); return; }
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Clear background for contain mode
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      if (fit === 'stretch') {
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      } else {
        const imgAspect = img.width / img.height;
        const targetAspect = targetWidth / targetHeight;
        let drawWidth, drawHeight, offsetX, offsetY;

        if (fit === 'cover') {
          if (imgAspect > targetAspect) {
            drawHeight = targetHeight;
            drawWidth = targetHeight * imgAspect;
            offsetX = (targetWidth - drawWidth) / 2;
            offsetY = 0;
          } else {
            drawWidth = targetWidth;
            drawHeight = targetWidth / imgAspect;
            offsetX = 0;
            offsetY = (targetHeight - drawHeight) / 2;
          }
        } else { // contain
          if (imgAspect > targetAspect) {
            drawWidth = targetWidth;
            drawHeight = targetWidth / imgAspect;
            offsetX = 0;
            offsetY = (targetHeight - drawHeight) / 2;
          } else {
            drawHeight = targetHeight;
            drawWidth = targetHeight * imgAspect;
            offsetX = (targetWidth - drawWidth) / 2;
            offsetY = 0;
          }
        }
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      }
      
      resolve(canvas.toDataURL('image/png', 0.9));
    };
    img.onerror = reject;
    img.src = url;
  });
};
