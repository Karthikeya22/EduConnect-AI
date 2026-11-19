import { fetchWithRetry, isRetryableFetchError, retryDelayMs } from './fetchWithRetry';

if (!isRetryableFetchError(new TypeError('Failed to fetch'))) {
  throw new Error('expected Failed to fetch to be retryable');
}
if (!isRetryableFetchError(new Error('x'), 502)) throw new Error('502 should retry');
if (!isRetryableFetchError(new Error('x'), 503)) throw new Error('503 should retry');
if (!isRetryableFetchError(new Error('x'), 429)) throw new Error('429 should retry');
if (isRetryableFetchError(new Error('auth'), 401)) throw new Error('401 must not retry');
if (isRetryableFetchError(new Error('auth'), 403)) throw new Error('403 must not retry');

{
  const res = new Response('', {
    status: 429,
    headers: { 'Retry-After': '2' },
  });
  const delay = retryDelayMs(res, 0, 400);
  if (delay !== 2000) throw new Error(`expected Retry-After 2s => 2000ms, got ${delay}`);
}

{
  const res = new Response('', { status: 502 });
  const delay = retryDelayMs(res, 1, 400);
  if (delay !== 800) throw new Error(`expected 502 delay 800, got ${delay}`);
}

const originalFetch = globalThis.fetch;
let calls = 0;
(globalThis as any).fetch = async () => {
  calls += 1;
  if (calls === 1) throw new TypeError('Failed to fetch');
  return new Response('ok', { status: 200 });
};
try {
  const res = await fetchWithRetry('/x', undefined, { retries: 2, baseDelayMs: 1 });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  if (calls !== 2) throw new Error(`expected 2 fetch attempts, got ${calls}`);
} finally {
  globalThis.fetch = originalFetch;
}

calls = 0;
(globalThis as any).fetch = async () => {
  calls += 1;
  if (calls === 1) {
    return new Response('slow down', {
      status: 429,
      headers: { 'Retry-After': '0' },
    });
  }
  return new Response('ok', { status: 200 });
};
try {
  const res = await fetchWithRetry('/rate', undefined, { retries: 2, baseDelayMs: 1 });
  if (res.status !== 200) throw new Error(`expected 200 after 429, got ${res.status}`);
  if (calls !== 2) throw new Error(`expected 2 attempts on 429, got ${calls}`);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('fetchWithRetry.test.ts PASS');
