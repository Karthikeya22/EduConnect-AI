"""
models.py
Pydantic models for the RAG grading pipeline.
These define the structured output at each stage.
"""

from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator

RetrievalStatus = Literal["ok", "no_useful_matches", "no_corpus", "infrastructure_error"]


def _coerce_str_list(value: Any) -> list[str]:
    """LLMs often emit a comma-separated string where a JSON array is required."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if "," in text:
            return [part.strip() for part in text.split(",") if part.strip()]
        return [text]
    return [str(value).strip()] if str(value).strip() else []


class CriterionVerdict(BaseModel):
    """Result of grading a single rubric criterion."""

    criterion_id: str
    criterion_name: str = ""
    dimension: Literal["content", "structure"]
    # None = not assessed (processing failure); 0 = genuinely assessed zero.
    # float preserved — never silently truncate fractional points from a frozen policy.
    score: Optional[float]
    max_score: float
    status: Literal["full", "partial", "missing", "not_assessable"]
    failure_kind: Optional[Literal["processing_failed", "reference_unavailable"]] = None
    retrieval_status: Optional[RetrievalStatus] = None
    justification: str = Field(
        ...,
        description="Must cite specific parts of the submission and rubric.",
    )
    credit_awarded_for: str = Field(
        default="",
        description="Faculty-facing: what in the submission earned the awarded points.",
    )
    points_withheld_because: str = Field(
        default="",
        description="Faculty-facing: why full marks were not given when score < max_score.",
    )
    missing_keywords: list[str] = Field(
        default_factory=list,
        description="Concept keywords expected but absent from submission_concepts.",
    )
    evidence_anchor: str = Field(
        ...,
        description='Direct quote from submission or "not found".',
    )
    supporting_materials: list[str] = Field(
        default_factory=list,
        description="Course material titles used to evaluate this criterion.",
    )
    covered_concepts: list[str] = Field(
        default_factory=list,
        description="Concepts from the required concepts list that the student demonstrated.",
    )
    required_concepts: list[str] = Field(
        default_factory=list,
        description="The core concepts required to fully satisfy this criterion.",
    )
    ai_generated: bool = False
    material_alignment: Literal["supports", "neutral", "contradicts"] = "neutral"
    placement_issue: bool = False
    ungrounded_full: bool = False
    # Optional evidence-protocol fields (schema v2+); absent on legacy results.
    criterion_claim: Optional[dict[str, Any]] = None
    submission_evidence_ids: list[str] = Field(default_factory=list)

    @field_validator(
        "missing_keywords",
        "supporting_materials",
        "covered_concepts",
        "required_concepts",
        "submission_evidence_ids",
        mode="before",
    )
    @classmethod
    def _list_fields_from_llm(cls, value: Any) -> list[str]:
        return _coerce_str_list(value)


class CritiqueResult(BaseModel):
    """Quality-check result for a single CriterionVerdict."""

    criterion_id: str
    is_supported: bool = Field(
        ..., description="Is the justification grounded in the evidence anchor?"
    )
    is_justified: bool = Field(
        ..., description="Is the score consistent with the exemplar comparison?"
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Overall confidence in the verdict."
    )
    flag_for_human: bool = Field(
        ..., description="True if confidence < 0.65."
    )
    reasoning: str = ""


class PartialSubtotal(BaseModel):
    """Points from assessed criteria only. Never rescaled to total_max."""

    earned: float
    assessed_max: float
    failed_criteria: list[str]


RESULT_SCHEMA_VERSION = 2


def is_legacy_result(result) -> bool:
    """Stored result written before versioning (or by an older schema): unverified, never complete."""
    if not isinstance(result, dict):
        return False
    v = result.get("result_schema_version")
    return not isinstance(v, int) or isinstance(v, bool) or v < RESULT_SCHEMA_VERSION


class GradingOutput(BaseModel):
    """Final aggregated output returned by the /api/grade endpoint."""

    # Bump when the meaning of status/score/total changes. Results without it are legacy/unverified.
    result_schema_version: int = RESULT_SCHEMA_VERSION
    assignment_id: str
    student_id: str

    # complete: every required criterion assessed. partial: some failed. processing_failed: none assessed.
    assessment_status: Literal["complete", "partial", "processing_failed"] = "complete"

    # Dimension scores; None unless assessment_status == "complete".
    content_score: Optional[float]
    content_max: float
    structure_score: Optional[float]
    structure_max: float
    total: Optional[float]
    total_max: float
    partial_subtotal: Optional[PartialSubtotal] = None

    # Per-criterion breakdown
    criteria_verdicts: list[CriterionVerdict]

    # Radar chart data: criterion title → percentage
    topic_mastery_radar: dict[str, float]

    # Misconception analysis
    misconception_hint: str

    # Flags
    flag_for_human: bool
    overall_confidence: float

    # Critique details
    critiques: list[CritiqueResult]
    
    # Referenced materials from RAG
    referenced_materials: list[str] = []
    
    # RAG Coverage
    rag_coverage_level: Literal["HIGH", "MEDIUM", "LOW", "NONE"] = "NONE"
    strong_match_count: int = 0
    retrieval_status: RetrievalStatus = "ok"
    # Degrade-and-grade: ready | reingesting
    materials_status: Literal["ready", "reingesting"] = "ready"
    rag_degraded: bool = False
    wrong_deliverable: bool = False
    wrong_deliverable_note: str = ""

    # Evidence protocol (v2+). Absent on legacy results — never treat those as newly verified.
    experiment_mode: Literal["baseline", "verification_only", "coverage_recovery"] = "baseline"
    evidence_protocol_version: Optional[int] = None
    evidence: Optional[dict[str, Any]] = None

    # Assessment policy metadata (separate from assessment_status).
    policy_id: Optional[str] = None
    policy_version: Optional[int] = None
    policy_content_hash: Optional[str] = None
    policy_origin: Optional[str] = None
    policy_lifecycle: Optional[str] = None
    policy_provisional: bool = False
    policy_formative_only: bool = False
    policy_label: Optional[str] = None
    assessment_policy: Optional[dict[str, Any]] = None
