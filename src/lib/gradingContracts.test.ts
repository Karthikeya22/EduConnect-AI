// Run: npx vite-node src/lib/gradingContracts.test.ts
// Mocked only: no Supabase, Canvas, or LLM traffic (fetch is replaced and must not be called).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GradingOutput } from '../types/grading';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
let fetchCalls = 0;
(globalThis as any).fetch = async () => {
  fetchCalls++;
  throw new Error('network must not be used in contract tests');
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { summarizeGrade, formatVerdictScore } = await import('./gradeDisplay');
const { authErrorMessage, activeCourseId, gradingAuthHeaders } = await import('./gradingApi');
const { GradingResult } = await import('../components/grading/GradingResult');

// ── reference / retrieval limits ────────────────────────────────────────────
const refVerdict = {
  criterion_id: 'Cites', criterion_name: 'Cites the reading', score: null, max_score: 4,
  status: 'not_assessable' as const, failure_kind: 'reference_unavailable' as const, retrieval_status: 'no_corpus' as const,
  justification: 'Course reference material was unavailable (no course materials are indexed). This is a system limitation, not a judgement of the student.',
  evidence_anchor: 'not found', missing_keywords: [], dimension: 'content' as const, supporting_materials: [],
};
const okVerdict = { ...refVerdict, criterion_id: 'Clarity', criterion_name: 'Clarity', score: 3, status: 'partial' as const, failure_kind: null, retrieval_status: 'ok' as const, justification: 'clear' };
const refLimited: GradingOutput = {
  result_schema_version: 2, assessment_status: 'partial', overall_confidence: 0.4, flag_for_human: true,
  misconception_hint: '', rag_coverage_level: 'NONE', strong_match_count: 0, referenced_materials: [],
  content_score: null, structure_score: null, total: null, content_max: 8, structure_max: 0, total_max: 8,
  partial_subtotal: { earned: 3, assessed_max: 4, failed_criteria: ['Cites the reading'] },
  retrieval_status: 'no_corpus', criteria_verdicts: [okVerdict, refVerdict],
} as GradingOutput;

assert(formatVerdictScore(refVerdict) === 'Not assessed: reference unavailable', 'reference-limited verdict label');
const s = summarizeGrade(refLimited);
assert(s.kind === 'incomplete' && s.label === 'Incomplete draft: 3 of 4 assessable pts', `reference-limited summary: ${s.label}`);
const html = renderToStaticMarkup(createElement(GradingResult, { result: refLimited }));
assert(html.includes('Not assessed: reference unavailable'), 'renders reference limitation per criterion');
assert(
  html.includes('Incomplete draft: 3 of 4 assessable pts') ||
    html.includes('Assessed so far 3 of 4 assessable pts'),
  'collapsed view shows assessed subtotal only',
);
assert(html.includes('Assessment policy'), 'assessment policy panel present');
assert(!html.includes('EVALUATION SCORE') && !/0\/0|NaN/.test(html), 'no final score for reference-limited draft');

// infrastructure failure of retrieval on a reference criterion is never a zero
const infra = { ...refVerdict, retrieval_status: 'infrastructure_error' as const };
assert(formatVerdictScore(infra) !== '0/4', 'retrieval outage is not a zero');

// ── auth denial mapping (distinct from BYOK) ────────────────────────────────
for (const code of ['AUTH_REQUIRED', 'INVALID_TOKEN', 'TOKEN_EXPIRED', 'COURSE_ACCESS_DENIED', 'ASSIGNMENT_NOT_IN_COURSE',
  'ASSIGNMENT_SCOPE_UNVERIFIED', 'AUTHZ_SETUP_REQUIRED', 'AUTH_UNAVAILABLE']) {
  assert(typeof authErrorMessage({ error: code }) === 'string', `auth code ${code} mapped`);
}
assert(authErrorMessage({ error: 'BYOK_REQUIRED' }) === null, 'BYOK stays a separate, non-auth error');
assert(authErrorMessage({ error: 'RUBRIC_STORE_UNAVAILABLE' }) === null, 'infra errors are not auth errors');
assert(authErrorMessage(null) === null && authErrorMessage('x') === null, 'garbage bodies');
assert(/Canvas did not confirm teacher\/TA access/.test(authErrorMessage({ error: 'COURSE_ACCESS_DENIED' })!), 'membership denial wording');

store.set('active_canvas_course', JSON.stringify({ id: 11 }));
assert(activeCourseId() === '11', 'active course id');
store.set('active_canvas_course', '{bad json');
assert(activeCourseId() === '', 'corrupt course selection');

// ── session headers: real access token only; mock/backdoor session sends none ──
const { supabase } = await import('./supabase');
const auth = supabase.auth as any;
auth.getSession = async () => ({ data: { session: { access_token: 'user-jwt' } } });
store.set('custom_canvas_token', 'ct');
let h = await gradingAuthHeaders();
assert(h.Authorization === 'Bearer user-jwt' && h['X-Canvas-Token'] === 'ct', 'session token + Canvas token');
auth.getSession = async () => ({ data: { session: { user: { email: 'dr.smith@educonnect.ai' } } } });
h = await gradingAuthHeaders();
assert(!('Authorization' in h), 'mock session has no identity for the server');

const { requireGradingSession } = await import('./gradingApi');
let sessionErr = '';
try {
  await requireGradingSession();
} catch (e: any) {
  sessionErr = e?.message || '';
}
assert(/Demo instructor login|Sign in again/i.test(sessionErr), `requireGradingSession rejects mock: ${sessionErr}`);
auth.getSession = async () => ({ data: { session: { access_token: 'user-jwt' } } });
assert((await requireGradingSession()) === 'user-jwt', 'requireGradingSession returns real token');

// ── publication blocked ──────────────────────────────────────────────────────
const { canvasAPI } = await import('../services/canvasAPI');
let blocked = '';
try {
  await canvasAPI.postGrade('11', '101', 's1', 10, 'x');
} catch (e: any) {
  blocked = e?.message;
}
assert(blocked === 'GRADE_PUBLICATION_DISABLED', `publication blocked: ${blocked}`);
const invoked = await (supabase.functions as any).invoke('canvas-post-grade', { body: { courseId: '11' } });
assert(invoked?.data === null && invoked?.error?.message === 'GRADE_PUBLICATION_DISABLED', 'edge invoke of post-grade blocked client-side');

// ── evidence panel + legacy schema v1 after RESULT_SCHEMA_VERSION bump ────────
const withEvidence: GradingOutput = {
  ...refLimited,
  experiment_mode: 'coverage_recovery',
  evidence_protocol_version: 1,
  evidence: {
    evidence_protocol_version: 1,
    experiment_mode: 'coverage_recovery',
    source_units: [{
      source_unit_id: 'submission:u0',
      artifact_id: 'submission',
      submission_version: 'v1',
      extraction_version: 'extract-flat-v1',
      content_hash: 'abc',
      source_location: { offset_encoding: 'unicode_codepoint', start_offset: 0, end_offset: 12, original_document_location: 'unavailable' },
      text: 'Sample passage from the student explaining their pipeline approach clearly.',
      extraction_status: 'ok',
    }],
    coverage: { artifact_extent: 'unknown', known_unit_count: 1, presented_unit_count: 0, extraction_failed_count: 0, not_processed_count: 0, omitted_budget_count: 0 },
    claims: [],
    labels: ['Instructor review needed'],
  },
  criteria_verdicts: [
    {
      ...okVerdict,
      missing_keywords: ['evaluation metrics'],
      criterion_claim: {
        criterion_id: 'Clarity',
        claim_type: 'partially_demonstrated',
        submission_evidence_ids: ['submission:u0'],
        evidence_check_status: 'valid',
        review_reasons: [],
        processing_limitations: [],
      },
    },
    refVerdict,
  ],
};
const evidenceHtml = renderToStaticMarkup(createElement(GradingResult, { result: withEvidence }));
assert(evidenceHtml.includes('Evidence policy:'), 'evidence policy indicator');
assert(evidenceHtml.includes('Evidence checks + recovery when needed'), 'automatic policy label');
assert(
  evidenceHtml.includes('Why this score') || evidenceHtml.includes('Score snapshot'),
  'evidence panel'
);
assert(evidenceHtml.includes('Partially demonstrated'), 'humanized claim type');
assert(evidenceHtml.includes('What looks missing') || evidenceHtml.includes('evaluation metrics'), 'gaps surfaced');
assert(evidenceHtml.includes('data-evidence-id="submission:u0"') || evidenceHtml.includes('Sample passage'), 'evidence link/passage');
assert(
  evidenceHtml.includes('page location unavailable') ||
    evidenceHtml.includes('original-document location unavailable') ||
    evidenceHtml.includes('Click to locate'),
  'location guidance'
);

const legacyV1 = { ...refLimited, result_schema_version: 1 } as GradingOutput;
const legacyHtml = renderToStaticMarkup(createElement(GradingResult, { result: legacyV1 }));
assert(legacyHtml.includes('LEGACY DRAFT') || summarizeGrade(legacyV1).kind === 'incomplete', 'v1 result stays unverified');
assert(summarizeGrade(legacyV1).kind === 'incomplete' && (summarizeGrade(legacyV1) as any).legacy === true, 'schema v1 is legacy');
assert(legacyHtml.includes('Not applied on this legacy draft'), 'legacy draft does not claim active evidence policy');

assert(fetchCalls === 0, `network calls: ${fetchCalls}`);
console.log('gradingContracts.test.ts PASS');
