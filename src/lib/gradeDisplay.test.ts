import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GradingOutput } from '../types/grading';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { summarizeGrade, formatVerdictScore } = await import('./gradeDisplay');
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
assert(partialHtml.includes('Assessment policy'), 'policy panel present');
assert(partialHtml.includes('Not assessed: processing failed'), 'per-criterion not assessed');
assert(partialHtml.includes('stroke-dasharray="0 150.79"'), 'ring must be empty for incomplete');
const zeroHtml = renderToStaticMarkup(createElement(GradingResult, { result: zero }));
assert(zeroHtml.includes('EVALUATION SCORE') && !bad.test(zeroHtml), 'genuine zero renders as complete');

console.log('gradeDisplay.test.ts PASS');
