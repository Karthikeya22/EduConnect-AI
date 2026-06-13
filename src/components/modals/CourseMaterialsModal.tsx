import React, { useState, useEffect, useRef } from 'react';
import * as Icons from '../ui/Icons';
import { canvasAPI } from '../../services/canvasAPI';

interface CanvasFile {
  id: number;
  display_name: string;
  url: string;
  size: number;
  updated_at: string;
}

interface CourseMaterialsModalProps {
  courseId: string;
  assignmentId: string;
  onClose: () => void;
  onIngestSuccess: () => void;
}

export function CourseMaterialsModal({ courseId, assignmentId, onClose, onIngestSuccess }: CourseMaterialsModalProps) {
  const [files, setFiles] = useState<CanvasFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestProgress, setIngestProgress] = useState<{ current: number, total: number, currentFileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files) {
      setLocalFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setLoading(true);
        const data = await canvasAPI.getCourseFiles(courseId);
        if (Array.isArray(data)) {
          // Filter for documents
          const docFiles = data.filter(f => 
            f.display_name.endsWith('.pdf') || 
            f.display_name.endsWith('.docx') || 
            f.display_name.endsWith('.txt') ||
            f.display_name.endsWith('.pptx')
          );
          setFiles(docFiles);
        } else {
          setFiles([]);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch course files.');
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [courseId]);

  const toggleFile = (id: number) => {
    const newSet = new Set(selectedFiles);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedFiles(newSet);
  };

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setLocalFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeLocalFile = (index: number) => {
    setLocalFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleIngest = async () => {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5557';
    setIsIngesting(true);
    setError(null);
    const canvasFilesToIngest = files.filter(f => selectedFiles.has(f.id));
    const totalFiles = canvasFilesToIngest.length + localFiles.length;
    let current = 0;

    try {
      // 1. Ingest Canvas Files
      for (const file of canvasFilesToIngest) {
        current++;
        setIngestProgress({ current, total: totalFiles, currentFileName: file.display_name });
        
        const blob = await canvasAPI.downloadCanvasFile(file.url);
        const formData = new FormData();
        formData.append('assignment_id', assignmentId);
        formData.append('file', blob, file.display_name);

        const headers: any = {};
        const customGeminiKey = localStorage.getItem('custom_gemini_api_key');
        if (customGeminiKey) {
          headers['X-Gemini-Api-Key'] = customGeminiKey;
        }

        const res = await fetch(`${API_BASE_URL}/api/ingest/file`, {
          method: 'POST',
          headers,
          body: formData
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Failed to ingest ${file.display_name}: ${errorText}`);
        }
      }

      // 2. Ingest Local Files
      for (const file of localFiles) {
        current++;
        setIngestProgress({ current, total: totalFiles, currentFileName: file.name });
        
        const formData = new FormData();
        formData.append('assignment_id', assignmentId);
        formData.append('file', file);

        const headers: any = {};
        const customGeminiKey = localStorage.getItem('custom_gemini_api_key');
        if (customGeminiKey) {
          headers['X-Gemini-Api-Key'] = customGeminiKey;
        }

        const res = await fetch(`${API_BASE_URL}/api/ingest/file`, {
          method: 'POST',
          headers,
          body: formData
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Failed to ingest ${file.name}: ${errorText}`);
        }
      }

      onIngestSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ingestion failed.');
    } finally {
      setIsIngesting(false);
      setIngestProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!isIngesting ? onClose : undefined} />
      
      <div className="relative bg-white dark:bg-[#0F172A] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-zinc-200 dark:border-white/10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-zinc-200 dark:border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center">
              <Icons.IconBook className="w-5 h-5 mr-2 text-indigo-500" />
              Manage Course Materials
            </h2>
            <div className="text-xs text-zinc-500 mt-1">Select Canvas files or upload local files to provide context for AI grading.</div>
          </div>
          <button 
            onClick={onClose}
            disabled={isIngesting}
            className="p-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
          >
            <Icons.IconX className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Canvas Files Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center">
              <Icons.IconGrid className="w-4 h-4 mr-2 text-zinc-400" />
              Canvas Course Files
            </h3>
            
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
              </div>
            ) : files.length === 0 ? (
              <div className="text-sm text-zinc-500 italic py-6 text-center">
                No supported documents (PDF, DOCX, TXT, PPTX) found in this course.
              </div>
            ) : (
              <div className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-white/10 max-h-[300px] overflow-y-auto custom-scrollbar">
                {files.map(file => (
                  <label key={file.id} className="flex items-center p-3 hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer transition-colors group">
                    <input 
                      type="checkbox" 
                      checked={selectedFiles.has(file.id)}
                      onChange={() => toggleFile(file.id)}
                      className="w-4 h-4 text-indigo-600 rounded border-zinc-300 focus:ring-indigo-500 bg-white dark:bg-zinc-800"
                    />
                    <Icons.IconFile className="w-5 h-5 ml-3 mr-3 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-200 truncate">{file.display_name}</div>
                      <div className="text-[10px] text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB • {new Date(file.updated_at).toLocaleDateString()}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Local Upload Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center">
              <Icons.IconUpload className="w-4 h-4 mr-2 text-zinc-400" />
              Upload Local Files
            </h3>
            
            <div 
              className="flex items-center justify-center p-6 bg-zinc-50 dark:bg-white/5 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors cursor-pointer text-center"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                multiple 
                accept=".pdf,.docx,.txt,.pptx"
                onChange={handleLocalFileChange}
                className="hidden"
              />
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 shrink-0">
                  <Icons.IconPlus className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Choose files or drag here</span>
                  <span className="block text-[10px] text-zinc-500">Supported formats: PDF, DOCX, TXT, PPTX</span>
                </div>
              </div>
            </div>

            {localFiles.length > 0 && (
              <div className="divide-y divide-zinc-200 dark:divide-white/5 mt-4">
                {localFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between py-2 border-b border-zinc-100 dark:border-white/5 last:border-0">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <Icons.IconFile className="w-4 h-4 text-zinc-400 shrink-0" />
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{file.name}</div>
                    </div>
                    <button 
                      onClick={() => removeLocalFile(index)}
                      className="p-1 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-red-500"
                    >
                      <Icons.IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-zinc-200 dark:border-white/10 shrink-0 flex items-center justify-between bg-transparent">
          <div className="text-xs font-medium text-zinc-500">
            {selectedFiles.size + localFiles.length} files selected for ingestion
          </div>
          
          <button
            onClick={handleIngest}
            disabled={isIngesting || (selectedFiles.size === 0 && localFiles.length === 0)}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all active:scale-95 flex items-center"
          >
            {isIngesting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                Ingesting ({ingestProgress?.current}/{ingestProgress?.total})...
              </>
            ) : (
              <>
                <Icons.IconSparkles className="w-4 h-4 mr-2" />
                Ingest Selected Files
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
