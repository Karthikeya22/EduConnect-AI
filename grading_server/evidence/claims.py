from __future__ import annotations
from typing import Any

from grading_server.evidence.types import CriterionClaim, ClaimType


_ABSENCE_MARKERS = (
    "not found",
    "no evidence",
    "does not demonstrate",
    "failed to demonstrate",
    "missing",
    "absent",
    "not present",
    "not demonstrated",
    "insufficient",
    "lacks",
)


def _looks_like_omission(verdict: dict[str, Any]) -> bool:
    anchor = str(verdict.get("evidence_anchor") or "").strip().lower()
    status = str(verdict.get("status") or "")
    justification = str(verdict.get("justification") or "").lower()
    missing_kw = verdict.get("missing_keywords") or []
    if anchor in ("", "not found", "n/a", "none"):
        return True
    if status == "missing":
        return True
    if missing_kw and isinstance(missing_kw, list) and len(missing_kw) > 0:
        if any(m in justification for m in _ABSENCE_MARKERS):
            return True
    if any(m in justification for m in ("not demonstrate", "no evidence", "not found", "absent")):
        return True
    return False


def claim_type_from_verdict(verdict: dict[str, Any]) -> ClaimType:
    if verdict.get("score") is None or verdict.get("status") == "not_assessable":
        return "unresolved"
    score = verdict.get("score")
    max_score = int(verdict.get("max_score") or 0)
    status = str(verdict.get("status") or "")
    if status == "missing" or (isinstance(score, int) and score == 0):
        return "assessed_not_demonstrated"
    if status == "full" or (isinstance(score, int) and max_score > 0 and score >= max_score):
        return "demonstrated"
    if status == "partial":
        return "partially_demonstrated"
    return "partially_demonstrated"


def verdict_to_claim(verdict: dict[str, Any], submission_evidence_ids: list[str] | None = None) -> CriterionClaim:
    cid = str(verdict.get("criterion_id") or "")
    return CriterionClaim(
        criterion_id=cid,
        claim_type=claim_type_from_verdict(verdict),
        judgment=str(verdict.get("justification") or "")[:500],
        submission_evidence_ids=list(submission_evidence_ids or []),
        original_score=verdict.get("score") if isinstance(verdict.get("score"), int) or verdict.get("score") is None else None,
        evidence_check_status="unchecked",
    )


def is_omission_based_penalty(verdict: dict[str, Any]) -> bool:
    """True when a score reduction materially relies on absence / insufficient demonstration."""
    if verdict.get("score") is None:
        return False
    max_score = int(verdict.get("max_score") or 0)
    score = verdict.get("score")
    if not isinstance(score, int) or max_score <= 0:
        return False
    if score >= max_score:
        return False
    return _looks_like_omission(verdict)
