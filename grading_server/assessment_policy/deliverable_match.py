"""Pre-grade wrong-deliverable / alternative-assignment detection."""

from __future__ import annotations

from dataclasses import dataclass


_ALT_PHRASES = (
    "alternative assignment",
    "alternate assignment",
    "this is about making good choices up front",
    "not running code",
    "not run the pipeline",
    "do not run the pipeline",
    "optional alternative",
    "instead of running",
    "conceptual outline only",
)

_MAIN_ONLY_TITLE_HINTS = (
    "running the pipeline",
    "pipeline execution",
    "model evaluation",
    "result interpretation",
    "drawing insights",
    "dataset and sna",
    "network structure",
    "visualization & interpretation",
    "visualization and interpretation",
    "tool utilization",
)


@dataclass(frozen=True)
class DeliverableMatchResult:
    wrong_deliverable: bool
    reason: str
    teacher_note: str


def detect_wrong_deliverable(
    *,
    submission_text: str,
    filenames: list[str] | None = None,
    assignment_name: str = "",
    assignment_description: str = "",
    is_proposal: bool = False,
) -> DeliverableMatchResult:
    """Return whether the submission appears to be an alternate deliverable for a main rubric."""
    names = " ".join(filenames or []).lower()
    body = (submission_text or "")[:16000].lower()
    ctx = f"{assignment_name}\n{assignment_description}".lower()[:4000]
    blob = f"{names}\n{body}\n{ctx}"

    alt_hits = sum(1 for p in _ALT_PHRASES if p in blob)
    filename_alt = any("alternative" in (f or "").lower() or "alternate" in (f or "").lower() for f in (filenames or []))

    # Main assignment text that mentions an alternative option + student chose it.
    assignment_offers_alt = "alternative" in ctx or "optional" in ctx
    student_chose_alt = alt_hits >= 1 or filename_alt

    wrong = False
    reason = ""
    if filename_alt and ("pipeline" in ctx or "running the" in ctx or "model evaluation" in ctx):
        wrong = True
        reason = "filename_alternative"
    elif alt_hits >= 2 or (alt_hits >= 1 and "not running code" in body):
        wrong = True
        reason = "body_alternative_cues"
    elif is_proposal and assignment_offers_alt and student_chose_alt:
        wrong = True
        reason = "proposal_style_alternative"
    elif filename_alt and alt_hits >= 1:
        wrong = True
        reason = "filename_and_body_alternative"

    note = ""
    if wrong:
        note = (
            "Submission appears to be an alternative/wrong deliverable for this assignment's "
            "main rubric. Main deliverable criteria were zeroed or marked not assessable."
        )
    return DeliverableMatchResult(wrong_deliverable=wrong, reason=reason, teacher_note=note)


def is_main_only_criterion(title: str, description: str = "") -> bool:
    blob = f"{title or ''}\n{description or ''}".lower()
    return any(h in blob for h in _MAIN_ONLY_TITLE_HINTS)


def apply_wrong_deliverable_to_verdicts(
    verdicts: list[dict],
    *,
    wrong: bool,
) -> list[dict]:
    """Zero / not_assess main-only instructor criteria when wrong deliverable is detected."""
    if not wrong:
        return verdicts
    out: list[dict] = []
    for v in verdicts:
        row = dict(v)
        if row.get("ai_generated"):
            out.append(row)
            continue
        title = str(row.get("criterion_name") or row.get("title") or "")
        desc = str(row.get("criterion_desc") or row.get("description") or "")
        if is_main_only_criterion(title, desc):
            max_score = float(row.get("max_score") or 0)
            row["score"] = 0.0
            row["status"] = "missing"
            row["wrong_deliverable"] = True
            just = str(row.get("justification") or "")
            prefix = "Wrong deliverable for this criterion (alternative/off-rubric submission). "
            if prefix not in just:
                row["justification"] = prefix + just
            row["max_score"] = max_score
        out.append(row)
    return out
