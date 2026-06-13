import React, { useState, useEffect } from 'react';
import * as Icons from '@/src/components/ui/Icons';
import { Skeleton } from '@/src/components/ui/Skeleton';

interface UniversalPreviewerProps {
  url: string;
  filename: string;
  onDownload?: () => void;
  hideHeader?: boolean;
  viewerMode?: 'web' | 'local';
  setViewerMode?: (mode: 'web' | 'local') => void;
  highlightText?: string | null;
}

interface SlideData {
  title: string;
  bullets: string[];
}

interface SheetData {
  name: string;
  html: string;
}

export const UniversalPreviewer: React.FC<UniversalPreviewerProps> = ({ url, filename, onDownload, hideHeader, viewerMode: externalViewerMode, setViewerMode: externalSetViewerMode, highlightText }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<{
    type: 'docx' | 'xlsx' | 'pptx' | 'text';
    html?: string;
    sheets?: SheetData[];
    slides?: SlideData[];
    rawText?: string;
  } | null>(null);

  // Detect if url is a local sandbox development file (Microsoft / Google online viewers can't fetch local files)
  const isLocalUrl = url.includes('localhost') || url.includes('127.0.0.1') || url.startsWith('blob:') || url.startsWith('data:');
  
  // Dual-mode: 'web' uses Google/Microsoft viewers, 'local' uses local JS libraries/iframes
  const [internalViewerMode, setInternalViewerMode] = useState<'web' | 'local'>(isLocalUrl ? 'local' : 'web');
  
  const viewerMode = externalViewerMode || internalViewerMode;
  const setViewerMode = externalSetViewerMode || setInternalViewerMode;

  // PPTX active slide index
  const [activeSlide, setActiveSlide] = useState(0);
  // XLSX active sheet index
  const [activeSheet, setActiveSheet] = useState(0);
  // Image zoom state
  const [imageFit, setImageFit] = useState<'contain' | 'cover' | 'original'>('contain');

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  useEffect(() => {
    // Reset states
    setError(null);
    setParsedData(null);
    setActiveSlide(0);
    setActiveSheet(0);

    // If it's a simple render (image, pdf) or we are in web viewer mode, we don't parse it in JS
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf'].includes(ext)) {
      return;
    }

    const parseFile = async () => {
      setLoading(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();

        if (ext === 'docx') {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer });
          setParsedData({
            type: 'docx',
            html: result.value || '<p className="text-zinc-400 italic">This Word document is empty.</p>'
          });
        } 
        else if (['xlsx', 'xls', 'csv'].includes(ext)) {
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const sheets = workbook.SheetNames.map(name => {
            const worksheet = workbook.Sheets[name];
            const html = XLSX.utils.sheet_to_html(worksheet, {
              header: '<table className="w-full border-collapse border border-zinc-200 dark:border-white/10 text-xs text-zinc-700 dark:text-zinc-300">',
              footer: '</table>'
            });
            return { name, html };
          });
          setParsedData({ type: 'xlsx', sheets });
        } 
        else if (ext === 'pptx') {
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(arrayBuffer);
          
          const slideFiles: { name: string; file: any }[] = [];
          zip.forEach((relativePath, file) => {
            if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
              slideFiles.push({ name: relativePath, file });
            }
          });

          slideFiles.sort((a, b) => {
            const numA = parseInt(a.name.match(/\d+/)?. [0] || '0');
            const numB = parseInt(b.name.match(/\d+/)?. [0] || '0');
            return numA - numB;
          });

          const slides: SlideData[] = [];
          for (const s of slideFiles) {
            const xmlText = await s.file.async('text');
            const textMatches = xmlText.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
            const cleanTexts = textMatches.map(match => {
              let t = match.replace(/<[^>]+>/g, '');
              t = t.replace(/&amp;/g, '&')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&quot;/g, '"')
                   .replace(/&apos;/g, "'");
              return t.trim();
            }).filter(Boolean);

            const unique: string[] = [];
            cleanTexts.forEach(item => {
              if (unique.length === 0 || unique[unique.length - 1] !== item) {
                unique.push(item);
              }
            });

            slides.push({
              title: unique[0] || `Slide ${slides.length + 1}`,
              bullets: unique.slice(1)
            });
          }

          if (slides.length === 0) {
             slides.push({ title: "Slide 1", bullets: ["No text content extracted from this presentation."] });
          }

          setParsedData({ type: 'pptx', slides });
        }
        else if (['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'json', 'py', 'r', 'java', 'sql', 'cpp', 'c'].includes(ext)) {
          const decoder = new TextDecoder('utf-8');
          const rawText = decoder.decode(arrayBuffer);
          setParsedData({ type: 'text', rawText });
        }
        else {
          throw new Error('Unsupported extension');
        }
      } catch (err: any) {
        console.error("Preview extraction failure:", err);
        setError(`Native preview failed: ${err.message || 'Cannot read file'}`);
      } finally {
        setLoading(false);
      }
    };

    parseFile();
  }, [url, ext]);

  const triggerDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      window.open(url, '_blank');
    }
  };  const renderContent = () => {
    if (loading) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-12 bg-zinc-50 dark:bg-[#0B0F19]">
          <Icons.IconRefresh className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Parsing Document Engine...</div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-red-50 dark:bg-red-950/20">
          <Icons.IconAlertCircle className="w-16 h-16 mb-4 text-red-500" />
          <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Parsing Engine Failed</h4>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
            {error}
          </div>
          <button 
            onClick={triggerDownload} 
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-2"
          >
            <Icons.IconUpload className="w-3.5 h-3.5 rotate-180" /> Download Document
          </button>
        </div>
      );
    }

    // 1. Image Viewer (Posters, layouts, pics)
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
      return (
        <div className="h-full w-full flex flex-col bg-zinc-950">
          <div className="p-2 border-b border-white/5 flex items-center justify-end bg-black/40 gap-2 shrink-0">
            <div className="flex bg-white/5 p-1 rounded-lg">
              {(['contain', 'cover', 'original'] as const).map((fit) => (
                <button 
                   key={fit}
                  onClick={() => setImageFit(fit)} 
                  className={`px-2.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                    imageFit === fit ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-bold' : 'text-zinc-450 hover:text-white'
                  }`}
                >
                  {fit}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-6 custom-scrollbar">
            <img 
              src={url} 
              alt={filename} 
              className={`rounded-lg shadow-2xl transition-all ${
                imageFit === 'contain' ? 'max-w-full max-h-full object-contain' :
                imageFit === 'cover' ? 'w-full h-full object-cover' : 'max-w-none'
              }`} 
            />
          </div>
        </div>
      );
    }

    // 2. Web Viewer Mode (Official Google Docs Viewer or Microsoft Office Viewer)
    if (viewerMode === 'web' && ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)) {
      if (ext === 'pdf') {
        return (
          <iframe 
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`} 
            className="w-full h-full border-0 bg-white" 
            title={filename} 
          />
        );
      } else {
        return (
          <iframe 
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`} 
            className="w-full h-full border-0 bg-white" 
            title={filename} 
          />
        );
      }
    }

    // 3. Local Reader Mode (Mammoth, xlsx, pptx player, direct PDF iframe)
    if (ext === 'pdf') {
      return (
        <iframe 
          src={url} 
          className="w-full h-full border-0 bg-white" 
          title={filename} 
        />
      );
    }

    if (ext === 'docx') {
      let finalHtml = parsedData?.html || '';
      
      if (highlightText && finalHtml) {
        const words = highlightText.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (words.length > 0) {
          const fuzzyPattern = words.join('(?:\\s|&nbsp;|<[^>]+>)+');
          try {
            const regex = new RegExp(`(${fuzzyPattern})`, 'gi');
            if (regex.test(finalHtml)) {
              finalHtml = finalHtml.replace(regex, '<mark id="evidence-anchor-highlight" class="bg-[var(--brand-primary)]/10 dark:bg-[var(--brand-primary)]/30 text-inherit px-1 rounded transition-all duration-500">$1</mark>');
              setTimeout(() => {
                const mark = document.getElementById('evidence-anchor-highlight');
                if (mark) {
                  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 300);
            }
          } catch (e) {
            console.error("Highlight regex error", e);
          }
        }
      }

      return (
        <div className="h-full bg-white dark:bg-[#0B0F19] overflow-y-auto p-12 custom-scrollbar">
          <div 
            className="max-w-3xl mx-auto prose dark:prose-invert prose-sm md:prose-base dark:text-zinc-200 leading-relaxed font-medium"
            dangerouslySetInnerHTML={{ __html: finalHtml }}
          />
        </div>
      );
    }

    if (ext === 'doc') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-[#0B0F19]">
          <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
          <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Legacy .doc format</h4>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
            Local preview parsing is only supported for modern .docx files. Please use the Web Viewer mode.
          </div>
          <button 
            onClick={() => setViewerMode('web')} 
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md"
          >
            Switch to Web Viewer
          </button>
        </div>
      );
    }

    if (ext === 'pptx') {
      const totalSlides = parsedData?.slides?.length || 0;
      const currentSlide = parsedData?.slides?.[activeSlide];

      return (
        <div className="h-full flex bg-zinc-900 overflow-hidden select-none">
          {/* Thumbnails Sidebar */}
          <div className="w-[180px] bg-zinc-950/80 border-r border-white/5 overflow-y-auto p-3 flex flex-col gap-2.5 custom-scrollbar shrink-0">
            {parsedData?.slides?.map((slide, idx) => (
              <div 
                key={idx}
                onClick={() => setActiveSlide(idx)}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                  activeSlide === idx 
                    ? 'border-orange-500 bg-orange-500/10 shadow-lg shadow-orange-500/10' 
                    : 'border-white/5 bg-zinc-900/50 hover:border-white/10 hover:bg-zinc-900'
                }`}
              >
                <div className="text-[7px] font-black uppercase tracking-wider text-zinc-500 mb-1">Slide {idx + 1}</div>
                <div className="text-[9px] font-bold text-zinc-300 truncate leading-snug">{slide.title}</div>
              </div>
            ))}
          </div>

          {/* Active Presentation Canvas */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-zinc-900/80 relative">
            <div className="absolute top-4 left-4 right-4 bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-bold p-2.5 rounded-lg text-center backdrop-blur-md z-10 shadow-lg shadow-orange-500/5 flex items-center justify-center gap-2">
              <Icons.IconSparkles className="w-3.5 h-3.5" />
              Native Visuals Hidden Ã¢ÂÂ This text-only preview is optimized for AI grading visibility. For original layouts, charts, and images, please download the file.
            </div>
            
            <div className="w-full max-w-xl aspect-[4/3] bg-white dark:bg-[#0F172A] p-8 flex flex-col justify-between border border-zinc-200 dark:border-white/5 relative overflow-hidden mt-8">
              <div className="absolute right-0 bottom-0 text-[100px] font-black opacity-[0.015] text-zinc-900 pointer-events-none select-none translate-x-10 translate-y-10">DECK</div>
              <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar">
                <h3 className="text-lg font-black text-zinc-900 dark:text-white tracking-tight border-b-2 border-orange-500 pb-2 leading-snug">{currentSlide?.title}</h3>
                <ul className="space-y-2.5 pl-4 list-disc text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {currentSlide?.bullets.map((b, i) => (
                    <li key={i} className="leading-relaxed">{b}</li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-zinc-100 dark:border-white/5 pt-3 flex justify-between items-center shrink-0 mt-3">
                <span className="text-[7px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">EduConnect Presentation Engine</span>
                <span className="text-[7px] font-black text-orange-500 dark:text-orange-400">SLIDE {activeSlide + 1}</span>
              </div>
            </div>

            {/* Slide Player Nav */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center bg-zinc-950/80 rounded-xl p-1 border border-white/5 shadow-2xl gap-2 backdrop-blur-xl">
              <button 
                onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))}
                disabled={activeSlide === 0}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Ã¢ÂÂ
              </button>
              <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400 px-1">{activeSlide + 1} / {totalSlides}</span>
              <button 
                onClick={() => setActiveSlide(prev => Math.min(totalSlides - 1, prev + 1))}
                disabled={activeSlide === totalSlides - 1}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Ã¢ÂÂ¶
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (ext === 'ppt') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-[#0B0F19]">
          <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
          <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Legacy .ppt format</h4>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
            The presentation viewer only supports modern .pptx formats. Please download the legacy presentation file to review it.
          </div>
          <button 
            onClick={triggerDownload} 
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-2"
          >
            <Icons.IconUpload className="w-3.5 h-3.5 rotate-180" /> Download Original Presentation
          </button>
        </div>
      );
    }

    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      const activeHtml = parsedData?.sheets?.[activeSheet]?.html || '';
      const formattedHtml = activeHtml
         .replace(/<table>/g, '<table class="min-w-full border border-zinc-200 dark:border-white/5 border-collapse text-left text-xs">')
        .replace(/<thead>/g, '<thead class="bg-zinc-50 dark:bg-white/5 font-black uppercase tracking-widest text-[9px] border-b border-zinc-200 dark:border-white/5">')
        .replace(/<tr>/g, '<tr class="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50/50 dark:hover:bg-white/5 transition-colors">')
        .replace(/<th>/g, '<th class="p-3 border-r border-zinc-200 dark:border-white/5 text-zinc-950 dark:text-white font-bold">')
        .replace(/<td>/g, '<td class="p-3 border-r border-zinc-100 dark:border-white/5 text-zinc-700 dark:text-zinc-300 font-medium">');

      return (
        <div className="h-full flex flex-col bg-white dark:bg-[#0B0F19]">
          <div className="p-3 border-b border-zinc-250/50 dark:border-white/5 flex items-center bg-zinc-50 dark:bg-white/5 gap-2 overflow-x-auto scrollbar-hide shrink-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mr-2">Sheets:</span>
            {parsedData?.sheets?.map((sheet, index) => (
              <button
                key={sheet.name}
                onClick={() => setActiveSheet(index)}
                className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md border transition-all ${
                  activeSheet === index
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                    : 'bg-white dark:bg-white/5 border-zinc-200 dark:border-white/5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-6 custom-scrollbar">
            <div 
              className="border border-zinc-200 dark:border-white/5 overflow-hidden bg-white dark:bg-zinc-900/50"
              dangerouslySetInnerHTML={{ __html: formattedHtml }}
            />
          </div>
        </div>
      );
    }

    if (parsedData?.type === 'text') {
      return (
        <div className="h-full bg-zinc-950 dark:bg-black overflow-auto p-6 custom-scrollbar text-left font-mono">
          <pre className="text-zinc-300 dark:text-zinc-200 text-xs leading-relaxed select-text whitespace-pre">
            <code>{parsedData.rawText}</code>
          </pre>
        </div>
      );
    }

    // Default download fallback
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-zinc-50 dark:bg-[#0B0F19]">
        <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
        <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Native Preview Unavailable</h4>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
          We couldn't render `{filename}` directly. Please download the file to review its contents.
        </div>
        <button 
          onClick={triggerDownload} 
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-2"
        >
          <Icons.IconUpload className="w-3.5 h-3.5 rotate-180" /> Download Document
        </button>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-zinc-50 dark:bg-[#0B0F19] overflow-hidden">
      {/* File Header Bar */}
      {!hideHeader && (
        <div className="p-3 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{filename}</span>
          
          {/* Web/Local Mode toggle (only shown when both modes can be used) */}
          {['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext) && !isLocalUrl && (
            <div className="flex bg-zinc-200/50 dark:bg-white/5 p-0.5 rounded-lg border border-zinc-250/20 dark:border-white/5">
              <button 
                onClick={() => setViewerMode('web')} 
                className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                  viewerMode === 'web' 
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm font-bold' 
                    : 'text-zinc-450 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                🌐 Web Viewer
              </button>
              <button 
                onClick={() => setViewerMode('local')} 
                className={`px-3 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                  viewerMode === 'local' 
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm font-bold' 
                    : 'text-zinc-455 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                🖥️ Local Reader
              </button>
            </div>
          )}
        </div>
      )}

      {/* Embedded Workspace */}
      <div className="flex-1 min-h-0 w-full relative bg-zinc-100 dark:bg-black/20">
        {renderContent()}
      </div>
    </div>
  );
};
