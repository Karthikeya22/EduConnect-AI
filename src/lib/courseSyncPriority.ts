/** Rank Canvas courses: active (+ late previous) first, unstarted future next, archives last. */

export type CourseTerm = {
  id?: number;
  name?: string;
  start_at?: string | null;
  end_at?: string | null;
};

export type CourseForSync = {
  id: number | string;
  name?: string;
  course_code?: string;
  term?: CourseTerm | null;
};

/** active = teaching/grading now; upcoming = semester not started; older = archives */
export type CourseSyncWave = 'active' | 'upcoming' | 'older';

const MS_DAY = 24 * 60 * 60 * 1000;
/** Teachers often grade the previous term for a while after it ends. */
const LATE_GRADING_WINDOW_DAYS = 120;

function parseDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function classifyCourseSyncWave(course: CourseForSync, now = new Date()): CourseSyncWave {
  const term = course.term;
  // No term metadata — keep with active so we don't bury courses they're using.
  if (!term) return 'active';

  const start = parseDate(term.start_at);
  const end = parseDate(term.end_at);

  // Currently in session.
  if (start && end && now >= start && now <= end) return 'active';
  if (start && !end && now >= start) return 'active';
  if (!start && end && now <= end) return 'active';

  // Previous term, still grading a bit late — same priority as current.
  if (end && now > end && now.getTime() - end.getTime() <= LATE_GRADING_WINDOW_DAYS * MS_DAY) {
    return 'active';
  }

  // Semester has not started yet — secondary wave (after active + late previous).
  if (start && now < start) return 'upcoming';

  const year = now.getFullYear();
  const name = (term.name || '').toLowerCase();
  if (name.includes(String(year + 1))) return 'upcoming';
  if (name.includes(String(year))) return 'active';
  // Early calendar year: Fall/Winter of previous year is still "late previous".
  if (now.getMonth() < 6 && name.includes(String(year - 1)) && /fall|autumn|winter/i.test(name)) {
    return 'active';
  }
  return 'older';
}

/** @deprecated use classifyCourseSyncWave === 'active' || 'upcoming' for broad "not archive" */
export function isCurrentishCourse(course: CourseForSync, now = new Date()): boolean {
  const wave = classifyCourseSyncWave(course, now);
  return wave === 'active' || wave === 'upcoming';
}

function recencyTieBreak(course: CourseForSync): number {
  const end = parseDate(course.term?.end_at);
  if (end) return end.getTime();
  const start = parseDate(course.term?.start_at);
  if (start) return start.getTime();
  return Number(course.term?.id) || 0;
}

/** Same-semester courses stay together; within a term, alphabetical by name. */
function sortWithinWave(a: CourseForSync, b: CourseForSync): number {
  const termA = Number(a.term?.id) || 0;
  const termB = Number(b.term?.id) || 0;
  if (termA !== termB) {
    const byRecency = recencyTieBreak(b) - recencyTieBreak(a);
    if (byRecency !== 0) return byRecency;
    return termB - termA;
  }
  return String(a.name || a.course_code || '').localeCompare(String(b.name || b.course_code || ''), undefined, {
    sensitivity: 'base',
  });
}

/**
 * Wave order: active (incl. 2–3 same-semester + late previous) → upcoming future → older archives.
 * `current` is kept as an alias of `active` for older call sites.
 */
export function orderCoursesForMaterialSync(
  courses: CourseForSync[],
  now = new Date(),
): {
  active: CourseForSync[];
  upcoming: CourseForSync[];
  older: CourseForSync[];
  /** @deprecated alias of active */
  current: CourseForSync[];
  ordered: CourseForSync[];
} {
  const active: CourseForSync[] = [];
  const upcoming: CourseForSync[] = [];
  const older: CourseForSync[] = [];
  for (const c of courses) {
    const wave = classifyCourseSyncWave(c, now);
    if (wave === 'active') active.push(c);
    else if (wave === 'upcoming') upcoming.push(c);
    else older.push(c);
  }
  active.sort(sortWithinWave);
  upcoming.sort(sortWithinWave);
  older.sort(sortWithinWave);
  return {
    active,
    upcoming,
    older,
    current: active,
    ordered: [...active, ...upcoming, ...older],
  };
}
