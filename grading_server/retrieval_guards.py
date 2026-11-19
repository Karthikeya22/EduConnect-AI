"""Hard guards for retrieval/grade paths. Keep empty-corpus states from looking "ok"."""

from __future__ import annotations

_OK = "ok"
_NO_CORPUS = "no_corpus"


def coerce_retrieval(
    chunks: list | None,
    status: str,
) -> tuple[list, str]:
    """Invariant: status == "ok" only when chunks is non-empty."""
    rows = list(chunks or [])
    if status == _OK and not rows:
        return [], _NO_CORPUS
    if status != _OK:
        return rows, status or _NO_CORPUS
    return rows, _OK


def top_chunk_similarity(chunks: list | None) -> float:
    """Empty-safe max similarity — never raises on []."""
    rows = chunks or []
    if not rows:
        return 0.0
    return max(float(c.get("similarity") or 0) for c in rows)
