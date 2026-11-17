from __future__ import annotations
from typing import Any

from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.types import CriterionClaim, SourceUnit


def run_semantic_check(
    claim: CriterionClaim,
    *,
    requirement: str,
    units: list[SourceUnit],
    adapters: EvidenceAdapters,
    provider: str | None = None,
    api_key: str | None = None,
) -> CriterionClaim:
    by_id = {u.source_unit_id: u for u in units}
    texts = [by_id[i].text for i in claim.submission_evidence_ids if i in by_id and by_id[i].text]
    if not texts and claim.submission_evidence_ids:
        return claim.model_copy(
            update={
                "semantic_label": "insufficient",
                "semantic_justification": "evidence ids present but no text",
                "evidence_check_status": "unsupported_judgment"
                if claim.evidence_check_status == "valid"
                else claim.evidence_check_status,
            }
        )
    adapters.bump_call()
    call_kwargs: dict[str, Any] = {
        "criterion_id": claim.criterion_id,
        "requirement": requirement,
        "judgment": claim.judgment,
        "evidence_texts": texts or [""],
        "evidence_ids": list(claim.submission_evidence_ids),
    }
    try:
        result = adapters.assess_evidence(**call_kwargs, provider=provider, api_key=api_key)
    except TypeError:
        result = adapters.assess_evidence(**call_kwargs)

    label = str(result.get("label") or "unavailable")
    if label not in ("supports", "contradicts", "insufficient", "unavailable"):
        label = "unavailable"
    status = claim.evidence_check_status
    if label in ("insufficient", "unavailable", "contradicts") and status == "valid":
        status = "unsupported_judgment"
    return claim.model_copy(
        update={
            "semantic_label": label,
            "semantic_justification": str(result.get("justification") or "")[:400],
            "evidence_check_status": status,
            "submission_evidence_ids": [
                str(x) for x in (result.get("evidence_ids") or claim.submission_evidence_ids)
            ],
        }
    )
