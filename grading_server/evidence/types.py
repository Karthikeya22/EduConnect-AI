"""Typed evidence contracts (result_json / schema v2)."""

from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

from grading_server.evidence.offsets import OFFSET_ENCODING

ExperimentMode = Literal[
    "baseline",
    "verification_only",
    "coverage_recovery",
    "obligation_recovery",
]
ExtractionStatus = Literal["ok", "failed", "partial", "unavailable"]
UnitPresentation = Literal[
    "available",
    "extraction_failed",
    "not_processed",
    "presented",
    "omitted_budget",
]
ArtifactExtent = Literal["known", "unknown"]
ClaimType = Literal[
    "demonstrated",
    "partially_demonstrated",
    "contradicted",
    "assessed_not_demonstrated",
    "unresolved",
]
EvidenceCheckStatus = Literal[
    "unchecked",
    "valid",
    "invalid_id",
    "foreign_scope",
    "quote_mismatch",
    "unsupported_judgment",
    "needs_review",
    "skipped_baseline",
]
SemanticLabel = Literal["supports", "contradicts", "insufficient", "unavailable"]

# Operational interpretation of an approved criterion — not new point allocations.
ObligationState = Literal[
    "supported",
    "contradicted",
    "inspected_not_demonstrated",
    "unresolved",
]
RecoveryAction = Literal[
    "inspect_passages",
    "include_neighbors",
    "inspect_remaining_units",
    "retry_extraction",
    "retrieve_approved_references",
    "defer_instructor_review",
]
GateDecision = Literal[
    "keep",
    "finalize_omission",
    "recover",
    "defer",
    "keep_supported_zero",
]

EVIDENCE_PROTOCOL_VERSION = 1
OBLIGATION_CONTROLLER_VERSION = "obligation-ctrl-v1"


class SourceLocation(BaseModel):
    offset_encoding: str = OFFSET_ENCODING
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    page: Optional[int] = None
    block_id: Optional[str] = None
    bbox: Optional[list[float]] = None
    original_document_location: Literal["available", "unavailable"] = "unavailable"


class SourceUnit(BaseModel):
    source_unit_id: str
    artifact_id: str
    submission_version: str
    extraction_version: str
    content_hash: str
    source_location: SourceLocation
    text: str
    extraction_status: ExtractionStatus = "ok"
    extraction_limitations: list[str] = Field(default_factory=list)
    presentation: UnitPresentation = "available"


class CoverageSummary(BaseModel):
    artifact_extent: ArtifactExtent = "unknown"
    known_unit_count: int = 0
    presented_unit_count: int = 0
    extraction_failed_count: int = 0
    not_processed_count: int = 0
    omitted_budget_count: int = 0
    denominator_note: str = (
        "Counts are unique known source units from extraction, not original-document completeness."
    )


class BudgetSnapshot(BaseModel):
    inspected: int = 0
    calls: int = 0
    rounds: int = 0


class RecoveryAttempt(BaseModel):
    round: int
    status: Literal["ok", "timeout", "budget_exhausted", "failed", "no_candidates"]
    inspected_unit_ids: list[str] = Field(default_factory=list)
    recovered_evidence_ids: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    duration_ms: Optional[int] = None
    tokens: Optional[int] = None
    # Obligation-controller extensions (optional for legacy attempts).
    action: Optional[RecoveryAction] = None
    reason: Optional[str] = None
    obligation_state_before: Optional[ObligationState] = None
    obligation_state_after: Optional[ObligationState] = None
    budget_before: Optional[BudgetSnapshot] = None
    budget_after: Optional[BudgetSnapshot] = None
    judgment_changed: bool = False
    stop_reason: Optional[str] = None


class EvidenceObligation(BaseModel):
    """Operational interpretation of an approved rubric criterion (not new points)."""

    criterion_id: str
    requirement_ids: list[str] = Field(default_factory=list)
    requirement_text: str = ""
    submission_evidence_needed: bool = True
    reference_evidence_needed: bool = False
    available_supporting_ids: list[str] = Field(default_factory=list)
    available_contradictory_ids: list[str] = Field(default_factory=list)
    extraction_limitations: list[str] = Field(default_factory=list)
    inspection_limitations: list[str] = Field(default_factory=list)
    ambiguity_notes: list[str] = Field(default_factory=list)
    state: ObligationState = "unresolved"


class CriterionClaim(BaseModel):
    criterion_id: str
    requirement_id: Optional[str] = None
    claim_type: ClaimType
    judgment: str = ""
    submission_evidence_ids: list[str] = Field(default_factory=list)
    reference_evidence_ids: list[str] = Field(default_factory=list)
    evidence_check_status: EvidenceCheckStatus = "unchecked"
    processing_limitations: list[str] = Field(default_factory=list)
    recovery_attempts: list[RecoveryAttempt] = Field(default_factory=list)
    review_reasons: list[str] = Field(default_factory=list)
    semantic_label: Optional[SemanticLabel] = None
    semantic_justification: Optional[str] = None
    original_score: Optional[float] = None
    revised_score: Optional[float] = None
    change_reason: Optional[str] = None
    # Obligation-driven fields (optional on legacy claims).
    obligation: Optional[EvidenceObligation] = None
    obligation_state: Optional[ObligationState] = None
    gate_decision: Optional[GateDecision] = None


class EvidenceLock(BaseModel):
    """Pinned after evidence_verify so post-verify guards cannot silently mutate omission claims."""

    score: Optional[float] = None
    evidence_anchor: str = ""
    claim_type: ClaimType
    content_hash: str
    evidence_verified: bool = True


class EvidenceBlock(BaseModel):
    evidence_protocol_version: int = EVIDENCE_PROTOCOL_VERSION
    experiment_mode: ExperimentMode = "baseline"
    recovery_budget_version: str = "recovery_budget_v1"
    obligation_controller_version: Optional[str] = None
    source_units: list[SourceUnit] = Field(default_factory=list)
    coverage: CoverageSummary = Field(default_factory=CoverageSummary)
    claims: list[CriterionClaim] = Field(default_factory=list)
    obligations: list[EvidenceObligation] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)

    def to_public_dict(self) -> dict[str, Any]:
        return self.model_dump()
