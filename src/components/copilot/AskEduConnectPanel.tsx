import React, { useEffect, useId, useRef, useState } from 'react';
import { gradingApiBase } from '../../lib/llmProviders';
import { activeCourseId, authErrorMessage, gradingAuthHeaders } from '../../lib/gradingApi';
import { EduConnectMascot } from './Mascot';
import { createBrowserSTT, createBrowserTTS, type SpeechToText, type TextToSpeech } from './voice';

export type CopilotScopeKind = 'submission' | 'assignment' | 'course';

type Msg = { id: string; role: 'teacher' | 'assistant'; text: string };

type Proposal = {
  proposal_id: string;
  proposal_hash: string;
  summary: string;
  status: string;
  scores_change: boolean;
  feedback_only: boolean;
  scope_kind: string;
  conflict_instruction_ids?: string[];
  changed_dimensions?: string[];
  unchanged_dimensions?: string[];
  requires_second_confirm_for_regrade?: boolean;
  target_manifest?: { submission_ids: string[]; frozen?: boolean };
};

type Instruction = {
  instruction_id: string;
  version: number;
  instruction_type: string;
  scope_kind: string;
  originating_request: string;
  lifecycle: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  courseId?: string;
  assignmentId: string | null;
  submissionId?: string | null;
  studentId?: string | null;
  knownSubmissionIds?: string[];
};

