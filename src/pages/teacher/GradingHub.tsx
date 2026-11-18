import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { gsap } from 'gsap';
import * as Icons from '../../components/ui/Icons';
import { canvasAPI } from '../../services/canvasAPI';
import { supabase } from '../../lib/supabase';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { GradingResult } from '../../components/grading/GradingResult';
import { GradingOutput } from '../../types/grading';
import { UniversalPreviewer, prefetchPreviewFile } from '../../components/ui/UniversalPreviewer';
import { selectPhaseFiles, selectFilesNeedingIngest, sourceUpdatedAt, CanvasCourseFile, CourseFileStatusRow } from '../../lib/courseFileRanker';
import { CourseMaterialsModal } from '../../components/modals/CourseMaterialsModal';
import { AskEduConnectPanel } from '../../components/copilot/AskEduConnectPanel';
import { loadAiGrades, saveAiGrade, formatAiGradeLabel } from '../../lib/aiGradeCache';
import {
  buildDeductionExplanation,
  formatVerdictScore,
  isLegacyResult,
  isScore,
  rubricScoreBandNote,
  selectMatchingRubricRating,
  summarizeGrade,
} from '../../lib/gradeDisplay';
import { gradingApiBase, llmAuthHeaders, requireLlmCredentials } from '../../lib/llmProviders';
import { requireGradingSession } from '../../lib/gradingApi';
import { activeCourseId, authErrorMessage, gradingAuthHeaders } from '../../lib/gradingApi';

function htmlToPlainText(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/** True when URL is a Canvas LTI / Harmonize-style launch (needs signed resolve). */
function isLtiExternalUrl(url: string): boolean {
  return /\/lti\//i.test(url) || /harmonize/i.test(url) || /42lines\.net/i.test(url);
}

/** True when Canvas (or student) stored only a bare http(s) URL as the submission body. */
function getExternalSubmissionUrl(html: string): string | null {
  const text = htmlToPlainText(html);
  if (!text) return null;
  // Canvas sometimes inserts <br>/whitespace into long launch URLs
  const collapsed = text.replace(/\s+/g, '');
  const match = collapsed.match(/^(https?:\/\/\S+)$/i);
  if (!match) return null;
  return match[1];
}

function linkHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'external link';
  }
}

const CANVAS_WEB_BASE = 'https://usflearn.instructure.com';

function isLtiEmbedBlockedCopy(value: string): boolean {
  return /needs to be loaded in a new browser window|load in a new window|cannot be displayed in an iframe/i.test(value || '');
}

