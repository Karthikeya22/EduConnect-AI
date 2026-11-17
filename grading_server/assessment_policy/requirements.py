"""Extract assessable requirements from authorized assignment text only."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

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
    r"(?:you will|students? (?:will|must|should)|your (?:task|paper|report) (?:must|should)|submit)\s+(.{20,220}?)(?:\.|$)",
    re.I,
)
_INJECTION = re.compile(
    r"(ignore (previous|all) instructions|system prompt|override (grading|policy)|"
    r"you are now|disregard (the )?rubric)",
    re.I,
)


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
    desc = assignment_description or ""
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
                excerpt=desc[start:end] if start < end else body,
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
    if not reqs and assignment_name and len(desc.strip()) >= 80:
        # Treat substantial prose paragraphs as soft requirements only when clearly instructional.
        for para in re.split(r"\n\s*\n", desc):
            p = " ".join(para.split()).strip()
            if len(p) >= 40 and re.search(r"\b(must|should|include|describe|explain|analyze|compare)\b", p, re.I):
                add(p, desc.find(para), desc.find(para) + len(para))

    return reqs, diagnostics


def context_is_sufficient(reqs: list[Requirement], assignment_description: str) -> bool:
    if len(reqs) >= 2:
        return True
    if len(reqs) == 1 and (reqs[0].explicit_points or len(reqs[0].text) >= 40):
        return True
    # Ambiguous / missing instructions
    return False
