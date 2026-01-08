
import React, { useState, useRef, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { ImageData, EditorStatus } from '../types';
import { fileToImageData, downloadImage, getCroppedImg, resizeImage } from '../utils/imageUtils';
import { generateOrEditImage, generateEditSuggestions } from '../services/geminiService';
import { Spinner } from './Spinner';
import toast from 'react-hot-toast';

interface Area {
  width: number;
  height: number;
  x: number;
  y: number;
}

const STORAGE_KEY = 'wp_featured_image_state';
const PAINT_SESSION_KEY = 'wp_featured_image_paint_session';

const ASPECT_RATIOS = [
  { label: 'Original', value: undefined },
  { label: '16:9 Wide', value: 16 / 9 },
  { label: '1:1 Square', value: 1 },
  { label: '4:5 Portrait', value: 4 / 5 },
  { label: '3:2 Photo', value: 3 / 2 },
];

export const ImageEditor: React.FC = () => {
  const getSavedState = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  };

  const getSavedPaintSession = () => {
    try {
      const saved = localStorage.getItem(PAINT_SESSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  };

  const savedState = getSavedState();
  const savedPaint = getSavedPaintSession();

  const [originalImage, setOriginalImage] = useState<ImageData | null>(savedState?.originalImage || null);
  const [generatedImages, setGeneratedImages] = useState<ImageData[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  
  const [prompt, setPrompt] = useState(savedState?.prompt || '');
  const [status, setStatus] = useState<EditorStatus>(EditorStatus.IDLE);
  const [isDragging, setIsDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  
  // Cropping State
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(16/9);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // Painting State
  const [isPainting, setIsPainting] = useState(savedPaint?.isPainting || false);
  const [brushColor, setBrushColor] = useState(savedPaint?.brushColor || '#38bdf8');
  const [brushSize, setBrushSize] = useState(savedPaint?.brushSize || 20);
  const [brushOpacity, setBrushOpacity] = useState(savedPaint?.brushOpacity || 100);
  const [paintHistory, setPaintHistory] = useState<string[]>(savedPaint?.paintHistory || []);
  const [historyStep, setHistoryStep] = useState(savedPaint?.historyStep || 0);
  
  const [expandedImage, setExpandedImage] = useState<ImageData | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{x: number, y: number} | null>(null);

  // General Auto-save
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      try {
        const stateToSave = { prompt, originalImage };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      } catch (e) {
        // Fallback if image is too large for localStorage
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ prompt }));
        } catch (e2) {}
      }
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [prompt, originalImage]);

  // Paint Auto-save
  useEffect(() => {
    if (!isPainting) {
      localStorage.removeItem(PAINT_SESSION_KEY);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      try {
        const paintSession = {
          isPainting,
          brushColor,
          brushSize,
          brushOpacity,
          paintHistory,
          historyStep
        };
        localStorage.setItem(PAINT_SESSION_KEY, JSON.stringify(paintSession));
      } catch (e) {
        // If history is too large, only save settings and last step
        try {
          const minimalSession = {
            isPainting,
            brushColor,
            brushSize,
            brushOpacity,
            paintHistory: [paintHistory[historyStep]],
            historyStep: 0
          };
          localStorage.setItem(PAINT_SESSION_KEY, JSON.stringify(minimalSession));
        } catch (e2) {}
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [isPainting, brushColor, brushSize, brushOpacity, paintHistory, historyStep]);

  useEffect(() => {
    if (!originalImage) {
      generateEditSuggestions(null).then(s => setSuggestions(s));
    } else if (suggestions.length === 0) {
      setLoadingSuggestions(true);
      generateEditSuggestions(originalImage)
        .then(s => setSuggestions(s))
        .catch(() => {})
        .finally(() => setLoadingSuggestions(false));
    }
  }, [originalImage]);

  const loadFile = async (file: File) => {
    try {
      const imageData = await fileToImageData(file);
      setOriginalImage(imageData);
      setGeneratedImages([]);
      setStatus(EditorStatus.IDLE);
      setSuggestions([]);
      setIsPainting(false);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
      setIsCropping(true); 
      
      setLoadingSuggestions(true);
      generateEditSuggestions(imageData)
        .then(s => setSuggestions(s))
        .finally(() => setLoadingSuggestions(false));

    } catch (error) {
      toast.error("Failed to load image.");
    }
  };

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleCropSave = async () => {
    if (!originalImage) return;
    
    try {
      let resultImage = originalImage;
      if (croppedAreaPixels) {
        resultImage = await getCroppedImg(originalImage.url, croppedAreaPixels);
      }
      
      setOriginalImage(resultImage);
      setIsCropping(false);
      toast.success("Frame applied!");
      
      setLoadingSuggestions(true);
      generateEditSuggestions(resultImage)
        .then(s => setSuggestions(s))
        .finally(() => setLoadingSuggestions(false));
    } catch (e) {
      toast.error("Failed to apply frame");
    }
  };

  // Painting Logic
  const startPainting = () => {
    if (!originalImage) return;
    setIsPainting(true);
    if (paintHistory.length === 0) {
      setPaintHistory([originalImage.url]);
      setHistoryStep(0);
    }
  };

  useEffect(() => {
    if (isPainting && paintCanvasRef.current && (originalImage || paintHistory.length > 0)) {
      const canvas = paintCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx?.drawImage(img, 0, 0);
      };
      // Load from history if exists, otherwise original
      img.src = paintHistory[historyStep] || originalImage!.url;
    }
  }, [isPainting, originalImage]);

  const getPaintCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    if (!paintCanvasRef.current) return { x: 0, y: 0 };
    const canvas = paintCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    let clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const onPaintStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPainting) return;
    isDrawingRef.current = true;
    const pos = getPaintCoordinates(e);
    lastPosRef.current = pos;
  };

  const onPaintDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || !paintCanvasRef.current) return;
    const ctx = paintCanvasRef.current.getContext('2d');
    if (!ctx) return;
    const currentPos = getPaintCoordinates(e);
    const lastPos = lastPosRef.current || currentPos;
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.globalAlpha = brushOpacity / 100;
    ctx.stroke();
    lastPosRef.current = currentPos;
  };

  const onPaintEnd = () => {
    if (!isDrawingRef.current || !paintCanvasRef.current) return;
    isDrawingRef.current = false;
    const newUrl = paintCanvasRef.current.toDataURL();
    const newHistory = paintHistory.slice(0, historyStep + 1);
    newHistory.push(newUrl);
    setPaintHistory(newHistory);
    setHistoryStep(newHistory.length - 1);
  };

  const handleSavePaint = () => {
    if (paintCanvasRef.current && originalImage) {
       const dataUrl = paintCanvasRef.current.toDataURL(originalImage.mimeType);
       const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
       if (matches && matches.length === 3) {
          setOriginalImage({ mimeType: matches[1], data: matches[2], url: dataUrl });
          setIsPainting(false);
          setPaintHistory([]);
          setHistoryStep(0);
          localStorage.removeItem(PAINT_SESSION_KEY);
          toast.success("Banner updated!");
       }
    }
  };

  const handleCancelPaint = () => {
    setIsPainting(false);
    setPaintHistory([]);
    setHistoryStep(0);
    localStorage.removeItem(PAINT_SESSION_KEY);
  };

  const undoPaint = () => {
    if (historyStep > 0) {
      setHistoryStep(historyStep - 1);
    }
  };

  const redoPaint = () => {
    if (historyStep < paintHistory.length - 1) {
      setHistoryStep(historyStep + 1);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
        toast.error("Please enter a topic for your blog image");
        return;
    }
    setStatus(EditorStatus.PROCESSING);
    setGeneratedImages([]); 
    try {
      const results = await generateOrEditImage(prompt, originalImage);
      setGeneratedImages(results);
      setSelectedImageIndex(0);
      setStatus(EditorStatus.SUCCESS);
      toast.success(`Generated ${results.length} professional banners!`);
    } catch (error: any) {
      setStatus(EditorStatus.ERROR);
      toast.error(`Generation failed: ${error.message}`);
    }
  };

  const exportSizes = [
    { label: 'WP Standard (1200x675)', w: 1200, h: 675, tag: '16:9' },
    { label: 'WP HD Hero (1920x1080)', w: 1920, h: 1080, tag: '16:9' },
    { label: 'Social Square (1200x1200)', w: 1200, h: 1200, tag: '1:1' },
    { label: 'Original Resolution', w: 0, h: 0, tag: 'Raw' },
  ];

  const handleExport = async (w: number, h: number, label: string, imgOverride?: ImageData) => {
    const activeImage = imgOverride || generatedImages[selectedImageIndex];
    if (!activeImage) return;
    
    const toastId = toast.loading(`Exporting ${label}...`);
    try {
      let finalUrl = activeImage.url;
      if (w > 0 && h > 0) {
        finalUrl = await resizeImage(activeImage.url, w, h);
      }
      
      const cleanLabel = label.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '');
      downloadImage(finalUrl, `wp-${cleanLabel}-${Date.now()}.png`);
      toast.success('Downloaded!', { id: toastId });
      setShowExportMenu(false);
    } catch (error) {
      toast.error('Export failed', { id: toastId });
    }
  };

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto w-full gap-8 pb-12">
      <div className="flex-grow flex flex-col gap-6">
        
        {/* Workspace: Comparison / Preview */}
        <div className="flex flex-col lg:flex-row gap-6 min-h-[450px]">
          
          {/* Input / Base Image */}
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex justify-between items-center px-1">
               <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                 {isPainting ? 'PAINT & ANNOTATE' : 'BASE IMAGE (OPTIONAL)'}
               </h2>
               {originalImage && !isCropping && !isPainting && (
                 <div className="flex gap-3">
                   <button onClick={() => setIsCropping(true)} className="text-xs text-gray-300 hover:text-white flex items-center gap-1">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M7.25 2a.75.75 0 01.75.75v2h5a.75.75 0 01.75.75v2h2a.75.75 0 01.75.75v6a.75.75 0 01-.75.75h-6a.75.75 0 01-.75-.75v-2h-2a.75.75 0 01-.75-.75v-6A.75.75 0 017.25 2z" clipRule="evenodd" /></svg>
                     Framing
                   </button>
                   <button onClick={startPainting} className="text-xs text-gray-300 hover:text-white flex items-center gap-1">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.5 11a.75.75 0 01-.75-.75V6a3 3 0 013-3h3.25a3 3 0 013 3v4.25a.75.75 0 01-1.5 0V6a1.5 1.5 0 00-1.5-1.5h-3.25A1.5 1.5 0 007.25 6v4.25a.75.75 0 01-.75.75z" /></svg>
                     Edit
                   </button>
                   <button onClick={() => fileInputRef.current?.click()} className="text-xs text-brand-400 hover:text-brand-300 font-bold">REPLACE</button>
                 </div>
               )}
            </div>
            
            <div 
              className={`relative flex-grow bg-gray-900 border-2 border-dashed ${isDragging ? 'border-brand-500 bg-gray-800/50' : 'border-gray-800'} rounded-2xl flex flex-col items-center justify-center transition-all overflow-hidden min-h-[300px] aspect-video`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault(); setIsDragging(false);
                if (e.dataTransfer.files?.[0]) await loadFile(e.dataTransfer.files[0]);
              }}
            >
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} className="hidden" accept="image/*" />
              
              {isCropping && originalImage ? (
                <div className="absolute inset-0 z-20 bg-black flex flex-col">
                  <div className="relative flex-grow">
                    <Cropper 
                      image={originalImage.url} 
                      crop={crop} 
                      zoom={zoom} 
                      aspect={aspectRatio} 
                      onCropChange={setCrop} 
                      onCropComplete={onCropComplete} 
                      onZoomChange={setZoom} 
                    />
                  </div>
                  <div className="bg-gray-900 border-t border-gray-800 p-4 z-30 flex flex-col gap-4">
                     <div className="flex flex-wrap gap-2 justify-center">
                        {ASPECT_RATIOS.map((r) => (
                          <button 
                            key={r.label} 
                            onClick={() => setAspectRatio(r.value)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${aspectRatio === r.value ? 'bg-brand-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                          >
                            {r.label}
                          </button>
                        ))}
                     </div>
                     <div className="flex items-center justify-between">
                        <button onClick={() => setIsCropping(false)} className="text-xs text-gray-400 px-4">Skip</button>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-gray-600 font-bold">ZOOM</span>
                          <input type="range" value={zoom} min={1} max={3} step={0.1} onChange={(e) => setZoom(Number(e.target.value))} className="w-32 accent-brand-500" />
                        </div>
                        <button onClick={handleCropSave} className="text-xs bg-brand-500 text-white px-6 py-2 rounded-xl font-bold shadow-lg shadow-brand-500/20">Apply Frame</button>
                     </div>
                  </div>
                </div>
              ) : isPainting && (originalImage || paintHistory.length > 0) ? (
                <div className="absolute inset-0 z-20 bg-gray-900 flex flex-col">
                  <div className="relative flex-grow flex items-center justify-center p-2 cursor-crosshair">
                     <canvas ref={paintCanvasRef} onMouseDown={onPaintStart} onMouseMove={onPaintDraw} onMouseUp={onPaintEnd} onMouseLeave={onPaintEnd} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="bg-gray-800 border-t border-gray-700 p-3 flex justify-between items-center z-30">
                      <div className="flex gap-4 items-center">
                        <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="w-6 h-6 rounded bg-transparent border-0" />
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-gray-500 font-bold uppercase">Size</span>
                          <input type="range" min="1" max="100" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-20 accent-brand-500" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[8px] text-gray-500 font-bold uppercase">Opacity</span>
                          <input type="range" min="1" max="100" value={brushOpacity} onChange={(e) => setBrushOpacity(Number(e.target.value))} className="w-20 accent-brand-500" />
                        </div>
                        <div className="flex gap-1 ml-2">
                           <button onClick={undoPaint} disabled={historyStep <= 0} className="p-1.5 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.128a5.75 5.75 0 010 11.5H12a.75.75 0 010-1.5h1.75a4.25 4.25 0 000-8.5H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.25-5a.75.75 0 010-1.085l5.25-5a.75.75 0 011.06.025z" clipRule="evenodd" /></svg></button>
                           <button onClick={redoPaint} disabled={historyStep >= paintHistory.length - 1} className="p-1.5 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M12.207 2.232a.75.75 0 00.025 1.06l4.146 3.958H6.25a5.75 5.75 0 000 11.5H8a.75.75 0 000-1.5H6.25a4.25 4.25 0 010-8.5h10.128l-4.146 3.957a.75.75 0 001.036 1.085l5.25-5a.75.75 0 000-1.085l-5.25-5a.75.75 0 00-1.06.025z" clipRule="evenodd" /></svg></button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                         <button onClick={handleCancelPaint} className="text-xs text-gray-400">Cancel</button>
                         <button onClick={handleSavePaint} className="text-xs bg-brand-500 text-white px-4 py-2 rounded-lg font-bold">Done</button>
                      </div>
                  </div>
                </div>
              ) : originalImage ? (
                <img src={originalImage.url} alt="Original" className="w-full h-full object-contain p-4" />
              ) : (
                <div className="text-center p-6 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  </div>
                  <p className="text-sm font-medium text-gray-400">Drop your product or subject here</p>
                  <p className="text-[10px] text-gray-600 mt-2 uppercase tracking-widest font-bold">16:9 Optimized by default</p>
                </div>
              )}
            </div>
          </div>

          {/* Generated Banner Result */}
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex justify-between items-center px-1">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">OUTPUT BANNERS</h2>
              <div className="relative">
                {generatedImages.length > 0 && (
                  <button 
                    onClick={() => setShowExportMenu(!showExportMenu)} 
                    className="text-xs flex items-center gap-1 text-brand-400 hover:text-brand-300 font-bold bg-brand-500/10 px-3 py-1.5 rounded-lg border border-brand-500/20"
                  >
                    EXPORT OPTIONS
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
                  </button>
                )}
                
                {showExportMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-gray-800 bg-gray-950">
                      <span className="text-[10px] text-gray-500 font-bold uppercase p-2 block">Optimized Formats</span>
                    </div>
                    {exportSizes.map((size) => (
                      <button 
                        key={size.label} 
                        onClick={() => handleExport(size.w, size.h, size.label)}
                        className="w-full text-left px-4 py-3 text-xs text-gray-300 hover:bg-brand-500 hover:text-white transition-colors flex justify-between items-center group"
                      >
                        <span>{size.label}</span>
                        <span className="text-[10px] bg-gray-800 group-hover:bg-brand-600 text-gray-500 group-hover:text-white px-1.5 py-0.5 rounded uppercase">{size.tag}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex-grow grid grid-cols-2 grid-rows-2 gap-3 aspect-video">
              {[0, 1, 2, 3].map((index) => {
                const img = generatedImages[index];
                const isSelected = selectedImageIndex === index && generatedImages.length > 0;
                return (
                  <div key={index} onClick={() => img && setSelectedImageIndex(index)} className={`relative rounded-xl border-2 border-dashed overflow-hidden flex items-center justify-center transition-all ${status === EditorStatus.PROCESSING ? 'border-gray-800 bg-gray-900' : img ? isSelected ? 'border-brand-500 bg-black shadow-lg shadow-brand-500/10' : 'border-gray-800 bg-black hover:border-gray-600' : 'border-gray-900 bg-gray-900/30'}`}>
                    {status === EditorStatus.PROCESSING ? (
                      <div className="flex flex-col items-center gap-2"><Spinner className="w-6 h-6 text-brand-500" /><span className="text-[10px] text-gray-600">Generating...</span></div>
                    ) : img ? (
                      <>
                        <img src={img.url} alt="Result" className="w-full h-full object-cover" />
                        <div className="absolute top-2 left-2 flex gap-1 opacity-0 hover:opacity-100 transition-opacity">
                           <span className="text-[8px] bg-brand-500 text-white px-1.5 py-0.5 rounded font-bold">AI GENERATED</span>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setExpandedImage(img); }} 
                          className="absolute bottom-2 right-2 p-1.5 bg-gray-950/80 text-white rounded-lg hover:bg-brand-500 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9" /></svg>
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-700 font-mono">{index + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="max-w-4xl w-full mx-auto">
          <div className="mb-6">
             <div className="flex flex-wrap gap-2 justify-center">
              {loadingSuggestions ? (
                <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase font-bold tracking-widest"><Spinner className="w-3 h-3" /> Analyzing Subject...</div>
              ) : suggestions.map((s, i) => (
                <button key={i} onClick={() => setPrompt(s)} className="text-[10px] uppercase font-bold tracking-wider bg-gray-900/50 hover:bg-brand-500/20 text-gray-500 hover:text-brand-400 border border-gray-800 px-4 py-2 rounded-xl transition-all">{s}</button>
              ))}
             </div>
          </div>

          <div className="bg-gray-900/50 border border-gray-800 rounded-[2.5rem] p-5 shadow-2xl focus-within:border-brand-500/30 transition-all flex flex-col gap-4 backdrop-blur-sm">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={status === EditorStatus.PROCESSING}
              placeholder="What is this blog post about? Describe the mood, environment, or key message..."
              className="bg-transparent text-lg placeholder-gray-800 text-gray-200 focus:outline-none resize-none min-h-[100px] font-medium leading-relaxed"
            />
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                 <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></div>
                 <span className="text-[10px] text-gray-600 uppercase font-bold tracking-widest">Premium Output Mode</span>
              </div>
              <button
                onClick={handleGenerate}
                disabled={status === EditorStatus.PROCESSING || !prompt.trim()}
                className="bg-gradient-to-r from-brand-600 to-brand-400 hover:from-brand-500 hover:to-brand-300 text-white font-black uppercase text-xs tracking-widest py-4 px-12 rounded-2xl transition-all disabled:opacity-50 flex items-center gap-2 shadow-2xl shadow-brand-500/30 active:scale-95"
              >
                {status === EditorStatus.PROCESSING ? 'Creating Banners...' : 'Design My Banners'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {expandedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-6" onClick={() => setExpandedImage(null)}>
           <div className="relative max-w-6xl w-full" onClick={e => e.stopPropagation()}>
              <img src={expandedImage.url} alt="Preview" className="w-full rounded-2xl shadow-[0_0_100px_rgba(14,165,233,0.2)]" />
              <div className="mt-8 flex justify-center gap-6">
                 {exportSizes.slice(0, 3).map(size => (
                   <button 
                    key={size.label}
                    onClick={() => handleExport(size.w, size.h, size.label, expandedImage)} 
                    className="bg-white/10 hover:bg-brand-500 text-white font-bold py-3 px-8 rounded-xl transition-all border border-white/10"
                   >
                     {size.tag} - {size.w}x{size.h}
                   </button>
                 ))}
                 <button onClick={() => setExpandedImage(null)} className="text-gray-500 font-bold uppercase tracking-widest text-xs px-8 hover:text-white transition-colors">Close</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
