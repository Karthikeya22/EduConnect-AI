export type CanvasCourseFile = {
  id: string | number;
  display_name: string;
  url?: string;
  updated_at?: string;
  created_at?: string;
  [k: string]: unknown;
};

const KEYWORD_RE = /rubric|instructions|syllabus|assignment/i;

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function fileTime(f: CanvasCourseFile): number {
  const raw = f.updated_at || f.created_at || '';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function scoreFile(f: CanvasCourseFile, titleTokens: string[]): number {
  const name = (f.display_name || '').toLowerCase();
  let score = 0;
  if (KEYWORD_RE.test(name)) score += 100;
  for (const tok of titleTokens) {
    if (name.includes(tok)) score += 20;
  }
  // Newer files get a small boost for tie-breaks among non-matches
  score += Math.min(10, fileTime(f) / 1e12);
  return score;
}

const INGESTIBLE_EXTS = [
  '.pdf', '.docx', '.txt', '.pptx',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp4', '.mov', '.m4v', '.webm', '.mkv',
  '.mp3', '.wav', '.m4a', '.ogg',
];

/** Course Files the grader can read: documents, images (vision), and media. */
export function isDocCourseFile(f: CanvasCourseFile): boolean {
  const n = (f.display_name || '').toLowerCase();
  return INGESTIBLE_EXTS.some((ext) => n.endsWith(ext));
}

export type CourseFileStatusRow = {
  canvas_file_id: string | number;
  status?: string;
  updated_at?: string | null;
};

export function sourceUpdatedAt(f: CanvasCourseFile): string {
  return f.updated_at || f.created_at || '';
}

// Doc files with no ready registry row for the same Canvas updated_at (absent, failed, or stale).
export function selectFilesNeedingIngest(
  files: CanvasCourseFile[],
  statusRows: CourseFileStatusRow[]
): CanvasCourseFile[] {
  const byId = new Map(statusRows.map((r) => [String(r.canvas_file_id), r]));
  return files.filter(isDocCourseFile).filter((f) => {
    const row = byId.get(String(f.id));
    return !row || row.status !== 'ready' || (row.updated_at || '') !== sourceUpdatedAt(f);
  });
}

export function selectPhaseFiles(
  files: CanvasCourseFile[],
  assignmentTitle: string,
  phaseALimit = 5
): { phaseA: CanvasCourseFile[]; phaseB: CanvasCourseFile[] } {
  const docs = files.filter(isDocCourseFile);
  const tokens = tokenizeTitle(assignmentTitle || '');
  const ranked = [...docs].sort((a, b) => {
    const ds = scoreFile(b, tokens) - scoreFile(a, tokens);
    if (ds !== 0) return ds;
    return fileTime(b) - fileTime(a);
  });
  const phaseA = ranked.slice(0, Math.max(0, phaseALimit));
  const phaseAIds = new Set(phaseA.map((f) => String(f.id)));
  const phaseB = ranked.filter((f) => !phaseAIds.has(String(f.id)));
  return { phaseA, phaseB };
}
