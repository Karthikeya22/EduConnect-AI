import { selectPhaseFiles, CanvasCourseFile } from './courseFileRanker';

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
console.log('courseFileRanker.test.ts PASS');
