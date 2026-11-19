import { enqueueGradeRequest, gradeQueueDepth } from './gradeRequestQueue';

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

{
  const order: number[] = [];
  const p1 = enqueueGradeRequest(async () => {
    order.push(1);
    await sleep(30);
    order.push(2);
    return 'a';
  });
  const p2 = enqueueGradeRequest(async () => {
    order.push(3);
    return 'b';
  });
  const [a, b] = await Promise.all([p1, p2]);
  if (a !== 'a' || b !== 'b') throw new Error('bad results');
  if (order.join(',') !== '1,2,3') throw new Error(`expected serial order, got ${order}`);
  if (gradeQueueDepth() !== 0) throw new Error(`expected empty queue, got ${gradeQueueDepth()}`);
}

console.log('gradeRequestQueue.test.ts PASS');
