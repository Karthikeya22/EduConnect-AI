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

export function isDocCourseFile(f: CanvasCourseFile): boolean {
  const n = (f.display_name || '').toLowerCase();
  return n.endsWith('.pdf') || n.endsWith('.docx') || n.endsWith('.txt') || n.endsWith('.pptx');
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
