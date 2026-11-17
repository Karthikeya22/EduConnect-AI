import React, { useState } from 'react';
import * as Icons from '../ui/Icons';
import {
  GradingOutput,
  CriterionVerdict,
  CriterionClaim,
  SourceUnit,
  AssessmentPolicy,
} from '../../types/grading';
import { formatVerdictScore, isScore, summarizeGrade } from '../../lib/gradeDisplay';
import { gradingApiBase, llmAuthHeaders } from '../../lib/llmProviders';
import { gradingAuthHeaders } from '../../lib/gradingApi';

interface GradingResultProps {
  result: GradingOutput;
  rubricContext?: any[];
  onEvidenceAnchorClick?: (anchor: string) => void;
  onEvidenceUnitClick?: (unit: SourceUnit) => void;
  onPolicyUpdated?: (policy: AssessmentPolicy) => void;
  onReassessUnderPolicy?: (policy: AssessmentPolicy) => void;
}

function AssessmentPolicyPanel({
  result,
  onPolicyUpdated,
  onReassessUnderPolicy,
}: {
  result: GradingOutput;
  onPolicyUpdated?: (policy: AssessmentPolicy) => void;
  onReassessUnderPolicy?: (policy: AssessmentPolicy) => void;
}) {
  const policy = result.assessment_policy || null;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const origin =
    result.policy_origin ||
    policy?.origin ||
    (result.rubric_missing ? 'absent' : 'instructor');
  const lifecycle = result.policy_lifecycle || policy?.lifecycle || '—';
  const label =
    result.policy_label ||
    (result.policy_provisional
      ? 'Provisional — inferred assessment policy'
      : result.policy_formative_only
        ? 'Formative only — insufficient assignment policy'
        : null);

  const callPolicy = async (path: string, body?: Record<string, unknown>) => {
    if (!policy?.policy_id || policy.version == null) return;
    setBusy(path);
    setMessage(null);
    try {
      const res = await fetch(
        `${gradingApiBase()}/api/assessment-policy/${encodeURIComponent(policy.policy_id)}/v/${policy.version}${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...llmAuthHeaders(),
            ...(await gradingAuthHeaders()),
          },
          body: JSON.stringify({
            course_id: policy.course_id,
            assignment_id: policy.assignment_id,
            ...(body || {}),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Policy action failed');
      }
      onPolicyUpdated?.(data as AssessmentPolicy);
      setMessage(path.includes('approve') ? 'Approved exact policy version.' : 'Saved as a new policy version.');
    } catch (e: any) {
      setMessage(e?.message || 'Policy action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="bg-white dark:bg-[#151D2C] border border-zinc-100 dark:border-white/5 rounded-xl p-3 shadow-lg space-y-2"
      data-testid="assessment-policy-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Assessment policy</div>
          <div className="mt-1 text-[12px] font-bold text-zinc-900 dark:text-zinc-100">
            {label || (origin === 'instructor' ? 'Instructor rubric' : String(origin))}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Origin: {origin} · Status: {lifecycle}
            {result.policy_version != null ? ` · Result pinned to v${result.policy_version}` : ''}
            {result.policy_content_hash ? ` · hash ${String(result.policy_content_hash).slice(0, 10)}…` : ''}
          </div>
        </div>
      </div>

      {result.policy_provisional && (
        <div
          role="status"
          data-testid="provisional-policy-banner"
          className="p-2 px-3 bg-amber-50 dark:bg-amber-500/10 rounded-lg text-[10px] font-bold text-amber-800 dark:text-amber-300"
        >
          Provisional — inferred assessment policy. Not instructor-authored. Inspect and approve when ready.
        </div>
      )}

      {result.policy_formative_only && (
        <div
          role="status"
          data-testid="formative-policy-banner"
          className="p-2 px-3 bg-zinc-50 dark:bg-white/5 rounded-lg text-[10px] text-zinc-700 dark:text-zinc-300"
        >
          Formative observations only — no authoritative assignment total. Supply clearer expectations or choose an
          approved template to enable scoring.
        </div>
      )}

      {policy?.maximum_score != null && (
        <div className="text-[10px] text-zinc-600 dark:text-zinc-400">
          Maximum score: {policy.maximum_score}
          {policy.weighting_mode ? ` · weighting: ${policy.weighting_mode}` : ''}
        </div>
      )}

      {(policy?.weighting_assumptions?.length || policy?.disclosed_assumptions?.length) ? (
        <details className="text-[10px] text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer font-bold text-zinc-700 dark:text-zinc-300">Assumptions (explicit vs inferred)</summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {(policy.disclosed_assumptions || []).map((a, i) => (
              <li key={`d-${i}`}>{a}</li>
            ))}
            {(policy.weighting_assumptions || []).map((a, i) => (
              <li key={`w-${i}`}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {policy?.criteria?.length ? (
        <div className="space-y-2 pt-1">
          {policy.criteria.map((c) => (
            <div key={c.criterion_id} className="border border-zinc-100 dark:border-white/10 rounded-lg p-2">
              <div className="flex justify-between gap-2">
                <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">{c.title}</div>
                <div className="text-[10px] text-zinc-500 whitespace-nowrap">
                  {c.max_points} pts · {(c.weight * 100).toFixed(1)}%
                </div>
              </div>
              <div className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-0.5">{c.description}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 mt-1">
                {c.provenance.replace(/_/g, ' ')}
                {c.evidence_policy === 'requires_reference' ? ' · requires reference' : ''}
              </div>
              {c.source_excerpts?.map((ex, i) => (
                <div key={i} className="mt-1 text-[10px] text-zinc-500 border-l-2 border-zinc-200 dark:border-white/10 pl-2">
                  Req: {ex.requirement_id}
                  {ex.location ? ` · ${ex.location}` : ''}
                  <div className="italic text-zinc-600 dark:text-zinc-400">“{ex.excerpt}”</div>
                </div>
              ))}
              {c.disclosed_assumptions?.length ? (
                <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                  Inferred: {c.disclosed_assumptions.join(' ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : origin === 'instructor' ? (
        <div className="text-[10px] text-zinc-500">Using instructor-authored rubric criteria from Canvas/ingest.</div>
      ) : null}

      {policy && policy.origin !== 'instructor' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-zinc-100 dark:bg-white/10"
            disabled={!!busy}
            onClick={() => callPolicy('/approve')}
          >
            {busy === '/approve' ? 'Approving…' : 'Approve this version'}
          </button>
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-zinc-100 dark:bg-white/10"
            disabled={!!busy}
            onClick={() =>
              callPolicy('/edit', {
                policy: {
                  ...policy,
                  disclosed_assumptions: [
                    ...(policy.disclosed_assumptions || []),
                    'Instructor edited into a new policy version.',
                  ],
                },
              })
            }
          >
            {busy === '/edit' ? 'Saving…' : 'Edit → new version'}
          </button>
          {onReassessUnderPolicy && (
            <button
              type="button"
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
              onClick={() => onReassessUnderPolicy(policy)}
            >
              Reassess under this version
            </button>
          )}
        </div>
      )}
      {message && <div className="text-[10px] text-zinc-600 dark:text-zinc-400">{message}</div>}
    </div>
  );
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  demonstrated: 'Fully demonstrated',
  partially_demonstrated: 'Partially demonstrated',
  contradicted: 'Conflicts with evidence',
  assessed_not_demonstrated: 'Not demonstrated',
  unresolved: 'Needs instructor review',
};

const STATUS_PLAIN: Record<string, string> = {
  full: 'Full credit',
  partial: 'Partial credit',
  missing: 'No credit',
  not_assessable: 'Not assessed',
};

function humanClaimType(claimType?: string | null): string | null {
  if (!claimType) return null;
  return CLAIM_TYPE_LABELS[claimType] || claimType.replace(/_/g, ' ');
}

function firstSentence(text: string, maxLen = 220): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const sentence = (m ? m[1] : clean).trim();
  return sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1)}…` : sentence;
}

/** Drop structural noise (page markers, lone digits, assignment boilerplate). */
function isUsefulEvidenceText(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 40) return false;
  if (/^===\s*page\s+\d+\s*===/i.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/module\s+\d+\s+alternative\s+assignment/i.test(t)) return false;
  if (/question\s*->\s*data\s*->\s*decision/i.test(t)) return false;
  if (/^in this assignment,? you will/i.test(t)) return false;
  return true;
}

function EvidenceLimitationsPanel({
  verdict,
  claim,
  units,
  onUnitClick,
  onAnchorClick,
  compact = false,
}: {
  verdict: CriterionVerdict;
  claim?: CriterionClaim | null;
  units: SourceUnit[];
  onUnitClick?: (unit: SourceUnit) => void;
  onAnchorClick?: (anchor: string) => void;
  /** Collapsed accordion: shorter layout. */
  compact?: boolean;
}) {
  const byId = Object.fromEntries(units.map((u) => [u.source_unit_id, u]));
  const subIds = claim?.submission_evidence_ids || [];
  const missing = (verdict.missing_keywords || []).filter(Boolean);
  const required = verdict.required_concepts || [];
  const covered = verdict.covered_concepts || [];
  const uncovered = required.filter(
    (req) =>
      !covered.some(
        (c) => c.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(c.toLowerCase())
      )
  );
  const gaps = [...new Set([...missing, ...uncovered])].slice(0, 8);

  const mappedUnits = subIds.map((id) => ({
    id,
    unit: byId[id],
    text: (byId[id]?.text || '').trim(),
  }));
  let evidenceUnits = mappedUnits.filter((row) => isUsefulEvidenceText(row.text)).slice(0, compact ? 2 : 4);
  // If every linked unit was noise-filtered, still show the least-noisy leftovers
  // so teachers are not left with an empty evidence section.
  if (evidenceUnits.length === 0 && mappedUnits.length > 0) {
    evidenceUnits = mappedUnits
      .filter((row) => {
        const t = row.text;
        if (!t) return false;
        if (/^===\s*page\s+\d+\s*===/i.test(t)) return false;
        if (/^\d+$/.test(t)) return false;
        return true;
      })
      .slice(0, compact ? 1 : 2);
  }

  // Prefer the graded anchor when it is real student text and not already listed.
  const anchor = (verdict.evidence_anchor || '').trim();
  const showAnchor =
    anchor &&
    anchor.toLowerCase() !== 'not found' &&
    isUsefulEvidenceText(anchor) &&
    !evidenceUnits.some((e) => e.text.includes(anchor.slice(0, 48)) || anchor.includes(e.text.slice(0, 48)));

  const claimLabel = humanClaimType(claim?.claim_type);
  const statusLabel = STATUS_PLAIN[verdict.status] || verdict.status;
  const whyLine = firstSentence(verdict.justification || claim?.semantic_justification || claim?.judgment || '');
  const needsReview =
    Boolean(claim?.review_reasons?.length) || claim?.evidence_check_status === 'needs_review';
  const recovered =
    claim?.change_reason === 'Additional evidence recovered' ||
    (claim?.original_score != null &&
      claim?.revised_score != null &&
      claim.original_score !== claim.revised_score);

  const techNotes: string[] = [];
  if (claim?.evidence_check_status === 'valid') techNotes.push('Source location validated');
  if (claim?.semantic_label === 'supports') techNotes.push('Model found supportive evidence');
  if (recovered) {
    const before = claim?.original_score;
    const after = claim?.revised_score;
    techNotes.push(
      before != null && after != null
        ? `Extra evidence reviewed (score ${before} → ${after})`
        : 'Extra evidence reviewed'
    );
  }
  (claim?.processing_limitations || []).forEach((p) => {
    if (/extract/i.test(p)) techNotes.push('Some text could not be fully extracted');
    else if (/budget|inspection/i.test(p)) techNotes.push('Inspection limit reached');
  });
  if (needsReview) techNotes.push('Flagged for instructor review');

  const obligation = claim?.obligation;
  const lastAttempt = (claim?.recovery_attempts || []).slice(-1)[0];
  const obligationState = claim?.obligation_state || obligation?.state;
  const reqText = (obligation?.requirement_text || '').trim();
  const reqIds = obligation?.requirement_ids || (claim?.requirement_id ? [claim.requirement_id] : []);
  const unresolvedLim =
    (obligation?.ambiguity_notes || [])[0] ||
    (obligation?.inspection_limitations || [])[0] ||
    (obligation?.extraction_limitations || [])[0] ||
    (claim?.processing_limitations || [])[0] ||
    null;
  const reviewWhy = (claim?.review_reasons || [])[0] || null;

  return (
    <div
      className="space-y-2.5 rounded-md border border-zinc-200 dark:border-white/10 bg-zinc-50/80 dark:bg-white/[0.03] p-2.5"
      data-testid="evidence-limitations-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">
            {compact ? 'Score snapshot' : 'Why this score'}
          </div>
          <div className="mt-0.5 text-[12px] font-bold text-zinc-900 dark:text-zinc-100">
            {isScore(verdict.score) ? `${verdict.score}/${verdict.max_score}` : formatVerdictScore(verdict)}
            <span className="ml-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
              · {claimLabel || statusLabel}
            </span>
          </div>
        </div>
        {needsReview && (
          <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-500/20">
            Review
          </span>
        )}
      </div>

      {(reqText || obligationState) && !compact && (
        <div className="space-y-1" data-testid="evidence-obligation">
          <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">Requirement checked</div>
          {reqText ? (
            <p className="text-[11px] text-zinc-700 dark:text-zinc-300">{reqText}</p>
          ) : null}
          <div className="text-[10px] text-zinc-500">
            {obligationState ? `Obligation: ${String(obligationState).replace(/_/g, ' ')}` : ''}
            {reqIds.length ? ` · ids: ${reqIds.slice(0, 3).join(', ')}` : ''}
            {claim?.gate_decision ? ` · gate: ${claim.gate_decision}` : ''}
          </div>
        </div>
      )}

      {whyLine ? (
        <p className="text-[12px] leading-snug text-zinc-700 dark:text-zinc-300">{whyLine}</p>
      ) : (
        <p className="text-[11px] italic text-zinc-500">No written explanation for this criterion.</p>
      )}

      {!compact && unresolvedLim && (
        <div className="text-[10px] text-amber-800 dark:text-amber-300" data-testid="evidence-unresolved-limitation">
          Unresolved limitation: {unresolvedLim}
        </div>
      )}

      {!compact && lastAttempt && (lastAttempt.action || lastAttempt.reason) && (
        <div className="text-[10px] text-zinc-600 dark:text-zinc-400" data-testid="evidence-recovery-action">
          Action taken: {String(lastAttempt.action || 'recovery').replace(/_/g, ' ')}
          {lastAttempt.reason ? ` — ${String(lastAttempt.reason)}` : ''}
          {lastAttempt.judgment_changed ? ' · judgment changed' : ' · judgment unchanged'}
        </div>
      )}

      {!compact &&
        claim?.original_score != null &&
        claim?.revised_score != null &&
        claim.original_score !== claim.revised_score && (
          <div className="text-[10px] text-zinc-600 dark:text-zinc-400" data-testid="evidence-before-after">
            Before → after: {claim.original_score} → {claim.revised_score}
            {claim.change_reason ? ` (${claim.change_reason})` : ''}
          </div>
        )}

      {!compact && needsReview && reviewWhy && (
        <div className="text-[10px] text-amber-800 dark:text-amber-300" data-testid="evidence-review-why">
          Why review is needed: {reviewWhy}
        </div>
      )}

      {gaps.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[7px] font-black text-rose-600/80 dark:text-rose-400/90 uppercase tracking-widest">
            What looks missing
          </div>
          <ul className="flex flex-wrap gap-1">
            {gaps.map((g) => (
              <li
                key={g}
                className="px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-500/10 text-[10px] font-semibold text-rose-700 dark:text-rose-300 normal-case tracking-normal"
              >
                {g}
              </li>
            ))}
          </ul>
        </div>
      ) : verdict.status === 'full' ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
          No major gaps flagged for this criterion.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">
          Strongest student evidence
        </div>
        {showAnchor && (
          <button
            type="button"
            className="block w-full text-left text-[12px] leading-snug text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-400 pl-2 py-1"
            onClick={() => onAnchorClick?.(anchor)}
          >
            <span className="line-clamp-3">“{anchor}”</span>
            <span className="mt-0.5 block text-[10px] text-zinc-500">Primary quote used for scoring · click to locate</span>
          </button>
        )}
        {evidenceUnits.length === 0 && !showAnchor ? (
          <p className="text-[11px] text-zinc-500 italic">
            {verdict.evidence_anchor === 'not found'
              ? 'No clear student passage was linked to this criterion.'
              : 'No linked passages after filtering document noise.'}
          </p>
        ) : (
          evidenceUnits.map(({ id, unit, text }) => (
            <button
              key={id}
              type="button"
              data-evidence-id={id}
              className="block w-full text-left text-[12px] leading-snug text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-400/70 pl-2 py-1"
              onClick={() => {
                if (unit && onUnitClick) onUnitClick(unit);
                else if (onAnchorClick) onAnchorClick(text);
              }}
            >
              <span className="line-clamp-3">“{text}”</span>
              <span className="mt-0.5 block text-[10px] text-zinc-500">
                Click to locate in submission
                {unit?.source_location?.original_document_location === 'unavailable'
                  ? ' · page location unavailable'
                  : ''}
              </span>
            </button>
          ))
        )}
      </div>

      {!compact && (claim?.review_reasons?.length || 0) > 0 && (
        <div className="text-[11px] text-amber-800 dark:text-amber-300 leading-snug">
          <span className="font-semibold">Instructor note: </span>
          {(claim?.review_reasons || []).join('; ')}
        </div>
      )}

      {!compact && techNotes.length > 0 && (
        <details className="text-[10px] text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer select-none font-semibold uppercase tracking-wider text-[8px] text-zinc-400">
            Technical checks
          </summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5 normal-case tracking-normal">
            {techNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export const GradingResult: React.FC<GradingResultProps> = ({
  result,
  rubricContext = [],
  onEvidenceAnchorClick,
  onEvidenceUnitClick,
  onPolicyUpdated,
  onReassessUnderPolicy,
}) => {
  const [openCriterion, setOpenCriterion] = useState<string | null>(null);
  const summary = summarizeGrade(result);
  const complete = summary.kind === 'complete';
  const dimLabel = (score: number | null | undefined, max?: number) =>
    complete && isScore(score) ? `${score}/${max || '?'}` : '—';
  const sourceUnits: SourceUnit[] = result.evidence?.source_units || [];
  const isLegacyDraft = summary.kind === 'incomplete' && summary.legacy;
  const provisionalPolicy = summary.provisionalPolicy;
  const formativeOnly = summary.kind === 'incomplete' && summary.formativeOnly;
  const researchMode = result.experiment_mode;
  const evidencePolicyLabel = isLegacyDraft
    ? 'Not applied on this legacy draft — reassess to run evidence checks'
    : researchMode === 'obligation_recovery'
      ? 'Obligation-driven recovery (research mode D)'
      : researchMode === 'coverage_recovery'
      ? 'Evidence checks + recovery when needed'
      : researchMode === 'verification_only'
        ? 'Evidence checks only'
        : researchMode === 'baseline'
          ? 'Standard grading path'
          : result.evidence_protocol_version != null
            ? 'Evidence checks + recovery when needed'
            : 'Pending reassessment';

  const copyToClipboard = () => {
    const headline = complete
      ? `Content: ${dimLabel(result.content_score, result.content_max)} | Structure: ${dimLabel(result.structure_score, result.structure_max)} | Total: ${summary.label}`
      : `${summary.label}${summary.failed.length ? ` | Not assessed: ${summary.failed.join(', ')}` : ''}`;
    const text = `AI Grading Summary${complete ? '' : summary.legacy ? ' (LEGACY DRAFT, UNVERIFIED)' : ' (INCOMPLETE DRAFT)'}
${headline}

${result.criteria_verdicts.map(v => 
  `[${v.criterion_name}] ${formatVerdictScore(v)} (${v.status}): ${v.justification}${v.missing_keywords?.length > 0 ? `\nMissing: ${v.missing_keywords.join(', ')}` : ''}`
).join('\n\n')}

${result.misconception_hint ? `Misconception: ${result.misconception_hint}` : ''}`;

    navigator.clipboard.writeText(text);
    alert('AI Feedback copied to clipboard!');
  };

  const coverageColors = {
    HIGH: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400',
    MEDIUM: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400',
    LOW: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400'
  };

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'full': 
        return <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-emerald-500 rounded-full"></div></div>;
      case 'partial': 
        return <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-amber-500 rounded-full"></div></div>;
      case 'missing': 
        return <div className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-rose-500 rounded-full"></div></div>;
      case 'not_assessable':
        return <div className="w-5 h-5 rounded-full border border-dashed border-amber-500 flex items-center justify-center shrink-0" aria-label="Not assessed"></div>;
      default: 
        return <div className="w-5 h-5 rounded-full bg-zinc-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-zinc-500 rounded-full"></div></div>;
    }
  };

  const getRubricDetail = (criterionNameOrId: string) => {
    const match = rubricContext.find((r: any) => 
      r.id === criterionNameOrId || 
      r.description === criterionNameOrId || 
      (r.title && r.title === criterionNameOrId)
    );
    return match ? (match.long_description || match.description) : null;
  };

  const cleanSupportingMaterial = (mat: string) => {
    return mat.replace(/\s*\(?chunk\s*\d+\)?/gi, '').trim() || mat;
  };

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      {/* Section A: Score Card */}
      <div className="bg-white dark:bg-[#151D2C] border border-zinc-100 dark:border-white/5 rounded-xl p-3 shadow-lg space-y-2 relative overflow-visible">
        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-[30px] pointer-events-none"></div>
        <div className="flex justify-between items-center relative z-10">
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14 flex items-center justify-center">
               <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-md">
                 <circle cx="28" cy="28" r="24" fill="transparent" stroke="currentColor" strokeWidth="3" className="text-zinc-100 dark:text-white/5" />
                 <circle cx="28" cy="28" r="24" fill="transparent" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-indigo-500 transition-all duration-1000" strokeDasharray={`${summary.ring * 150.79} 150.79`} />
               </svg>
               <div className="text-center z-10 flex flex-col items-center mt-0.5">
                  <div className="text-xl font-black text-zinc-900 dark:text-white leading-none tracking-tighter">{complete ? summary.total : '—'}</div>
                  {complete && summary.max && (
                    <div className="text-[7px] font-bold text-zinc-500 mt-0.5 uppercase tracking-widest">/ {summary.max}</div>
                  )}
               </div>
            </div>
             <div className="flex flex-col">
                <div className="text-[9px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1">
                  {formativeOnly
                    ? 'FORMATIVE ONLY'
                    : provisionalPolicy
                      ? 'PROVISIONAL — INFERRED POLICY'
                      : complete
                        ? 'EVALUATION SCORE'
                        : summary.legacy
                          ? 'LEGACY DRAFT — UNVERIFIED'
                          : 'INCOMPLETE DRAFT'}
                </div>
                <div className="text-[9px] text-zinc-500 dark:text-zinc-400 font-medium" data-testid="grade-summary-label">
                  {summary.label}
                </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 origin-right">
            <div className="flex items-center space-x-2 text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
              <span>CONTENT:</span>
              <span className="text-xs text-zinc-900 dark:text-white font-bold ml-auto">{dimLabel(result.content_score, result.content_max)}</span>
            </div>
            {result.structure_max !== undefined && result.structure_max > 0 && (
              <div className="flex items-center space-x-2 text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                <span>STRUCTURE:</span>
                <span className="text-xs text-zinc-900 dark:text-white font-bold ml-auto">{dimLabel(result.structure_score, result.structure_max)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5 relative z-10 pt-3 border-t border-zinc-100 dark:border-white/5">
          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>AI CONFIDENCE INDEX</span>
            <span className="text-indigo-500">{Math.round((result.overall_confidence || result.confidence || 0) * 100)}%</span>
          </div>
          <div className="h-1 w-full bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000" 
              style={{ width: `${(result.overall_confidence || result.confidence || 0) * 100}%` }}
            ></div>
          </div>
        </div>

        {result.flag_for_human && (
          <div className="p-2.5 px-3 bg-amber-50 dark:bg-amber-500/10 rounded-lg flex items-center space-x-2.5 text-amber-700 dark:text-amber-400 relative z-10">
            <Icons.IconSparkles className="w-4 h-4 shrink-0" />
            <div className="text-[9px] font-black uppercase tracking-widest leading-relaxed">FLAGGED FOR HUMAN REVIEW — ALGORITHM UNCERTAINTY DETECTED.</div>
          </div>
        )}

        <div
          role="status"
          data-testid="research-mode-indicator"
          className="p-2 px-3 bg-zinc-50 dark:bg-white/5 rounded-lg text-[10px] text-zinc-600 dark:text-zinc-400 relative z-10"
        >
          Evidence policy:{' '}
          <span className="font-bold text-zinc-800 dark:text-zinc-200">{evidencePolicyLabel}</span>
          {result.evidence_protocol_version != null
            ? ` · protocol v${result.evidence_protocol_version}`
            : ''}
          {summary.kind === 'incomplete' && summary.legacy ? ' · legacy draft (unverified)' : ''}
        </div>

        {summary.kind === 'incomplete' && summary.legacy && (
          <div role="status" className="p-2.5 px-3 bg-zinc-50 dark:bg-white/5 rounded-lg text-[10px] text-zinc-700 dark:text-zinc-300 relative z-10">
            This draft predates result versioning, so its scores and total are shown for reference only and are not verified. Use Reassess to produce a verified draft; the original is kept.
          </div>
        )}

        {summary.kind === 'incomplete' && !summary.legacy && !formativeOnly && summary.failed.length > 0 && (
          <div className="p-2.5 px-3 bg-zinc-50 dark:bg-white/5 rounded-lg text-[10px] text-zinc-700 dark:text-zinc-300 relative z-10">
            No total is shown because these criteria were not assessed (not scored as zero): {summary.failed.join(', ')}. Regrade or review manually.
          </div>
        )}
      </div>

      <AssessmentPolicyPanel
        result={result}
        onPolicyUpdated={onPolicyUpdated}
        onReassessUnderPolicy={onReassessUnderPolicy}
      />

      {/* Section C: Rubric Walkthrough */}
      <div className="space-y-3">
        <div className="text-[9px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] ml-2">CRITERIA BREAKDOWN</div>
        <div className="space-y-2">
          {result.criteria_verdicts?.map((v) => {
            const criterionNameOrId = v.criterion_name || (v as any).title || v.criterion_id;
            const rubricDetail = getRubricDetail(criterionNameOrId);
            const isOpen = openCriterion === criterionNameOrId;
            
            return (
            <div key={criterionNameOrId} className={`bg-white dark:bg-[#151D2C] border transition-all duration-300 rounded-lg overflow-hidden shadow-sm ${isOpen ? 'border-indigo-500/30 shadow-md ring-2 ring-indigo-500/5' : 'border-zinc-100 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'}`}>
              <button 
                onClick={() => setOpenCriterion(isOpen ? null : criterionNameOrId)}
                className="w-full p-2.5 flex items-center justify-between text-left transition-colors"
              >
                <div className="flex items-center space-x-2.5 min-w-0 pr-3">
                  {renderStatusIcon(v.status)}
                  <div className="min-w-0">
                    <div className={`text-sm font-bold truncate ${isOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-900 dark:text-white'}`}>
                      {criterionNameOrId}
                    </div>
                    <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 bg-zinc-100 dark:bg-white/5 px-1 py-0.5 rounded mt-0.5 inline-block">{v.dimension}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  {isScore(v.score) ? (
                    <div className="flex items-baseline space-x-0.5">
                       <span className="text-xs font-black text-zinc-900 dark:text-white">{v.score}</span>
                       <span className="text-[9px] font-bold text-zinc-400">/{v.max_score}</span>
                    </div>
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">{formatVerdictScore(v)}</span>
                  )}
                  <div className={`w-6 h-6 rounded-full bg-zinc-50 dark:bg-white/5 flex items-center justify-center transition-transform duration-300 ${isOpen ? 'rotate-180 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500' : 'text-zinc-400'}`}>
                     <Icons.IconChevronDown className="w-3 h-3" />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="p-2.5 pt-0 space-y-2.5 animate-in slide-in-from-top-2 duration-200 border-t border-zinc-100 dark:border-white/5 mt-1 pt-2">
                  {rubricDetail && (
                     <div className="pl-3 border-l-2 border-indigo-500/30 py-1.5">
                        <div className="text-[7px] font-black text-indigo-500 uppercase tracking-widest mb-1 flex items-center"><Icons.IconList className="w-3 h-3 mr-1" /> Rubric Expectation</div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-snug font-medium">{rubricDetail}</div>
                     </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconCheck className="w-3 h-3 mr-1" /> Why the AI scored it this way</div>
                    <div className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug font-medium">{v.justification}</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconFile className="w-3 h-3 mr-1" /> Best matching quote</div>
                    <button 
                       onClick={() => { if (v.evidence_anchor !== 'not found' && onEvidenceAnchorClick) onEvidenceAnchorClick(v.evidence_anchor); }}
                       className={`w-full text-left pl-3 border-l-2 text-xs py-1.5 transition-all block relative group cursor-pointer
                          ${v.evidence_anchor === 'not found' ? 'italic text-rose-500 border-rose-300' : 'text-indigo-600 dark:text-indigo-400 border-indigo-500 hover:text-indigo-800 dark:hover:text-indigo-300'}`}
                    >
                      {v.evidence_anchor !== 'not found' && (
                         <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Icons.IconSparkles className="w-3.5 h-3.5 text-indigo-400" />
                         </div>
                      )}
                      <span className="relative z-10 leading-relaxed font-medium">{v.evidence_anchor === 'not found' ? 'No evidence found in submission' : `"${v.evidence_anchor}"`}</span>
                    </button>
                  </div>

                  {v.missing_keywords?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconX className="w-3 h-3 mr-1" /> What appears missing</div>
                      <div className="flex flex-wrap gap-1">
                        {v.missing_keywords.map((kw, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-500/10 text-[10px] font-semibold text-rose-600 dark:text-rose-400 rounded-md normal-case tracking-normal">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {v.required_concepts && v.required_concepts.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[8px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconNetwork className="w-3 h-3 mr-1" /> Concept coverage</div>
                      <div className="flex flex-col gap-1.5">
                         <div className="flex flex-wrap gap-1.5">
                            <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold my-auto mr-1.5">Expected:</span>
                            {v.required_concepts.map((kw, i) => {
                               const isCovered = v.covered_concepts?.some(c => c.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(c.toLowerCase()));
                               return (
                                  <span key={`req-${i}`} className={`px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded ${isCovered ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-50 dark:bg-white/5 text-zinc-400'}`}>
                                    {kw} {isCovered && <Icons.IconCheck className="inline w-2.5 h-2.5 ml-0.5" />}
                                  </span>
                               );
                            })}
                         </div>
                         {v.covered_concepts && v.covered_concepts.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-0.5">
                               <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold my-auto mr-1.5">Found in work:</span>
                               {v.covered_concepts.map((kw, i) => (
                                 <span key={`cov-${i}`} className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-[8px] font-black text-indigo-600 dark:text-indigo-400 rounded uppercase tracking-wider">
                                   {kw}
                                 </span>
                               ))}
                            </div>
                         )}
                      </div>
                    </div>
                  )}

                  {v.supporting_materials?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconChart className="w-3 h-3 mr-1" /> GROUNDED IN</div>
                      <div className="flex flex-wrap gap-1">
                        {v.supporting_materials.map((mat, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 text-[8px] font-black uppercase tracking-wider rounded-md">
                            {cleanSupportingMaterial(mat)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(v.criterion_claim || (researchMode !== 'baseline' && result.evidence)) && (
                    <EvidenceLimitationsPanel
                      verdict={v}
                      claim={v.criterion_claim}
                      units={sourceUnits}
                      onUnitClick={onEvidenceUnitClick}
                      onAnchorClick={onEvidenceAnchorClick}
                      compact={false}
                    />
                  )}
                </div>
              )}

              {!isOpen && v.criterion_claim && (
                <div className="px-2.5 pb-2.5">
                  <EvidenceLimitationsPanel
                    verdict={v}
                    claim={v.criterion_claim}
                    units={sourceUnits}
                    onUnitClick={onEvidenceUnitClick}
                    onAnchorClick={onEvidenceAnchorClick}
                    compact
                  />
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Section D: Misconception Hint */}
      {result.misconception_hint && (
        <div className="p-3 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/5 border border-amber-200 dark:border-amber-500/20 space-y-1.5 shadow-md shadow-amber-500/5 transition-all relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-400/10 rounded-full blur-[20px]"></div>
          <div className="flex items-center space-x-1.5 text-amber-700 dark:text-amber-400 relative z-10">
            <Icons.IconSparkles className="w-3.5 h-3.5" />
            <h4 className="text-[8px] font-black uppercase tracking-[0.2em]">TARGETED FEEDBACK</h4>
          </div>
          <div className="text-sm text-amber-900/90 dark:text-amber-200/90 font-medium leading-snug italic relative z-10">
            "{result.misconception_hint}"
          </div>
        </div>
      )}

      {/* Section E: Academic Integrity */}
      {result.integrityEvaluation && (
        <div className="space-y-2 relative overflow-hidden pt-2">
          <div className="flex items-center space-x-2 border-b border-zinc-100 dark:border-white/5 pb-1.5">
            <Icons.IconSparkles className="w-3 h-3 text-indigo-500" />
            <div className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">ACADEMIC INTEGRITY</div>
          </div>

          <div className="space-y-2 bg-zinc-50 dark:bg-white/5 p-3 rounded-lg border border-zinc-100/50 dark:border-white/5">
            <div className="space-y-1 text-[9px] text-zinc-500 dark:text-zinc-400 font-medium">
              <div className="flex justify-between">
                <span className="text-zinc-400">AI Authorship:</span>
                <span className={`font-bold ${result.integrityEvaluation.ai_authorship_probability > 0.5 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {Math.round(result.integrityEvaluation.ai_authorship_probability * 100)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Plagiarism Risk:</span>
                <span className={`font-bold uppercase tracking-wider px-1 py-0.5 rounded ${result.integrityEvaluation.plagiarism_risk === 'High' ? 'bg-rose-500/10 text-rose-500' : result.integrityEvaluation.plagiarism_risk === 'Medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                  {result.integrityEvaluation.plagiarism_risk}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copy Button */}
      <button 
        onClick={copyToClipboard}
        className="w-full py-2.5 mt-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg flex items-center justify-center space-x-2 font-black text-[10px] uppercase tracking-[0.2em] transition-all hover:scale-[1.01] active:scale-[0.99] group"
      >
        <Icons.IconCheck className="w-4 h-4 group-hover:scale-110 transition-transform" />
        <span>Copy AI Feedback</span>
      </button>

    </div>
  );
};
