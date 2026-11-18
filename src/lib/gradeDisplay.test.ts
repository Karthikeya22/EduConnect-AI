import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GradingOutput } from '../types/grading';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const {
  summarizeGrade,
  formatVerdictScore,
  selectMatchingRubricRating,
  rubricScoreBandNote,
  buildDeductionExplanation,
} = await import('./gradeDisplay');
const { saveAiGrade, loadAiGrades, formatAiGradeLabel, loadArchivedLegacyGrades } = await import('./aiGradeCache');
const { GradingResult } = await import('../components/grading/GradingResult');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const verdict = (id: string, score: number | null, max: number) => ({
  criterion_id: id,
  criterion_name: id,
  score,
  max_score: max,
  status: score === null ? ('not_assessable' as const) : score === 0 ? ('missing' as const) : ('partial' as const),
  failure_kind: score === null ? ('processing_failed' as const) : null,
  justification: 'j',
  evidence_anchor: 'not found',
  missing_keywords: [],
  dimension: 'content' as const,
  supporting_materials: [],
});

const base = {
  result_schema_version: 2,
  overall_confidence: 0.5,
  flag_for_human: true,
  misconception_hint: '',
  rag_coverage_level: 'NONE' as const,
  strong_match_count: 0,
  referenced_materials: [],
  content_max: 16,
  structure_max: 0,
  total_max: 16,
};

const partial: GradingOutput = {
  ...base,
  assessment_status: 'partial',
  content_score: null,
  structure_score: null,
  total: null,
  partial_subtotal: { earned: 7, assessed_max: 10, failed_criteria: ['Intro'] },
  criteria_verdicts: [verdict('Method', 7, 10), verdict('Intro', null, 6)],
};
const failedAll: GradingOutput = {
  ...base,
  assessment_status: 'processing_failed',
  content_score: null,
  structure_score: null,
  total: null,
  partial_subtotal: { earned: 0, assessed_max: 0, failed_criteria: ['Method', 'Intro'] },
  criteria_verdicts: [verdict('Method', null, 10), verdict('Intro', null, 6)],
};
const zero: GradingOutput = {
  ...base,
  assessment_status: 'complete',
  content_score: 0,
  structure_score: 0,
  total: 0,
  criteria_verdicts: [verdict('Method', 0, 10), verdict('Intro', 0, 6)],
};
// Server says complete-looking total, but a verdict is null (e.g. stale/mixed cache): never complete.
const inconsistent: GradingOutput = { ...partial, assessment_status: undefined, total: 7, partial_subtotal: null };

// summarizeGrade
const sp = summarizeGrade(partial);
assert(sp.kind === 'incomplete' && sp.earned === 7 && sp.assessedMax === 10 && sp.ring === 0, 'partial summary');
assert(sp.label === 'Incomplete draft: 7 of 10 assessable pts', `partial label: ${sp.label}`);
const sf = summarizeGrade(failedAll);
assert(sf.kind === 'incomplete' && sf.processingFailed && sf.label === 'Not assessed: processing failed', 'failed summary');
const sz = summarizeGrade(zero);
assert(sz.kind === 'complete' && sz.total === 0 && sz.label === '0/16', `genuine zero: ${sz.label}`);
assert(summarizeGrade(inconsistent).kind === 'incomplete', 'null verdict blocks complete');
assert(summarizeGrade({ result_schema_version: 2, total: null } as any).label === 'Not assessed: processing failed', 'empty result');
assert(summarizeGrade({ result_schema_version: 1, total: 12, assessment_status: 'complete', criteria_verdicts: [verdict('Method', 12, 12)] } as any).kind === 'incomplete', 'schema v1 is legacy after bump');
assert(summarizeGrade(undefined).kind === 'incomplete', 'undefined result');
const provisional = summarizeGrade({
  ...zero,
  policy_provisional: true,
  policy_label: 'Provisional — inferred assessment policy',
} as any);
assert(
  provisional.kind === 'complete' &&
    provisional.provisionalPolicy &&
    provisional.label.includes('Provisional — inferred assessment policy'),
  `provisional label survives summary: ${provisional.label}`,
);
const formative = summarizeGrade({
  result_schema_version: 2,
  assessment_status: 'complete',
  total: null,
  policy_formative_only: true,
  policy_label: 'Formative only — insufficient assignment policy',
  criteria_verdicts: [],
} as any);
assert(
  formative.kind === 'incomplete' &&
    formative.formativeOnly &&
    formative.label.includes('Formative only'),
  `formative label: ${formative.label}`,
);
assert(formatVerdictScore({ score: null, max_score: 6 }) === 'Not assessed: processing failed', 'verdict null');
assert(
  formatVerdictScore({ score: null, max_score: 0, status: 'not_assessable', failure_kind: null }) ===
    'Formative observation (not scored)',
  'formative not scored',
);
assert(formatVerdictScore({ score: 0, max_score: 6 }) === '0/6', 'verdict zero');

