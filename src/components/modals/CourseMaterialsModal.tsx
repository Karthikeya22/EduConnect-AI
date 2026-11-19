import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Icons from '../ui/Icons';
import { canvasAPI } from '../../services/canvasAPI';
import { gradingApiBase, llmAuthHeaders, requireLlmCredentials } from '../../lib/llmProviders';
import { gradingAuthHeaders } from '../../lib/gradingApi';
import {
  CanvasCourseFile,
  CourseFileStatusRow,
  isDocCourseFile,
  materialIndexLabel,
  materialIndexState,
  MaterialIndexState,
  sourceUpdatedAt,
} from '../../lib/courseFileRanker';
import {
  isCourseIngestInFlight,
  joinOrStartCourseIngest,
  subscribeCourseIngest,
} from '../../lib/courseIngestCoordinator';
import { fetchWithRetry } from '../../lib/fetchWithRetry';

type CanvasFile = CanvasCourseFile & {
  size?: number;
  folder_id?: number;
  'content-type'?: string;
};

function isIngestibleFile(file: CanvasCourseFile): boolean {
  return isDocCourseFile(file);
}

function statusBadgeClass(state: MaterialIndexState): string {
  switch (state) {
    case 'indexed':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'failed':
    case 'broken':
      return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300';
    case 'stale':
    case 'pending':
      return 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300';
    case 'skipped':
      return 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400';
    default:
      return 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300';
  }
}

interface CourseMaterialsModalProps {
  courseId: string;
  assignmentId: string;
  onClose: () => void;
  onIngestSuccess: () => void;
}

