import type { CriterionVerdict, GradingOutput } from '../types/grading';

export const isScore = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Must match grading_server/models.py RESULT_SCHEMA_VERSION. */
export const RESULT_SCHEMA_VERSION = 2;

/** Results written before versioning (or by an older schema) are legacy/unverified. */
export function isLegacyResult(g: Partial<GradingOutput> | null | undefined): boolean {
  if (!g) return false;
  const v = g.result_schema_version;
  return !isScore(v) || v < RESULT_SCHEMA_VERSION;
}

export type GradeSummary =
  | {
      kind: 'complete';
      total: number;
      max: number | null;
      ring: number;
      label: string;
      provisionalPolicy: boolean;
      policyLabel: string | null;
    }
  | {
      kind: 'incomplete';
      /** Unversioned/older result: contents preserved, never shown as complete. */
      legacy: boolean;
      processingFailed: boolean;
      formativeOnly: boolean;
      earned: number;
      assessedMax: number;
      failed: string[];
      max: number | null;
      ring: 0;
      label: string;
      provisionalPolicy: boolean;
      policyLabel: string | null;
    };

function policyFlags(g: Partial<GradingOutput> | null | undefined) {
  const provisionalPolicy = Boolean(g?.policy_provisional);
  const formativeOnly = Boolean(g?.policy_formative_only);
  const policyLabel =
    (typeof g?.policy_label === 'string' && g.policy_label) ||
    (formativeOnly
      ? 'Formative only — insufficient assignment policy'
      : provisionalPolicy
        ? 'Provisional — inferred assessment policy'
        : null);
  return { provisionalPolicy, formativeOnly, policyLabel };
}

/**
 * Single source of truth for showing a draft grade. A draft is complete only if a current-schema
 * result says complete, has a numeric total, and no criterion is unassessed.
 * Incomplete drafts never produce a total, a rescaled percentage, NaN, or 0/0.
 */
export function summarizeGrade(g: Partial<GradingOutput> | null | undefined): GradeSummary {
  const verdicts: CriterionVerdict[] = g?.criteria_verdicts ?? [];
  const maxRaw = g?.total_max ?? g?.content_max ?? g?.structure_max;
  const max = isScore(maxRaw) && maxRaw > 0 ? maxRaw : null;
  const unassessed = verdicts.filter((v) => !isScore(v.score));
  const legacy = isLegacyResult(g);
  const { provisionalPolicy, formativeOnly, policyLabel } = policyFlags(g);

  if (
    !legacy &&
    !formativeOnly &&
    g?.assessment_status === 'complete' &&
    isScore(g.total) &&
    unassessed.length === 0
  ) {
    const total = g!.total as number;
    const base = max ? `${total}/${max}` : `${total} pts`;
    return {
      kind: 'complete',
      total,
      max,
      ring: max ? Math.min(1, Math.max(0, total / max)) : 0,
      // Detail UI already shows PROVISIONAL header + reason; list chips re-prefix via formatAiGradeLabel.
      label: base,
      provisionalPolicy,
      policyLabel,
    };
  }

  const required = verdicts.filter((v) => !v.ai_generated);
  const assessed = required.filter((v) => isScore(v.score));
  const sub = g?.partial_subtotal;
  const earned = sub ? sub.earned : assessed.reduce((s, v) => s + (v.score as number), 0);
  const assessedMax = sub ? sub.assessed_max : assessed.reduce((s, v) => s + (v.max_score || 0), 0);
  const failed = sub
    ? sub.failed_criteria
    : required.filter((v) => !isScore(v.score)).map((v) => v.criterion_name || v.criterion_id || 'criterion');
  const processingFailed =
    !legacy &&
    !formativeOnly &&
    (g?.assessment_status === 'processing_failed' || assessedMax === 0);
  const label = legacy
    ? 'Legacy draft (unverified): reassess to verify'
    : formativeOnly
      ? policyLabel || 'Formative only — insufficient assignment policy'
      : processingFailed
        ? 'Not assessed: processing failed'
        : `Incomplete draft: ${earned} of ${assessedMax} assessable pts`;
  return {
    kind: 'incomplete',
    legacy,
    processingFailed,
    formativeOnly,
    earned,
    assessedMax,
    failed,
    max,
    ring: 0,
    label,
    provisionalPolicy,
    policyLabel,
  };
}

export function formatVerdictScore(
  v: Pick<CriterionVerdict, 'score' | 'max_score' | 'failure_kind' | 'status'>,
): string {
  if (isScore(v.score)) return `${v.score}/${v.max_score}`;
  if (v.failure_kind === 'reference_unavailable') return 'Not assessed: reference unavailable';
  if (v.status === 'not_assessable' && !v.failure_kind) return 'Formative observation (not scored)';
  return 'Not assessed: processing failed';
}

export type RubricRatingLike = {
  points: number;
  description?: string;
  long_description?: string;
  [key: string]: unknown;
};

/**
 * Highlight a Canvas rating only on an exact point match.
 * Intermediate AI scores (e.g. 9 with bands 10/6/1) must not check Excellent or Satisfactory —
 * that contradiction gives faculty a reason to distrust the grade.
 */
export function selectMatchingRubricRating<T extends RubricRatingLike>(
  score: number,
  ratings: T[],
  epsilon = 1e-6,
): T | null {
  if (!ratings.length || !Number.isFinite(score)) return null;
  const sorted = [...ratings].sort((a, b) => b.points - a.points);
  return sorted.find((r) => Math.abs(Number(r.points) - score) <= epsilon) || null;
}

