import type { CanvasCourseFile, CourseFileStatusRow } from './courseFileRanker';
import { provisionalMaterialsReason, summarizeMaterialsReady } from './materialsReadySummary';

const file = (id: number, name: string): CanvasCourseFile => ({
  id,
  display_name: name,
  url: 'https://x',
  size: 1,
  updated_at: '2026-01-01',
});

{
  const files = [file(1, 'a.pdf'), file(2, 'b.docx')];
  const rows: CourseFileStatusRow[] = [
    { canvas_file_id: 1, status: 'ready', updated_at: '2026-01-01', verified: true, stored_chunks: 3 },
    { canvas_file_id: 2, status: 'ready', updated_at: '2026-01-01', verified: true, stored_chunks: 2 },
  ];
  const s = summarizeMaterialsReady(files, rows);
  if (s.kind !== 'ready' || s.indexed !== 2 || s.withPriorIndex !== 2) {
    throw new Error(`ready summary: ${JSON.stringify(s)}`);
  }
}

{
  const files = [file(1, 'a.pdf'), file(2, 'b.docx')];
  const rows: CourseFileStatusRow[] = [
    { canvas_file_id: 1, status: 'ready', updated_at: '2026-01-01', verified: true, stored_chunks: 3 },
  ];
  const s = summarizeMaterialsReady(files, rows);
  if (s.kind !== 'indexing') throw new Error(`expected indexing, got ${s.kind}`);
}

{
  // Reingest queued must not look like a total wipe when chunks still exist.
  const files = [file(1, 'a.pdf'), file(2, 'b.docx')];
  const rows: CourseFileStatusRow[] = [
    { canvas_file_id: 1, status: 'pending', updated_at: '2026-01-01', stored_chunks: 3, chunk_count: 3 },
    { canvas_file_id: 2, status: 'pending', updated_at: '2026-01-01', stored_chunks: 2, chunk_count: 2 },
  ];
  const s = summarizeMaterialsReady(files, rows);
  if (s.indexed !== 0) throw new Error(`expected 0 ready-indexed, got ${s.indexed}`);
  if (s.withPriorIndex !== 2) throw new Error(`expected retained prior index, got ${s.withPriorIndex}`);
  if (!/retained/i.test(s.label)) throw new Error(`expected retained note in label: ${s.label}`);
}

{
  const s = summarizeMaterialsReady([file(1, 'a.pdf')], [], { statusUnavailable: true });
  if (s.kind !== 'unavailable') throw new Error('expected unavailable');
}

{
  const reason = provisionalMaterialsReason({
    policyProvisional: true,
    ragDegraded: true,
    materialsSummary: {
      kind: 'indexing',
      label: 'Indexing 5/86',
      indexed: 5,
      withPriorIndex: 5,
      totalReadable: 86,
      pending: 81,
      failed: 0,
      broken: 0,
    },
  });
  if (!reason || !/5 of 86/.test(reason) || !/Refresh materials/.test(reason)) {
    throw new Error(`bad provisional reason: ${reason}`);
  }
  if (provisionalMaterialsReason({ policyProvisional: false }) !== null) {
    throw new Error('non-provisional should be null');
  }
}

console.log('materialsReadySummary.test.ts PASS');
