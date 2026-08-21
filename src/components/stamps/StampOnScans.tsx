import React, { useState, useEffect, useRef } from 'react';
import { 
  Stamp, 
  Upload, 
  FileText, 
  Check, 
  Trash2, 
  Download, 
  Eye, 
  Sparkles, 
  RefreshCw, 
  CheckSquare, 
  Square, 
  Layers, 
  Move, 
  Sliders, 
  RotateCw, 
  Maximize2, 
  Info,
  CheckCircle2,
  FileCheck,
  Plus
} from 'lucide-react';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';

// Set up pdf.js worker URL matching exact installed library version
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

interface SavedStamp {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  removeBg: boolean;
  threshold: number;
  isDefault: boolean;
  createdAt: string;
}

export const StampOnScans = () => {
  const { t, isRTL } = useLanguage();

  // Stamp States
  const [stamps, setStamps] = useState<SavedStamp[]>([]);
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null);
  const [isUploadingStamp, setIsUploadingStamp] = useState(false);
  const [newStampName, setNewStampName] = useState('');
  const [stampRemoveBg, setStampRemoveBg] = useState(true);
  const [stampThreshold, setStampThreshold] = useState(210);

  // PDF Document States
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [activePageIndex, setActivePageIndex] = useState<number>(0); // 0-based index

  // Page Selection Strategy: 'all' | 'first' | 'last' | 'custom'
  const [stampPageMode, setStampPageMode] = useState<'all' | 'first' | 'last' | 'custom'>('all');
  const [selectedPages, setSelectedPages] = useState<number[]>([]); // 1-based page numbers

  // Stamp Positioning & Transforms
  const [positionX, setPositionX] = useState<number>(70); // % from left (0 to 100)
  const [positionY, setPositionY] = useState<number>(80); // % from top (0 to 100)
  const [stampScale, setStampScale] = useState<number>(100); // % of default size (50 to 200)
  const [stampRotation, setStampRotation] = useState<number>(-3); // degrees (-180 to 180)
  const [stampOpacity, setStampOpacity] = useState<number>(95); // % (10 to 100)

  // Statuses
  const [isProcessing, setIsProcessing] = useState(false);
  const [stampedPdfUrl, setStampedPdfUrl] = useState<string | null>(null);
  const [stampedFileName, setStampedFileName] = useState<string>('stamped_document.pdf');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // References for Drag & Canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Load Saved Stamps from LocalStorage on Mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('silkroad_saved_stamps');
      if (saved) {
        const parsed: SavedStamp[] = JSON.parse(saved);
        setStamps(parsed);
        const defaultStamp = parsed.find(s => s.isDefault) || parsed[0];
        if (defaultStamp) {
          setSelectedStampId(defaultStamp.id);
        }
      }
    } catch (err) {
      console.error('Failed to load saved stamps from localStorage:', err);
    }
  }, []);

  // Save Stamps to LocalStorage
  const saveStampsToStorage = (updated: SavedStamp[]) => {
    setStamps(updated);
    try {
      localStorage.setItem('silkroad_saved_stamps', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to save stamps to localStorage:', err);
    }
  };

  // Helper: Process Image to Remove White Paper Background
  const processImageTransparency = (dataUrl: string, threshold: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // If pixel is close to white/light grey, make it transparent
          if (r >= threshold && g >= threshold && b >= threshold) {
            data[i + 3] = 0; // Alpha = 0
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Handle Uploading a New Stamp
  const handleStampUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingStamp(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const rawDataUrl = event.target?.result as string;
      const finalDataUrl = stampRemoveBg 
        ? await processImageTransparency(rawDataUrl, stampThreshold)
        : rawDataUrl;

      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        const newStamp: SavedStamp = {
          id: 'stamp_' + Date.now(),
          name: newStampName.trim() || file.name.replace(/\.[^/.]+$/, "") || 'Печать компании',
          dataUrl: finalDataUrl,
          width: img.width || 200,
          height: img.height || 200,
          removeBg: stampRemoveBg,
          threshold: stampThreshold,
          isDefault: stamps.length === 0,
          createdAt: new Date().toISOString()
        };

        const updated = [...stamps, newStamp];
        saveStampsToStorage(updated);
        setSelectedStampId(newStamp.id);
        setIsUploadingStamp(false);
        setNewStampName('');
        setSuccessMessage('Печать успешно загружена и сохранена!');
        setTimeout(() => setSuccessMessage(null), 3000);
      };
      img.src = finalDataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Delete Stamp
  const handleDeleteStamp = (id: string) => {
    const updated = stamps.filter(s => s.id !== id);
    saveStampsToStorage(updated);
    if (selectedStampId === id) {
      setSelectedStampId(updated[0]?.id || null);
    }
  };

  // Set Default Stamp
  const handleSetDefaultStamp = (id: string) => {
    const updated = stamps.map(s => ({
      ...s,
      isDefault: s.id === id
    }));
    saveStampsToStorage(updated);
    setSelectedStampId(id);
  };

  // Handle PDF Upload
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfFile(file);
    setStampedFileName(`${file.name.replace(/\.pdf$/i, '')}_stamped.pdf`);
    setStampedPdfUrl(null);

    const arrayBuffer = await file.arrayBuffer();
    setPdfBytes(arrayBuffer);

    try {
      // Pass a sliced copy to pdfjsLib so arrayBuffer is not detached by web worker transfer
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      const pdf = await loadingTask.promise;
      setPdfDocProxy(pdf);
      setNumPages(pdf.numPages);
      setActivePageIndex(0);

      // Default selection: all pages
      const allPageNums = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      setSelectedPages(allPageNums);
    } catch (err) {
      console.error('Error parsing PDF:', err);
      alert('Не удалось загрузить PDF файл. Убедитесь, что файл не поврежден.');
    }
  };

  // Render Current PDF Page onto Canvas
  useEffect(() => {
    if (!pdfDocProxy) return;

    let isMounted = true;

    const renderPage = async () => {
      try {
        const page = await pdfDocProxy.getPage(activePageIndex + 1);
        if (!isMounted) return;

        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          canvas,
          viewport: viewport
        } as any;

        await page.render(renderContext).promise;
      } catch (err) {
        console.error('Page render error:', err);
      }
    };

    renderPage();

    return () => {
      isMounted = false;
    };
  }, [pdfDocProxy, activePageIndex]);

  // Handle Page Mode Selection Updates
  useEffect(() => {
    if (numPages === 0) return;
    if (stampPageMode === 'all') {
      setSelectedPages(Array.from({ length: numPages }, (_, i) => i + 1));
    } else if (stampPageMode === 'first') {
      setSelectedPages([1]);
    } else if (stampPageMode === 'last') {
      setSelectedPages([numPages]);
    }
  }, [stampPageMode, numPages]);

  // Toggle Page Selection in Custom Mode
  const togglePageSelection = (pageNum: number) => {
    setStampPageMode('custom');
    setSelectedPages(prev => 
      prev.includes(pageNum) 
        ? prev.filter(p => p !== pageNum) 
        : [...prev, pageNum].sort((a, b) => a - b)
    );
  };

  // Auto-Detect Free Space on Page Canvas
  const detectFreeSpace = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Define candidate regions (120x120 approx)
    const boxW = Math.min(150, w * 0.25);
    const boxH = Math.min(150, h * 0.25);

    const candidates = [
      { name: 'BottomRight', x: w - boxW - 20, y: h - boxH - 20, posX: 75, posY: 80 },
      { name: 'BottomLeft', x: 20, y: h - boxH - 20, posX: 15, posY: 80 },
      { name: 'BottomCenter', x: (w - boxW) / 2, y: h - boxH - 20, posX: 45, posY: 80 },
      { name: 'TopRight', x: w - boxW - 20, y: 20, posX: 75, posY: 15 }
    ];

    let minDarkPixels = Infinity;
    let bestCandidate = candidates[0];

    candidates.forEach(c => {
      try {
        const imgData = ctx.getImageData(c.x, c.y, boxW, boxH);
        const pixels = imgData.data;
        let darkCount = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          if (r < 200 || g < 200 || b < 200) {
            darkCount++;
          }
        }

        if (darkCount < minDarkPixels) {
          minDarkPixels = darkCount;
          bestCandidate = c;
        }
      } catch (e) {
        console.error('Auto detect error:', e);
      }
    });

    setPositionX(bestCandidate.posX);
    setPositionY(bestCandidate.posY);
    setSuccessMessage(`Свободное место найдено (${bestCandidate.name})`);
    setTimeout(() => setSuccessMessage(null), 2500);
  };

  // Drag Stamp directly on Canvas Container
  const updatePositionFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const clampedX = Math.max(0.5, Math.min(99.5, x));
    const clampedY = Math.max(0.5, Math.min(99.5, y));

    setPositionX(Number(clampedX.toFixed(2)));
    setPositionY(Number(clampedY.toFixed(2)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePositionFromPointer(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updatePositionFromPointer(e);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
  };

  // Process & Generate Stamped PDF
  const handleProcessPdf = async () => {
    if (!pdfFile) {
      alert('Загрузите PDF документ!');
      return;
    }

    const activeStamp = stamps.find(s => s.id === selectedStampId);
    if (!activeStamp) {
      alert('Выберите или загрузите образец печати!');
      return;
    }

    if (selectedPages.length === 0) {
      alert('Выберите хотя бы одну страницу для наложения печати!');
      return;
    }

    setIsProcessing(true);

    try {
      // Get fresh ArrayBuffer from file
      const currentBytes = await pdfFile.arrayBuffer();

      // Load PDF via pdf-lib
      const pdfDoc = await PDFDocument.load(currentBytes);

      // Convert Stamp Base64 Data URL to Image bytes
      const stampImageBytes = await fetch(activeStamp.dataUrl).then(res => res.arrayBuffer());
      const stampImage = await pdfDoc.embedPng(stampImageBytes);

      // Target Pages
      const pagesToStamp = selectedPages;

      pagesToStamp.forEach(pageNum => {
        if (pageNum < 1 || pageNum > pdfDoc.getPageCount()) return;

        const page = pdfDoc.getPage(pageNum - 1);
        const { width: pWidth, height: pHeight } = page.getSize();

        // Calculate Stamp Size on PDF relative to page width (22% of page width at 100% scale)
        const baseWidth = pWidth * 0.22;
        const scaleFactor = (stampScale / 100);
        const stampW = baseWidth * scaleFactor;
        const stampH = (stampW / activeStamp.width) * activeStamp.height;

        // Target Center Coordinates on PDF page (X from left, Y from bottom)
        const centerX = (positionX / 100) * pWidth;
        const centerY = pHeight - ((positionY / 100) * pHeight);

        // Rotation angle in radians
        const rad = (stampRotation * Math.PI) / 180;

        // Calculate center offset accounting for rotation around image bottom-left origin in pdf-lib
        const centerOffsetX = (stampW / 2) * Math.cos(rad) - (stampH / 2) * Math.sin(rad);
        const centerOffsetY = (stampW / 2) * Math.sin(rad) + (stampH / 2) * Math.cos(rad);

        const pdfX = centerX - centerOffsetX;
        const pdfY = centerY - centerOffsetY;

        page.drawImage(stampImage, {
          x: pdfX,
          y: pdfY,
          width: stampW,
          height: stampH,
          opacity: stampOpacity / 100,
          rotate: degrees(stampRotation)
        });
      });

      // Save PDF Bytes
      const modifiedPdfBytes = await pdfDoc.save();

      // Create Blob URL for downloading & previewing
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setStampedPdfUrl(url);
      setIsProcessing(false);
      setSuccessMessage('Печать успешно нанесена на документ!');
    } catch (err) {
      console.error('Error stamping PDF:', err);
      setIsProcessing(false);
      alert('Произошла ошибка при нанесении печати на PDF: ' + (err as Error).message);
    }
  };

  const currentStamp = stamps.find(s => s.id === selectedStampId);

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-indigo-900 text-white p-6 sm:p-8 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider mb-3 backdrop-blur-sm border border-blue-400/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('pdfStampingTool')}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {t('stampOnScans')}
            </h2>
            <p className="text-slate-300 text-sm mt-1 max-w-xl">
              Автоматическое или точное ручное нанесение печати/штампа на сканы и PDF документы. Сохраняйте образцы печатей и проставляйте их на всех или выбранных листах в один клик.
            </p>
          </div>

          {stampedPdfUrl && (
            <a
              href={stampedPdfUrl}
              download={stampedFileName}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm rounded-2xl shadow-lg shadow-emerald-900/30 transition-all hover:scale-105"
            >
              <Download className="w-5 h-5" />
              <span>Скачать готовый PDF</span>
            </a>
          )}
        </div>
      </div>

      {/* Success Alert */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-sm font-semibold animate-fade-in shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Grid: Left Side (Stamp & Settings) + Right Side (PDF Preview & Canvas) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: 1. Sample Stamps Manager & 2. PDF Upload / Page Selectors */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* 1. SAVED STAMPS MANAGER */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Stamp className="w-5 h-5 text-blue-600" />
                <span>1. {t('manageStamps')}</span>
              </h3>
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                {stamps.length} шт.
              </span>
            </div>

            {/* List of Saved Stamps */}
            {stamps.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {stamps.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedStampId(s.id)}
                    className={cn(
                      "p-3 rounded-2xl border-2 cursor-pointer transition-all relative flex flex-col items-center justify-center text-center group",
                      selectedStampId === s.id
                        ? "border-blue-600 bg-blue-50/50 shadow-sm"
                        : "border-slate-100 hover:border-slate-200 bg-slate-50/50"
                    )}
                  >
                    {/* Background Grid Pattern to preview transparency */}
                    <div className="w-20 h-20 rounded-xl bg-white border border-slate-200 p-2 flex items-center justify-center overflow-hidden mb-2 relative bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:8px_8px]">
                      <img 
                        src={s.dataUrl} 
                        alt={s.name} 
                        className="max-w-full max-h-full object-contain filter drop-shadow-sm"
                      />
                    </div>
                    <p className="text-xs font-bold text-slate-800 truncate w-full px-1">{s.name}</p>
                    
                    {s.isDefault && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full mt-1">
                        Основная
                      </span>
                    )}

                    {/* Action Buttons */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white/90 p-1 rounded-lg border border-slate-200 shadow-sm">
                      {!s.isDefault && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSetDefaultStamp(s.id); }}
                          title="Сделать основной"
                          className="p-1 text-slate-400 hover:text-blue-600 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteStamp(s.id); }}
                        title="Удалить"
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center bg-slate-50/50 mb-4">
                <Stamp className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-medium">Нет загруженных образцов печатей.</p>
              </div>
            )}

            {/* Upload New Stamp Controls */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>Загрузить новый образец</span>
              </p>

              <input
                type="text"
                placeholder="Название (например: Печать ТОО / Штамп КОПИЯ ВЕРНА)"
                value={newStampName}
                onChange={(e) => setNewStampName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />

              {/* White Background Remover Toggle */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={stampRemoveBg}
                    onChange={(e) => setStampRemoveBg(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>{t('makeBackgroundTransparent')}</span>
                </label>

                {stampRemoveBg && (
                  <div className="pt-1">
                    <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                      <span>{t('threshold')}</span>
                      <span>{stampThreshold}</span>
                    </div>
                    <input
                      type="range"
                      min="150"
                      max="250"
                      value={stampThreshold}
                      onChange={(e) => setStampThreshold(Number(e.target.value))}
                      className="w-full accent-blue-600 cursor-pointer h-1 bg-slate-200 rounded-lg"
                    />
                  </div>
                )}
              </div>

              <label className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-sm transition-colors">
                <Upload className="w-4 h-4" />
                <span>{isUploadingStamp ? 'Обработка...' : t('uploadStampSample')}</span>
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={handleStampUpload}
                  disabled={isUploadingStamp}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* 2. PDF DOCUMENT UPLOAD & PAGE SCOPE */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              <span>2. {t('uploadPdfDocument')}</span>
            </h3>

            {/* Drop Zone */}
            <label className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/30 p-6 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all text-center">
              <FileCheck className="w-10 h-10 text-blue-500 mb-2" />
              <p className="text-xs font-bold text-slate-800">
                {pdfFile ? pdfFile.name : 'Нажмите или перетащите PDF документ сюда'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Поддерживаются отсканированные договоры, накладные, инвойсы (до 50 МБ)
              </p>
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePdfUpload}
                className="hidden"
              />
            </label>

            {/* Page Scope Selection Options */}
            {numPages > 0 && (
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('stampPages')}</span>
                  <span className="text-blue-600">Всего листов: {numPages}</span>
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setStampPageMode('all')}
                    className={cn(
                      "py-2 px-3 rounded-xl border text-center transition-all",
                      stampPageMode === 'all'
                        ? "bg-blue-600 text-white border-blue-600 font-bold"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {t('allPages')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStampPageMode('first')}
                    className={cn(
                      "py-2 px-3 rounded-xl border text-center transition-all",
                      stampPageMode === 'first'
                        ? "bg-blue-600 text-white border-blue-600 font-bold"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {t('firstPageOnly')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStampPageMode('last')}
                    className={cn(
                      "py-2 px-3 rounded-xl border text-center transition-all",
                      stampPageMode === 'last'
                        ? "bg-blue-600 text-white border-blue-600 font-bold"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {t('lastPageOnly')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStampPageMode('custom')}
                    className={cn(
                      "py-2 px-3 rounded-xl border text-center transition-all",
                      stampPageMode === 'custom'
                        ? "bg-blue-600 text-white border-blue-600 font-bold"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {t('selectedPagesOnly')}
                  </button>
                </div>

                {/* Individual Page Checkboxes */}
                {numPages > 1 && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-[11px] font-bold text-slate-500 mb-2">Выберите листы вручную:</p>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                      {Array.from({ length: numPages }, (_, i) => i + 1).map((pNum) => {
                        const isChecked = selectedPages.includes(pNum);
                        return (
                          <button
                            key={pNum}
                            onClick={() => togglePageSelection(pNum)}
                            className={cn(
                              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border",
                              isChecked
                                ? "bg-blue-100 text-blue-700 border-blue-300"
                                : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                            )}
                          >
                            {isChecked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                            <span>Стр. {pNum}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. STAMP POSITION & FINE-TUNING TRANSFORM CONTROLS */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-blue-600" />
                <span>3. Настройки положения и размера</span>
              </h3>
              <button
                type="button"
                onClick={detectFreeSpace}
                disabled={!pdfFile}
                className="px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>{t('autoDetectSpace')}</span>
              </button>
            </div>

            {/* Position Presets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => { setPositionX(75); setPositionY(80); }}
                className="py-2 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-center"
              >
                {t('bottomRight')}
              </button>
              <button
                type="button"
                onClick={() => { setPositionX(15); setPositionY(80); }}
                className="py-2 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-center"
              >
                {t('bottomLeft')}
              </button>
              <button
                type="button"
                onClick={() => { setPositionX(45); setPositionY(80); }}
                className="py-2 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-center"
              >
                {t('bottomCenter')}
              </button>
              <button
                type="button"
                onClick={() => { setPositionX(75); setPositionY(15); }}
                className="py-2 px-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-center"
              >
                {t('topRight')}
              </button>
            </div>

            {/* Sliders for Scale, Rotation, Opacity */}
            <div className="space-y-3 pt-2">
              <div>
                <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                  <span>{t('stampScale')}</span>
                  <span>{stampScale}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="30"
                    max="300"
                    value={stampScale}
                    onChange={(e) => setStampScale(Number(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                  />
                  <div className="flex gap-1 shrink-0">
                    <button 
                      onClick={() => setStampScale(80)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      80%
                    </button>
                    <button 
                      onClick={() => setStampScale(100)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      100%
                    </button>
                    <button 
                      onClick={() => setStampScale(150)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      150%
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                  <span>{t('stampRotation')} (наклон)</span>
                  <span>{stampRotation}°</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="-45"
                    max="45"
                    value={stampRotation}
                    onChange={(e) => setStampRotation(Number(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                  />
                  <div className="flex gap-1 shrink-0">
                    <button 
                      onClick={() => setStampRotation(-3)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      -3°
                    </button>
                    <button 
                      onClick={() => setStampRotation(0)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      0°
                    </button>
                    <button 
                      onClick={() => setStampRotation(3)} 
                      className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                    >
                      +3°
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold text-slate-600 mb-1">
                  <span>{t('stampOpacity')} (прозрачность оттиска)</span>
                  <span>{stampOpacity}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="100"
                  value={stampOpacity}
                  onChange={(e) => setStampOpacity(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                />
              </div>
            </div>

            {/* PROCESS & GENERATE PDF BUTTON */}
            <button
              type="button"
              onClick={handleProcessPdf}
              disabled={isProcessing || !pdfFile || !selectedStampId}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 transition-all"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Нанесение печати на файл...</span>
                </>
              ) : (
                <>
                  <Stamp className="w-5 h-5" />
                  <span>{t('processAndDownload')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Document Canvas Preview */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-600" />
              <span>{t('previewPage')}</span>
            </h3>

            {numPages > 1 && (
              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-700">
                <button
                  disabled={activePageIndex === 0}
                  onClick={() => setActivePageIndex(prev => Math.max(0, prev - 1))}
                  className="px-2.5 py-1 bg-white disabled:opacity-40 rounded-lg shadow-xs"
                >
                  ← Назад
                </button>
                <span className="px-2">
                  Лист {activePageIndex + 1} из {numPages}
                </span>
                <button
                  disabled={activePageIndex >= numPages - 1}
                  onClick={() => setActivePageIndex(prev => Math.min(numPages - 1, prev + 1))}
                  className="px-2.5 py-1 bg-white disabled:opacity-40 rounded-lg shadow-xs"
                >
                  Вперед →
                </button>
              </div>
            )}
          </div>

          {/* Interactive Document Preview Box */}
          {pdfFile ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-100/70 p-4 rounded-2xl border border-slate-200 overflow-hidden relative min-h-[500px]">
              
              <p className="text-[11px] text-slate-500 font-medium mb-2 flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-blue-600" />
                <span>Перетаскивайте печать мышью прямо по предпросмотру листа для точного размещения!</span>
              </p>

              {/* Interactive Canvas Wrapper */}
              <div
                ref={previewContainerRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="relative inline-block shadow-2xl rounded-sm bg-white overflow-hidden cursor-crosshair max-w-full select-none"
              >
                {/* PDF Page Canvas */}
                <canvas ref={canvasRef} className="block max-w-full h-auto" />

                {/* Stamp Interactive Overlay */}
                {currentStamp && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${positionX}%`,
                      top: `${positionY}%`,
                      width: '22%',
                      transform: `translate(-50%, -50%) rotate(${stampRotation}deg) scale(${stampScale / 100})`,
                      transformOrigin: 'center center',
                      opacity: stampOpacity / 100,
                      pointerEvents: 'none'
                    }}
                    className="transition-transform duration-75 filter drop-shadow-md border-2 border-dashed border-blue-400 p-0.5 rounded-lg"
                  >
                    <img
                      src={currentStamp.dataUrl}
                      alt="Stamp Overlay"
                      className="w-full h-auto block pointer-events-none"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200 text-center min-h-[450px]">
              <FileText className="w-16 h-16 text-slate-300 mb-3 animate-pulse" />
              <h4 className="text-base font-bold text-slate-700 mb-1">
                Загрузите PDF скан для предпросмотра
              </h4>
              <p className="text-xs text-slate-400 max-w-md">
                Вы сможете видеть каждую страницу документа в реальном времени, перемещать печать мышью и настраивать прозрачность.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