// cache round-trip keeps null (JSON), and labels never coerce it
saveAiGrade('k1', 'a1', 's1', partial);
saveAiGrade('k1', 'a1', 's2', zero);
const loaded = loadAiGrades('k1', 'a1');
assert(loaded.s1.total === null && loaded.s1.criteria_verdicts[1].score === null, 'cache keeps null');
assert(formatAiGradeLabel(loaded.s1) === 'Incomplete draft: 7 of 10 assessable pts', 'cache label partial');
assert(formatAiGradeLabel(loaded.s2) === '0/16', 'cache label zero');

// legacy: unversioned historical draft with a numeric total is preserved but never complete
const { result_schema_version: _v, ...zeroNoVersion } = zero;
const legacyComplete = { ...zeroNoVersion, total: 12, content_score: 12, criteria_verdicts: [verdict('Method', 8, 10), verdict('Intro', 4, 6)] } as GradingOutput;
const sl = summarizeGrade(legacyComplete);
assert(sl.kind === 'incomplete' && sl.legacy && !sl.processingFailed, 'legacy never complete');
assert(sl.label === 'Legacy draft (unverified): reassess to verify', `legacy label: ${sl.label}`);
assert(summarizeGrade({ ...legacyComplete, result_schema_version: 0 }).kind === 'incomplete', 'older schema is legacy');
store.set('educonnect_ai_grades:k2:a2', JSON.stringify({ s9: legacyComplete }));
assert(formatAiGradeLabel(loadAiGrades('k2', 'a2').s9) === sl.label, 'legacy cache label');
assert(loadAiGrades('k2', 'a2').s9.total === 12, 'legacy contents preserved on load');
saveAiGrade('k2', 'a2', 's9', zero);
assert(loadArchivedLegacyGrades('k2', 'a2').s9.total === 12, 'reassessment archives the legacy draft');
assert(loadAiGrades('k2', 'a2').s9.total === 0, 'reassessed draft replaces it');
const legacyHtml = renderToStaticMarkup(createElement(GradingResult, { result: legacyComplete }));
assert(legacyHtml.includes('LEGACY DRAFT — UNVERIFIED') && !legacyHtml.includes('EVALUATION SCORE'), 'legacy render');
assert(legacyHtml.includes('stroke-dasharray="0 150.79"'), 'legacy ring empty');

// render
const bad = /NaN|0\/0|null|undefined/;
for (const [name, r] of [['partial', partial], ['failed', failedAll], ['inconsistent', inconsistent]] as const) {
  const html = renderToStaticMarkup(createElement(GradingResult, { result: r }));
  assert(!bad.test(html), `${name} render contains ${html.match(bad)?.[0]}`);
  assert(html.includes('INCOMPLETE DRAFT'), `${name} render missing incomplete label`);
  assert(!html.includes('EVALUATION SCORE'), `${name} render shows a final score`);
}
const partialHtml = renderToStaticMarkup(createElement(GradingResult, { result: partial }));
assert(
  partialHtml.includes('Incomplete draft: 7 of 10 assessable pts') ||
    partialHtml.includes('Assessed so far 7 of 10 assessable pts'),
  'partial subtotal text',
);
assert(!partialHtml.includes('Assessment policy'), 'policy panel hidden from faculty UI');
assert(partialHtml.includes('Not assessed: processing failed'), 'per-criterion not assessed');
assert(partialHtml.includes('stroke-dasharray="0 150.79"'), 'ring must be empty for incomplete');
const zeroHtml = renderToStaticMarkup(createElement(GradingResult, { result: zero }));
assert(zeroHtml.includes('EVALUATION SCORE') && !bad.test(zeroHtml), 'genuine zero renders as complete');