export function CourseMaterialsModal({ courseId, assignmentId, onClose, onIngestSuccess }: CourseMaterialsModalProps) {
  const [files, setFiles] = useState<CanvasFile[]>([]);
  const [statusRows, setStatusRows] = useState<CourseFileStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string | number>>(new Set());
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [isIngesting, setIsIngesting] = useState(false);
  const [courseIngestBusy, setCourseIngestBusy] = useState(() => isCourseIngestInFlight(courseId));
  const [statusAvailable, setStatusAvailable] = useState(true);
  const [statusWarning, setStatusWarning] = useState<string | null>(null);
  const [ingestProgress, setIngestProgress] = useState<{ current: number, total: number, currentFileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusById = useMemo(() => {
    const map = new Map<string, CourseFileStatusRow>();
    for (const row of statusRows) {
      map.set(String(row.canvas_file_id), row);
    }
    return map;
  }, [statusRows]);

  const summary = useMemo(() => {
    const counts = {
      indexed: 0,
      failed: 0,
      broken: 0,
      pending: 0,
      stale: 0,
      not_indexed: 0,
      skipped: 0,
    };
    for (const file of files) {
      const state = materialIndexState(file, statusById.get(String(file.id)));
      counts[state] += 1;
    }
    return counts;
  }, [files, statusById]);

  const indexedOnly = useMemo(
    () => statusRows.filter((row) => row.filename),
    [statusRows],
  );

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

  const loadStatus = async (mode: 'status' | 'verify' = 'status') => {
    const path = mode === 'verify' ? 'course-verify' : 'course-status';
    const res = await fetchWithRetry(
      `${gradingApiBase()}/api/ingest/${path}?course_id=${encodeURIComponent(courseId)}`,
      { headers: { ...(await gradingAuthHeaders()) } },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Could not load ${mode}`);
    }
    const data = await res.json();
    const rows: CourseFileStatusRow[] = Array.isArray(data?.files) ? data.files : [];
    setStatusRows(rows);
    setStatusAvailable(true);
    setStatusWarning(null);
    return data;
  };

  const refreshLists = async (opts?: { preserveSelection?: boolean }) => {
    setLoading(true);
    setError(null);
    setStatusWarning(null);
    try {
      let data: unknown;
      try {
        data = await canvasAPI.getCourseFiles(courseId);
      } catch (err: any) {
        setFiles([]);
        setError(err.message || 'Failed to fetch course files.');
        return;
      }

      let statusOk = false;
      try {
        await loadStatus('status');
        statusOk = true;
      } catch (err: any) {
        setStatusAvailable(false);
        setStatusRows([]);
        setStatusWarning(
          err?.message
            ? `Index status unavailable: ${err.message}`
            : 'Index status unavailable. Ingest is disabled until status loads.',
        );
      }

      if (Array.isArray(data)) {
        const sorted = [...data].sort((a, b) =>
          String(a.display_name || '').localeCompare(String(b.display_name || '')),
        );
        setFiles(sorted);
        if (!opts?.preserveSelection) {
          if (statusOk) {
            const ingestible = sorted.filter((f) => isIngestibleFile(f));
            setSelectedFiles(new Set(ingestible.map((f) => f.id)));
          } else {
            setSelectedFiles(new Set());
          }
        }
      } else {
        setFiles([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch course files.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshLists();
  }, [courseId]);

  useEffect(() => {
    setCourseIngestBusy(isCourseIngestInFlight(courseId));
    return subscribeCourseIngest((id, inFlight) => {
      if (id === String(courseId)) setCourseIngestBusy(inFlight);
    });
  }, [courseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isIngesting || courseIngestBusy) {
        e.preventDefault();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isIngesting, courseIngestBusy, onClose]);

  const toggleFile = (id: string | number, ingestible: boolean) => {
    if (!ingestible) return;
    const newSet = new Set(selectedFiles);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedFiles(newSet);
  };

  const ingestibleCount = files.filter((f) => isIngestibleFile(f)).length;
  const ingestBlocked = isIngesting || courseIngestBusy || !statusAvailable;

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setLocalFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeLocalFile = (index: number) => {
    setLocalFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    setVerifyNote(null);
    try {
      const data = await loadStatus('verify');
      const s = data?.summary || {};
      const rows: CourseFileStatusRow[] = Array.isArray(data?.files) ? data.files : [];
      const byId = new Map(rows.map((row) => [String(row.canvas_file_id), row]));
      const canvasNotIndexed = files.filter((f) => {
        if (!isIngestibleFile(f)) return false;
        return materialIndexState(f, byId.get(String(f.id))) !== 'indexed';
      }).length;
      setVerifyNote(
        `Checked against stored chunks: ${s.indexed || 0} indexed, ${s.broken || 0} broken, ${s.failed || 0} failed, ${s.pending || 0} pending`
        + (files.length ? `. ${canvasNotIndexed} Canvas file(s) still need indexing.` : '.'),
      );
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleIngest = async () => {
    if (!statusAvailable) {
      setError('Index status unavailable. Retry loading status before ingesting.');
      return;
    }
    if (isCourseIngestInFlight(courseId) && selectedFiles.size > 0) {
      setIsIngesting(true);
      setVerifyNote('Indexing already in progress for this course — waiting for it to finish…');
      try {
        await joinOrStartCourseIngest(courseId, async () => undefined);
        await refreshLists({ preserveSelection: true });
        setVerifyNote('Background indexing finished. Verify index or select files to continue.');
      } catch (err: any) {
        setError(err?.message || 'Background indexing failed.');
      } finally {
        setIsIngesting(false);
      }
      return;
    }

    const apiBase = gradingApiBase();
    setIsIngesting(true);
    setError(null);
    setVerifyNote(null);
    const canvasFilesToIngest = files.filter(f => selectedFiles.has(f.id));
    const totalFiles = canvasFilesToIngest.length + localFiles.length;
    let current = 0;
    const failures: string[] = [];

    try {
      requireLlmCredentials();
      await joinOrStartCourseIngest(courseId, async () => {
        for (const file of canvasFilesToIngest) {
          current++;
          setIngestProgress({ current, total: totalFiles, currentFileName: file.display_name });

          const headers: any = {
            'Content-Type': 'application/json',
            ...llmAuthHeaders(),
            ...(await gradingAuthHeaders()),
          };

          try {
            const res = await fetchWithRetry(`${apiBase}/api/ingest/canvas-url`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                assignment_id: assignmentId,
                course_id: courseId,
                url: file.url,
                filename: file.display_name,
                canvas_file_id: String(file.id),
                updated_at: sourceUpdatedAt(file),
                canvas_token: localStorage.getItem('custom_canvas_token') || '',
              }),
            });
            if (!res.ok) {
              const errorText = await res.text();
              failures.push(`${file.display_name}: ${errorText}`);
            }
          } catch (err: any) {
            failures.push(`${file.display_name}: ${err.message || 'ingest failed'}`);
          }
        }

        for (const file of localFiles) {
          current++;
          setIngestProgress({ current, total: totalFiles, currentFileName: file.name });

          const formData = new FormData();
          formData.append('assignment_id', assignmentId);
          formData.append('course_id', courseId);
          formData.append('file', file);

          const headers: any = { ...llmAuthHeaders(), ...(await gradingAuthHeaders()) };

          try {
            const res = await fetchWithRetry(`${apiBase}/api/ingest/file`, {
              method: 'POST',
              headers,
              body: formData
            });
            if (!res.ok) {
              const errorText = await res.text();
              failures.push(`${file.name}: ${errorText}`);
            }
          } catch (err: any) {
            failures.push(`${file.name}: ${err.message || 'ingest failed'}`);
          }
        }
      });

      await refreshLists({ preserveSelection: true });
      try {
        const verified = await loadStatus('verify');
        const s = verified?.summary || {};
        setVerifyNote(
          `After ingest: ${s.indexed || 0} indexed, ${s.broken || 0} broken, ${s.failed || 0} failed.`
          + (failures.length ? ` ${failures.length} file(s) failed this run.` : ''),
        );
      } catch {
        /* status refresh already ran */
      }

      if (failures.length) {
        setError(failures.slice(0, 5).join('\n') + (failures.length > 5 ? `\n…and ${failures.length - 5} more` : ''));
      } else {
        onIngestSuccess();
      }
    } catch (err: any) {
      setError(err.message || 'Ingestion failed.');
    } finally {
      setIsIngesting(false);
      setIngestProgress(null);
    }
  };

  const renderFileRow = (file: CanvasFile) => {
    const ingestible = isIngestibleFile(file);
    const row = statusById.get(String(file.id));
    const state = materialIndexState(file, row);
    const detail =
      state === 'failed' && row?.last_error
        ? String(row.last_error).slice(0, 120)
        : state === 'indexed'
          ? `${row?.stored_chunks ?? row?.chunk_count ?? 0} chunks`
          : state === 'broken'
            ? 'marked ready but no chunks stored'
            : state === 'pending'
              ? 'In progress'
              : undefined;

    return (
      <label
        key={file.id}
        className={`flex items-center p-3 transition-colors group ${
          ingestible
            ? 'hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer'
            : 'opacity-60 cursor-not-allowed'
        }`}
        title={detail || (ingestible ? undefined : 'Not a readable course material type')}
      >
        <input
          type="checkbox"
          checked={selectedFiles.has(file.id)}
          disabled={!ingestible}
          onChange={() => toggleFile(file.id, ingestible)}
          className="w-4 h-4 text-indigo-600 rounded border-zinc-300 focus:ring-indigo-500 bg-white dark:bg-zinc-800 disabled:opacity-40"
        />
        <Icons.IconFile className="w-5 h-5 ml-3 mr-3 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-200 truncate">{file.display_name || '(unnamed file)'}</div>
          <div className="text-[10px] text-zinc-500 truncate">
            {((file.size || 0) / 1024 / 1024).toFixed(2)} MB
            {file.updated_at ? ` • ${new Date(file.updated_at).toLocaleDateString()}` : ''}
            {detail ? ` • ${detail}` : ''}
          </div>
        </div>
        <span className={`ml-3 shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(state)}`}>
          {materialIndexLabel(state)}
        </span>
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!ingestBlocked ? onClose : undefined} />

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
            disabled={ingestBlocked}
            title={ingestBlocked ? 'Ingestion in progress' : 'Close'}
            className="p-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
          >
            <Icons.IconX className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm whitespace-pre-wrap">
              {error}
            </div>
          )}
          {statusWarning && (
            <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-amber-800 dark:text-amber-300 text-sm flex items-start justify-between gap-3">
              <span>{statusWarning}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-bold underline"
                onClick={() => void refreshLists({ preserveSelection: true })}
              >
                Retry
              </button>
            </div>
          )}
          {(courseIngestBusy || isIngesting) && (
            <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl text-blue-800 dark:text-blue-300 text-sm font-medium">
              Indexing in progress for this course…
            </div>
          )}
          {verifyNote && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl text-emerald-800 dark:text-emerald-300 text-sm">
              {verifyNote}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider flex items-center justify-between gap-2">
              <span className="flex items-center">
                <Icons.IconGrid className="w-4 h-4 mr-2 text-zinc-400" />
                Canvas Course Files
              </span>
              {!loading && files.length > 0 && (
                <span className="normal-case tracking-normal font-medium text-zinc-500">
                  {files.length} total · {ingestibleCount} ingestible · {summary.indexed} indexed
                </span>
              )}
            </h3>

            {!loading && files.length > 0 && statusAvailable && (
              <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
                <span className={`px-2 py-0.5 rounded-full ${statusBadgeClass('indexed')}`}>{summary.indexed} indexed</span>
                <span className={`px-2 py-0.5 rounded-full ${statusBadgeClass('pending')}`}>{summary.pending} pending</span>
                <span className={`px-2 py-0.5 rounded-full ${statusBadgeClass('not_indexed')}`}>{summary.not_indexed} not indexed</span>
                <span className={`px-2 py-0.5 rounded-full ${statusBadgeClass('failed')}`}>{summary.failed + summary.broken} failed/broken</span>
                <span className={`px-2 py-0.5 rounded-full ${statusBadgeClass('stale')}`}>{summary.stale} needs refresh</span>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center p-8">
                <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
              </div>
            ) : files.length === 0 && indexedOnly.length === 0 ? (
              <div className="text-sm text-zinc-500 italic py-6 text-center">
                No files found in this course Files tree (all folders).
              </div>
            ) : files.length === 0 ? (
              <div className="border border-emerald-200 dark:border-emerald-500/20 rounded-xl overflow-hidden divide-y divide-emerald-100 dark:divide-white/10 max-h-[300px] overflow-y-auto">
                <div className="px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10">
                  Canvas did not return a file list. These class materials are already indexed and are what grading uses.
                </div>
                {indexedOnly.map((row) => (
                  <div key={row.canvas_file_id || row.filename || Math.random()} className="flex items-center p-3">
                    <Icons.IconFile className="w-5 h-5 mr-3 text-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-200 truncate">{row.filename}</div>
                      <div className="text-[10px] text-zinc-500">
                        {row.verified === false ? 'Broken index' : row.status === 'ready' ? 'Indexed' : row.status || 'Indexed'}
                        {row.stored_chunks || row.chunk_count ? ` · ${row.stored_chunks ?? row.chunk_count} chunks` : ''}
                        {row.last_error ? ` · ${String(row.last_error).slice(0, 80)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-white/10 max-h-[300px] overflow-y-auto custom-scrollbar">
                {files.map(renderFileRow)}
              </div>
            )}
          </div>

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
                accept=".pdf,.docx,.txt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.mp3,.wav,.m4a"
                onChange={handleLocalFileChange}
                className="hidden"
              />
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-indigo-50 dark:bg-indigo-500/10 rounded-full flex items-center justify-center text-indigo-500 shrink-0">
                  <Icons.IconPlus className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Choose files or drag here</span>
                  <span className="block text-[10px] text-zinc-500">Supported: PDF, DOCX, TXT, PPTX, images, audio/video</span>
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

        <div className="p-6 border-t border-zinc-200 dark:border-white/10 shrink-0 flex items-center justify-between gap-3 bg-transparent">
          <div className="text-xs font-medium text-zinc-500">
            {files.length === 0 && indexedOnly.length > 0
              ? `${indexedOnly.length} class materials in index`
              : `${selectedFiles.size + localFiles.length} selected · ${summary.indexed} indexed`}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isIngesting || verifying || loading}
              className="px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 disabled:opacity-50 text-zinc-800 dark:text-zinc-200 text-sm font-semibold rounded-xl transition-all flex items-center"
            >
              {verifying ? (
                <>
                  <span className="w-4 h-4 border-2 border-zinc-400/30 border-t-zinc-600 rounded-full animate-spin mr-2"></span>
                  Checking…
                </>
              ) : (
                <>
                  <Icons.IconCheck className="w-4 h-4 mr-2" />
                  Verify index
                </>
              )}
            </button>

            <button
              onClick={files.length === 0 && indexedOnly.length > 0 && selectedFiles.size === 0 && localFiles.length === 0
                ? () => { onIngestSuccess(); onClose(); }
                : handleIngest}
              disabled={
                ingestBlocked
                || (selectedFiles.size === 0 && localFiles.length === 0 && indexedOnly.length === 0)
                || (!statusAvailable && (selectedFiles.size > 0 || localFiles.length > 0))
              }
              title={!statusAvailable ? 'Load index status before ingesting' : courseIngestBusy ? 'Indexing in progress' : undefined}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all active:scale-95 flex items-center"
            >
              {isIngesting || courseIngestBusy ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
                  {courseIngestBusy && !ingestProgress
                    ? 'Indexing in progress…'
                    : `Ingesting (${ingestProgress?.current}/${ingestProgress?.total})...`}
                </>
              ) : files.length === 0 && indexedOnly.length > 0 && localFiles.length === 0 ? (
                <>
                  <Icons.IconSparkles className="w-4 h-4 mr-2" />
                  Grade with these materials
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
    </div>
  );
}
