/**
 * After Canvas + LLM keys are ready, scan the teacher's courses for new/changed
 * materials. Active (+ late previous, same-semester peers) first, then unstarted
 * future terms, then older archives. Browser-foreground — pause/resume via cache.
 */
import { canvasAPI } from '@/src/services/canvasAPI';
import {
  CanvasCourseFile,
  CourseFileStatusRow,
  selectFilesNeedingIngest,
  sourceUpdatedAt,
} from './courseFileRanker';
import {
  CourseForSync,
  CourseSyncWave,
  orderCoursesForMaterialSync,
} from './courseSyncPriority';
import { joinOrStartCourseIngest } from './courseIngestCoordinator';
import { fetchWithRetry } from './fetchWithRetry';
import { gradingAuthHeaders, requireGradingSession } from './gradingApi';
import { gradingApiBase, llmAuthHeaders, requireLlmCredentials } from './llmProviders';

export type CourseMaterialsSyncProgress = {
  phase: CourseSyncWave | 'done' | 'cancelled' | 'blocked';
  message: string;
  courseIndex: number;
  courseTotal: number;
  courseName: string;
  fileIndex: number;
  fileTotal: number;
  filesIndexed: number;
  filesFailed: number;
  filesSkipped: number;
  /** Short reason for the most recent failure (rate limit, network, etc.). */
  lastFailure?: string;
  /** Up to a few course names that contributed failures. */
  failedCourses?: string[];
};

export type CourseMaterialsSyncResult = {
  cancelled: boolean;
  blockedReason?: string;
  coursesScanned: number;
  filesIndexed: number;
  filesFailed: number;
  filesSkipped: number;
  lastFailure?: string;
  failedCourses?: string[];
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function shortSyncError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? 'failed');
  const cleaned = msg.replace(/\s+/g, ' ').trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}

function looksLikeRateLimit(msg: string): boolean {
  return /429|rate.?limit|resource_exhausted|quota|too many requests/i.test(msg);
}

