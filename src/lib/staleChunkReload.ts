/** Detect Vite/browser failures after a deploy replaced hashed JS chunks. */
export function isStaleChunkError(err: unknown): boolean {
  const msg = String((err as { message?: string } | undefined)?.message ?? err ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i.test(
    msg
  );
}

/** One hard reload per 15s when a deploy invalidated the open tab's chunks. */
export function reloadOnceForStaleChunk(): boolean {
  try {
    const key = 'educonnect_stale_chunk_reload_at';
    const last = Number(sessionStorage.getItem(key) || 0);
    const now = Date.now();
    if (now - last < 15_000) return false;
    sessionStorage.setItem(key, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceForStaleChunk();
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isStaleChunkError(event.reason) && reloadOnceForStaleChunk()) {
      event.preventDefault();
    }
  });
}
