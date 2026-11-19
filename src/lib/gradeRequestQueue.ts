/**
 * Serialize grade API calls so continuous "Grade with AI" clicks cannot
 * stack multiple PDF/DOCX parses on the 2GB Render box (OOM → restart → Failed to fetch).
 */

type Job<T> = () => Promise<T>;

let chain: Promise<unknown> = Promise.resolve();
let inflight = 0;

export function gradeQueueDepth(): number {
  return inflight;
}

export function enqueueGradeRequest<T>(job: Job<T>): Promise<T> {
  inflight += 1;
  const run = chain.then(job, job);
  chain = run.then(
    () => {
      inflight = Math.max(0, inflight - 1);
    },
    () => {
      inflight = Math.max(0, inflight - 1);
    },
  );
  return run;
}
