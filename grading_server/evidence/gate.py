"""Omission decision gate — before finalizing omission-based score reductions.

Does not equate:
- not retrieved with absent
- keyword absence with conceptual absence
- presented text with proven understanding
- a failed extraction with student failure

Gate rejection does not automatically increase scores.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from grading_server.evidence.omission import processing_blocks_omission, should_trigger_omission_check
from grading_server.evidence.types import (
    CriterionClaim,
    EvidenceObligation,
    GateDecision,
    SourceUnit,
)

GateOutcome = Literal[
    "keep",
    "finalize_omission",
    "recover",
    "defer",
    "keep_supported_zero",
]


@dataclass(frozen=True)
class OmissionGateResult:
    decision: GateDecision
    reasons: list[str]
    blockers: list[str]
    further_inspection_possible: bool


def omission_decision_gate(
    *,
    verdict: dict[str, Any],
    claim: CriterionClaim,
    obligation: EvidenceObligation,
    units: list[SourceUnit],
    mode: str,
    proposal_low_partial: bool = False,
    recovery_available: bool = True,
    budget_remaining: bool = True,
) -> OmissionGateResult:
    """
    Decide whether an alleged omission-based reduction may be finalized.

    Order: identify obligation → provenance/limitations → whether further
    inspection is possible within budget.
    """
    reasons: list[str] = []
    blockers = processing_blocks_omission(units, claim)
    if obligation.ambiguity_notes:
        reasons.extend(obligation.ambiguity_notes)
        # Ambiguity must not become a silent student penalty.
        if obligation.state == "unresolved":
            return OmissionGateResult(
                decision="defer",
                reasons=reasons + ["Obligation ambiguity requires instructor review"],
                blockers=blockers,
                further_inspection_possible=False,
            )

    score = verdict.get("score")
    is_zero = isinstance(score, (int, float)) and float(score) == 0.0
    omission_trigger = should_trigger_omission_check(verdict, claim) or proposal_low_partial

    # Supported zero after complete inspection — keep, do not recover upward automatically.
    if (
        is_zero
        and claim.claim_type == "assessed_not_demonstrated"
        and claim.evidence_check_status not in ("needs_review", "unsupported_judgment")
        and not blockers
        and not obligation.ambiguity_notes
        and "uninspected_source_units_remain" not in obligation.inspection_limitations
    ):
        return OmissionGateResult(
            decision="keep_supported_zero",
            reasons=["Complete inspection supports assessed-not-demonstrated (genuine zero)"],
            blockers=[],
            further_inspection_possible=False,
        )

    if not omission_trigger:
        return OmissionGateResult(
            decision="keep",
            reasons=["Judgment is not an omission-based reduction"],
            blockers=[],
            further_inspection_possible=False,
        )

    # Provenance / extraction limitations
    if blockers:
        reasons.extend(blockers)
        if any("Extraction incomplete" in b for b in blockers):
            return OmissionGateResult(
                decision="defer",
                reasons=reasons
                + ["Failed extraction is not student failure; omission not finalized"],
                blockers=blockers,
                further_inspection_possible=False,
            )
        if any("Provenance" in b for b in blockers):
            return OmissionGateResult(
                decision="defer",
                reasons=reasons + ["Evidence provenance invalid; omission not finalized"],
                blockers=blockers,
                further_inspection_possible=False,
            )

    units_remain = any(u.presentation in ("available", "not_processed") for u in units)
    further = bool(
        recovery_available
        and budget_remaining
        and (
            "uninspected_source_units_remain" in obligation.inspection_limitations
            or units_remain
        )
    )

    if obligation.reference_evidence_needed and not claim.reference_evidence_ids:
        if mode in ("coverage_recovery", "obligation_recovery") and recovery_available and budget_remaining:
            return OmissionGateResult(
                decision="recover",
                reasons=reasons
                + ["Reference evidence required but unavailable; attempt approved-reference recovery"],
                blockers=blockers,
                further_inspection_possible=True,
            )
        return OmissionGateResult(
            decision="defer",
            reasons=reasons + ["Reference evidence required but unavailable"],
            blockers=blockers,
            further_inspection_possible=False,
        )

    if mode == "verification_only":
        # Verify path: do not recover; defer unsupported omission.
        return OmissionGateResult(
            decision="defer",
            reasons=reasons
            + ["verification_only: omission-based reduction not finalized without recovery"],
            blockers=blockers,
            further_inspection_possible=False,
        )

    # Modes C/D: one bounded recovery pass for alleged omissions (keyword≠concept;
    # presented window may still need search). keep_supported_zero already returned above
    # for genuine inspected zeros.
    if mode in ("coverage_recovery", "obligation_recovery") and recovery_available and budget_remaining:
        return OmissionGateResult(
            decision="recover",
            reasons=reasons
            + [
                "Omission alleged; bounded recovery before finalizing "
                "(not-retrieved ≠ absent; keyword miss ≠ concept miss)"
            ],
            blockers=blockers,
            further_inspection_possible=True,
        )

    if is_zero:
        return OmissionGateResult(
            decision="finalize_omission",
            reasons=reasons + ["No further inspection possible; omission may be assessed"],
            blockers=blockers,
            further_inspection_possible=False,
        )

    return OmissionGateResult(
        decision="defer",
        reasons=reasons + ["Unresolved evidence prevents a defensible omission score"],
        blockers=blockers,
        further_inspection_possible=further,
    )