export function AskEduConnectPanel({
  open,
  onClose,
  courseId,
  assignmentId,
  submissionId,
  studentId,
  knownSubmissionIds = [],
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const [scopeKind, setScopeKind] = useState<CopilotScopeKind>(
    submissionId ? 'submission' : 'assignment',
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const sttRef = useRef<SpeechToText | null>(null);
  const ttsRef = useRef<TextToSpeech | null>(null);

  const cid = courseId || activeCourseId();

  useEffect(() => {
    sttRef.current = createBrowserSTT();
    ttsRef.current = createBrowserTTS();
    if (!sttRef.current.available()) {
      setVoiceNote('Live microphone unavailable — type instead (mock adapters used in tests).');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    composerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (submissionId) setScopeKind('submission');
  }, [submissionId]);

  useEffect(() => {
    if (!open || !cid || !assignmentId) return;
    (async () => {
      try {
        const res = await fetch(
          `${gradingApiBase()}/api/copilot/instructions?course_id=${encodeURIComponent(cid)}&assignment_id=${encodeURIComponent(assignmentId)}`,
          { headers: await gradingAuthHeaders() },
        );
        const body = await res.json().catch(() => ({}));
        if (res.ok) setInstructions(body.instructions || []);
      } catch {
        /* offline */
      }
    })();
  }, [open, cid, assignmentId]);

  const setStatus = (msg: string) => {
    setAnnounce(msg);
    if (liveRef.current) liveRef.current.textContent = msg;
  };

  async function sendText(text: string, source: 'text' | 'voice_final' = 'text') {
    if (!text.trim() || !assignmentId || !cid) return;
    setBusy(true);
    setMessages((m) => [...m, { id: `t-${Date.now()}`, role: 'teacher', text }]);
    setDraft('');
    try {
      const res = await fetch(`${gradingApiBase()}/api/copilot/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await gradingAuthHeaders()) },
        body: JSON.stringify({
          conversation_id: conversationId,
          text,
          course_id: cid,
          assignment_id: assignmentId,
          submission_id: submissionId || undefined,
          student_id: studentId || undefined,
          scope_kind: scopeKind,
          known_submission_ids: knownSubmissionIds,
          source,
          is_partial_transcript: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      const auth = authErrorMessage(body);
      if (!res.ok) {
        const err = auth || body.message || body.error || 'Request failed';
        setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', text: String(err) }]);
        setStatus(String(err));
        return;
      }
      setConversationId(body.conversation_id);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: 'assistant', text: body.assistant_text || '' },
      ]);
      setProposal(body.proposal || null);
      if (body.instructions) setInstructions(body.instructions);
      if (body.job) setJobStatus(`${body.job.job_id}: ${body.job.status}`);
      setStatus(body.status_announcement || 'Assistant replied');
      if (!ttsMuted && body.spoken_summary && ttsRef.current?.available()) {
        ttsRef.current.speak(body.spoken_summary, { allowNames: false, allowGrades: false });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm(action: 'save_instruction' | 'run_regrade' | 'reject') {
    if (!proposal || !assignmentId || !cid) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${gradingApiBase()}/api/copilot/proposals/${encodeURIComponent(proposal.proposal_id)}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await gradingAuthHeaders()) },
          body: JSON.stringify({
            action,
            proposal_hash: proposal.proposal_hash,
            conversation_id: conversationId,
            course_id: cid,
            assignment_id: assignmentId,
            submission_id: submissionId || undefined,
            scope_kind: scopeKind,
            known_submission_ids: knownSubmissionIds,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: 'assistant', text: body.assistant_text || body.message || 'Done' },
      ]);
      if (body.proposal) setProposal(body.proposal);
      if (body.instructions) setInstructions(body.instructions);
      if (body.job) setJobStatus(`${body.job.job_id}: ${body.job.status}`);
      setStatus(body.status_announcement || `Confirmation ${action}`);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!cid) return;
    const res = await fetch(`${gradingApiBase()}/api/copilot/instructions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await gradingAuthHeaders()) },
      body: JSON.stringify({ course_id: cid, assignment_id: assignmentId }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setInstructions((rows) => rows.filter((r) => r.instruction_id !== id));
      setStatus(`Revoked ${id}`);
    } else {
      setStatus(body.message || 'Revoke failed');
    }
  }

  function toggleMic() {
    const stt = sttRef.current;
    if (!stt?.available()) {
      setStatus('Microphone unavailable');
      return;
    }
    if (!listening) {
      stt.start();
      setListening(true);
      setStatus('Listening (push-to-talk)');
    } else {
      const ev = stt.stop();
      setListening(false);
      // Partial never auto-sends; final lands in composer for edit + explicit send.
      setDraft(ev.text);
      setStatus('Transcript ready — edit and send. No grading action yet.');
    }
  }

  if (!open) return null;

  const drawer = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  return (
    <>
      {drawer && (
        <button
          type="button"
          className="fixed inset-0 z-[90] bg-black/40 motion-safe:transition-opacity"
          aria-label="Close Ask EduConnect"
          onClick={onClose}
        />
      )}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`fixed z-[95] flex flex-col bg-[var(--bg-card)] border-[var(--border-primary)] shadow-[var(--shadow-xl)]
          ${drawer ? 'inset-x-0 bottom-0 top-16 rounded-t-2xl border-t-2' : 'top-0 right-0 h-full w-full max-w-md border-l-2'}
          motion-safe:animate-[slideUp_0.25s_ease-out] motion-reduce:animate-none`}
      >
        <header className="flex items-center gap-3 p-4 border-b-2 border-[var(--border-primary)] shrink-0">
          <EduConnectMascot className="w-9 h-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold font-['Space_Grotesk'] truncate">
              Ask EduConnect
            </h2>
            <p className="text-[10px] font-bold text-[var(--text-muted)] truncate">
              Course {cid || '—'} · Assignment {assignmentId || '—'}
              {submissionId ? ` · Sub ${submissionId}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs font-bold rounded-lg border-2 border-[var(--border-primary)] hover:bg-[var(--bg-nested)]"
          >
            Close
          </button>
        </header>

        <div className="px-4 py-2 border-b border-[var(--border-primary)] shrink-0 flex items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]" htmlFor="copilot-scope">
            Scope
          </label>
          <select
            id="copilot-scope"
            value={scopeKind}
            onChange={(e) => setScopeKind(e.target.value as CopilotScopeKind)}
            className="flex-1 text-xs font-bold rounded-lg px-2 py-1.5"
          >
            <option value="submission">This submission</option>
            <option value="assignment">This assignment</option>
            <option value="course">This course (explicit only)</option>
          </select>
        </div>

        <div className="px-4 py-2 border-b border-[var(--border-primary)] shrink-0 max-h-28 overflow-y-auto">
          <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1">
            Remembered instructions
          </div>
          {instructions.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">None active. Nothing is remembered until you confirm.</p>
          ) : (
            <ul className="space-y-1">
              {instructions.map((inst) => (
                <li key={`${inst.instruction_id}-${inst.version}`} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="font-bold">{inst.instruction_type}</span> ({inst.scope_kind}) —{' '}
                    {inst.originating_request.slice(0, 60)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--color-danger)] font-bold underline"
                    onClick={() => revoke(inst.instruction_id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
          {messages.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">
              Describe a grading change. Ambiguous requests get clarifying questions. Nothing mutates
              policy or grades until you confirm a proposal.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-xl px-3 py-2 max-w-[95%] ${
                m.role === 'teacher'
                  ? 'ml-auto bg-[var(--brand-primary)]/10 border border-[var(--brand-primary)]/20'
                  : 'mr-auto bg-[var(--bg-nested)] border border-[var(--border-primary)]'
              }`}
            >
              {m.text}
            </div>
          ))}

          {proposal && (
            <div
              className="rounded-xl border-2 border-[var(--border-strong)] p-3 space-y-2 bg-[var(--bg-nested)]"
              data-testid="copilot-proposal-card"
            >
              <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                Proposal · {proposal.status}
              </div>
              <p className="text-sm font-bold">{proposal.summary}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Scope: {proposal.scope_kind}
                {proposal.feedback_only ? ' · feedback only (scores unchanged)' : ''}
                {proposal.scores_change ? ' · scores may change after a separate regrade confirm' : ''}
              </p>
              {!!proposal.conflict_instruction_ids?.length && (
                <p className="text-xs text-[var(--color-warning)] font-bold">
                  Conflicts must be resolved before confirmation.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy || proposal.status === 'conflict'}
                  onClick={() => confirm('save_instruction')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[var(--brand-primary)] text-white disabled:opacity-50"
                >
                  Confirm save
                </button>
                {proposal.scores_change && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirm('run_regrade')}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border-2 border-[var(--border-strong)] disabled:opacity-50"
                  >
                    Confirm draft regrade
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => confirm('reject')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg text-[var(--color-danger)]"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {jobStatus && (
            <div className="text-xs font-bold text-[var(--color-info)]" data-testid="copilot-job-status">
              Regrade job: {jobStatus} (drafts only · Canvas publish blocked)
            </div>
          )}
        </div>

        <div className="p-3 border-t-2 border-[var(--border-primary)] shrink-0 space-y-2">
          {voiceNote && <p className="text-[10px] text-[var(--text-muted)]">{voiceNote}</p>}
          <label className="sr-only" htmlFor="copilot-composer">
            Message
          </label>
          <textarea
            id="copilot-composer"
            ref={composerRef}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendText(draft);
              }
            }}
            placeholder="Ask about grading… (Enter to send)"
            className="w-full rounded-xl px-3 py-2 text-sm resize-none"
            disabled={busy || !assignmentId}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={listening}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border-2 ${
                listening
                  ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
                  : 'border-[var(--border-primary)]'
              }`}
            >
              {listening ? 'Stop mic' : 'Hold-talk'}
            </button>
            <button
              type="button"
              onClick={() => {
                ttsRef.current?.stop();
                setStatus('Speech stopped');
              }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border-2 border-[var(--border-primary)]"
            >
              Stop speaking
            </button>
            <button
              type="button"
              aria-pressed={ttsMuted}
              onClick={() => {
                const next = !ttsMuted;
                setTtsMuted(next);
                ttsRef.current?.mute(next);
              }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border-2 border-[var(--border-primary)]"
            >
              {ttsMuted ? 'TTS muted' : 'TTS on'}
            </button>
            <button
              type="button"
              disabled={busy || !draft.trim() || !assignmentId}
              onClick={() => void sendText(draft)}
              className="ml-auto px-4 py-1.5 text-xs font-bold rounded-lg bg-[var(--brand-primary)] text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
        <div ref={liveRef} className="sr-only" aria-live="assertive" aria-atomic="true">
          {announce}
        </div>
      </aside>
    </>
  );
}
