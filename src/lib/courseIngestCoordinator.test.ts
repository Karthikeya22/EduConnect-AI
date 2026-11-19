import {
  isCourseIngestInFlight,
  joinOrStartCourseIngest,
} from './courseIngestCoordinator';

let resolveRun!: (v: string) => void;
const first = joinOrStartCourseIngest(
  'c1',
  () =>
    new Promise<string>((resolve) => {
      resolveRun = resolve;
    }),
);
if (!isCourseIngestInFlight('c1')) throw new Error('expected in-flight');

let secondStarted = false;
const second = joinOrStartCourseIngest('c1', async () => {
  secondStarted = true;
  return 'nope';
});

resolveRun('done');
if ((await first) !== 'done') throw new Error('first should resolve done');
if ((await second) !== 'done') throw new Error('second should join first');
if (secondStarted) throw new Error('second run must not start while first is in flight');
if (isCourseIngestInFlight('c1')) throw new Error('should clear after settle');

if ((await joinOrStartCourseIngest('c2', async () => 1)) !== 1) throw new Error('c2 first');
if ((await joinOrStartCourseIngest('c2', async () => 2)) !== 2) throw new Error('c2 second');

console.log('courseIngestCoordinator.test.ts PASS');