// ── Canvas rating highlight: exact match only (partial scores check no band) ─
const bands = [
  { points: 10, description: 'Excellent' },
  { points: 6, description: 'Satisfactory' },
  { points: 1, description: 'Needs Improvement' },
];
assert(selectMatchingRubricRating(9, bands) === null, '9 must not check Excellent or Satisfactory');
assert(selectMatchingRubricRating(10, bands)?.points === 10, 'exact 10');
assert(selectMatchingRubricRating(6, bands)?.points === 6, 'exact 6');
assert(selectMatchingRubricRating(1, bands)?.points === 1, 'exact 1');
assert(selectMatchingRubricRating(7.5, bands) === null, '7.5 matches no Canvas band');
const between = rubricScoreBandNote(9, bands);
assert(between?.includes('AI awarded 9'), 'between-band note states awarded score');
assert(between?.includes('Excellent') && between?.includes('Satisfactory'), 'note names surrounding bands');
assert(between?.toLowerCase().includes('withheld') || between?.toLowerCase().includes('partial'), 'note points to deduction');
assert(rubricScoreBandNote(10, bands) === null, 'no note on exact Excellent match');

// ── deduction explanation fallbacks ─────────────────────────────────────────
const structured = buildDeductionExplanation({
  score: 9,
  max_score: 10,
  status: 'partial',
  justification: 'Overall solid.',
  credit_awarded_for: 'Clear GPT tutoring recommendation.',
  points_withheld_because: 'Thin justification for preferring GPT over BERT.',
  missing_keywords: [],
});
assert(structured.creditAwardedFor?.includes('GPT'), 'structured credit');
assert(structured.pointsWithheldBecause?.includes('BERT'), 'structured withheld');
assert(!structured.justification, 'no triple-paste body when structured fields exist');

const legacy = buildDeductionExplanation({
  score: 9,
  max_score: 10,
  status: 'partial',
  justification: 'Mentions tutoring with GPT.',
  missing_keywords: ['model comparison'],
  required_concepts: ['recommendation', 'justification'],
  covered_concepts: ['recommendation'],
});
assert(legacy.pointsWithheldBecause, 'legacy composes withheld from gaps');
assert(legacy.pointsWithheldBecause!.toLowerCase().includes('missing') || legacy.pointsWithheldBecause!.includes('9/10'), 'legacy withheld useful');

const processOnly = buildDeductionExplanation({
  score: 2,
  max_score: 5,
  status: 'partial',
  justification:
    'Limited credit (2/5): topical discussion may be present, but no verifiable student quote was linked as evidence for this criterion. No verifiable quote from the student submission was linked to this criterion, so credit was limited.',
  credit_awarded_for:
    'Limited credit (2/5): topical discussion may be present, but no verifiable student quote was linked as evidence for this criterion.',
  points_withheld_because:
    'No verifiable quote from the student submission was linked to this criterion, so credit was limited.',
  missing_keywords: [],
});
assert(
  processOnly.pointsWithheldBecause?.toLowerCase().includes('depth') ||
    processOnly.pointsWithheldBecause?.toLowerCase().includes('specificity'),
  'process-only withheld replaced with content reason',
);
assert(!processOnly.pointsWithheldBecause?.toLowerCase().includes('verifiable quote'), 'no quote-jargon withheld');
assert(!processOnly.justification, 'no duplicate body for process-only drafts');

const deductionHtml = renderToStaticMarkup(
  createElement(GradingResult, {
    result: {
      ...base,
      assessment_status: 'complete' as const,
      content_score: 9,
      structure_score: 0,
      total: 9,
      content_max: 10,
      structure_max: 0,
      total_max: 10,
      flag_for_human: false,
      criteria_verdicts: [
        {
          ...verdict('Recommendation', 9, 10),
          status: 'partial' as const,
          justification: 'Partial credit for recommendation.',
          credit_awarded_for: 'Names a tutoring task with GPT.',
          points_withheld_because: 'Does not fully compare models for the task.',
          evidence_anchor: 'GPT for tutoring',
          criterion_claim: {
            criterion_id: 'Recommendation',
            claim_type: 'partially_demonstrated',
            submission_evidence_ids: [],
            evidence_check_status: 'valid',
            review_reasons: [],
            processing_limitations: [],
          },
        },
      ],
    },
  }),
);
assert(deductionHtml.includes('Points withheld because'), 'renders withheld label');
assert(deductionHtml.includes('Does not fully compare models'), 'renders withheld text');

console.log('gradeDisplay.test.ts PASS');
