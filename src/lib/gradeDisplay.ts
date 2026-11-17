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
      label: provisionalPolicy ? `Provisional — inferred assessment policy · ${base}` : base,
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
        : provisionalPolicy
          ? `Provisional — inferred assessment policy · Incomplete draft: ${earned} of ${assessedMax} assessable pts`
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

export function formatVerdictScore(v: Pick<CriterionVerdict, 'score' | 'max_score' | 'failure_kind'>): string {
  if (isScore(v.score)) return `${v.score}/${v.max_score}`;
  return v.failure_kind === 'reference_unavailable' ? 'Not assessed: reference unavailable' : 'Not assessed: processing failed';
}
