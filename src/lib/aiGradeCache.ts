import type { GradingOutput } from '../types/grading';
import { isLegacyResult, summarizeGrade } from './gradeDisplay';

const PREFIX = 'educonnect_ai_grades';
const LEGACY_PREFIX = 'educonnect_ai_grades_legacy';

function storageKey(courseId: string, assignmentId: string) {
  return `${PREFIX}:${courseId}:${assignmentId}`;
}

/** Legacy drafts replaced by a reassessment, kept verbatim (first one wins). */
export function loadArchivedLegacyGrades(courseId: string, assignmentId: string): Record<string, GradingOutput> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${LEGACY_PREFIX}:${courseId}:${assignmentId}`) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function archiveLegacyGrade(courseId: string, assignmentId: string, studentId: string, grade: GradingOutput) {
  const archive = loadArchivedLegacyGrades(courseId, assignmentId);
  if (archive[studentId]) return;
  archive[studentId] = grade;
  try {
    localStorage.setItem(`${LEGACY_PREFIX}:${courseId}:${assignmentId}`, JSON.stringify(archive));
  } catch (err) {
    console.error('Failed to archive legacy AI grade', err);
  }
}

export function loadAiGrades(
  courseId: string,
  assignmentId: string
): Record<string, GradingOutput> {
  try {
    const raw = localStorage.getItem(storageKey(courseId, assignmentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, GradingOutput>;
  } catch {
    return {};
  }
}

export function saveAiGrade(
  courseId: string,
  assignmentId: string,
  studentId: string,
  grade: GradingOutput
): void {
  const all = loadAiGrades(courseId, assignmentId);
  const prev = all[studentId];
  if (prev && isLegacyResult(prev)) archiveLegacyGrade(courseId, assignmentId, studentId, prev);
  all[studentId] = {
    ...grade,
    assignment_id: assignmentId,
    student_id: studentId,
  };
  try {
    localStorage.setItem(storageKey(courseId, assignmentId), JSON.stringify(all));
  } catch (err) {
    console.error('Failed to persist AI grade', err);
  }
}

export function formatAiGradeLabel(grade: GradingOutput): string {
  return summarizeGrade(grade).label;
}
