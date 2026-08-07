import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

interface NotebookOutput {
  type: string;
  text?: string;
  imageDataUrl?: string;
}

interface NotebookCell {
  id: string;
  cellType: 'code' | 'markdown' | 'raw';
  source: string;
  outputs: NotebookOutput[];
}

/** In-memory file cache so switching students/files doesn't re-download. */
const fileBufferCache = new Map<string, ArrayBuffer>();
const inflightFetches = new Map<string, Promise<ArrayBuffer>>();
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5557';

function isBrowserLocalUrl(url: string) {
  return url.startsWith('blob:') || url.startsWith('data:') || url.includes('localhost') || url.includes('127.0.0.1');
}

async function fetchFileBuffer(url: string): Promise<ArrayBuffer> {
  const cached = fileBufferCache.get(url);
  if (cached) return cached.slice(0);

  const existing = inflightFetches.get(url);
  if (existing) return (await existing).slice(0);

  const promise = (async () => {
    const token = localStorage.getItem('custom_canvas_token') || '';
    // Canvas CDN URLs block browser CORS — always proxy remote files through our API.
    const fetchUrl = isBrowserLocalUrl(url)
      ? url
      : `${API_BASE_URL}/api/proxy-file?url=${encodeURIComponent(url)}`;

    const headers: Record<string, string> = {};
    if (!isBrowserLocalUrl(url) && token) {
      headers['X-Canvas-Token'] = token;
    } else if (token && isBrowserLocalUrl(url)) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(fetchUrl, { headers });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errJson = await response.clone().json();
        if (errJson?.error) detail = errJson.error;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const buf = await response.arrayBuffer();
    fileBufferCache.set(url, buf);
    // Cap cache size (~25 entries of typical homework)
    if (fileBufferCache.size > 25) {
      const oldest = fileBufferCache.keys().next().value;
      if (oldest) fileBufferCache.delete(oldest);
    }
    return buf;
  })();

  inflightFetches.set(url, promise);
  try {
    return (await promise).slice(0);
  } finally {
    inflightFetches.delete(url);
  }
}

/** Prefetch a submission file so Local Reader opens instantly. */
export function prefetchPreviewFile(url?: string | null) {
  if (!url || fileBufferCache.has(url) || inflightFetches.has(url)) return;
  void fetchFileBuffer(url).catch(() => {});
}

