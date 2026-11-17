"""Build evidence obligations from approved criteria — never from student answers."""

from __future__ import annotations

from typing import Any

from grading_server.evidence.types import (
    ClaimType,
    CriterionClaim,
    EvidenceObligation,
    ObligationState,
    SourceUnit,
)

# Non-equations (operational reminders; asserted in tests):
# - not retrieved ≠ absent
# - keyword absence ≠ conceptual absence
# - presented text ≠ proven understanding
# - failed extraction ≠ student failure


def _requirement_ids_from_rubric(criterion: dict[str, Any], criterion_id: str) -> list[str]:
    raw = criterion.get("source_requirement_ids") or criterion.get("requirement_ids")
    if isinstance(raw, list) and raw:
        return [str(x) for x in raw if str(x).strip()]
    pol = criterion.get("policy_criterion_provenance")
    # Single stable id from approved criterion — not invented from submission.
    rid = str(criterion.get("requirement_id") or criterion_id or "").strip()
    return [rid] if rid else []


def _approved_requirement_text(criterion: dict[str, Any]) -> str:
    for key in ("description", "long_description", "text", "title"):
        val = criterion.get(key)
        if val and str(val).strip():
            return str(val).strip()[:800]
    return ""


def _requirement_text(criterion: dict[str, Any], verdict: dict[str, Any]) -> str:
    approved = _approved_requirement_text(criterion)
    if approved:
        return approved
    name = verdict.get("criterion_name") or verdict.get("criterion_id") or ""
    return str(name).strip()[:800]


def _extraction_limitations(units: list[SourceUnit]) -> list[str]:
    notes: list[str] = []
    for u in units:
        if u.extraction_status in ("failed", "unavailable", "partial"):
            notes.extend(u.extraction_limitations or [f"extraction_{u.extraction_status}"])
        if u.presentation == "omitted_budget":
            notes.append("inspection_budget_omitted_units")
    return list(dict.fromkeys(notes))


def claim_type_to_obligation_state(claim_type: ClaimType, *, semantic_label: str | None = None) -> ObligationState:
    if claim_type == "unresolved":
        return "unresolved"
    if claim_type == "contradicted" or semantic_label == "contradicts":
        return "contradicted"
    if claim_type == "demonstrated":
        return "supported"
    if claim_type == "partially_demonstrated":
        # Partial credit is supported evidence of some kind — not inspected-not-demonstrated.
        return "supported"
    if claim_type == "assessed_not_demonstrated":
        return "inspected_not_demonstrated"
    return "unresolved"


def build_obligation(
    *,
    verdict: dict[str, Any],
    claim: CriterionClaim,
    rubric_row: dict[str, Any] | None,
    units: list[SourceUnit],
) -> EvidenceObligation:
    """
    Operational interpretation of an approved criterion.

    Never derives grading expectations from the student's answer text.
    Ambiguity is recorded — not turned into a silent student penalty.
    """
    cid = str(verdict.get("criterion_id") or claim.criterion_id or "")
    row = rubric_row or {}
    req_ids = _requirement_ids_from_rubric(row, cid)
    approved_text = _approved_requirement_text(row)
    req_text = _requirement_text(row, verdict)
    ambiguity: list[str] = []
    # Only when an approved rubric row was supplied but lacks text — missing row
    # is ordinary baseline grading without rubric metadata, not an ambiguity defer.
    if rubric_row is not None and not approved_text:
        ambiguity.append(
            "Approved criterion text was empty or unavailable; obligation interpretation is ambiguous."
        )
    if not req_ids:
        ambiguity.append("No explicit requirement_id on the approved criterion; using criterion_id as scope key.")
        req_ids = [cid] if cid else []

    ref_needed = str(row.get("evidence_policy") or "").lower() == "requires_reference"
    # Supporting / contradictory IDs come from verified claim evidence only — not from inventing requirements.
    supporting = list(claim.submission_evidence_ids or [])
    contradictory: list[str] = []
    if claim.semantic_label == "contradicts":
        contradictory = list(claim.submission_evidence_ids or [])

    state = claim_type_to_obligation_state(claim.claim_type, semantic_label=claim.semantic_label)
    if ambiguity and state == "inspected_not_demonstrated":
        # Do not silently finalize an omission when the obligation itself is ambiguous.
        state = "unresolved"
        ambiguity.append(
            "Ambiguous obligation blocked silent omission penalty; routed as unresolved."
        )

    inspection_lims: list[str] = list(claim.processing_limitations or [])
    if any(u.presentation == "not_processed" for u in units):
        inspection_lims.append("uninspected_source_units_remain")
        # Not-retrieved ≠ absent — record limitation, do not invent demonstration.
        if state == "inspected_not_demonstrated" and not supporting:
            ambiguity.append(
                "Some source units were not processed; absence was not fully inspected."
            )

    return EvidenceObligation(
        criterion_id=cid,
        requirement_ids=req_ids,
        requirement_text=req_text,
        submission_evidence_needed=True,
        reference_evidence_needed=ref_needed,
        available_supporting_ids=supporting,
        available_contradictory_ids=contradictory,
        extraction_limitations=_extraction_limitations(units),
        inspection_limitations=list(dict.fromkeys(inspection_lims)),
        ambiguity_notes=ambiguity,
        state=state,
    )


def attach_obligation_to_claim(claim: CriterionClaim, obligation: EvidenceObligation) -> CriterionClaim:
    rid = obligation.requirement_ids[0] if obligation.requirement_ids else None
    return claim.model_copy(
        update={
            "obligation": obligation,
            "obligation_state": obligation.state,
            "requirement_id": claim.requirement_id or rid,
        }
    )
