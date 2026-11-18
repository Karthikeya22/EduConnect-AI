"""Extract assessable requirements from authorized assignment text only."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from html import unescape

from grading_server.assessment_policy.validate import flag_unsupported_requirements

_BULLET = re.compile(
    r"^(?:[-*•]|\d+[.)]|[A-Za-z][.)])\s+(.+)$",
    re.M,
)
_POINTS = re.compile(
    r"(?P<body>.+?)(?:\s*[\(\[]?\s*(?P<pts>\d+(?:\.\d+)?)\s*(?:pts?|points?)\s*[\)\]]?\s*)$",
    re.I,
)
_YOU_WILL = re.compile(
    r"(?:you will|students? (?:will|must|should)|your (?:task|paper|report|post|response) (?:must|should)|submit|prepare|create|develop)\s+(.{20,220}?)(?:\.|$)",
    re.I,
)
_INJECTION = re.compile(
    r"(ignore (previous|all) instructions|system prompt|override (grading|policy)|"
    r"you are now|disregard (the )?rubric)",
    re.I,
)
_INSTRUCTIONAL = re.compile(
    r"\b(must|should|include|describe|explain|analyze|compare|discuss|evaluate|"
    r"summarize|define|identify|outline|present|address|cover|demonstrate|"
    r"respond|answer|write|prepare|create|develop|submit)\b",
    re.I,
)
_TAG = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
_BR = re.compile(r"(?i)<br\s*/?>")
_BLOCK = re.compile(r"(?i)</(p|div|li|h[1-6]|tr|section|article)>")
_LI = re.compile(r"(?is)<li[^>]*>(.*?)</li>")
_ALL_TAGS = re.compile(r"(?s)<[^>]+>")


@dataclass
class Requirement:
    requirement_id: str
    text: str
    excerpt: str
    start: int
    end: int
    explicit_points: float | None = None
    unsupported_flags: list[str] = field(default_factory=list)


def _rid(text: str, idx: int) -> str:
    h = hashlib.sha256(f"{idx}:{text}".encode("utf-8")).hexdigest()[:10]
    return f"req_{h}"


def assignment_text_to_plain(text: str) -> str:
    """Normalize Canvas HTML assignment descriptions into plain instructional text.

    Preserves newlines so bullet / numbered-list extractors still work.
    """
    raw = text or ""
    if not raw.strip():
        return ""
    if "<" not in raw:
        # Keep line structure; only collapse horizontal whitespace.
        t = unescape(raw)
        t = re.sub(r"[ \t]+\n", "\n", t)
        t = re.sub(r"[ \t]{2,}", " ", t)
        t = re.sub(r"\n{3,}", "\n\n", t)
        return t.strip()

    t = _TAG.sub(" ", raw)

    def _li_to_bullet(m: re.Match[str]) -> str:
        inner = _ALL_TAGS.sub(" ", m.group(1))
        inner = " ".join(unescape(inner).split()).strip()
        return f"\n- {inner}\n" if inner else "\n"

    t = _LI.sub(_li_to_bullet, t)
    t = _BR.sub("\n", t)
    t = _BLOCK.sub("\n", t)
    t = _ALL_TAGS.sub(" ", t)
    t = unescape(t)
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def extract_requirements(
    assignment_name: str,
    assignment_description: str,
    explicit_outcomes: list[str] | None = None,
) -> tuple[list[Requirement], list[str]]:
    """
    Returns (requirements, diagnostics).
    Strips prompt-injection attempts from becoming policy controls.
    """
    diagnostics: list[str] = []
    raw_desc = assignment_description or ""
    if raw_desc and "<" in raw_desc:
        diagnostics.append("Assignment description HTML was normalized to plain text for requirement extraction.")
    desc = assignment_text_to_plain(raw_desc)
    if _INJECTION.search(desc):
        diagnostics.append(
            "Assignment text contained prompt-injection phrases; those phrases were ignored for policy controls."
        )
        desc = _INJECTION.sub("[redacted-injection]", desc)

    reqs: list[Requirement] = []
    seen: set[str] = set()

    def add(text: str, start: int, end: int) -> None:
        clean = " ".join(text.split()).strip()
        if len(clean) < 12:
            return
        key = clean.lower()
        if key in seen:
            return
        seen.add(key)
        pts = None
        body = clean
        m = _POINTS.search(clean)
        if m:
            body = m.group("body").strip(" -–—:")
            try:
                pts = float(m.group("pts"))
            except ValueError:
                pts = None
        flags = flag_unsupported_requirements(clean)
        reqs.append(
            Requirement(
                requirement_id=_rid(body, len(reqs)),
                text=body,
                excerpt=desc[start:end] if 0 <= start < end <= len(desc) else body,
                start=start,
                end=end,
                explicit_points=pts,
                unsupported_flags=flags,
            )
        )

    for m in _BULLET.finditer(desc):
        add(m.group(1), m.start(1), m.end(1))
    for m in _YOU_WILL.finditer(desc):
        add(m.group(0), m.start(0), m.end(0))
    for outcome in explicit_outcomes or []:
        o = " ".join(str(outcome).split()).strip()
        if o:
            add(o, 0, 0)

    # Title alone is never enough for scored policy.
    if not reqs and assignment_name and len(desc.strip()) >= 40:
        # Treat substantial prose paragraphs / sentences as soft requirements when instructional.
        chunks: list[str] = []
        for para in re.split(r"\n\s*\n", desc):
            p = " ".join(para.split()).strip()
            if p:
                chunks.append(p)
        if not chunks:
            chunks = [desc]
        for chunk in chunks:
            if len(chunk) >= 40 and _INSTRUCTIONAL.search(chunk):
                idx = desc.find(chunk[:40])
                start = idx if idx >= 0 else 0
                add(chunk[:240], start, start + min(len(chunk), 240))
            else:
                for sent in re.split(r"(?<=[.!?])\s+", chunk):
                    s = " ".join(sent.split()).strip()
                    if len(s) >= 40 and _INSTRUCTIONAL.search(s):
                        idx = desc.find(s[:40])
                        start = idx if idx >= 0 else 0
                        add(s[:240], start, start + min(len(s), 240))

    # Single instructional blob: keep one scored requirement when description is usable.
    if not reqs and len(desc.strip()) >= 80 and _INSTRUCTIONAL.search(desc):
        add(desc[:280], 0, min(len(desc), 280))

    return reqs, diagnostics


def context_is_sufficient(reqs: list[Requirement], assignment_description: str) -> bool:
    if len(reqs) >= 2:
        return True
    if len(reqs) == 1 and (reqs[0].explicit_points or len(reqs[0].text) >= 40):
        return True
    # Ambiguous / missing instructions
    return False


def prompt_context_usable(assignment_name: str, assignment_description: str) -> bool:
    """True when there is enough prompt text to anchor a points-based fallback policy."""
    name = (assignment_name or "").strip()
    desc = assignment_text_to_plain(assignment_description or "")
    if len(name) >= 8:
        return True
    if len(desc) >= 40:
        return True
    return False
