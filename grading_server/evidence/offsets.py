"""Unicode code-point offset helpers shared with TypeScript (Array.from / [...str])."""

from __future__ import annotations

OFFSET_ENCODING = "unicode_codepoint"


def codepoint_len(text: str) -> int:
    return len(text)


def slice_codepoints(text: str, start: int, end: int) -> str:
    """Slice by Unicode code-point indices (same as Python str for BMP+supplementary)."""
    if start < 0 or end < start:
        raise ValueError("invalid codepoint range")
    return text[start:end]


def find_span(haystack: str, needle: str) -> tuple[int, int] | None:
    """Return (start, end) code-point offsets of first exact match, or None."""
    if not needle:
        return None
    idx = haystack.find(needle)
    if idx < 0:
        return None
    return idx, idx + len(needle)
