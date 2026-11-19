import {
  CanvasCourseFile,
  CourseFileStatusRow,
  materialIndexState,
  selectFilesNeedingIngest,
} from './courseFileRanker';

export type MaterialsReadyKind = 'ready' | 'indexing' | 'partial' | 'unavailable';

export type MaterialsReadySummary = {
  kind: MaterialsReadyKind;
  label: string;
  indexed: number;
  totalReadable: number;
  pending: number;
  failed: number;
  broken: number;
};

export function summarizeMaterialsReady(
  files: CanvasCourseFile[] | null | undefined,
  statusRows: CourseFileStatusRow[] | null | undefined,
  opts?: { statusUnavailable?: boolean },
): MaterialsReadySummary {
  if (opts?.statusUnavailable) {
    return {
      kind: 'unavailable',
      label: 'Status unavailable',
      indexed: 0,
      totalReadable: 0,
      pending: 0,
      failed: 0,
      broken: 0,
    };
  }

  const all = Array.isArray(files) ? files : [];
  const rows = Array.isArray(statusRows) ? statusRows : [];
  const byId = new Map(rows.map((r) => [String(r.canvas_file_id), r]));
  const totalReadable = selectFilesNeedingIngest(all, []).length;
  let indexed = 0;
  let pending = 0;
  let failed = 0;
  let broken = 0;

  for (const f of all) {
    const state = materialIndexState(f, byId.get(String(f.id)));
    if (state === 'indexed') indexed += 1;
    else if (state === 'pending' || state === 'stale' || state === 'not_indexed') pending += 1;
    else if (state === 'failed') failed += 1;
    else if (state === 'broken') broken += 1;
  }

  const needWork = selectFilesNeedingIngest(all, rows).length;
  if (totalReadable === 0) {
    return {
      kind: 'ready',
      label: 'No ingestible course files',
      indexed,
      totalReadable,
      pending,
      failed,
      broken,
    };
  }
  if (needWork === 0 && failed === 0 && broken === 0) {
    return {
      kind: 'ready',
      label: `Ready · ${indexed}/${totalReadable} indexed`,
      indexed,
      totalReadable,
      pending,
      failed,
      broken,
    };
  }
  if (failed > 0 || broken > 0) {
    return {
      kind: 'partial',
      label: `Partial · ${indexed}/${totalReadable} indexed (${failed + broken} failed)`,
      indexed,
      totalReadable,
      pending,
      failed,
      broken,
    };
  }
  return {
    kind: 'indexing',
    label: `Indexing ${indexed}/${totalReadable}`,
    indexed,
    totalReadable,
    pending,
    failed,
    broken,
  };
}

/** Extra line under provisional grades when materials/RAG were thin. */
export function provisionalMaterialsReason(opts: {
  policyProvisional?: boolean;
  materialsStatus?: 'ready' | 'reingesting' | null;
  ragDegraded?: boolean;
  materialsSummary?: MaterialsReadySummary | null;
}): string | null {
  if (!opts.policyProvisional) return null;
  const parts: string[] = [];
  if (opts.materialsStatus === 'reingesting' || opts.ragDegraded) {
    parts.push('course materials were still indexing or RAG was degraded');
  }
  const s = opts.materialsSummary;
  if (s && s.kind !== 'ready' && s.totalReadable > 0) {
    parts.push(`only ${s.indexed} of ${s.totalReadable} course files indexed`);
  }
  if (parts.length === 0) {
    return 'No Canvas rubric matched — score uses an inferred assessment policy';
  }
  return `Provisional because ${parts.join('; ')}. Refresh materials, then regrade when ready.`;
}
