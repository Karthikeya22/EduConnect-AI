from __future__ import annotations
from typing import Any

from grading_server.evidence.claims import is_omission_based_penalty
from grading_server.evidence.types import CriterionClaim, SourceUnit


def should_trigger_omission_check(verdict: dict[str, Any], claim: CriterionClaim) -> bool:
    if claim.claim_type == "unresolved":
        return False
    return is_omission_based_penalty(verdict)


def processing_blocks_omission(units: list[SourceUnit], claim: CriterionClaim) -> list[str]:
    """Limitations that prevent accepting an omission judgment as finalized.

    Note: artifact_extent_unknown is almost always true for flattened extracts and is
    recorded on the coverage ledger — it must NOT wipe criterion scores by itself.
    """
    reasons: list[str] = []
    if any(u.extraction_status in ("failed", "unavailable") for u in units):
        reasons.append("Extraction incomplete")
    if any(u.presentation == "omitted_budget" for u in units):
        reasons.append("Inspection budget reached")
    if claim.evidence_check_status in ("invalid_id", "foreign_scope", "quote_mismatch"):
        reasons.append("Provenance validation failed")
    return reasons
