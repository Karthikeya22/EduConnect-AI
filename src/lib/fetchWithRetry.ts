/**
 * Retry transport / gateway failures and rate limits. Auth and other 4xx are not retried.
 */

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export function isRetryableFetchError(err: unknown, status?: number): boolean {
  if (typeof status === 'number') {
    if (status >= 400 && status < 500 && !RETRYABLE_STATUS.has(status)) return false;
    if (RETRYABLE_STATUS.has(status)) return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|econnreset|etimedout|socket/i.test(
    msg,
  );
}

export type FetchWithRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
};

/** Cap Retry-After so a bad header cannot stall the UI for minutes. */
const MAX_RETRY_AFTER_MS = 30_000;

export function retryDelayMs(res: Response, attempt: number, baseDelayMs: number): number {
  if (res.status === 429) {
    const ra = res.headers.get('Retry-After');
    if (ra) {
      const asSeconds = Number(ra);
      if (Number.isFinite(asSeconds) && asSeconds >= 0) {
        return Math.min(asSeconds * 1000, MAX_RETRY_AFTER_MS);
      }
      const asDate = Date.parse(ra);
      if (!Number.isNaN(asDate)) {
        return Math.min(Math.max(0, asDate - Date.now()), MAX_RETRY_AFTER_MS);
      }
    }
    return Math.min(baseDelayMs * 2 ** (attempt + 1), MAX_RETRY_AFTER_MS);
  }
  return baseDelayMs * (attempt + 1);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: FetchWithRetryOptions,
): Promise<Response> {
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  const signal = opts?.signal ?? init?.signal;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const res = await fetch(input, signal ? { ...init, signal } : init);
      if (!res.ok && RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await sleep(retryDelayMs(res, attempt, baseDelayMs), signal);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (!isRetryableFetchError(err) || attempt >= retries) throw err;
      await sleep(baseDelayMs * (attempt + 1), signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'fetch failed'));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