/** Fetch submission from Canvas (API + signed LTI launch) and render it in-app. */
function ExternalSubmissionViewer({
  url,
  courseId,
  assignmentId,
  studentId,
  initialText,
  onResolved,
}: {
  url: string;
  courseId: string;
  assignmentId: string;
  studentId: string;
  initialText?: string;
  onResolved?: (payload: { text: string; html: string; embedBlocked: boolean }) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(initialText && initialText.length >= 20 ? initialText : null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [canvasOpenUrl, setCanvasOpenUrl] = useState<string | null>(null);
  const [toolName, setToolName] = useState<string>('Canvas submission');
  const [error, setError] = useState<string | null>(null);
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const [pasteText, setPasteText] = useState(initialText && !getExternalSubmissionUrl(initialText) ? initialText : '');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'content' | 'text' | 'embed'>(
    initialText && initialText.length >= 20 && !getExternalSubmissionUrl(initialText) ? 'text' : 'content'
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    setText(null);
    setLaunchUrl(null);
    setEmbedBlocked(false);
    const fallbackCanvasOpen =
      courseId && assignmentId && studentId
        ? `${CANVAS_WEB_BASE}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}&student_id=${studentId}`
        : null;
    setCanvasOpenUrl(fallbackCanvasOpen);

    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await gradingAuthHeaders()) };

        const res = await fetch(`${gradingApiBase()}/api/resolve-external-submission`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            url,
            course_id: courseId,
            assignment_id: assignmentId,
            student_id: studentId,
            extract_text: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        const authMsg = authErrorMessage(data);
        if (authMsg) {
          setError(authMsg);
          setMode('embed');
          return;
        }
        const openUrl = data.canvas_open_url || data.speedgrader_url || fallbackCanvasOpen;
        if (openUrl) setCanvasOpenUrl(openUrl);
        if (data.tool_name) setToolName(data.tool_name);

        const extractedHtml = String(data.html || '').trim();
        const extractedText = String(data.text || '').trim();
        const blocked =
          Boolean(data.embed_blocked) ||
          isLtiEmbedBlockedCopy(extractedHtml) ||
          isLtiEmbedBlockedCopy(extractedText);
        setEmbedBlocked(blocked);

        const isLtiError =
          /unknown version/i.test(extractedText) ||
          /launch message is of an unknown version/i.test(extractedText) ||
          /unknown version/i.test(extractedHtml);

        // Never treat Harmonize's "open in a new window" interstitial as the submission.
        if (extractedHtml && extractedHtml.length >= 40 && !isLtiError && !isLtiEmbedBlockedCopy(extractedHtml)) {
          const plain = extractedText || htmlToPlainText(extractedHtml);
          setHtml(extractedHtml);
          setText(plain);
          setMode('content');
          onResolved?.({ text: plain, html: extractedHtml, embedBlocked: false });
        } else if (extractedText && extractedText.length >= 40 && !isLtiError && !isLtiEmbedBlockedCopy(extractedText)) {
          setText(extractedText);
          setMode('text');
          onResolved?.({ text: extractedText, html: '', embedBlocked: false });
        } else if (data.launch_url && !blocked) {
          setLaunchUrl(data.launch_url);
          setMode('embed');
          if (!res.ok) setError(data.error || data.details || null);
          onResolved?.({ text: '', html: '', embedBlocked: false });
        } else {
          setLaunchUrl(null);
          setError(
            data.error ||
              data.details ||
              (blocked
                ? 'This external tool blocks embedding inside EduConnect. Open the submission in Canvas to read it, or paste the student post below to grade.'
                : 'Could not load this submission from Canvas.')
          );
          setMode('embed');
          onResolved?.({ text: '', html: '', embedBlocked: blocked });
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Could not load submission from Canvas');
          setMode('embed');
          onResolved?.({ text: '', html: '', embedBlocked: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url, courseId, assignmentId, studentId]);

  const openHref = canvasOpenUrl || launchUrl || url;
  const hasContent = Boolean((html && html.length >= 40) || (text && text.length >= 40));

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0F172A] min-h-0">
      <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-white/5">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Student submission</div>
          <div className="text-[11px] text-zinc-400 truncate">Loaded from Canvas · {toolName}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex bg-white dark:bg-black/20 p-0.5 rounded-lg border border-zinc-200 dark:border-white/10">
            <button
              type="button"
              onClick={() => setMode('content')}
              disabled={!html}
              className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40 ${
                mode === 'content' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Content
            </button>
            <button
              type="button"
              onClick={() => setMode('text')}
              disabled={!text}
              className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40 ${
                mode === 'text' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => setMode('embed')}
              disabled={!launchUrl || embedBlocked}
              className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-40 ${
                mode === 'embed' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Live
            </button>
          </div>
          {openHref && (
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-[var(--brand-primary)] text-white text-[9px] font-black uppercase tracking-widest hover:opacity-90"
            >
              Open in Canvas
            </a>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
          <Icons.IconRefresh className="w-7 h-7 animate-spin text-[var(--brand-primary)]" />
          <div className="text-[10px] font-black uppercase tracking-widest">Fetching submission from Canvas…</div>
        </div>
      )}

      {!loading && mode === 'content' && html && (
        <div
          className="flex-1 overflow-y-auto p-8 prose dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200 break-words [overflow-wrap:anywhere] [&_a]:text-inherit [&_a]:no-underline"
          dangerouslySetInnerHTML={{ __html: prepareSubmissionHtml(html) }}
        />
      )}

      {!loading && mode === 'text' && text && (
        <div className="flex-1 overflow-y-auto p-8 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {text}
        </div>
      )}

      {!loading && mode === 'embed' && launchUrl && !embedBlocked && (
        <iframe
          src={launchUrl}
          title="Canvas LTI submission"
          className="flex-1 w-full border-0 bg-white"
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer-when-downgrade"
        />
      )}

      {!loading && !hasContent && (embedBlocked || !launchUrl) && (
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-xl mx-auto flex flex-col items-center text-center gap-3">
            <Icons.IconAlertCircle className="w-14 h-14 text-amber-500" />
            <h4 className="text-base font-bold text-zinc-900 dark:text-white">
              {embedBlocked ? 'External tool blocks in-app preview' : 'No submission content from Canvas'}
            </h4>
            <p className="text-sm text-zinc-500">
              {error ||
                (embedBlocked
                  ? 'Harmonize will not embed here. Open the post in Canvas, copy the student text, and paste it below so AI grading has something to read.'
                  : 'Canvas did not return readable HTML for this external submission.')}
            </p>
            {openHref && (
              <a
                href={openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 px-5 py-2.5 rounded-xl bg-[var(--brand-primary)] text-white text-[10px] font-black uppercase tracking-widest"
              >
                Open in Canvas
              </a>
            )}
            <div className="w-full text-left mt-4 space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Paste student post for AI grading
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={10}
                placeholder="Paste the Harmonize / Canvas discussion post here…"
                className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-black/20 p-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40"
              />
              <button
                type="button"
                disabled={pasteText.trim().length < 20}
                onClick={() => {
                  const cleaned = pasteText.trim();
                  if (cleaned.length < 20) return;
                  setText(cleaned);
                  setHtml(null);
                  setEmbedBlocked(false);
                  setMode('text');
                  onResolved?.({ text: cleaned, html: '', embedBlocked: false });
                }}
                className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
              >
                Use pasted text for grading
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Generic https link-only submissions (Power BI, docs, dashboards, etc.). */
function LinkSubmissionViewer({
  url,
  courseId,
  initialText,
  onResolved,
}: {
  url: string;
  courseId?: string;
  initialText?: string;
  onResolved?: (payload: { text: string; html: string; embedBlocked: boolean }) => void;
}) {
  const host = linkHostLabel(url);
  const [showEmbed, setShowEmbed] = useState(false);
  const [embedFailed, setEmbedFailed] = useState(false);
  const [pasteText, setPasteText] = useState(
    initialText && !getExternalSubmissionUrl(initialText) ? initialText : ''
  );
  const [fetchedNote, setFetchedNote] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setFetchedNote(null);
    (async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(await gradingAuthHeaders()),
        };
        const res = await fetch(`${gradingApiBase()}/api/fetch-public-link`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            url,
            course_id: courseId || activeCourseId(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data?.extractable && typeof data.text === 'string' && data.text.trim().length >= 40) {
          const cleaned = data.text.trim();
          setFetchedNote('Readable content was extracted from this public link for AI grading.');
          onResolved?.({ text: cleaned, html: '', embedBlocked: false });
        } else {
          setFetchedNote(
            data?.reason ||
              'This link could not be read automatically (often sign-in or an interactive app). Open it and paste a short description for AI grading.'
          );
        }
      } catch {
        if (!cancelled) {
          setFetchedNote('Could not fetch link content. Open the link and paste a description if needed.');
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, courseId]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0F172A] min-h-0" data-testid="link-submission-viewer">
      <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-white/5">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Link submission</div>
          <div className="text-[11px] text-zinc-400 truncate">{host}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowEmbed(true);
              setEmbedFailed(false);
            }}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-white/5"
          >
            Try in-app preview
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-[var(--brand-primary)] text-white text-[9px] font-black uppercase tracking-widest hover:opacity-90"
          >
            Open link
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50/80 dark:bg-white/[0.03] p-4 space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Submitted URL</div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-indigo-600 dark:text-indigo-400 break-all hover:underline"
          >
            {url}
          </a>
          <p className="text-[11px] text-zinc-500 leading-snug">
            Interactive dashboards (Power BI, Looker, etc.) usually will not embed here. Use Open link, then paste a
            short description below if AI grading has nothing to read.
          </p>
          {fetching ? (
            <p className="text-[11px] text-zinc-400">Checking whether public content can be extracted…</p>
          ) : fetchedNote ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">{fetchedNote}</p>
          ) : null}
        </div>

        {showEmbed && !embedFailed && (
          <div className="rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden h-[360px] bg-white">
            <iframe
              src={url}
              title={`Preview ${host}`}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setEmbedFailed(true)}
            />
          </div>
        )}
        {showEmbed && embedFailed && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            In-app preview was blocked by the remote site. Use Open link instead.
          </p>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            Paste description for AI grading (optional)
          </label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder="Describe what the linked dashboard/doc shows, key findings, filters used, etc."
            className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-black/20 p-3 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40"
          />
          <button
            type="button"
            disabled={pasteText.trim().length < 20}
            onClick={() => {
              const cleaned = pasteText.trim();
              if (cleaned.length < 20) return;
              onResolved?.({ text: `[LINK DESCRIPTION]\nURL: ${url}\n\n${cleaned}`, html: '', embedBlocked: false });
            }}
            className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
          >
            Use pasted description for grading
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Prepare Canvas HTML for the grading viewer:
 * - unwrap <a> so fragments aren't shown as blue links
 * - drop iframes/images that show as broken loaders under pasted URLs
 */
function prepareSubmissionHtml(html: string): string {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img, iframe, object, embed, video, audio, script, style').forEach((el) => el.remove());
    doc.querySelectorAll('a').forEach((anchor) => {
      const parent = anchor.parentNode;
      if (!parent) return;
      while (anchor.firstChild) {
        parent.insertBefore(anchor.firstChild, anchor);
      }
      parent.removeChild(anchor);
    });
    doc.querySelectorAll('[style]').forEach((el) => {
      const style = (el.getAttribute('style') || '')
        .replace(/color\s*:[^;]+;?/gi, '')
        .replace(/text-decoration\s*:[^;]+;?/gi, '');
      if (style.trim()) el.setAttribute('style', style);
      else el.removeAttribute('style');
    });
    return doc.body.innerHTML;
  } catch {
    return html
      .replace(/<\/?a\b[^>]*>/gi, '')
      .replace(/<(img|iframe|object|embed|video|audio|script|style)\b[^>]*>/gi, '');
  }
}

async function fetchViaCanvasProxy(url: string): Promise<Response> {
  const proxyUrl = `${gradingApiBase()}/api/proxy-file?course_id=${encodeURIComponent(activeCourseId())}&url=${encodeURIComponent(url)}`;
  return fetch(proxyUrl, { headers: await gradingAuthHeaders() });
}

const MOCK_LEARNING_PROFILE = {
  materialsViewed: '18/24',
  mostActiveTopic: 'Chapter 2 (MapReduce)',
  lastActive: '2 days ago',
  discussionPosts: 8,
  assignmentCompletion: '5/6',
  completionRate: 83,
  backgroundNote: 'Works in data engineering, engages most with practical applications'
};

const MOCK_AI_RESPONSE = {
  suggestedGrade: 87,
  strengths: [
    "Strong real-world connection to professional experience",
    "Accurate technical explanation of MapReduce architecture"
  ],
  improvements: [
    "Could elaborate more on fault tolerance mechanisms",
    "Missing comparison to alternative frameworks"
  ],
  feedback: "Excellent work. Your explanation of distributed processing is accurate and well-structured. To strengthen this further, consider discussing how MapReduce handles node failures.",
  personalizedNote: "Given your background in data engineering, you might find it valuable to explore how modern tools like Apache Spark have evolved from the MapReduce paradigm.",
  tags: ["Excellent format", "Needs fault tolerance info"]
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class RightPanelErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error.toString() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("RightPanel Crash Detected:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-zinc-900 border-2 border-red-500 rounded text-red-100 min-h-[50vh]">
          <div className="text-center max-w-lg mb-4 p-4 bg-black rounded shadow">
            <h2 className="text-xl font-bold mb-2">Rendering Error in Student View</h2>
            <div className="text-xs mb-4 font-mono text-left block text-red-300 overflow-auto">{this.state.errorMsg}</div>
          </div>
          <button onClick={() => this.setState({hasError: false})} className="px-6 py-3 bg-red-600 font-bold uppercase disabled opacity-80 cursor-pointer rounded">Retry Render</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function GradingHub({ onBack, onNavigateTo, currentPath, onLogout, onOpenNotifs }: { onBack?: () => void, onNavigateTo?: (path: string) => void, currentPath?: string, onLogout?: () => void, onOpenNotifs?: () => void }) {
  const [activeCourse, setActiveCourse] = useState<{id: string, name: string} | null>(null);
  const selectedCourse = activeCourse?.id;

  const [assignments, setAssignments] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [studentsData, setStudentsData] = useState<any[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [activeAttachment, setActiveAttachment] = useState<any>(null);
  const [useMoE, setUseMoE] = useState<boolean>(false);

  const [filter, setFilter] = useState<'All' | 'Ungraded' | 'Graded' | 'Missing'>('All');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'Default' | 'NameASC' | 'UID' | 'GradeASC'>('Default');

  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  // New states for Sidebar Filtering
  const [sideFilterType, setSideFilterType] = useState<'All' | 'Assignments' | 'Quizzes' | 'Discussions'>('All');
  const [sideSortOrder, setSideSortOrder] = useState<'Newest' | 'Oldest'>('Newest');

  const [loading, setLoading] = useState({ assignments: true, submissions: false });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showScaffoldedFeedback, setShowScaffoldedFeedback] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRefreshingMaterials, setIsRefreshingMaterials] = useState(false);
  /** Extracted / pasted text for Harmonize (and similar) when Canvas body is only an LTI URL. */
  const [gradingTextByStudent, setGradingTextByStudent] = useState<Record<string, string>>({});
  const [isGradingSidebarCollapsed, setIsGradingSidebarCollapsed] = useState(false);
  const [showAssignmentContext, setShowAssignmentContext] = useState(false);
  const [showLearningProfile, setShowLearningProfile] = useState(false);
  const [showRubricContext, setShowRubricContext] = useState(false);
  const [showMaterialsModal, setShowMaterialsModal] = useState(false);
  const [showAskEduConnect, setShowAskEduConnect] = useState(false);

  // Phase 3: RAG States
  const [aiGradingData, setAiGradingData] = useState<Record<string, GradingOutput>>({});
  const [loadingStudents, setLoadingStudents] = useState<Set<string>>(new Set());
  const [ingestingStudents, setIngestingStudents] = useState<Set<string>>(new Set());
  const [ingestStatus, setIngestStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'loading', msg: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [ingestedAssignments, setIngestedAssignments] = useState<Set<string>>(new Set());
  const ingestionPromisesRef = useRef<Record<string, Promise<void>>>({});
  const [highlightText, setHighlightText] = useState<string | null>(null);

  // References for animations
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const centerPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const centerRowsRef = useRef<HTMLDivElement>(null);
  const rightCardsRef = useRef<HTMLDivElement>(null);

  // Resizing logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft.current) {
        let newWidth = e.clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 500) newWidth = 500;
        setLeftPanelWidth(newWidth);
      }
      if (isDraggingRight.current) {
        let newWidth = window.innerWidth - e.clientX;
        if (newWidth < 300) newWidth = 300;
        if (newWidth > 700) newWidth = 700;
        setRightPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingLeft.current || isDraggingRight.current) {
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
      isDraggingLeft.current = false;
      isDraggingRight.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Initial Data Fetch
  useEffect(() => {
    gsap.from([leftPanelRef.current, centerPanelRef.current, rightPanelRef.current], {
      x: -30,
      opacity: 0,
      stagger: 0.1,
      duration: 0.5,
      ease: "power2.out",
      clearProps: "all"
    });

    const initData = () => {
      const rawCourse = localStorage.getItem('active_canvas_course');
      if (!rawCourse) {
        if (onNavigateTo) onNavigateTo('teacher-select-course');
      } else {
        const parsed = JSON.parse(rawCourse);
        setActiveCourse({ id: parsed.id.toString(), name: parsed.name });
      }
    };
    initData();

    // Surface missing memberships/migrations before auto-ingest fails mid-flow.
    (async () => {
      try {
        const res = await fetch(`${gradingApiBase()}/api/health`);
        const body = await res.json().catch(() => ({}));
        if (body?.authz && body.authz.ready === false) {
          setIngestStatus({
            type: 'error',
            msg: body.authz.message || authErrorMessage({ error: 'AUTHZ_SETUP_REQUIRED' }) || 'Course access is not set up on the server.',
          });
        }
      } catch {
        /* health probe is best-effort; ingest still fails closed */
      }
    })();
  }, []);

  // Fetch Assignments & Discussions when course changes
  useEffect(() => {
    if (!selectedCourse) return;
    const fetchAssn = async () => {
      setLoading(l => ({ ...l, assignments: true }));
      try {
        const [assn, disc] = await Promise.all([
          canvasAPI.getAssignments(selectedCourse),
          canvasAPI.getDiscussionTopics(selectedCourse)
        ]);
        setAssignments(Array.isArray(assn) ? assn : []);
        setDiscussions(Array.isArray(disc) ? disc : []);
      } catch (err: any) {
        setErrorMsg(`Failed to load assignments: ${err.message || 'Unknown error'}`);
        console.error("Assignments fetch failed:", err);
      } finally {
        setLoading(l => ({ ...l, assignments: false }));
      }
    };
    fetchAssn();
  }, [selectedCourse]);

  // Fetch Submissions when assignment changes
  useEffect(() => {
    // Clear in-memory grading so we don't bleed previous assignment's scores
    setAiGradingData({});
    setSelectedStudent(null);
    setRowErrors({});
    setGradingTextByStudent({});
    
    if (!selectedCourse || !selectedAssignment) return;
    const isDiscussion = discussions.some(d => String(d.id) === selectedAssignment);
    const cachedGrades = loadAiGrades(selectedCourse, selectedAssignment);

    const mergeCachedGrade = (student: any) => {
      const cached = cachedGrades[student.id];
      if (!cached || student.status === 'Missing') return student;
      // Canvas official score wins for the badge when present
      if (student.rawScore !== null && student.rawScore !== undefined) return student;
      const summary = summarizeGrade(cached);
      if (summary.kind !== 'complete') return student;
      return {
        ...student,
        status: 'Graded',
        gradeText: `${formatAiGradeLabel(cached)} AI`,
        rawScore: summary.total,
      };
    };

    const fetchSubmissions = async () => {
      setLoading(l => ({ ...l, submissions: true }));
      try {
        // Restore persisted AI grades (survive leaving the page / refresh)
        setAiGradingData(cachedGrades);

        if (isDiscussion) {
          const entries = await canvasAPI.getDiscussionEntries(selectedCourse, selectedAssignment);
          // format entries to match student view
          const mapped = (Array.isArray(entries) ? entries : []).map((e: any) => mergeCachedGrade({
            id: String(e.user_id),
            name: e.user_name || 'Unknown Student',
            initials: (e.user_name || 'U S').substring(0, 2).toUpperCase(),
            date: e.created_at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(e.created_at)) : 'No date',
            status: e.message ? 'Ungraded' : 'Missing',
            gradeText: 'Ungraded',
            avatarColor: 'bg-emerald-700',
            rawScore: null,
            body: e.message || ''
          }));
          setStudentsData(mapped);
        } else {
          const subs = await canvasAPI.getSubmissions(selectedCourse, selectedAssignment);
          const mapped = (Array.isArray(subs) ? subs : []).filter((s: any) => s.user).map((s: any) => mergeCachedGrade({
            id: String(s.user_id),
            name: s.user?.name || s.user?.short_name || 'Unknown Student',
            initials: (s.user?.name || s.user?.short_name || 'U S').substring(0, 2).toUpperCase(),
            date: s.submitted_at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(s.submitted_at)) : 'Missing input',
            status: s.score !== null ? 'Graded' : (s.submitted_at ? 'Ungraded' : 'Missing'),
            gradeText: s.score !== null ? `${s.score} pts` : 'Ungraded',
            avatarColor: 'bg-blue-700',
            rawScore: s.score,
            attachments: (() => {
              let allAtts = [...(s.attachments || [])];
              // Traverse submission history to collect any past attached files if they submitted multiple times
              if (s.submission_history && Array.isArray(s.submission_history)) {
                s.submission_history.forEach((hist: any) => {
                  if (hist.attachments) {
                    hist.attachments.forEach((ha: any) => {
                      if (!allAtts.find(a => a.id === ha.id)) {
                        allAtts.push(ha);
                      }
                    });
                  }
                });
              }
              return allAtts;
            })(),
            submissionType: s.submission_type || null,
            submissionUrl: s.url || null,
            previewUrl: s.preview_url || null,
            body: (() => {
              let content = s.body || '';
              // For graded discussions, Canvas returns student responses inside discussion_entries
              if (!content && s.discussion_entries && Array.isArray(s.discussion_entries) && s.discussion_entries.length > 0) {
                 content = s.discussion_entries.map((e: any) => e.message || '').filter(Boolean).join('<hr class="my-4 border-zinc-200 dark:border-white/10" />');
              }
              // Fallback to submission_history if discussion_entries is absent but it is a text-based submission
              if (!content && s.submission_history && Array.isArray(s.submission_history) && s.submission_history.length > 0) {
                 const latestHistory = s.submission_history[s.submission_history.length - 1];
                 if (latestHistory && latestHistory.body) content = latestHistory.body;
                 else if (latestHistory && latestHistory.url) content = latestHistory.url;
                 else if (latestHistory && latestHistory.discussion_entries) {
                    content = latestHistory.discussion_entries.map((e: any) => e.message || '').filter(Boolean).join('<hr class="my-4 border-zinc-200 dark:border-white/10" />');
                 }
              }
              // basic_lti_launch / online_url: Canvas stores the tool URL in `url`, often with empty body
              const launchUrl = s.url || '';
              const bodyIsPlaceholder =
                !content ||
                /^submission type:/i.test(content.trim()) ||
                /^no submission content/i.test(content.trim());
              if (launchUrl && (bodyIsPlaceholder || getExternalSubmissionUrl(content))) {
                content = launchUrl;
              }
              if (!content) {
                 content = s.submission_type ? `Submission type: ${s.submission_type}` : 'No submission content.';
              }
              return content;
            })()
          }));
          setStudentsData(mapped);

          // Phase 2: Upsert into supabase (Removed frontend parallel upserts to fix Supabase Rate Limiting / 400 errors)
        }
      } catch (err: any) {
        setErrorMsg(`Failed to load submissions: ${err.message || 'Unknown error'}`);
        console.error("Submissions fetch failed:", err);
      } finally {
        setLoading(l => ({ ...l, submissions: false }));
      }
    };
    fetchSubmissions();
  }, [selectedCourse, selectedAssignment, discussions]);

  // Prefetch attachment bytes so Local Reader opens quickly
  useEffect(() => {
    if (!studentsData.length) return;
    const selected = selectedStudent
      ? studentsData.find(s => s.id === selectedStudent)
      : null;
    const queue: string[] = [];
    if (selected?.attachments?.length) {
      selected.attachments.forEach((a: any) => { if (a?.url) queue.push(a.url); });
    }
    // Warm cache for nearby students' first attachment
    for (const s of studentsData.slice(0, 8)) {
      const url = s.attachments?.[0]?.url;
      if (url && !queue.includes(url)) queue.push(url);
    }
    queue.forEach(prefetchPreviewFile);
  }, [studentsData, selectedStudent]);

  // Stagger center panel rows when assignment changes
  useEffect(() => {
    if (selectedAssignment && centerRowsRef.current && !loading.submissions) {
      gsap.fromTo(centerRowsRef.current.children, 
        { y: 15, opacity: 0 },
        { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "power2.out", clearProps: "all" }
      );
    }
  }, [selectedAssignment, filter, loading.submissions]);

  // Slide right panel in when student selected
  useEffect(() => {
    if (selectedStudent && rightPanelRef.current) {
      gsap.from(rightPanelRef.current, {
        x: 50,
        opacity: 0,
        duration: 0.3,
        ease: "power2.out"
      });
    }
    setActiveAttachment(null);
    setHighlightText(null);
  }, [selectedStudent]);

  const currentAuthItem = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
  const assignmentContextStr = currentAuthItem?.description || currentAuthItem?.message || '';


  const handleDownloadZip = async () => {
    if (!selectedAssignment || studentsData.length === 0) return;
    setIsDownloading(true);
    
    try {
      const zip = new JSZip();
      
      // Iterate through students and fetch their content
      for (const student of studentsData) {
        // Only include students who have some sort of submission or attachments
        if (student.status === 'Missing') continue;

        const studentFolder = zip.folder(student.name);
        if (!studentFolder) continue;

        // Clean out HTML tags for the text version
        const rawBodyText = student.body ? student.body.replace(/(<([^>]+)>)/gi, "\n") : "No submission text.";
        studentFolder.file(`${student.name}_submission.txt`, rawBodyText);

        // Fetch attachments via API proxy (Canvas CDN blocks browser CORS)
        if (student.attachments && student.attachments.length > 0) {
          for (const att of student.attachments) {
            const name = att.filename || att.display_name;
            if (att.url && name) {
              try {
                const res = await fetchViaCanvasProxy(att.url);
                if (!res.ok) throw new Error(`Proxy ${res.status}`);
                const blob = await res.blob();
                studentFolder.file(name, blob);
              } catch (err) {
                console.error(`Failed to download attachment for ${student.name}: ${name}`, err);
                studentFolder.file(`${name}_download_error.txt`, `Failed to download file from canvas.`);
              }
            }
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const assignmentTitle = (currentAuthItem?.name || currentAuthItem?.title || 'Submissions').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      saveAs(zipBlob, `${assignmentTitle}_submissions.zip`);

    } catch (err) {
      console.error("Failed to generate ZIP", err);
      alert("Failed to download ZIP file.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadSingleAttachment = async (url: string, filename: string) => {
    try {
      const res = await fetchViaCanvasProxy(url);
      if (!res.ok) throw new Error(`Proxy download failed (${res.status})`);
      const blob = await res.blob();
      saveAs(blob, filename);
    } catch (err) {
      console.error(`Failed to download ${filename}`, err);
      alert(`Failed to download file from canvas.`);
    }
  };

  // Pushes the assignment description + rubric criteria to the grading server.
  const postAssignmentIngest = async (assignmentId: string) => {
    const currentItem = assignments.find(a => String(a.id) === assignmentId) || discussions.find(d => String(d.id) === assignmentId);
    const rubric = currentItem?.rubric || [];
    const materialText = currentItem?.description || currentItem?.message || '';

    const headers: any = { 'Content-Type': 'application/json', ...llmAuthHeaders(), ...(await gradingAuthHeaders()) };
    requireLlmCredentials();

    const res = await fetch(`${gradingApiBase()}/api/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assignment_id: assignmentId,
        course_id: selectedCourse,
        canvas_base_url: localStorage.getItem('canvas_base_url') || '',
        course_material_text: materialText,
        rubric_criteria: rubric.map((r: any) => ({
          criterion_id: r.id || r.description,
          title: r.description,
          description: r.long_description || r.description,
          max_score: r.points,
          dimension: 'content' // default
        })),
        exemplars: []
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      let authMsg: string | null = null;
      try { authMsg = authErrorMessage(JSON.parse(errText)); } catch { /* not JSON */ }
      throw new Error(authMsg || errText || 'Assignment ingest failed');
    }
  };

  const ingestCourseFile = async (assignmentId: string, file: CanvasCourseFile) => {
    const payload = {
      assignment_id: assignmentId,
      course_id: selectedCourse,
      canvas_base_url: localStorage.getItem('canvas_base_url') || '',
      url: file.url,
      filename: file.display_name,
      canvas_file_id: String(file.id),
      updated_at: sourceUpdatedAt(file),
      canvas_token: localStorage.getItem('custom_canvas_token') || ''
    };

    const fileHeaders: any = { 'Content-Type': 'application/json', ...llmAuthHeaders(), ...(await gradingAuthHeaders()) };

    const res = await fetch(`${gradingApiBase()}/api/ingest/canvas-url`, {
      method: 'POST',
      headers: fileHeaders,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return await res.json().catch(() => ({} as any));
  };

  const fetchCourseFileStatus = async (): Promise<CourseFileStatusRow[]> => {
    const res = await fetch(
      `${gradingApiBase()}/api/ingest/course-status?course_id=${encodeURIComponent(String(selectedCourse))}`,
      { headers: { ...(await gradingAuthHeaders()) } }
    );
    if (!res.ok) {
      const errText = await res.text();
      let authMsg: string | null = null;
      try { authMsg = authErrorMessage(JSON.parse(errText)); } catch { /* not JSON */ }
      throw new Error(authMsg || errText || 'Course status failed');
    }
    const data = await res.json();
    return Array.isArray(data?.files) ? data.files : [];
  };

  // Indexes course files that are missing, failed, or changed in Canvas since last ingest.
  const handleRefreshMaterials = async () => {
    if (!selectedCourse || !selectedAssignment || isRefreshingMaterials) return;
    setIsRefreshingMaterials(true);
    try {
      await requireGradingSession();
      requireLlmCredentials();
      setIngestStatus({ type: 'loading', msg: 'Checking which course materials need indexing...' });
      const [files, statusRows] = await Promise.all([
        canvasAPI.getCourseFiles(selectedCourse),
        fetchCourseFileStatus(),
      ]);
      const docFiles = (Array.isArray(files) ? files as CanvasCourseFile[] : []);
      const pending = selectFilesNeedingIngest(docFiles, statusRows);

      let failed = 0;
      for (const [i, file] of pending.entries()) {
        setIngestStatus({ type: 'loading', msg: `Indexing materials ${i + 1} of ${pending.length}: ${file.display_name}` });
        try {
          const result = await ingestCourseFile(selectedAssignment, file);
          if (!result?.cached && !result?.skipped) {
            await new Promise(r => setTimeout(r, 400));
          }
        } catch (e) {
          failed += 1;
          console.error(`Refresh ingest failed: ${file.display_name}`, e);
        }
      }

      const total = selectFilesNeedingIngest(docFiles, []).length;
      const ready = total - selectFilesNeedingIngest(docFiles, await fetchCourseFileStatus()).length;
      setIngestStatus(failed > 0
        ? { type: 'warning', msg: `${ready} of ${total} course files indexed — ${failed} failed this refresh. Grading may miss some context.` }
        : { type: 'success', msg: `${ready} of ${total} course files indexed${pending.length === 0 ? ' (already up to date)' : ''}.` });
    } catch (err: any) {
      console.error('Refresh materials failed:', err);
      setIngestStatus({ type: 'error', msg: `Refresh materials failed: ${err.message}` });
    } finally {
      setIsRefreshingMaterials(false);
    }
  };

  // Auto-index course materials when an assignment opens. Already-ready files are
  // skipped (no download / no re-embed). Only new or changed Canvas files are read.
  useEffect(() => {
    if (!selectedCourse || !selectedAssignment) return;

    if (ingestedAssignments.has(selectedAssignment) || ingestionPromisesRef.current[selectedAssignment]) {
      return;
    }

    const runAutoIngest = async () => {
      setIngestStatus({ type: 'loading', msg: 'Checking class materials...' });
      try {
        await requireGradingSession();
        const health = await fetch(`${gradingApiBase()}/api/health`).then((r) => r.json()).catch(() => null);
        if (health?.authz && health.authz.ready === false) {
          throw new Error(health.authz.message || authErrorMessage({ error: 'AUTHZ_SETUP_REQUIRED' }));
        }
        const currentItem = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
        requireLlmCredentials();

        await postAssignmentIngest(selectedAssignment);

        const [files, statusRows] = await Promise.all([
          canvasAPI.getCourseFiles(selectedCourse),
          fetchCourseFileStatus(),
        ]);
        const allFiles = Array.isArray(files) ? files as CanvasCourseFile[] : [];
        const pending = selectFilesNeedingIngest(allFiles, statusRows);
        const totalReadable = selectFilesNeedingIngest(allFiles, []).length;
        const alreadyReady = Math.max(0, totalReadable - pending.length);

        if (pending.length === 0) {
          setIngestedAssignments(prev => new Set(prev).add(selectedAssignment));
          setIngestStatus({
            type: 'success',
            msg: `${alreadyReady} of ${totalReadable} course files indexed (already up to date).`,
          });
          setTimeout(() => setIngestStatus(null), 5000);
          return;
        }

        setIngestStatus({
          type: 'loading',
          msg: `Indexing ${pending.length} new or updated material${pending.length === 1 ? '' : 's'}...`,
        });

        const { phaseA, phaseB } = selectPhaseFiles(
          pending,
          currentItem?.name || currentItem?.title || '',
          5
        );

        const ingestFile = (file: CanvasCourseFile) => ingestCourseFile(selectedAssignment, file);

        let succeeded = 0;
        let failed = 0;
        for (const [i, file] of phaseA.entries()) {
          setIngestStatus({
            type: 'loading',
            msg: `Indexing materials ${i + 1} of ${pending.length}: ${file.display_name}`,
          });
          try {
            const result = await ingestFile(file);
            succeeded += 1;
            // A cache hit does no embedding work, so there is no quota to pace.
            if (!result?.cached && !result?.skipped) {
              await new Promise(r => setTimeout(r, 800));
            }
          } catch (e) {
            failed += 1;
            console.error(`Failed to ingest course file: ${file.display_name}`, e);
          }
        }

        setIngestedAssignments(prev => new Set(prev).add(selectedAssignment));
        const readyNow = alreadyReady + succeeded;
        const phaseAStatus: { type: 'success' | 'warning', msg: string } = failed > 0
          ? {
              type: 'warning',
              msg: `${readyNow} of ${totalReadable} course files indexed — ${failed} failed. Grading may miss some context.`,
            }
          : {
              type: 'success',
              msg: `${readyNow} of ${totalReadable} course files indexed.`,
            };
        setIngestStatus(phaseAStatus);

        if (phaseB.length > 0) {
          void (async () => {
            setIngestStatus({ type: 'loading', msg: 'Indexing more materials in background...' });
            for (const file of phaseB) {
              try {
                const result = await ingestFile(file);
                if (!result?.cached && !result?.skipped) {
                  await new Promise(r => setTimeout(r, 400));
                }
              } catch (e) {
                console.error(`Background ingest failed: ${file.display_name}`, e);
              }
            }
            setIngestStatus({
              type: failed > 0 ? 'warning' : 'success',
              msg: failed > 0
                ? `${totalReadable - failed} of ${totalReadable} course files indexed — ${failed} failed. Grading may miss some context.`
                : `${totalReadable} of ${totalReadable} course files indexed.`,
            });
            setTimeout(() => setIngestStatus(null), 5000);
          })();
        } else {
          setTimeout(() => setIngestStatus(null), 5000);
        }
      } catch (err: any) {
        console.error(`Auto-ingestion failed:`, err);
        setIngestStatus({ type: 'error', msg: `Auto-ingestion failed: ${err.message}` });
      }
    };

    const promise = runAutoIngest();
    ingestionPromisesRef.current[selectedAssignment] = promise;
  }, [selectedAssignment, selectedCourse, assignments, discussions]);

  const handleFetchAiGrade = async (studentId: string, isRetry = false) => {
    const student = studentsData.find(s => s.id === studentId);
    if (!student) return;

    setLoadingStudents(prev => new Set(prev).add(studentId));
    setRowErrors(prev => { const n = { ...prev }; delete n[studentId]; return n; });
    
    try {
      await requireGradingSession();
      // Offline mock hub courses (101/102) grade without a Canvas token when the
      // server has EDUCONNECT_LOCAL_MOCK_GRADE=1. Real Canvas courses still need a token.
      const mockHubCourse = ['101', '102'].includes(String(selectedCourse || ''));
      if (!mockHubCourse && !localStorage.getItem('custom_canvas_token')) {
        throw new Error(
          'Connect your Canvas API token (Course Selection → Verify Canvas) so the assignment can be verified before AI grading.',
        );
      }
      // Wait for auto-ingest to finish if it's currently running for this assignment
      if (ingestionPromisesRef.current[selectedAssignment!]) {
        try {
          setIngestingStudents(prev => new Set(prev).add(studentId));
          await ingestionPromisesRef.current[selectedAssignment!];
        } catch(e) {} finally {
          setIngestingStudents(prev => { const n = new Set(prev); n.delete(studentId); return n; });
        }
      }

      const submissionTextForAnalysis = student.body ? String(student.body).replace(/(<([^>]+)>)/gi, "") : "";
      const hfText = submissionTextForAnalysis.substring(0, 1500);

      const backendReq = async () => {
        let body: any;
        let headers: any = { ...llmAuthHeaders(), ...(await gradingAuthHeaders()) };
        requireLlmCredentials();

        const canvasToken = localStorage.getItem('custom_canvas_token') || '';

        const rawBody = student.body || '';
        const overrideText = (gradingTextByStudent[studentId] || '').trim();
        const bareSubmissionUrl = getExternalSubmissionUrl(String(rawBody));
        const launchOnly = Boolean(bareSubmissionUrl);
        // Prefer extracted/pasted Harmonize/link text; fall back to body (may be URL for server resolve).
        const submissionTextForGrade = overrideText || String(rawBody || '');
        const placeholderBody =
          !submissionTextForGrade ||
          /^submission type:/i.test(submissionTextForGrade.trim()) ||
          /^no submission content/i.test(submissionTextForGrade.trim());

        if (launchOnly && !overrideText && !(student.attachments && student.attachments.length > 0)) {
          console.warn(
            bareSubmissionUrl && isLtiExternalUrl(bareSubmissionUrl)
              ? '[grade] LTI/Harmonize body is launch URL only; server will attempt extract'
              : '[grade] Link-only submission; server will attempt public fetch or use pasted description'
          );
        }

        const assignMeta = assignments.find(a => String(a.id) === selectedAssignment)
          || discussions.find(d => String(d.id) === selectedAssignment);
        const rawPoints = (assignMeta as any)?.points_possible ?? (assignMeta as any)?.points;
        const parsedPoints =
          rawPoints == null || rawPoints === ''
            ? null
            : Number(rawPoints);
        const assignmentPayload = {
          assignment_name: (assignMeta as any)?.name || (assignMeta as any)?.title || '',
          assignment_description: (assignMeta as any)?.description || (assignMeta as any)?.message || '',
          // Required for no-rubric inferred / points-anchored scored policies.
          ...(Number.isFinite(parsedPoints) && parsedPoints > 0
            ? { points_possible: parsedPoints }
            : {}),
          moe: useMoE,
        };

        if (student.attachments && student.attachments.length > 0) {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({
            assignment_id: selectedAssignment,
            course_id: selectedCourse,
            canvas_base_url: localStorage.getItem('canvas_base_url') || '',
            student_id: studentId,
            // Don't send Canvas placeholders — grader reads the attached file(s)
            submission_text: placeholderBody ? '' : submissionTextForGrade,
            canvas_token: canvasToken,
            file_urls: student.attachments.map((a: any) => ({
              url: a.url,
              filename: a.filename || a.display_name || 'submission.bin'
            })),
            ...assignmentPayload,
          });
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({
            assignment_id: selectedAssignment,
            course_id: selectedCourse,
            canvas_base_url: localStorage.getItem('canvas_base_url') || '',
            student_id: studentId,
            submission_text: submissionTextForGrade,
            external_url: bareSubmissionUrl || undefined,
            canvas_token: canvasToken,
            ...assignmentPayload,
          });
        }

        const res = await fetch(`${gradingApiBase()}/api/grade`, {
          method: 'POST',
          headers,
          body
        });

        const data = await res.json();
        if (!res.ok) {
          const authMsg = authErrorMessage(data);
          if (authMsg) {
             throw new Error(authMsg);
          }
          if (data.error === "DATABASE_DIMENSION_MISMATCH") {
             throw new Error(data.message || "Database vector setup does not match this grading server.");
          }
          if (data.error === "BYOK_REQUIRED" || res.status === 401) {
             throw new Error(data.message || data.error || "Verify your LLM provider API key before grading.");
          }
          if (data.error === "EMBEDDING_MIGRATION_REQUIRED" || (res.status === 503 && String(data.error || '').includes('EMBEDDING'))) {
             throw new Error(data.message || "Embedding schema migration required before grading.");
          }
          if (data.error === "REINGEST_REQUIRED" || data.error === "UNKNOWN_PROVENANCE") {
             // Legacy hard-fail path; degrade-and-grade should return 200 with materials_status.
             throw new Error(data.message || "Re-ingest course materials with your current LLM provider, then grade again.");
          }
          if (res.status === 409 && !isScore(data?.total) && data?.assessment_status == null) {
             throw new Error(data.message || "Grading blocked by embedding provenance. Re-index materials, then retry.");
          }
          if (data.error === "LLM_QUOTA" || res.status === 429 || String(data.error || '').toLowerCase().includes('quota')) {
             throw new Error(data.message || "LLM API quota exceeded. Wait a moment and retry.");
          }
          if (data.error === "RUBRIC_INVALID" || res.status === 422) {
             throw new Error(
               data.message ||
                 "Instructor rubric is invalid/unusable. Re-send the Canvas rubric, then grade again.",
             );
          }
          throw new Error(
            (typeof data.message === 'string' && data.message)
              || (typeof data.error === 'string' && data.error)
              || "Grading failed",
          );
        }
        
        if (data.error === "RUBRIC_INVALID") {
           throw new Error(
             data.message ||
               "Instructor rubric is invalid/unusable and was not replaced with a fallback. Fix the rubric explicitly.",
           );
        }
        // Fallback policies grade without an instructor rubric; only hard-fail when
        // the server still reports a true missing rubric with no policy resolution.
        if (data.rubric_missing && !data.policy_origin && !data.assessment_policy) {
           if (isRetry) {
              throw new Error("No rubric exists for this assignment.");
           }
           setIngestStatus({ type: 'loading', msg: 'AI rubric unavailable. Re-sending the rubric and retrying once...' });
           throw new Error("RUBRIC_MISSING_RETRY");
        }
        return data;
      };

      const integrityReq = async () => {
         try {
            const hfToken = import.meta.env.VITE_HUGGINGFACE_TOKEN || ''; 
            const hfRes = await fetch('https://api-inference.huggingface.co/models/roberta-base-openai-detector', {
               method: 'POST',
               headers: {
                 'Content-Type': 'application/json',
                 ...(hfToken ? { 'Authorization': `Bearer ${hfToken}` } : {})
               },
               body: JSON.stringify({ inputs: hfText })
            });
            const hfData = await hfRes.json();
            
            let fakeProb = 0;
            if (Array.isArray(hfData) && Array.isArray(hfData[0])) {
               const fakeEntry = hfData[0].find((l: any) => l.label === "Fake");
               if (fakeEntry) fakeProb = fakeEntry.score;
            } else if (Array.isArray(hfData) && hfData[0]?.label) {
               const fakeEntry = hfData.find((l: any) => l.label === "Fake");
               if (fakeEntry) fakeProb = fakeEntry.score;
            }
            
            let risk = "Low";
            if (fakeProb > 0.8) risk = "High";
            else if (fakeProb > 0.4) risk = "Medium";
            
            return {
               ai_authorship_probability: fakeProb,
               plagiarism_risk: risk,
               integrity_flags: fakeProb > 0.5 ? ["High likelihood of AI generation"] : []
            };
         } catch(e) {
            console.error("Integrity check failed", e);
            return undefined;
         }
      };

      const [backendData, integrityEvaluation] = await Promise.all([
          backendReq(),
          integrityReq()
      ]);

      const finalData = { ...backendData };
      if (integrityEvaluation) {
         finalData.integrityEvaluation = integrityEvaluation;
      }

      if (finalData.materials_status === 'reingesting' || finalData.rag_degraded) {
        setIngestStatus({
          type: 'warning',
          msg: 'Course materials are reindexing for your current LLM provider. This grade used the rubric and submission only (limited material grounding).',
        });
        setTimeout(() => setIngestStatus(null), 8000);
        // Kick background reindex for pending/mismatched materials.
        void handleRefreshMaterials();
      }
      if (finalData.wrong_deliverable && finalData.wrong_deliverable_note) {
        setIngestStatus({
          type: 'warning',
          msg: String(finalData.wrong_deliverable_note),
        });
        setTimeout(() => setIngestStatus(null), 10000);
      }

      setAiGradingData(prev => ({ ...prev, [studentId]: finalData }));

      // Persist so grades survive navigation / refresh
      if (selectedCourse && selectedAssignment) {
        saveAiGrade(selectedCourse, selectedAssignment, studentId, finalData);
      }
      const summary = summarizeGrade(finalData);
      setStudentsData(prev => prev.map(s => {
        if (s.id !== studentId) return s;
        if (s.status === 'Missing' || summary.kind !== 'complete') return s;
        return {
          ...s,
          status: 'Graded',
          gradeText: `${formatAiGradeLabel(finalData)} AI`,
          rawScore: summary.total,
        };
      }));

      setSelectedStudent(studentId);
    } catch (err: any) {
      if (err.message === "RUBRIC_MISSING_RETRY") {
          // Re-upsert the rubric once before retrying, otherwise the retry hits
          // the same empty rubric and fails for the same reason.
          try {
            await postAssignmentIngest(selectedAssignment!);
          } catch (ingestErr: any) {
            setIngestStatus({ type: 'error', msg: 'Could not send the rubric to the AI.' });
            setRowErrors(prev => ({ ...prev, [studentId]: `No rubric exists for this assignment (rubric upload failed: ${ingestErr.message})` }));
            return;
          }
          return await handleFetchAiGrade(studentId, true);
      }
      setRowErrors(prev => ({ ...prev, [studentId]: err.message }));
    } finally {
      setLoadingStudents(prev => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    }
  };

  const totalUngraded = studentsData.filter(s => s.status === 'Ungraded').length;

  const visibleStudents = studentsData.filter(s => {
    if (filter !== 'All' && s.status !== filter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortOrder === 'NameASC') {
      return a.name.localeCompare(b.name);
    } else if (sortOrder === 'UID') {
      return a.id.localeCompare(b.id);
    } else if (sortOrder === 'GradeASC') {
      const scoreA = a.rawScore ?? Infinity;
      const scoreB = b.rawScore ?? Infinity;
      return scoreA - scoreB;
    }
    return 0; // Default
  });

  // Combine and sort Side items
  const combinedItems = [
    ...assignments.map(a => ({
      id: String(a.id),
      title: a.name,
      dateStr: a.due_at,
      date: a.due_at ? new Date(a.due_at) : null,
      type: (a.is_quiz_assignment || (a.submission_types && a.submission_types.includes('online_quiz'))) ? 'Quizzes' : 
            ((a.submission_types && a.submission_types.includes('discussion_topic')) || (a.name && a.name.toLowerCase().includes('discussion'))) ? 'Discussions' : 
            'Assignments'
    })),
    ...discussions.map(d => ({
      id: String(d.id),
      title: d.title,
      dateStr: d.posted_at || d.created_at,
      date: (d.posted_at || d.created_at) ? new Date(d.posted_at || d.created_at) : null,
      type: 'Discussions'
    }))
  ];

  const filteredSideItems = combinedItems
    .filter(item => sideFilterType === 'All' || item.type === sideFilterType)
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return sideSortOrder === 'Newest' ? b.date.getTime() - a.date.getTime() : a.date.getTime() - b.date.getTime();
    });

  return (
    <>
      <div className="flex w-full h-screen bg-[#F8FAFC] dark:bg-[#020617] text-zinc-900 dark:text-zinc-100 font-['Plus_Jakarta_Sans'] overflow-hidden">

      {/* LEFT PANEL */}
      <div 
        ref={leftPanelRef} 
        style={{ width: `${leftPanelWidth}px`, display: selectedStudent ? 'none' : 'flex' }}
        className="shrink-0 bg-[#0F172A] text-white flex flex-col h-full border-r border-[#1E293B] relative"
      >
        {/* Header */}
        <div className="p-5 border-b border-[#1E293B] shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              {onBack && <button onClick={onBack} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">←</button>}
              <h1 className="text-xl font-bold font-['Space_Grotesk'] text-white">Evaluation Nexus</h1>
            </div>
            {onNavigateTo && (
               <button 
                 onClick={() => onNavigateTo('teacher-select-course')}
                 className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors border border-indigo-500/20"
                 title="Switch Course"
               >
                 <Icons.IconChart className="w-4 h-4" />
               </button>
            )}
          </div>
          <div className="bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-3 py-2 flex items-center justify-between">
            <span className="font-bold truncate text-[10px] tracking-widest">{activeCourse?.name || 'Loading Course...'}</span>
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          </div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0">
          
          {/* Side Filters */}
          <div className="mb-4 space-y-2 shrink-0">
             <div className="flex gap-2">
               <select 
                 value={sideFilterType} 
                 onChange={e => setSideFilterType(e.target.value as any)}
                 className="flex-1 bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-2 py-1.5 outline-none appearance-none cursor-pointer"
               >
                 <option value="All">All Types</option>
                 <option value="Assignments">Assignments</option>
                 <option value="Quizzes">Quizzes</option>
                 <option value="Discussions">Discussions</option>
               </select>

               <select 
                 value={sideSortOrder} 
                 onChange={e => setSideSortOrder(e.target.value as any)}
                 className="flex-1 bg-[#1E293B] border border-zinc-700 text-xs text-zinc-300 rounded px-2 py-1.5 outline-none appearance-none cursor-pointer"
               >
                 <option value="Newest">Newest First</option>
                 <option value="Oldest">Oldest First</option>
               </select>
             </div>
          </div>

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs font-bold text-center mb-4 shrink-0">
              {errorMsg} <br /> <button onClick={() => window.location.reload()} className="underline mt-1">Retry</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-1 pb-4">
            {loading.assignments ? (
              <div className="space-y-3 px-2">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse"></div>)}
              </div>
            ) : (
                <>
                  {filteredSideItems.map(item => (
                    <div
                      key={item.id}
                      onClick={() => { setSelectedAssignment(item.id); setSelectedStudent(null); }}
                      className={`w-full text-left p-3 rounded-lg flex flex-col justify-center transition-all cursor-pointer border 
                      ${selectedAssignment === item.id ? 'bg-[#1E293B] border-purple-500/20' : 'hover:bg-white/5 border-transparent'}`}
                    >
                      <div className="flex items-start justify-between">
                         <div className="font-bold text-sm text-zinc-200 line-clamp-2 mb-1 flex-1 pr-2">{item.title}</div>
                         <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full mt-0.5 shrink-0
                            ${item.type === 'Quizzes' ? 'bg-orange-500/20 text-orange-400' : 
                              item.type === 'Discussions' ? 'bg-blue-500/20 text-blue-400' : 
                              'bg-zinc-700 text-zinc-300'}`}
                         >
                           {item.type === 'Quizzes' ? 'Quiz' : item.type === 'Discussions' ? 'Discussion' : 'Assignment'}
                         </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {item.dateStr ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(item.dateStr)) : 'No Date'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {filteredSideItems.length === 0 && <div className="text-xs text-zinc-500 italic ml-2 mt-4">No items match filters</div>}
                </>
            )}
          </div>
        </div>

        {/* Bottom Stats */}
        <div className="p-4 border-t border-[#1E293B] shrink-0 text-center">
          <div className="text-sm font-medium text-zinc-300">
            <span className={`font-bold ${totalUngraded > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{totalUngraded}</span> ungraded for this assignment
          </div>
        </div>
      </div>

      {/* DRAG HANDLE 1 */}
      <div 
        style={{ display: selectedStudent ? 'none' : 'block' }}
        className="w-1.5 bg-transparent hover:bg-indigo-500/50 cursor-col-resize z-50 transition-colors"
        onMouseDown={(e) => {
           e.preventDefault();
           isDraggingLeft.current = true;
           document.body.style.cursor = 'col-resize';
           document.body.style.userSelect = 'none';
        }}
      />

      {/* CENTER PANEL */}
      <div 
        ref={centerPanelRef} 
        style={{ display: selectedStudent ? 'none' : 'flex' }}
        className="flex-1 bg-zinc-50 dark:bg-[#0B1120] flex flex-col min-w-0 border-r border-zinc-200 dark:border-white/5"
      >
        {!selectedAssignment ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-zinc-500 dark:text-zinc-400 font-bold">Select an assignment to view submissions</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-6 bg-white dark:bg-[#0F172A] border-b border-zinc-200 dark:border-white/5 shrink-0">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <h2 className="text-xl font-bold font-['Space_Grotesk'] truncate flex-1 min-w-0 pr-4">
                  {assignments.find(a => String(a.id) === selectedAssignment)?.name || discussions.find(d => String(d.id) === selectedAssignment)?.title || "Reviewing Submissions"}
                </h2>
                <div className="flex space-x-3 shrink-0 items-center">

                  <button
                    type="button"
                    onClick={() => setShowAskEduConnect(true)}
                    className="px-4 py-2 border border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors flex items-center text-indigo-700 dark:text-indigo-300"
                    aria-haspopup="dialog"
                    aria-expanded={showAskEduConnect}
                  >
                    <Icons.IconChat className="w-4 h-4 mr-2" />
                    Ask EduConnect
                  </button>

                  <button
                    onClick={() => setShowMaterialsModal(true)}
                    className="px-4 py-2 border border-zinc-300 dark:border-white/10 rounded-lg text-xs font-bold hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors flex items-center"
                  >
                    <Icons.IconBook className="w-4 h-4 mr-2 text-indigo-500" />
                    Manage Materials
                  </button>
                  <button
                    onClick={handleRefreshMaterials}
                    disabled={isRefreshingMaterials}
                    title="Index course files that are missing, failed, or changed in Canvas"
                    className="px-4 py-2 border border-zinc-300 dark:border-white/10 rounded-lg text-xs font-bold hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    <Icons.IconRefresh className={`w-4 h-4 mr-2 text-indigo-500 ${isRefreshingMaterials ? 'animate-spin' : ''}`} />
                    {isRefreshingMaterials ? 'Refreshing...' : 'Refresh Materials'}
                  </button>
                  <button 
                    onClick={handleDownloadZip}
                    disabled={isDownloading || studentsData.length === 0}
                    className="px-4 py-2 border border-zinc-300 dark:border-white/10 rounded-lg text-xs font-bold hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {isDownloading ? (
                      <><span className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mr-2"></span> Downloading...</>
                    ) : (
                      "Download All as ZIP"
                    )}
                  </button>
                </div>
              </div>

              {ingestStatus && (
                <div className={`mt-4 p-3 rounded-lg text-sm font-bold flex items-center shadow-sm
                  ${ingestStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' :
                    ingestStatus.type === 'loading' ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 animate-pulse' :
                    ingestStatus.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' :
                    'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'}`}
                >
                  {ingestStatus.type === 'loading' && (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-3"></div>
                  )}
                  {ingestStatus.type === 'success' && <Icons.IconCheck className="w-5 h-5 mr-2" />}
                  {ingestStatus.type === 'warning' && <Icons.IconAlertCircle className="w-5 h-5 mr-2" />}
                  {ingestStatus.type === 'error' && <Icons.IconX className="w-5 h-5 mr-2" />}
                  {ingestStatus.msg}
                </div>
              )}

              <div className="flex items-center justify-between mt-6">
                <div className="flex items-center space-x-3">
                  <div className="flex bg-zinc-100 dark:bg-white/5 p-2 rounded-lg">
                    {(['All', 'Ungraded', 'Graded', 'Missing'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all 
                          ${filter === f ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="Default">Default Sort</option>
                    <option value="NameASC">Sort by Name (A-Z)</option>
                    <option value="UID">Sort by U-ID</option>
                    <option value="GradeASC">Sort by Grade (Lowest)</option>
                  </select>
                </div>

                <div className="flex items-center bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 w-64">
                  <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-2 pr-4 py-2 bg-transparent text-sm outline-none w-full placeholder:text-zinc-500"
                  />
                </div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2" ref={centerRowsRef}>
              {loading.submissions ? (
                <div className="space-y-4 px-2 py-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-white/5 animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-zinc-200 dark:bg-white/5 rounded animate-pulse w-32"></div>
                        <div className="h-3 bg-zinc-200 dark:bg-white/5 rounded animate-pulse w-48"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {visibleStudents.map(student => (
                    <div
                      key={student.id}
                      onClick={() => setSelectedStudent(student.id)}
                      className={`w-full text-left p-4 rounded-xl border flex items-center justify-between transition-all group cursor-pointer
                          ${selectedStudent === student.id ? 'bg-white dark:bg-[#0F172A] border-purple-500 shadow-md transform -translate-y-0.5' : 'bg-white dark:bg-[#0B1120] border-zinc-200 dark:border-white/5 hover:shadow-md hover:-translate-y-0.5'}`}
                    >
                      <div className="flex items-center space-x-4 min-w-0 pr-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${student.avatarColor}`}>
                          {student.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-zinc-900 dark:text-white truncate">{student.name}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center space-x-2 mt-0.5">
                            <span>{student.date}</span>
                            <span className="hidden sm:inline w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                            <span className="hidden sm:inline italic truncate">"{student.body ? String(student.body).replace(/(<([^>]+)>)/gi, "").substring(0, 60) + (String(student.body).length > 60 ? '...' : '') : 'No preview'}"</span>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center space-x-4">
                        {/* Per-Submission Grade / Regrade Trigger */}
                        <div className="flex flex-col items-end">
                          {student.status !== 'Missing' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleFetchAiGrade(student.id); }}
                              disabled={loadingStudents.has(student.id)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 ${
                                aiGradingData[student.id]
                                  ? 'bg-zinc-800 hover:bg-zinc-900 text-white border border-zinc-600'
                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              }`}
                            >
                              {loadingStudents.has(student.id) ? (
                                ingestingStudents.has(student.id) ? (
                                  <span className="flex items-center"><div className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div> Reading materials...</span>
                                ) : (
                                  <span className="flex items-center"><div className="w-2 h-2 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1.5"></div> {aiGradingData[student.id] ? 'Regrading...' : 'Grading...'}</span>
                                )
                              ) : (
                                aiGradingData[student.id] ? 'Regrade ✨' : 'Grade with AI ✨'
                              )}
                            </button>
                          )}
                          {rowErrors[student.id] && (
                            <span className="text-xs font-bold text-red-500 mt-1 max-w-[140px] truncate" title={rowErrors[student.id]}>
                              {rowErrors[student.id]}
                            </span>
                          )}
                        </div>

                        <span className={`px-2.5 py-1 rounded-full text-xs font-black
                              ${student.status === 'Graded' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                            student.status === 'Ungraded' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                              'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-400'}`}
                        >
                          {student.status === 'Graded' ? student.gradeText : student.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  {visibleStudents.length === 0 && (
                    <div className="text-center p-10 text-zinc-500 font-medium">No students match the current filters.</div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* RIGHT PANEL */}
      <div 
        style={{ display: selectedStudent ? 'flex' : 'none' }}
        className="flex-1 flex flex-col relative z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.02)] overflow-x-hidden"
      >
        {!selectedStudent ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] p-8 text-center">
            <div className="w-16 h-16 bg-zinc-200 dark:bg-white/5 rounded-full mb-4 flex items-center justify-center">
              <Icons.IconUsers className="w-8 h-8 opacity-50" />
            </div>
            <div className="font-bold">Select a student to begin grading</div>
          </div>
        ) : (
          <RightPanelErrorBoundary>
            {(() => {
              const student = studentsData.find(s => s.id === selectedStudent);
              if (!student) return <div className="p-8 text-zinc-500 italic">Student not found</div>;
              
              let scoreText = "RUBRIC";
              const gradingResult = aiGradingData[selectedStudent!];
              const item = currentAuthItem;
              if (gradingResult && gradingResult.criteria_verdicts && item?.rubric) {
                 let totalEarned = 0;
                 let totalPossible = 0;
                 let unassessed = 0;
                 
                 item.rubric.forEach((crit: any) => {
                    totalPossible += crit.points || 0;
                    const verdict = gradingResult.criteria_verdicts.find((v: any) => 
                        v.criterion_id === crit.id || 
                        v.criterion_name === crit.description || 
                        v.title === crit.description ||
                        (crit.id && v.criterion_id && String(v.criterion_id).includes(String(crit.id)))
                    );
                    if (verdict?.ai_generated) {
                       return;
                    }
                    if (verdict && isScore(verdict.score)) {
                       totalEarned += verdict.score;
                    } else if (verdict) {
                       unassessed += 1;
                    }
                 });
                 
                 if (totalPossible > 0) {
                    scoreText = unassessed > 0
                      ? `RUBRIC (PARTIAL: ${totalEarned} assessed, ${unassessed} not assessed)`
                      : `RUBRIC (${totalEarned}/${totalPossible})`;
                 }
              }
              
              return (
                <div className="flex flex-col h-full w-full">
                  {/* TOP BAR */}
                  <div className="px-6 py-4 border-b border-zinc-200 dark:border-white/5 bg-white dark:bg-[#0F172A] flex items-center justify-between shrink-0 z-20">
                    <div className="flex items-center space-x-6">
                      <button 
                        onClick={() => setSelectedStudent(null)} 
                        className="p-2 bg-zinc-100 dark:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white rounded-lg transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-white/10"
                        title="Back to Students"
                      >
                        <Icons.IconArrowLeft className="w-5 h-5" />
                      </button>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 ${student.avatarColor || 'bg-indigo-600'} shadow-lg shadow-indigo-500/10`}>
                          {student.initials}
                        </div>
                        <div>
                          <h2 className="text-lg font-bold font-['Space_Grotesk'] text-zinc-900 dark:text-white leading-tight">{typeof student.name === 'string' ? student.name : JSON.stringify(student.name)}</h2>
                          <div className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] mt-0.5">STUDENT SUBMISSION</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-4">
                      <button
                        type="button"
                        onClick={() => setShowAskEduConnect(true)}
                        className="px-3 py-2 text-[11px] font-black uppercase tracking-widest rounded-lg border border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                        aria-haspopup="dialog"
                      >
                        Ask EduConnect
                      </button>
                      <div className="flex items-center bg-zinc-100 dark:bg-white/5 p-2 rounded-xl">
                        <button 
                          onClick={() => setShowAssignmentContext(!showAssignmentContext)}
                          className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${showAssignmentContext ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'}`}
                        >
                          CONTEXT
                        </button>
                        <button 
                          onClick={() => setShowLearningProfile(!showLearningProfile)}
                          className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${showLearningProfile ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'}`}
                          title="Learning Profile"
                        >
                          PROFILE
                        </button>
                        <button 
                          onClick={() => setShowRubricContext(!showRubricContext)}
                          className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all ${showRubricContext ? 'bg-white dark:bg-white/10 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'}`}
                          title="Official Rubric"
                        >
                          {scoreText}
                        </button>
                      </div>

                      <div className="h-6 w-px bg-zinc-200 dark:bg-white/10 mx-2"></div>

                      <button 
                        onClick={() => setIsGradingSidebarCollapsed(!isGradingSidebarCollapsed)}
                        className="p-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl transition-all border border-indigo-500/20 group"
                        title={isGradingSidebarCollapsed ? "Expand Grading Panel" : "Collapse Grading Panel"}
                      >
                        <Icons.IconList className={`w-5 h-5 transition-transform duration-300 ${isGradingSidebarCollapsed ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* MAIN CONTENT AREA */}
                  <div ref={rightPanelRef} className="flex-1 overflow-hidden flex w-full relative">
                    
                    {/* LEFT SECTION: DOCUMENT VIEWER */}
                    <div className="flex-1 h-full bg-[#F8FAFC] dark:bg-[#020617] flex flex-col items-center overflow-y-auto scrollbar-hide p-4 sm:p-8 relative">
                      
                      {/* Context Overlay (Collapsible) */}
                      {showAssignmentContext && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-primary)]/20 shadow-2xl overflow-hidden max-h-[400px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-primary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconFile className="w-4 h-4 text-[var(--brand-primary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Assignment Context</h3>
                              </div>
                              <button onClick={() => setShowAssignmentContext(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div 
                              className="p-6 overflow-y-auto prose dark:prose-invert prose-sm max-w-none text-zinc-700 dark:text-zinc-300"
                              dangerouslySetInnerHTML={{ 
                                __html: (() => {
                                  const item = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
                                  let htmlStr = item?.description || item?.message || '<div class="text-zinc-500 italic">No additional context provided.</div>';
                                  htmlStr = typeof htmlStr === 'string' ? htmlStr : JSON.stringify(htmlStr);
                                  htmlStr = htmlStr.replace(/style="[^"]*"/gi, "");
                                  htmlStr = htmlStr.replace(/style='[^']*'/gi, "");
                                  return htmlStr;
                                })() 
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Learning Profile Overlay */}
                      {showLearningProfile && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-secondary)]/20 shadow-2xl overflow-hidden max-h-[420px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-secondary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconUsers className="w-4 h-4 text-[var(--brand-secondary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-secondary)]">Learning Profile</h3>
                              </div>
                              <button onClick={() => setShowLearningProfile(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="p-6 overflow-y-auto space-y-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-100 dark:border-purple-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-purple-500 uppercase tracking-widest mb-1">Materials Viewed</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.materialsViewed}</div>
                                </div>
                                <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Discussion Posts</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.discussionPosts}</div>
                                </div>
                                <div className="bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">Assignments Done</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.assignmentCompletion}</div>
                                </div>
                                <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/10 rounded-xl p-3">
                                  <div className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Last Active</div>
                                  <div className="text-lg font-black text-zinc-900 dark:text-white">{MOCK_LEARNING_PROFILE.lastActive}</div>
                                </div>
                              </div>
                              <div className="bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-xl p-4">
                                <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1">Most Active Topic</div>
                                <div className="text-sm font-bold text-zinc-700 dark:text-zinc-300">{MOCK_LEARNING_PROFILE.mostActiveTopic}</div>
                              </div>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest">Completion Rate</div>
                                  <div className="text-xs font-black text-[var(--brand-primary)]">{MOCK_LEARNING_PROFILE.completionRate}%</div>
                                </div>
                                <div className="h-2 w-full bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-[var(--brand-primary)] to-[var(--brand-secondary)] rounded-full transition-all duration-1000" style={{ width: `${MOCK_LEARNING_PROFILE.completionRate}%` }}></div>
                                </div>
                              </div>
                              <div className="bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/10 rounded-xl p-4">
                                <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Background Note</div>
                                <div className="text-xs text-zinc-600 dark:text-zinc-400 font-medium italic leading-relaxed">"{MOCK_LEARNING_PROFILE.backgroundNote}"</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Rubric Overlay */}
                      {showRubricContext && (
                        <div className="absolute top-8 left-8 right-8 z-30 animate-in slide-in-from-top-4 fade-in duration-300">
                          <div className="bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md rounded-2xl border border-[var(--brand-primary)]/20 shadow-2xl overflow-hidden max-h-[420px] flex flex-col">
                            <div className="p-4 border-b border-[var(--brand-primary)]/10 flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Icons.IconList className="w-4 h-4 text-[var(--brand-primary)]" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Official Rubric</h3>
                              </div>
                              <button onClick={() => setShowRubricContext(false)} className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-full transition-colors">
                                <Icons.IconX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="p-6 overflow-y-auto space-y-4">
                              {(() => {
                                const item = assignments.find(a => String(a.id) === selectedAssignment) || discussions.find(d => String(d.id) === selectedAssignment);
                                if (!item?.rubric || item.rubric.length === 0) {
                                  return <div className="text-zinc-500 italic">No rubric attached to this assignment.</div>;
                                }
                                const gradingResult = aiGradingData[selectedStudent!];
                                return (
                                  <div className="space-y-4">
                                    {item.rubric.map((crit: any) => {
                                      const verdict = gradingResult?.criteria_verdicts?.find((v: any) => 
                                        v.criterion_id === crit.id || 
                                        v.criterion_name === crit.description || 
                                        v.title === crit.description ||
                                        (crit.id && v.criterion_id && String(v.criterion_id).includes(String(crit.id)))
                                      );

                                      return (
                                        <div key={crit.id} className="bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-xl p-4 transition-all duration-300 hover:border-zinc-200 dark:hover:border-white/20 shadow-sm">
                                          <div className="flex justify-between items-start mb-2">
                                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{crit.description}</h4>
                                            {verdict?.ai_generated ? (
                                              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md text-zinc-600 bg-zinc-500/10">
                                                Advisory · not in score
                                              </span>
                                            ) : verdict && !isScore(verdict.score) ? (
                                              <span className="text-xs font-black px-2 py-1 rounded-md text-amber-600 bg-amber-500/10">
                                                {formatVerdictScore(verdict)}
                                              </span>
                                            ) : verdict ? (
                                              <span className={`text-xs font-black px-2 py-1 rounded-md ${verdict.score === crit.points ? 'text-emerald-600 bg-emerald-500/10' : verdict.score > 0 ? 'text-amber-600 bg-amber-500/10' : 'text-rose-600 bg-rose-500/10'}`}>
                                                {verdict.score} / {crit.points} PTS
                                              </span>
                                            ) : (
                                              <span className="text-xs font-black text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded-md">{crit.points} PTS</span>
                                            )}
                                          </div>
                                          <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-3">{crit.long_description || "No detailed description provided."}</div>
                                          
                                          {crit.ratings && crit.ratings.length > 0 && (
                                            <div className="flex flex-col sm:flex-row gap-3 mb-4 mt-2 w-full">
                                              {(() => {
                                                const sorted = [...crit.ratings].sort((a, b) => b.points - a.points);
                                                const matched =
                                                  verdict && isScore(verdict.score)
                                                    ? selectMatchingRubricRating(verdict.score, sorted)
                                                    : null;
                                                return sorted.map((rating: any, rIdx: number) => {
                                                  const isTop = rIdx === 0;
                                                  const isBottom = rIdx === sorted.length - 1 && sorted.length > 1;
                                                  // Exact point match only — never check Excellent for a 9/10 deduction.
                                                  const isSelected = !!(matched && rating === matched);

                                                  let borderAccentColor = 'border-amber-500/40 dark:border-amber-500/20';
                                                  let textColor = 'text-amber-700 dark:text-amber-300';
                                                  
                                                  if (isTop) {
                                                    borderAccentColor = 'border-emerald-500/40 dark:border-emerald-500/20';
                                                    textColor = 'text-emerald-700 dark:text-emerald-300';
                                                  } else if (isBottom) {
                                                    borderAccentColor = 'border-rose-500/40 dark:border-rose-500/20';
                                                    textColor = 'text-rose-700 dark:text-rose-300';
                                                  }
                                                  
                                                  const activeClass = !verdict 
                                                    ? 'opacity-100 border border-dashed rounded-xl bg-white/80 dark:bg-zinc-900/40' 
                                                    : (isSelected 
                                                        ? 'opacity-100 border-2 border-solid font-bold scale-[1.02] z-10 rounded-xl bg-white dark:bg-zinc-900 shadow-sm' 
                                                        : 'opacity-100 border border-dashed rounded-xl bg-zinc-50/90 dark:bg-zinc-900/50');

                                                  return (
                                                    <div key={rIdx} className={`flex-1 flex flex-col relative px-3.5 py-3 transition-all duration-300 ${borderAccentColor} ${textColor} ${activeClass}`}>
                                                      {isSelected && (
                                                        <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center shadow-md">
                                                          <Icons.IconCheck className="w-3 h-3 text-white" />
                                                        </div>
                                                      )}
                                                      <span className={`text-sm mb-1 leading-snug ${isSelected ? 'font-black' : 'font-bold'} text-zinc-900 dark:text-zinc-100`}>
                                                        {rating.description}
                                                      </span>
                                                      <span className={`text-xs font-black mb-2 ${isSelected ? textColor : 'text-zinc-700 dark:text-zinc-300'}`}>
                                                        {rating.points} pts
                                                      </span>
                                                      {rating.long_description && (
                                                        <span
                                                          className="text-[11px] leading-relaxed line-clamp-5 text-zinc-700 dark:text-zinc-300"
                                                          title={rating.long_description}
                                                        >
                                                          {rating.long_description}
                                                        </span>
                                                      )}
                                                    </div>
                                                  );
                                                });
                                              })()}
                                            </div>
                                          )}

                                          {verdict && isScore(verdict.score) && crit.ratings?.length > 0 && (() => {
                                            const note = rubricScoreBandNote(verdict.score, crit.ratings);
                                            return note ? (
                                              <div className="mt-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
                                                {note}
                                              </div>
                                            ) : null;
                                          })()}
                                          
                                          {verdict && (
                                            <div className="mt-4 space-y-3 pt-3 border-t border-zinc-200 dark:border-white/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                              <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500 flex items-center">
                                                  <Icons.IconCheck className="w-3 h-3 mr-1 text-emerald-500" /> Explanation
                                                </div>
                                                {(() => {
                                                  const explain = buildDeductionExplanation(verdict);
                                                  return (
                                                    <div className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed pl-3 border-l-2 border-indigo-500/30 py-1 space-y-2">
                                                      {explain.creditAwardedFor ? (
                                                        <p><span className="font-bold text-zinc-600 dark:text-zinc-400">Credit awarded: </span>{explain.creditAwardedFor}</p>
                                                      ) : null}
                                                      {explain.pointsWithheldBecause ? (
                                                        <p><span className="font-bold text-amber-700 dark:text-amber-400">Points withheld because: </span>{explain.pointsWithheldBecause}</p>
                                                      ) : null}
                                                      {explain.justification &&
                                                      !(explain.creditAwardedFor || explain.pointsWithheldBecause) ? (
                                                        <p>{explain.justification}</p>
                                                      ) : !explain.creditAwardedFor && !explain.pointsWithheldBecause && !explain.justification ? (
                                                        <p className="italic text-zinc-500">No written explanation for this criterion.</p>
                                                      ) : null}
                                                    </div>
                                                  );
                                                })()}
                                              </div>
                                              <div className="space-y-1">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] flex items-center mb-1">
                                                  <Icons.IconFile className="w-3 h-3 mr-1 text-[var(--brand-primary)]" /> Anchor Text
                                                </div>
                                                <div className={`pl-3 border-l-2 text-xs italic py-1 ${verdict.evidence_anchor === 'not found' ? 'border-rose-300 text-rose-600 dark:text-rose-400' : 'border-[var(--brand-primary)]/30 text-[var(--text-primary)]'}`}>
                                                  {verdict.evidence_anchor === 'not found' ? 'No evidence found in submission.' : `"${verdict.evidence_anchor}"`}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="w-full max-w-5xl bg-white dark:bg-[#0F172A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-2xl shadow-black/5 overflow-hidden flex flex-col h-[min(78vh,860px)] min-h-[560px] transition-all duration-500">


                        {/* MAIN VIEWER AREA — format-specific PDF / Word / PPT / image preview */}
                        <div className="flex-1 flex flex-col min-h-0 min-w-0">
                          {student.attachments && student.attachments.length > 0 ? (
                            (() => {
                              const att = activeAttachment || student.attachments[0];
                              const fileLabel = att.display_name || att.filename || 'submission.docx';
                              return (
                                <UniversalPreviewer 
                                  url={att.url} 
                                  filename={fileLabel} 
                                  onDownload={() => handleDownloadSingleAttachment(att.url, fileLabel)}
                                  highlightText={highlightText}
                                />
                              );
                            })()
                          ) : student.body ? (
                            (() => {
                              const rawBody = typeof student.body === 'string' ? student.body : JSON.stringify(student.body);
                              const externalUrl =
                                getExternalSubmissionUrl(rawBody) ||
                                (student.submissionUrl && getExternalSubmissionUrl(student.submissionUrl)
                                  ? student.submissionUrl
                                  : null);
                              const onLinkResolved = ({ text: resolvedText }: { text: string }) => {
                                const cleaned = (resolvedText || '').trim();
                                if (cleaned.length < 20) return;
                                setGradingTextByStudent((prev) => ({
                                  ...prev,
                                  [String(student.id)]: cleaned,
                                }));
                              };
                              if (externalUrl && isLtiExternalUrl(externalUrl) && selectedCourse && selectedAssignment) {
                                return (
                                  <ExternalSubmissionViewer
                                    url={externalUrl}
                                    courseId={String(selectedCourse)}
                                    assignmentId={String(selectedAssignment)}
                                    studentId={String(student.id)}
                                    initialText={gradingTextByStudent[String(student.id)] || ''}
                                    onResolved={onLinkResolved}
                                  />
                                );
                              }
                              if (externalUrl) {
                                return (
                                  <LinkSubmissionViewer
                                    url={externalUrl}
                                    courseId={selectedCourse ? String(selectedCourse) : undefined}
                                    initialText={gradingTextByStudent[String(student.id)] || ''}
                                    onResolved={onLinkResolved}
                                  />
                                );
                              }
                              return (
                                <div
                                  className="h-full bg-white dark:bg-[#0F172A] p-12 overflow-y-auto prose dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200 break-words [overflow-wrap:anywhere] [&_a]:text-inherit [&_a]:no-underline [&_a]:pointer-events-none"
                                  dangerouslySetInnerHTML={{
                                    __html: (() => {
                                      let content = prepareSubmissionHtml(rawBody);
                                      if (highlightText) {
                                        const words = highlightText.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                                        if (words.length > 0) {
                                          const fuzzyPattern = words.join('(?:\\s|&nbsp;|<[^>]+>)+');
                                          try {
                                            const regex = new RegExp(`(${fuzzyPattern})`, 'gi');
                                            if (regex.test(content)) {
                                              content = content.replace(regex, '<mark id="evidence-anchor-highlight" class="bg-[var(--brand-primary)]/10 dark:bg-[var(--brand-primary)]/30 text-inherit px-1 rounded transition-all duration-500">$1</mark>');
                                              setTimeout(() => {
                                                const mark = document.getElementById('evidence-anchor-highlight');
                                                if (mark) {
                                                  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                }
                                              }, 200);
                                            }
                                          } catch (e) {
                                            console.error("Highlight regex error", e);
                                          }
                                        }
                                      }
                                      return content;
                                    })()
                                  }}
                                />
                              );
                            })()
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 bg-white dark:bg-[#0F172A] p-12">
                              <Icons.IconFile className="w-16 h-16 mb-4 text-zinc-300 dark:text-zinc-700" />
                              <h4 className="text-lg font-bold text-zinc-900 dark:text-white">No submission content</h4>
                              <p className="text-sm">The student hasn't provided any text or file attachment.</p>
                            </div>
                          )}
                        </div>

                        {/* BOTTOM FILES STRIP (only if files exist) */}
                        {student.attachments && student.attachments.length > 0 && (
                          <div className="w-full border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-[#0B1120] p-2 flex items-center space-x-2 overflow-x-auto custom-scrollbar shrink-0">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 shrink-0 px-2">Submission Files:</span>
                            {student.attachments.map((att: any, idx: number) => {
                              const isSelected = activeAttachment ? activeAttachment.id === att.id : idx === 0;
                              return (
                                <button
                                  key={att.id}
                                  onClick={() => setActiveAttachment(att)}
                                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border transition-all shrink-0
                                    ${isSelected 
                                      ? 'bg-white dark:bg-[#0F172A] border-indigo-500 shadow-sm' 
                                      : 'bg-transparent border-transparent hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                >
                                  <Icons.IconFile className={`w-3.5 h-3.5 ${isSelected ? 'text-[var(--brand-primary)]' : 'text-[var(--text-muted)]'}`} />
                                  <span className={`text-xs font-bold ${isSelected ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                    {att.filename}
                                  </span>
                                  <span className="text-[9px] text-[var(--text-muted)] ml-2">
                                    {att.size ? (att.size / 1024).toFixed(1) + ' KB' : ''}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div> {/* closes w-full max-w-5xl */}
                    </div> {/* closes flex-1 flex flex-col (Left Side) */}

                    {/* RIGHT SECTION: GRADING SIDEBAR */}
                    {!isGradingSidebarCollapsed && (
                      <div className="w-[420px] h-full bg-white dark:bg-[#0F172A] border-l border-zinc-200 dark:border-white/5 grid grid-rows-[auto_1fr] z-10 animate-in slide-in-from-right duration-300 shrink-0">
                        {/* Sidebar Header */}
                        <div className="p-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/5 flex items-center justify-between shrink-0">
                          <div className="flex items-center space-x-2">
                            <Icons.IconSparkles className="w-4 h-4 text-[var(--brand-primary)]" />
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)]">GRADING & AI FEEDBACK</h3>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => setUseMoE(!useMoE)}
                              className={`flex items-center px-2 py-1 rounded-full transition-all ${useMoE ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                            >
                              <div className={`w-3 h-3 rounded-full bg-white transition-transform ${useMoE ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tight whitespace-nowrap">MOE</span>
                          </div>
                        </div>

                        {/* Sidebar Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                          
                          {/* Phase 3: RAG Loading Skeleton */}
                          {loadingStudents.has(selectedStudent) && (
                            <div className="flex flex-col items-center justify-center p-8 space-y-3 h-full">
                              <Icons.IconSparkles className="w-8 h-8 text-indigo-500 animate-spin" />
                              <div className="text-[10px] font-black text-indigo-500 uppercase tracking-widest text-center animate-pulse">
                                {ingestingStudents.has(selectedStudent)
                                  ? "Reading class materials, please wait..."
                                  : "CONSULTING CONTEXT & RUBRICS..."}
                              </div>
                            </div>
                          )}

                          {/* Phase 3: RAG Result View */}
                          {!loadingStudents.has(selectedStudent!) && aiGradingData[selectedStudent!] ? (
                            <div className="space-y-4">
                              <button
                                onClick={() => handleFetchAiGrade(selectedStudent!)}
                                className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center border border-zinc-700"
                              >
                                <Icons.IconRefresh className="w-3.5 h-3.5 mr-2" />
                                {isLegacyResult(aiGradingData[selectedStudent!]) ? 'Reassess legacy draft' : 'Regrade with AI'}
                              </button>
                              <GradingResult 
                                 result={aiGradingData[selectedStudent!]} 
                                 rubricContext={currentAuthItem?.rubric || []}
                                 onEvidenceAnchorClick={(text) => setHighlightText(text)}
                                 onEvidenceUnitClick={(unit) => setHighlightText(unit.text)}
                              />
                            </div>
                          ) : (
                            !loadingStudents.has(selectedStudent!) && (
                              <div className="space-y-6">
                                {rowErrors[selectedStudent!] ? (
                                  <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl shadow-sm">
                                    <div className="text-red-600 dark:text-red-400 text-xs font-bold mb-1 flex items-center"><Icons.IconX className="w-4 h-4 mr-1"/> GRADING FAILED</div>
                                    <div className="text-red-500 dark:text-red-300 text-xs whitespace-pre-wrap">{rowErrors[selectedStudent!]}</div>
                                    <button
                                      onClick={() => handleFetchAiGrade(selectedStudent!)}
                                      className="mt-3 w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                                    >
                                      Retry grade
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex flex-col">
                                    <div className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-4 text-center">Click below to assess this submission</div>
                                    <button 
                                      onClick={() => handleFetchAiGrade(selectedStudent!)}
                                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center"
                                    >
                                      <Icons.IconSparkles className="w-4 h-4 mr-2" />
                                      GRADE WITH AI ✨
                                    </button>
                                  </div>
                                )}
                                
                                {/* Expected Rubric View (Before Grading) */}
                                {currentAuthItem?.rubric && currentAuthItem.rubric.length > 0 && (
                                  <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-white/10">
                                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Expected Rubric Criteria</h3>
                                    <div className="space-y-2">
                                      {currentAuthItem.rubric.map((r: any, idx: number) => (
                                        <div key={idx} className="bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/10 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                                          <div className="flex items-center space-x-3">
                                            <div className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-white/5 flex items-center justify-center text-[10px] font-black text-zinc-500">
                                              {idx + 1}
                                            </div>
                                            <div>
                                              <div className="text-xs font-bold text-zinc-900 dark:text-white">{r.description || r.id}</div>
                                              {r.long_description && <div className="text-[9px] text-zinc-500 line-clamp-1">{r.long_description}</div>}
                                            </div>
                                          </div>
                                          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-md">{r.points} pts</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          )}

                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </RightPanelErrorBoundary>
        )}
      </div>
    </div>

      {showMaterialsModal && selectedCourse && selectedAssignment && (
        <CourseMaterialsModal
          courseId={selectedCourse}
          assignmentId={selectedAssignment}
          onClose={() => setShowMaterialsModal(false)}
          onIngestSuccess={() => {
            setIngestedAssignments(prev => new Set(prev).add(selectedAssignment));
            alert("Materials successfully ingested! Future grading will use these materials.");
          }}
        />
      )}

      <AskEduConnectPanel
        open={showAskEduConnect}
        onClose={() => setShowAskEduConnect(false)}
        courseId={selectedCourse ? String(selectedCourse) : undefined}
        assignmentId={selectedAssignment}
        submissionId={selectedStudent}
        studentId={selectedStudent}
        knownSubmissionIds={studentsData.map((s) => String(s.id))}
      />
    </>
  );
}