/** @deprecated Use selectMatchingRubricRating — kept for import compatibility during rollout. */
export function selectNearestRubricRating<T extends RubricRatingLike>(
  score: number,
  ratings: T[],
): T | null {
  return selectMatchingRubricRating(score, ratings);
}

/** Faculty note when AI score sits between Canvas bands (partial credit, not a band label). */
export function rubricScoreBandNote(
  score: number,
  ratings: RubricRatingLike[],
): string | null {
  if (!ratings.length || !Number.isFinite(score)) return null;
  if (selectMatchingRubricRating(score, ratings)) return null;
  const sorted = [...ratings].sort((a, b) => b.points - a.points);
  const above = sorted.filter((r) => r.points > score);
  const below = sorted.filter((r) => r.points < score);
  // Closest ceiling / floor bands (not the extreme ends of the scale).
  const higher = above.length ? above[above.length - 1] : null;
  const lower = below.length ? below[0] : null;
  const fmt = (r: RubricRatingLike) => {
    const label = String(r.description || '').trim();
    return label ? `${label} (${r.points} pts)` : `${r.points} pts`;
  };
  if (higher && lower) {
    return (
      `AI awarded ${score} pts — between ${fmt(higher)} and ${fmt(lower)}. ` +
      `Partial credit applies; see Points withheld because for why full ${higher.points} was not given.`
    );
  }
  if (higher) {
    return (
      `AI awarded ${score} pts — below ${fmt(higher)}. ` +
      `Partial credit applies; see Points withheld because for the deduction.`
    );
  }
  if (lower) {
    return `AI awarded ${score} pts — above ${fmt(lower)}.`;
  }
  return `AI awarded ${score} pts (no matching Canvas rating band).`;
}

/** @deprecated Use rubricScoreBandNote */
export function nearestRubricBandNote(
  score: number,
  rating: RubricRatingLike | null | undefined,
): string | null {
  if (!rating || !Number.isFinite(score)) return null;
  if (Math.abs(score - rating.points) < 1e-6) return null;
  return rubricScoreBandNote(score, [rating]);
}

export type DeductionExplanation = {
  creditAwardedFor: string | null;
  pointsWithheldBecause: string | null;
  justification: string;
};

/** Faculty-facing deduction copy; composes legacy fields when structured ones are absent. */
export function buildDeductionExplanation(
  v: Pick<
    CriterionVerdict,
    | 'score'
    | 'max_score'
    | 'status'
    | 'justification'
    | 'credit_awarded_for'
    | 'points_withheld_because'
    | 'missing_keywords'
    | 'required_concepts'
    | 'covered_concepts'
  >,
): DeductionExplanation {
  const justification = String(v.justification || '').trim();
  let credit: string | null =
    (typeof v.credit_awarded_for === 'string' && v.credit_awarded_for.trim()) || null;
  let withheld =
    (typeof v.points_withheld_because === 'string' && v.points_withheld_because.trim()) ||
    null;

  const max = isScore(v.max_score) ? v.max_score : 0;
  const score = isScore(v.score) ? v.score : null;
  const belowMax = score != null && max > 0 && score < max;

  const isProcessOnly = (text: string | null) => {
    if (!text) return true;
    const t = text.toLowerCase();
    const process =
      /verifiable quote|evidence quote|evidence_anchor|no clear student passage|score capped|credit limited|linked as evidence|linked to this criterion/.test(
        t,
      );
    if (!process) return false;
    return !/missing|underdeveloped|incomplete|does not|fails to|lacks|thin|shallow|unclear|depth|specificity|compare|definition|example/.test(
      t,
    );
  };

  // Prefer content gaps over process-only “no quote” reasons on legacy drafts.
  const covered = new Set(
    (v.covered_concepts || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean),
  );
  const missingFromRequired = (v.required_concepts || [])
    .map((c) => String(c).trim())
    .filter((c) => c && !covered.has(c.toLowerCase()));
  const gaps = [
    ...new Set([...(v.missing_keywords || []).map((c) => String(c).trim()), ...missingFromRequired]),
  ].filter(Boolean);

  if (withheld && isProcessOnly(withheld)) {
    withheld = null;
  }
  if (credit && belowMax && isProcessOnly(credit)) {
    credit = null;
  }

  if (belowMax && (!withheld || isProcessOnly(withheld))) {
    if (gaps.length) {
      withheld = `Not full credit: missing or underdeveloped — ${gaps.slice(0, 6).join(', ')}.`;
    } else if (justification && !isProcessOnly(justification)) {
      withheld = `Awarded ${score}/${max}. ${justification}`;
    } else {
      withheld = `Awarded ${score}/${max}. The response does not demonstrate this criterion with enough depth or specificity for full marks.`;
    }
  }

  // Hide body justification when it duplicates credit/withheld (avoids triple paste).
  let body = justification;
  const joined = `${credit || ''} ${withheld || ''}`.trim().toLowerCase();
  if (
    body &&
    (isProcessOnly(body) ||
      (joined && (joined.includes(body.toLowerCase()) || body.toLowerCase().includes(joined))))
  ) {
    body = '';
  }
  if (body && withheld && withheld.toLowerCase().includes(body.toLowerCase().slice(0, 80))) {
    body = '';
  }
  // When structured fields are present, prefer them alone (no third paste).
  if (body && (credit || withheld)) {
    body = '';
  }

  return {
    creditAwardedFor: credit,
    pointsWithheldBecause: belowMax ? withheld : null,
    justification: body,
  };
}