export const UniversalPreviewer: React.FC<UniversalPreviewerProps> = ({ url, filename, onDownload: _onDownload, hideHeader, viewerMode: externalViewerMode, setViewerMode: externalSetViewerMode, highlightText }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const [parsedData, setParsedData] = useState<{
    type: 'docx' | 'xlsx' | 'pptx' | 'text' | 'ipynb';
    html?: string;
    sheets?: SheetData[];
    slides?: SlideData[];
    rawText?: string;
    cells?: NotebookCell[];
  } | null>(null);

  // Detect if url is a local sandbox development file (Microsoft / Google online viewers can't fetch local files)
  const isLocalUrl = url.includes('localhost') || url.includes('127.0.0.1') || url.startsWith('blob:') || url.startsWith('data:');
  const isCanvasHosted =
    /instructure\.com|inscloudgate\.net|instructuremedia\.com/i.test(url) || url.includes('/files/');
  
  // Default to Local Reader — Office/Google web viewers can't auth to Canvas.
  const [internalViewerMode, setInternalViewerMode] = useState<'web' | 'local'>('local');
  
  const rawViewerMode = externalViewerMode || internalViewerMode;
  // Canvas files always use Local Reader (Web Viewer cannot authenticate).
  const viewerMode: 'web' | 'local' = isCanvasHosted ? 'local' : rawViewerMode;
  const setViewerMode = externalSetViewerMode || setInternalViewerMode;

  // PPTX active slide index
  const [activeSlide, setActiveSlide] = useState(0);
  // XLSX active sheet index
  const [activeSheet, setActiveSheet] = useState(0);
  // Image zoom state
  const [imageFit, setImageFit] = useState<'contain' | 'cover' | 'original'>('contain');

  const ext = useMemo(() => {
    const fromName = (filename.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    // Allow longer extensions like ipynb
    if (fromName && fromName.length <= 8 && fromName !== filename.toLowerCase().replace(/[^a-z0-9.]/g, '')) {
      return fromName;
    }
    const path = (url || '').split('?')[0].toLowerCase();
    const m = path.match(/\.([a-z0-9]{2,8})$/);
    return (m?.[1] || fromName || '').replace(/[^a-z0-9]/g, '');
  }, [filename, url]);

  const formatLabel = useMemo(() => {
    if (['pdf'].includes(ext)) return 'PDF';
    if (['docx', 'doc'].includes(ext)) return 'Word';
    if (['pptx', 'ppt'].includes(ext)) return 'PowerPoint';
    if (['xlsx', 'xls', 'csv'].includes(ext)) return 'Excel';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'Image';
    if (ext === 'ipynb') return 'Notebook';
    return 'File';
  }, [ext]);

  const displayName = useMemo(() => {
    try {
      return decodeURIComponent(filename.replace(/\+/g, ' '));
    } catch {
      return filename.replace(/\+/g, ' ');
    }
  }, [filename]);

  const needsLocalParse = useMemo(
    () => ['docx', 'xlsx', 'xls', 'csv', 'pptx', 'ipynb', 'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'json', 'py', 'r', 'java', 'sql', 'cpp', 'c'].includes(ext),
    [ext]
  );

  useEffect(() => {
    // Reset states
    setError(null);
    setParsedData(null);
    setDocxBuffer(null);
    setActiveSlide(0);
    setActiveSheet(0);
    setPdfObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

      // Web Viewer cannot open authenticated Canvas URLs — skip local parse while in web mode.
    // Prefetch via proxy so switching back to Local Reader is instant.
    if (viewerMode === 'web' && ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)) {
      if (!isBrowserLocalUrl(url)) {
        void fetchFileBuffer(url).catch(() => {});
      }
      return;
    }

    let cancelled = false;

    const loadLocal = async () => {
      setLoading(true);
      try {
        const arrayBuffer = await fetchFileBuffer(url);
        if (cancelled) return;

        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
          const mime =
            ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
            ext === 'svg' ? 'image/svg+xml' :
            `image/${ext}`;
          const blob = new Blob([arrayBuffer], { type: mime });
          const objectUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setPdfObjectUrl(objectUrl); // reuse blob URL slot for images
          return;
        }

        if (ext === 'pdf') {
          const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
          const objectUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          setPdfObjectUrl(objectUrl);
          return;
        }

        if (ext === 'docx') {
          // Exact Word layout via docx-preview (pages, images, tables)
          setDocxBuffer(arrayBuffer.slice(0));
          setParsedData({ type: 'docx' });
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
          if (cancelled) return;
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
            const numA = parseInt(a.name.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.name.match(/\d+/)?.[0] || '0');
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

          if (cancelled) return;
          setParsedData({ type: 'pptx', slides });
        }
        else if (ext === 'ipynb') {
          const decoder = new TextDecoder('utf-8');
          const raw = decoder.decode(arrayBuffer);
          const nb = JSON.parse(raw);
          const cells: NotebookCell[] = (Array.isArray(nb?.cells) ? nb.cells : []).map((cell: any, idx: number) => {
            const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
            const outputs: NotebookOutput[] = [];
            for (const out of cell.outputs || []) {
              if (out.output_type === 'stream') {
                const text = Array.isArray(out.text) ? out.text.join('') : String(out.text || '');
                if (text.trim()) outputs.push({ type: 'stream', text });
              } else if (out.output_type === 'error') {
                const text = [out.ename, out.evalue, ...(out.traceback || [])].filter(Boolean).join('\n');
                if (text.trim()) outputs.push({ type: 'error', text });
              } else if (out.data) {
                if (out.data['image/png']) {
                  outputs.push({
                    type: 'image',
                    imageDataUrl: `data:image/png;base64,${out.data['image/png']}`,
                  });
                } else if (out.data['image/jpeg']) {
                  outputs.push({
                    type: 'image',
                    imageDataUrl: `data:image/jpeg;base64,${out.data['image/jpeg']}`,
                  });
                }
                const text =
                  (Array.isArray(out.data['text/plain']) ? out.data['text/plain'].join('') : out.data['text/plain']) ||
                  (Array.isArray(out.data['text/html']) ? out.data['text/html'].join('') : '');
                if (text && String(text).trim()) {
                  outputs.push({ type: 'result', text: String(text) });
                }
              }
            }
            return {
              id: String(cell.id || idx),
              cellType: (cell.cell_type === 'markdown' || cell.cell_type === 'raw') ? cell.cell_type : 'code',
              source,
              outputs,
            };
          });
          if (cancelled) return;
          if (cells.length === 0) throw new Error('Notebook has no cells');
          setParsedData({ type: 'ipynb', cells });
        }
        else if (needsLocalParse) {
          const decoder = new TextDecoder('utf-8');
          const rawText = decoder.decode(arrayBuffer);
          if (cancelled) return;
          setParsedData({ type: 'text', rawText });
        }
        else if (ext === 'doc' || ext === 'ppt') {
          // Legacy formats: local parse unsupported — leave error null so UI can prompt Web Viewer
          return;
        }
        else {
          throw new Error('Unsupported extension');
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Preview extraction failure:", err);
        setError(`Native preview failed: ${err.message || 'Cannot read file'}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadLocal();
    return () => {
      cancelled = true;
    };
  }, [url, ext, viewerMode, needsLocalParse, reloadKey]);

  // Render DOCX with faithful Word layout (not HTML conversion)
  useEffect(() => {
    if (loading || ext !== 'docx' || !docxBuffer) return;
    const host = docxContainerRef.current;
    if (!host) return;

    let cancelled = false;
    host.innerHTML = '';

    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled || !docxContainerRef.current) return;
        await renderAsync(docxBuffer, docxContainerRef.current, undefined, {
          className: 'educonnect-docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });

        if (highlightText && docxContainerRef.current) {
          const needle = highlightText.trim();
          if (needle.length > 8) {
            const walker = document.createTreeWalker(docxContainerRef.current, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const text = node.textContent || '';
              const idx = text.toLowerCase().indexOf(needle.slice(0, 40).toLowerCase());
              if (idx >= 0) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, Math.min(text.length, idx + needle.length));
                const mark = document.createElement('mark');
                mark.id = 'evidence-anchor-highlight';
                mark.className = 'bg-amber-200 text-inherit px-0.5 rounded';
                range.surroundContents(mark);
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                break;
              }
            }
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('docx-preview failed, falling back to mammoth', err);
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml(
            { arrayBuffer: docxBuffer },
            {
              convertImage: mammoth.images.imgElement(async (image: any) => {
                const imageBuffer = await image.read('base64');
                return { src: `data:${image.contentType};base64,${imageBuffer}` };
              }),
            }
          );
          if (cancelled || !docxContainerRef.current) return;
          docxContainerRef.current.innerHTML = `<div class="docx-mammoth-fallback prose max-w-none p-12 bg-white">${result.value || ''}</div>`;
        } catch (fallbackErr: any) {
          if (!cancelled) setError(`Word viewer failed: ${fallbackErr?.message || err?.message || 'Cannot render document'}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docxBuffer, ext, highlightText, loading]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-12 bg-zinc-50 dark:bg-[#0B0F19]">
          <Icons.IconRefresh className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Loading document…</div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-red-50 dark:bg-red-950/20">
          <Icons.IconAlertCircle className="w-16 h-16 mb-4 text-red-500" />
          <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Viewer failed</h4>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
            {error}
          </div>
          <button 
            onClick={() => {
              fileBufferCache.delete(url);
              setError(null);
              setDocxBuffer(null);
              setParsedData(null);
              setReloadKey((k) => k + 1);
            }}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
          >
            Retry preview
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
              src={pdfObjectUrl || url} 
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

    // 2. Web Viewer Mode — Canvas auth URLs cannot be opened by Office/Google viewers
    if (viewerMode === 'web' && ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)) {
      const canvasHost = /instructure\.com|inscloudgate\.net|instructuremedia\.com/i.test(url);
      if (canvasHost || url.includes('/files/')) {
        return (
          <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-amber-50 dark:bg-amber-950/20">
            <Icons.IconAlertCircle className="w-12 h-12 mb-4 text-amber-500" />
            <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Web Viewer can't open Canvas files</h4>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-6 max-w-sm">
              Office/Google viewers cannot authenticate to Canvas. Use Local Reader instead.
            </div>
            <button
              onClick={() => setViewerMode('local')}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md"
            >
              Switch to Local Reader
            </button>
          </div>
        );
      }
      if (ext === 'pdf') {
        return (
          <iframe 
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`} 
            className="w-full h-full border-0 bg-white" 
            title={filename} 
          />
        );
      }
      return (
        <iframe 
          src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`} 
          className="w-full h-full border-0 bg-white" 
          title={filename} 
        />
      );
    }

    // 3. Format-native Local Reader (PDF browser engine, Word HTML, PPT slides, images)
    if (ext === 'pdf') {
      const pdfSrc = pdfObjectUrl || url;
      return (
        <div className="h-full w-full bg-zinc-200 dark:bg-zinc-950">
          <object
            data={`${pdfSrc}#toolbar=1&navpanes=1&view=FitH`}
            type="application/pdf"
            className="w-full h-full"
            title={displayName}
          >
            <iframe
              src={`${pdfSrc}#toolbar=1&navpanes=1&view=FitH`}
              className="w-full h-full border-0 bg-white"
              title={displayName}
            />
          </object>
        </div>
      );
    }

    if (ext === 'docx') {
      return (
        <div className="h-full bg-[#cfcfcf] dark:bg-zinc-900 overflow-y-auto custom-scrollbar">
          <div
            ref={docxContainerRef}
            className="educonnect-docx-host min-h-full w-full flex flex-col items-center py-6"
          />
          <style>{`
            .educonnect-docx-host .docx-wrapper {
              background: transparent !important;
              padding: 0 !important;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 16px;
            }
            .educonnect-docx-host .docx-wrapper > section.docx {
              background: white !important;
              box-shadow: 0 8px 28px rgba(0,0,0,0.18);
              margin: 0 auto !important;
            }
            .educonnect-docx-host img { max-width: 100%; height: auto; }
          `}</style>
        </div>
      );
    }

    if (ext === 'doc') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-[#0B0F19]">
          <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
          <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">Legacy .doc format</h4>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
            In-app viewing supports modern .docx files. This legacy .doc cannot be rendered here.
          </div>
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
              Slide text preview — download the file for original layouts, charts, and images.
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
                ←
              </button>
              <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400 px-1">{activeSlide + 1} / {totalSlides}</span>
              <button 
                onClick={() => setActiveSlide(prev => Math.min(totalSlides - 1, prev + 1))}
                disabled={activeSlide === totalSlides - 1}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                →
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
          <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
            In-app viewing supports modern .pptx files. This legacy .ppt cannot be rendered here.
          </div>
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

    if (parsedData?.type === 'ipynb' && parsedData.cells) {
      return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#1e1e1e] text-zinc-100">
          <div className="sticky top-0 z-10 px-4 py-2 border-b border-white/10 bg-[#252526] flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Jupyter Notebook</span>
            <span className="text-[10px] font-bold text-zinc-400">{parsedData.cells.length} cells</span>
          </div>
          <div className="p-4 space-y-4 max-w-5xl mx-auto">
            {parsedData.cells.map((cell, idx) => (
              <div key={cell.id} className="rounded-xl border border-white/10 overflow-hidden bg-[#252526]">
                <div className="px-3 py-1.5 border-b border-white/5 flex items-center justify-between bg-black/20">
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    [{idx + 1}] {cell.cellType}
                  </span>
                </div>
                {cell.cellType === 'markdown' ? (
                  <div className="p-4 prose prose-invert prose-sm max-w-none prose-pre:bg-black/40">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{cell.source || '_Empty markdown cell_'}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="p-4 text-[12px] leading-relaxed font-mono text-emerald-100 overflow-x-auto whitespace-pre">
                    <code>{cell.source || '# empty cell'}</code>
                  </pre>
                )}
                {cell.outputs.length > 0 && (
                  <div className="border-t border-white/10 bg-black/30 p-3 space-y-3">
                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Output</div>
                    {cell.outputs.map((out, oIdx) => (
                      <div key={oIdx}>
                        {out.imageDataUrl ? (
                          <img src={out.imageDataUrl} alt={`Output ${oIdx + 1}`} className="max-w-full rounded-md border border-white/10" />
                        ) : (
                          <pre className={`text-[11px] font-mono whitespace-pre-wrap ${out.type === 'error' ? 'text-rose-300' : 'text-zinc-300'}`}>
                            {out.text}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
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

    // Unsupported type — still try to show something useful in-viewer
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-zinc-50 dark:bg-[#0B0F19]">
        <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
        <h4 className="text-base font-bold text-zinc-900 dark:text-white mb-2">No in-app viewer for this type</h4>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
          `{displayName}` is not a supported preview format yet (supported: PDF, Word, PowerPoint, Excel, images, Jupyter notebooks).
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-zinc-50 dark:bg-[#0B0F19] overflow-hidden">
      {/* File Header Bar */}
      {!hideHeader && (
        <div className="p-3 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 dark:text-zinc-300 truncate" title={displayName}>
            {displayName}
          </span>
          
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
              {formatLabel}
            </span>
          </div>
        </div>
      )}

      {/* Embedded Workspace */}
      <div className="flex-1 min-h-0 w-full relative bg-zinc-100 dark:bg-black/20">
        {renderContent()}
      </div>
    </div>
  );
};
