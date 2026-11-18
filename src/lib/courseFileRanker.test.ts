import {
  selectPhaseFiles,
  selectFilesNeedingIngest,
  isDocCourseFile,
  materialIndexState,
  CanvasCourseFile,
} from './courseFileRanker';

const files: CanvasCourseFile[] = [
  { id: 1, display_name: 'unrelated_notes.pdf', updated_at: '2026-01-01T00:00:00Z' },
  { id: 2, display_name: 'EME6356_Reflection_rubric.pdf', updated_at: '2026-01-02T00:00:00Z' },
  { id: 3, display_name: 'syllabus.docx', updated_at: '2026-01-03T00:00:00Z' },
  { id: 4, display_name: 'zzz_old.txt', updated_at: '2025-01-01T00:00:00Z' },
  { id: 5, display_name: 'instructions_reflection.pdf', updated_at: '2026-01-04T00:00:00Z' },
  { id: 6, display_name: 'extra6.pdf', updated_at: '2026-01-05T00:00:00Z' },
  { id: 7, display_name: 'extra7.pdf', updated_at: '2026-01-06T00:00:00Z' },
];

const { phaseA, phaseB } = selectPhaseFiles(files, 'EME 6356 Reflection Paper', 5);
if (phaseA.length !== 5) throw new Error(`expected 5 phaseA, got ${phaseA.length}`);
if (!phaseA.some(f => String(f.id) === '2')) throw new Error('rubric match missing from phaseA');
if (!phaseA.some(f => String(f.id) === '5')) throw new Error('instructions match missing from phaseA');
if (phaseA.length + phaseB.length !== files.length) throw new Error('partition incomplete');

const needing = selectFilesNeedingIngest(
  [...files, { id: 8, display_name: 'video.mp4', updated_at: '2026-01-01T00:00:00Z' }],
  [
    { canvas_file_id: '1', status: 'ready', updated_at: '2026-01-01T00:00:00Z' }, // fresh -> skip
    { canvas_file_id: 2, status: 'failed', updated_at: '2026-01-02T00:00:00Z' },  // failed -> retry
    { canvas_file_id: '3', status: 'ready', updated_at: '2025-12-01T00:00:00Z' }, // stale -> re-ingest
  ]
).map(f => String(f.id)).sort();
const expectedNeeding = ['2', '3', '4', '5', '6', '7', '8'];
if (JSON.stringify(needing) !== JSON.stringify(expectedNeeding)) {
  throw new Error(`selectFilesNeedingIngest: expected ${expectedNeeding}, got ${needing}`);
}
if (!isDocCourseFile({ id: 9, display_name: 'slide.png' })) {
  throw new Error('expected PNG course images to be ingestible');
}
const indexedFile = { id: 1, display_name: 'a.pdf', updated_at: '2026-01-01T00:00:00Z' };
if (materialIndexState(indexedFile, { canvas_file_id: '1', status: 'ready', updated_at: '2026-01-01T00:00:00Z', verified: true, stored_chunks: 2 }) !== 'indexed') {
  throw new Error('expected indexed state');
}
if (materialIndexState(indexedFile, { canvas_file_id: '1', status: 'ready', updated_at: '2026-01-01T00:00:00Z', verified: false, stored_chunks: 0 }) !== 'broken') {
  throw new Error('expected broken state');
}
if (materialIndexState(indexedFile, { canvas_file_id: '1', status: 'failed', last_error: '404' }) !== 'failed') {
  throw new Error('expected failed state');
}
console.log('courseFileRanker.test.ts PASS');
