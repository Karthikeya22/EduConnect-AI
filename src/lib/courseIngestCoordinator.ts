/**
 * Single-flight course-file ingest: hub auto-ingest, Manage Materials, and
 * login-wave sync share one in-flight job per courseId.
 */

type Listener = (courseId: string, inFlight: boolean) => void;

const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<Listener>();

function notify(courseId: string, inFlight: boolean) {
  for (const fn of listeners) {
    try {
      fn(courseId, inFlight);
    } catch {
      /* ignore listener errors */
    }
  }
}

export function isCourseIngestInFlight(courseId: string | number | null | undefined): boolean {
  if (courseId == null || courseId === '') return false;
  return inflight.has(String(courseId));
}

export function subscribeCourseIngest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * If a job is already running for this course, await it.
 * Otherwise start `run` and clear the slot when it settles.
 */
export function joinOrStartCourseIngest<T>(
  courseId: string | number,
  run: () => Promise<T>,
): Promise<T> {
  const key = String(courseId);
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const started = (async () => {
    notify(key, true);
    try {
      return await run();
    } finally {
      if (inflight.get(key) === started) {
        inflight.delete(key);
      }
      notify(key, false);
    }
  })();

  inflight.set(key, started);
  return started;
}
