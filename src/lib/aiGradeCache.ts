import type { GradingOutput } from '../types/grading';

const PREFIX = 'educonnect_ai_grades';

function storageKey(courseId: string, assignmentId: string) {
  return `${PREFIX}:${courseId}:${assignmentId}`;
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
  const max = grade.total_max ?? grade.content_max ?? grade.structure_max;
  if (max != null) return `${grade.total}/${max}`;
  return `${grade.total} pts`;
}
