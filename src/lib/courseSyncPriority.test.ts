import {
  classifyCourseSyncWave,
  isCurrentishCourse,
  orderCoursesForMaterialSync,
} from './courseSyncPriority';

const now = new Date('2026-11-18T12:00:00Z');

const fall2026a = {
  id: 1,
  name: 'AI Teaching A',
  term: {
    id: 30,
    name: 'Fall 2026',
    start_at: '2026-08-15T00:00:00Z',
    end_at: '2026-12-15T00:00:00Z',
  },
};
const fall2026b = {
  id: 11,
  name: 'AI Teaching B',
  term: {
    id: 30,
    name: 'Fall 2026',
    start_at: '2026-08-15T00:00:00Z',
    end_at: '2026-12-15T00:00:00Z',
  },
};
const fall2026c = {
  id: 12,
  name: 'Methods C',
  term: {
    id: 30,
    name: 'Fall 2026',
    start_at: '2026-08-15T00:00:00Z',
    end_at: '2026-12-15T00:00:00Z',
  },
};
const spring2024 = {
  id: 2,
  name: 'Old Seminar',
  term: {
    id: 10,
    name: 'Spring 2024',
    start_at: '2024-01-10T00:00:00Z',
    end_at: '2024-05-01T00:00:00Z',
  },
};
const justEnded = {
  id: 3,
  name: 'Summer Wrap',
  term: {
    id: 28,
    name: 'Summer 2026',
    start_at: '2026-05-01T00:00:00Z',
    end_at: '2026-08-10T00:00:00Z',
  },
};
const spring2027 = {
  id: 5,
  name: 'Future Seminar',
  term: {
    id: 40,
    name: 'Spring 2027',
    start_at: '2027-01-12T00:00:00Z',
    end_at: '2027-05-01T00:00:00Z',
  },
};
const noTerm = { id: 4, name: 'Mystery Course' };

if (classifyCourseSyncWave(fall2026a, now) !== 'active') throw new Error('Fall 2026 active');
if (classifyCourseSyncWave(justEnded, now) !== 'active') throw new Error('late previous → active');
if (classifyCourseSyncWave(spring2027, now) !== 'upcoming') throw new Error('future → upcoming');
if (classifyCourseSyncWave(spring2024, now) !== 'older') throw new Error('2024 → older');
if (classifyCourseSyncWave(noTerm, now) !== 'active') throw new Error('no-term → active');
if (!isCurrentishCourse(spring2027, now)) throw new Error('upcoming still currentish');

const { active, upcoming, older, ordered } = orderCoursesForMaterialSync(
  [spring2024, spring2027, fall2026b, justEnded, fall2026a, fall2026c, noTerm],
  now,
);

if (active.map((c) => String(c.id)).join(',') !== '1,11,12,3,4') {
  // Fall 2026 trio grouped (A,B,C alpha), then late summer, then no-term
  throw new Error(`active wave wrong: ${active.map((c) => c.id)}`);
}
if (upcoming.map((c) => String(c.id)).join(',') !== '5') {
  throw new Error(`upcoming wave wrong: ${upcoming.map((c) => c.id)}`);
}
if (older.map((c) => String(c.id)).join(',') !== '2') {
  throw new Error(`older wave wrong: ${older.map((c) => c.id)}`);
}
if (ordered[0].id !== 1 || ordered[1].id !== 11 || ordered[2].id !== 12) {
  throw new Error('same-semester courses should stay together at the front');
}
if (ordered[ordered.length - 2].id !== 5 || ordered[ordered.length - 1].id !== 2) {
  throw new Error('upcoming before older at the end');
}

console.log('courseSyncPriority.test.ts PASS');
