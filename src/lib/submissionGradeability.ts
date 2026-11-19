/**
 * Shared rules for whether a Canvas submission row can be AI-graded,
 * and how to label empty vs uploaded vs text bodies.
 */

export type GradeableStudentLike = {
  body?: string | null;
  attachments?: Array<{ url?: string; display_name?: string; filename?: string }> | null;
  score?: number | null;
  status?: string | null;
  submitted_at?: string | null;
  workflow_state?: string | null;
};

const PLACEHOLDER_BODY =
  /^(submission type:\s*|no submission content\.?\s*|no preview\s*|missing input\s*)/i;

export function isPlaceholderSubmissionBody(text: string | null | undefined): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  return PLACEHOLDER_BODY.test(t);
}

export function hasAttachment(student: GradeableStudentLike): boolean {
  return Array.isArray(student.attachments) && student.attachments.length > 0;
}

/** True when there is something the grader can read (file, text, or launch URL). */
export function hasGradeableSubmission(student: GradeableStudentLike): boolean {
  if (hasAttachment(student)) return true;
  const body = String(student.body || '').trim();
  if (!body || isPlaceholderSubmissionBody(body)) return false;
  return true;
}

export function isUngradedSubmitted(student: GradeableStudentLike): boolean {
  if (student.status === 'Missing') return false;
  if (student.status === 'Ungraded') return true;
  if (student.score != null && !Number.isNaN(Number(student.score))) return false;
  return hasGradeableSubmission(student) || Boolean(student.submitted_at);
}

export function submissionListLabel(student: GradeableStudentLike): string {
  if (hasAttachment(student)) {
    const n = student.attachments!.length;
    return n === 1 ? 'Uploaded file' : `${n} uploaded files`;
  }
  const body = String(student.body || '').trim();
  if (!body || isPlaceholderSubmissionBody(body)) {
    return 'No Canvas submission';
  }
  if (/^https?:\/\//i.test(body) || /submission type:\s*online_url/i.test(body)) {
    return 'External / link submission';
  }
  if (/^submission type:/i.test(body)) {
    return body;
  }
  return 'Online text';
}

export function emptySubmissionHeadline(student: GradeableStudentLike): string {
  return hasGradeableSubmission(student) ? 'Submission preview unavailable' : 'No Canvas submission';
}
