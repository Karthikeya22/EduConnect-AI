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
};

export type CourseMaterialsSyncResult = {
  cancelled: boolean;
  blockedReason?: string;
  coursesScanned: number;
  filesIndexed: number;
  filesFailed: number;
  filesSkipped: number;
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

async function fetchCourseFileStatus(courseId: string): Promise<CourseFileStatusRow[]> {
  const res = await fetch(
    `${gradingApiBase()}/api/ingest/course-status?course_id=${encodeURIComponent(String(courseId))}`,
    { headers: { ...(await gradingAuthHeaders()) } },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = await res.json();
  return Array.isArray(data?.files) ? data.files : [];
}

async function ingestCourseFile(courseId: string, file: CanvasCourseFile): Promise<any> {
  const payload = {
    assignment_id: `course-sync:${courseId}`,
    course_id: String(courseId),
    canvas_base_url: localStorage.getItem('canvas_base_url') || '',
    url: file.url,
    filename: file.display_name,
    canvas_file_id: String(file.id),
    updated_at: sourceUpdatedAt(file),
    canvas_token: localStorage.getItem('custom_canvas_token') || '',
  };
  const res = await fetch(`${gradingApiBase()}/api/ingest/canvas-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...llmAuthHeaders(),
      ...(await gradingAuthHeaders()),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json().catch(() => ({}));
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
    partial: Omit<CourseMaterialsSyncProgress, 'filesIndexed' | 'filesFailed' | 'filesSkipped'>,
  ) => {
    onProgress?.({
      ...partial,
      filesIndexed,
      filesFailed,
      filesSkipped,
    });
  };

  for (let ci = 0; ci < ordered.length; ci++) {
    if (signal?.aborted) {
      emit({
        phase: 'cancelled',
        message: 'Materials sync paused — it will continue next time you connect.',
        courseIndex: ci,
        courseTotal: ordered.length,
        courseName: '',
        fileIndex: 0,
        fileTotal: 0,
      });
      return { cancelled: true, coursesScanned, filesIndexed, filesFailed, filesSkipped };
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
      const [files, statusRows] = await Promise.all([
        canvasAPI.getCourseFiles(courseId),
        fetchCourseFileStatus(courseId),
      ]);
      const allFiles = Array.isArray(files) ? (files as CanvasCourseFile[]) : [];
      const pending = selectFilesNeedingIngest(allFiles, statusRows);
      const alreadyReady = Math.max(0, selectFilesNeedingIngest(allFiles, []).length - pending.length);
      filesSkipped += alreadyReady;

      for (let fi = 0; fi < pending.length; fi++) {
        if (signal?.aborted) {
          emit({
            phase: 'cancelled',
            message: 'Materials sync paused — already-indexed files stay saved.',
            courseIndex: ci + 1,
            courseTotal: ordered.length,
            courseName,
            fileIndex: fi,
            fileTotal: pending.length,
          });
          return { cancelled: true, coursesScanned, filesIndexed, filesFailed, filesSkipped };
        }

        const file = pending[fi];
        emit({
          phase,
          message: `${label}: ${courseName} — ${file.display_name} (${fi + 1}/${pending.length})`,
          courseIndex: ci + 1,
          courseTotal: ordered.length,
          courseName,
          fileIndex: fi + 1,
          fileTotal: pending.length,
        });

        try {
          const result = await ingestCourseFile(courseId, file);
          filesIndexed += 1;
          if (!result?.cached && !result?.skipped) {
            await sleep(400, signal);
          }
        } catch (err) {
          filesFailed += 1;
          console.error(`[course-sync] ${courseName} / ${file.display_name}`, err);
        }
      }
    } catch (err) {
      console.error(`[course-sync] course scan failed: ${courseName}`, err);
      filesFailed += 1;
    }

    coursesScanned += 1;
  }

  const parts: string[] = [];
  if (active.length) parts.push(`${active.length} active`);
  if (upcoming.length) parts.push(`${upcoming.length} upcoming`);
  if (older.length) parts.push(`${older.length} older`);
  const waveNote = parts.length ? ` Order: ${parts.join(' → ')}.` : '';
  emit({
    phase: 'done',
    message:
      filesFailed > 0
        ? `Materials sync done — ${filesIndexed} updated, ${filesFailed} failed.${waveNote}`
        : `Materials sync done — ${filesIndexed} updated, ${filesSkipped} already current.${waveNote}`,
    courseIndex: ordered.length,
    courseTotal: ordered.length,
    courseName: '',
    fileIndex: 0,
    fileTotal: 0,
  });

  return { cancelled: false, coursesScanned, filesIndexed, filesFailed, filesSkipped };
}