async function fetchCourseFileStatus(
  courseId: string,
  signal?: AbortSignal,
): Promise<CourseFileStatusRow[]> {
  const res = await fetchWithRetry(
    `${gradingApiBase()}/api/ingest/course-status?course_id=${encodeURIComponent(String(courseId))}`,
    { headers: { ...(await gradingAuthHeaders()) } },
    { signal },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  return Array.isArray(data?.files) ? data.files : [];
}

async function ingestCourseFile(
  courseId: string,
  file: CanvasCourseFile,
  signal?: AbortSignal,
): Promise<any> {
  const payload = {
    assignment_id: `course:${courseId}`,
    course_id: String(courseId),
    canvas_base_url: localStorage.getItem('canvas_base_url') || '',
    url: file.url,
    filename: file.display_name,
    canvas_file_id: String(file.id),
    updated_at: sourceUpdatedAt(file),
    canvas_token: localStorage.getItem('custom_canvas_token') || '',
  };
  const res = await fetchWithRetry(
    `${gradingApiBase()}/api/ingest/canvas-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...llmAuthHeaders(),
        ...(await gradingAuthHeaders()),
      },
      body: JSON.stringify(payload),
    },
    { signal },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json().catch(() => ({}));
}

async function syncOneCourseFiles(
  courseId: string,
  pending: CanvasCourseFile[],
  onFile: (fi: number, file: CanvasCourseFile) => void,
  signal?: AbortSignal,
  onFailure?: (err: unknown, file: CanvasCourseFile) => void,
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;
  for (let fi = 0; fi < pending.length; fi++) {
    if (signal?.aborted) break;
    const file = pending[fi];
    onFile(fi, file);
    try {
      const result = await ingestCourseFile(courseId, file, signal);
      indexed += 1;
      if (!result?.cached && !result?.skipped) {
        await sleep(400, signal);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      failed += 1;
      onFailure?.(err, file);
      console.error(`[course-sync] ${courseId} / ${file.display_name}`, err);
      const msg = shortSyncError(err);
      if (looksLikeRateLimit(msg)) {
        try {
          await sleep(2000, signal);
        } catch {
          throw err;
        }
      }
    }
  }
  return { indexed, failed };
}

export async function syncAllCourseMaterials(opts: {
  courses: CourseForSync[];
  signal?: AbortSignal;
  onProgress?: (p: CourseMaterialsSyncProgress) => void;
  now?: Date;
}): Promise<CourseMaterialsSyncResult> {
  const { courses, signal, onProgress, now = new Date() } = opts;
  const empty: CourseMaterialsSyncResult = {
    cancelled: false,
    coursesScanned: 0,
    filesIndexed: 0,
    filesFailed: 0,
    filesSkipped: 0,
  };

  try {
    await requireGradingSession();
    requireLlmCredentials();
  } catch (e: any) {
    const blockedReason = e?.message || 'Connect Canvas and verify your AI key first.';
    onProgress?.({
      phase: 'blocked',
      message: blockedReason,
      courseIndex: 0,
      courseTotal: 0,
      courseName: '',
      fileIndex: 0,
      fileTotal: 0,
      filesIndexed: 0,
      filesFailed: 0,
      filesSkipped: 0,
    });
    return { ...empty, blockedReason };
  }

  if (!localStorage.getItem('custom_canvas_token')) {
    const blockedReason = 'Enter and verify your Canvas API key first.';
    onProgress?.({
      phase: 'blocked',
      message: blockedReason,
      courseIndex: 0,
      courseTotal: 0,
      courseName: '',
      fileIndex: 0,
      fileTotal: 0,
      filesIndexed: 0,
      filesFailed: 0,
      filesSkipped: 0,
    });
    return { ...empty, blockedReason };
  }

  const { active, upcoming, older, ordered } = orderCoursesForMaterialSync(courses, now);
  const activeIds = new Set(active.map((c) => String(c.id)));
  const upcomingIds = new Set(upcoming.map((c) => String(c.id)));
  let filesIndexed = 0;
  let filesFailed = 0;
  let filesSkipped = 0;
  let coursesScanned = 0;
  let lastFailure = '';
  const failedCourseNames: string[] = [];

  const noteFailure = (courseName: string, err: unknown) => {
    lastFailure = shortSyncError(err);
    if (!failedCourseNames.includes(courseName) && failedCourseNames.length < 5) {
      failedCourseNames.push(courseName);
    }
  };

  const waveFor = (courseId: string): CourseSyncWave => {
    if (activeIds.has(courseId)) return 'active';
    if (upcomingIds.has(courseId)) return 'upcoming';
    return 'older';
  };
  const waveLabel = (phase: CourseSyncWave) =>
    phase === 'active'
      ? 'Active courses'
      : phase === 'upcoming'
        ? 'Upcoming semesters'
        : 'Older courses';

  const emit = (
    partial: Omit<
      CourseMaterialsSyncProgress,
      'filesIndexed' | 'filesFailed' | 'filesSkipped' | 'lastFailure' | 'failedCourses'
    >,
  ) => {
    onProgress?.({
      ...partial,
      filesIndexed,
      filesFailed,
      filesSkipped,
      lastFailure: lastFailure || undefined,
      failedCourses: failedCourseNames.length ? [...failedCourseNames] : undefined,
    });
  };

  for (let ci = 0; ci < ordered.length; ci++) {
    if (signal?.aborted) {
      emit({
        phase: 'cancelled',
        message: lastFailure
          ? `Materials sync paused after: ${lastFailure}. Already-indexed files stay saved.`
          : 'Materials sync paused — it will continue next time you connect.',
        courseIndex: ci,
        courseTotal: ordered.length,
        courseName: '',
        fileIndex: 0,
        fileTotal: 0,
      });
      return {
        cancelled: true,
        coursesScanned,
        filesIndexed,
        filesFailed,
        filesSkipped,
        lastFailure: lastFailure || undefined,
        failedCourses: failedCourseNames.length ? [...failedCourseNames] : undefined,
      };
    }

    const course = ordered[ci];
    const courseId = String(course.id);
    const courseName = course.name || course.course_code || courseId;
    const phase = waveFor(courseId);
    const label = waveLabel(phase);

    emit({
      phase,
      message: `${label}: checking ${courseName} (${ci + 1}/${ordered.length})…`,
      courseIndex: ci + 1,
      courseTotal: ordered.length,
      courseName,
      fileIndex: 0,
      fileTotal: 0,
    });

    try {
      let files: unknown;
      let statusRows: CourseFileStatusRow[];
      try {
        files = await canvasAPI.getCourseFiles(courseId);
      } catch (err) {
        console.error(`[course-sync] list files failed: ${courseName}`, err);
        noteFailure(courseName, err);
        filesFailed += 1;
        coursesScanned += 1;
        emit({
          phase,
          message: `${label}: could not list files for ${courseName} — ${lastFailure}`,
          courseIndex: ci + 1,
          courseTotal: ordered.length,
          courseName,
          fileIndex: 0,
          fileTotal: 0,
        });
        if (looksLikeRateLimit(lastFailure)) {
          try {
            await sleep(2000, signal);
          } catch {
            break;
          }
        }
        continue;
      }
      try {
        statusRows = await fetchCourseFileStatus(courseId, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.error(`[course-sync] course-status failed: ${courseName}`, err);
        noteFailure(courseName, err);
        filesFailed += 1;
        coursesScanned += 1;
        emit({
          phase,
          message: `${label}: index status failed for ${courseName} — ${lastFailure}`,
          courseIndex: ci + 1,
          courseTotal: ordered.length,
          courseName,
          fileIndex: 0,
          fileTotal: 0,
        });
        if (looksLikeRateLimit(lastFailure)) {
          try {
            await sleep(2000, signal);
          } catch {
            break;
          }
        }
        continue;
      }
      const allFiles = Array.isArray(files) ? (files as CanvasCourseFile[]) : [];
      const pending = selectFilesNeedingIngest(allFiles, statusRows);
      const alreadyReady = Math.max(0, selectFilesNeedingIngest(allFiles, []).length - pending.length);
      filesSkipped += alreadyReady;

      if (pending.length === 0) {
        coursesScanned += 1;
        continue;
      }

      const result = await joinOrStartCourseIngest(courseId, async () => {
        return syncOneCourseFiles(
          courseId,
          pending,
          (fi, file) => {
            emit({
              phase,
              message: `${label}: ${courseName} — ${file.display_name} (${fi + 1}/${pending.length})`,
              courseIndex: ci + 1,
              courseTotal: ordered.length,
              courseName,
              fileIndex: fi + 1,
              fileTotal: pending.length,
            });
          },
          signal,
          (err) => noteFailure(courseName, err),
        );
      });

      if (signal?.aborted) {
        emit({
          phase: 'cancelled',
          message: lastFailure
            ? `Materials sync paused after: ${lastFailure}. Already-indexed files stay saved.`
            : 'Materials sync paused — already-indexed files stay saved.',
          courseIndex: ci + 1,
          courseTotal: ordered.length,
          courseName,
          fileIndex: 0,
          fileTotal: pending.length,
        });
        return {
          cancelled: true,
          coursesScanned,
          filesIndexed,
          filesFailed,
          filesSkipped,
          lastFailure: lastFailure || undefined,
          failedCourses: failedCourseNames.length ? [...failedCourseNames] : undefined,
        };
      }

      filesIndexed += result.indexed;
      filesFailed += result.failed;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        emit({
          phase: 'cancelled',
          message: 'Materials sync paused — already-indexed files stay saved.',
          courseIndex: ci + 1,
          courseTotal: ordered.length,
          courseName,
          fileIndex: 0,
          fileTotal: 0,
        });
        return {
          cancelled: true,
          coursesScanned,
          filesIndexed,
          filesFailed,
          filesSkipped,
          lastFailure: lastFailure || undefined,
          failedCourses: failedCourseNames.length ? [...failedCourseNames] : undefined,
        };
      }
      console.error(`[course-sync] course scan failed: ${courseName}`, err);
      noteFailure(courseName, err);
      filesFailed += 1;
    }

    coursesScanned += 1;
  }

  const parts: string[] = [];
  if (active.length) parts.push(`${active.length} active`);
  if (upcoming.length) parts.push(`${upcoming.length} upcoming`);
  if (older.length) parts.push(`${older.length} older`);
  const waveNote = parts.length ? ` Order: ${parts.join(' → ')}.` : '';
  const failDetail =
    filesFailed > 0
      ? [
          failedCourseNames.length
            ? ` (${failedCourseNames.slice(0, 3).join(', ')}${failedCourseNames.length > 3 ? ', …' : ''})`
            : '',
          lastFailure ? `: ${lastFailure}` : '',
        ].join('')
      : '';
  emit({
    phase: 'done',
    message:
      filesFailed > 0
        ? `Materials sync done — ${filesIndexed} updated, ${filesFailed} failed${failDetail}.${waveNote}`
        : `Materials sync done — ${filesIndexed} updated, ${filesSkipped} already current.${waveNote}`,
    courseIndex: ordered.length,
    courseTotal: ordered.length,
    courseName: '',
    fileIndex: 0,
    fileTotal: 0,
  });

  return {
    cancelled: false,
    coursesScanned,
    filesIndexed,
    filesFailed,
    filesSkipped,
    lastFailure: lastFailure || undefined,
    failedCourses: failedCourseNames.length ? [...failedCourseNames] : undefined,
  };
}
