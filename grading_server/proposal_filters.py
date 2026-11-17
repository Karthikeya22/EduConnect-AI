"""Shared proposal-scope filters (avoids app ↔ evidence circular imports)."""
from __future__ import annotations

from typing import Any, Iterable


_EMPIRICAL_ML_KEYWORDS = {
    "data pre-processing",
    "data preprocessing",
    "data splitting",
    "train-test split",
    "supervised technique",
    "unsupervised technique",
    "hyperparameter tuning",
    "labeled dataset",
    "feature engineering",
    "model training",
    "cross-validation",
    "running the pipeline",
    "pipeline execution process",
    "pipeline execution",
    "pre-built ml pipeline",
    "pre-built pipeline",
    "model accuracy",
    "coefficients interpretation",
    "observations made during this step",
    "accuracy",
    "coefficients",
}

_EMPIRICAL_FRAGMENTS = (
    "pre-process",
    "preprocess",
    "data split",
    "supervised",
    "unsupervised",
    "hyperparameter",
    "running the pipeline",
    "pipeline execution",
    "pre-built",
    "pipeline output",
    "trained-model",
    "train/test",
    "train-test",
    "model accuracy",
    "coefficients",
    "observations made",
    "confusion matrix",
    "held-out results",
)


def _coerce_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        # One checklist string, not one character per letter.
        if "," in text:
            return [part.strip() for part in text.split(",") if part.strip()]
        return [text]
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for x in value:
            s = str(x).strip() if x is not None else ""
            if s:
                out.append(s)
        return out
    s = str(value).strip()
    return [s] if s else []


def filter_proposal_empirical_checklist(keywords: Iterable[Any] | None, is_proposal: bool) -> list[str]:
    """Drop empirical lab-checklist items when grading a proposal/plan deliverable."""
    items = _coerce_str_list(keywords)
    if not is_proposal or not items:
        return list(items)
    out: list[str] = []
    for kw in items:
        low = str(kw).strip().lower()
        if low in _EMPIRICAL_ML_KEYWORDS:
            continue
        if any(e in low for e in _EMPIRICAL_FRAGMENTS):
            continue
        out.append(kw)
    return out


def finalize_raised_verdict(
    revised: dict[str, Any] | None,
    *,
    prior: dict[str, Any],
    is_proposal: bool = False,
) -> dict[str, Any] | None:
    """Ensure a recovery raise survives output re-guard (status + empirical checklist)."""
    if not isinstance(revised, dict):
        return revised
    max_score = int(revised.get("max_score") or prior.get("max_score") or 0)
    try:
        new_score = int(revised.get("score"))
    except (TypeError, ValueError):
        return revised
    try:
        old_score = int(prior.get("score") or 0)
    except (TypeError, ValueError):
        old_score = 0
    new_score = max(0, new_score)
    if max_score:
        new_score = min(new_score, max_score)

    raised = new_score > old_score or (old_score == 0 and new_score > 0)
    status = str(revised.get("status") or "partial").lower()
    if new_score > 0 and (status == "missing" or status not in ("full", "partial", "missing")):
        status = "full" if max_score and new_score >= max_score else "partial"
    if raised:
        status = "partial" if (not max_score or new_score < max_score) else "full"

    strip_empirical = is_proposal or raised
    out = {
        **revised,
        "score": new_score,
        "status": status,
        "placement_issue": False if raised else bool(revised.get("placement_issue")),
        "placement_ok": True if raised else revised.get("placement_ok", True),
        "missing_keywords": filter_proposal_empirical_checklist(
            revised.get("missing_keywords"), strip_empirical
        ),
        "required_concepts": filter_proposal_empirical_checklist(
            revised.get("required_concepts") or prior.get("required_concepts"),
            strip_empirical,
        ),
    }
    # Alternate valid methods in a plan are not course-material contradictions.
    if is_proposal and raised:
        out["material_alignment"] = "neutral"
    return out
