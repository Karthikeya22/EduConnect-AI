"""Source-linked assessment policy contracts (assignment-level, not per-submission)."""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

POLICY_GENERATION_PROTOCOL_VERSION = "policy-gen-v1"
DEFAULT_EQUAL_WEIGHT_LABEL = "equal_split_inferred"

RubricLookupStatus = Literal[
    "instructor_rubric_found",
    "rubric_absent",
    "rubric_invalid",
    "rubric_lookup_failed",
    "assignment_context_insufficient",
]

PolicyOrigin = Literal["instructor", "inferred", "approved_template", "formative"]
PolicyLifecycle = Literal["draft", "frozen_provisional", "approved", "superseded"]
CriterionProvenance = Literal[
    "explicit_requirement",
    "inferred_interpretation",
    "template_assumption",
]
WeightingMode = Literal["explicit", "inferred_equal", "template", "none"]


class SourceExcerpt(BaseModel):
    """Excerpt tied to an authorized assignment source; never fabricated locations."""

    requirement_id: str
    excerpt: str
    location: Optional[str] = None  # only when real coords exist; else None/"unavailable"
    source_document_version: Optional[str] = None
    content_hash: Optional[str] = None


class PerformanceDescriptor(BaseModel):
    level: str
    description: str
    min_ratio: float = Field(ge=0.0, le=1.0)


class PolicyCriterion(BaseModel):
    criterion_id: str
    title: str
    description: str
    source_requirement_ids: list[str] = Field(default_factory=list)
    source_excerpts: list[SourceExcerpt] = Field(default_factory=list)
    provenance: CriterionProvenance
    max_points: float
    weight: float = Field(ge=0.0)
    performance_descriptors: list[PerformanceDescriptor] = Field(default_factory=list)
    evidence_policy: Literal["submission_sufficient", "requires_reference"] = "submission_sufficient"
    disclosed_assumptions: list[str] = Field(default_factory=list)
    dimension: Literal["content", "structure"] = "content"


class AssessmentPolicy(BaseModel):
    policy_id: str
    version: int
    content_hash: str
    organization_id: Optional[str] = None
    lms_host: Optional[str] = None
    course_id: str
    assignment_id: str
    origin: PolicyOrigin
    lifecycle: PolicyLifecycle
    assignment_context_hash: str
    assignment_context_version: str
    source_document_versions: list[str] = Field(default_factory=list)
    criteria: list[PolicyCriterion]
    maximum_score: Optional[float] = None
    weighting_mode: WeightingMode = "none"
    weighting_assumptions: list[str] = Field(default_factory=list)
    creation_model: Optional[str] = None
    creation_config: dict[str, Any] = Field(default_factory=dict)
    generation_protocol_version: str = POLICY_GENERATION_PROTOCOL_VERSION
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    created_at: Optional[str] = None
    approved_at: Optional[str] = None
    formative_only: bool = False
    diagnostic: Optional[str] = None
    disclosed_assumptions: list[str] = Field(default_factory=list)

    def to_rubric_rows(self) -> list[dict[str, Any]]:
        """Map frozen policy criteria into the existing rubric_criteria shape."""
        rows: list[dict[str, Any]] = []
        for c in self.criteria:
            rows.append(
                {
                    "criterion_id": c.criterion_id,
                    "assignment_id": self.assignment_id,
                    "course_id": self.course_id,
                    "title": c.title,
                    "description": c.description,
                    "max_score": c.max_points,
                    "dimension": c.dimension,
                    "evidence_policy": c.evidence_policy,
                    "ai_generated": False,
                    "policy_origin": self.origin,
                    "policy_criterion_provenance": c.provenance,
                    "disclosed_assumptions": list(c.disclosed_assumptions),
                }
            )
        return rows

    def result_metadata(self) -> dict[str, Any]:
        """Attach to grading results; separate from assessment_status."""
        provisional = self.lifecycle == "frozen_provisional" and self.origin in (
            "inferred",
            "approved_template",
        )
        return {
            "assessment_policy": self.model_dump(),
            "policy_id": self.policy_id,
            "policy_version": self.version,
            "policy_content_hash": self.content_hash,
            "policy_origin": self.origin,
            "policy_lifecycle": self.lifecycle,
            "policy_formative_only": self.formative_only,
            "policy_provisional": provisional,
            "policy_label": (
                "Instructor rubric"
                if self.origin == "instructor"
                else (
                    "Formative only — insufficient assignment policy"
                    if self.formative_only
                    else (
                        "Provisional — inferred assessment policy"
                        if provisional
                        else (
                            "Approved assessment policy"
                            if self.lifecycle == "approved"
                            else f"Assessment policy ({self.origin})"
                        )
                    )
                )
            ),
        }


class RubricLookupResult(BaseModel):
    status: RubricLookupStatus
    criteria: list[dict[str, Any]] = Field(default_factory=list)
    diagnostic: Optional[str] = None
    validation_errors: list[str] = Field(default_factory=list)


class PolicyResolution(BaseModel):
    """Outcome of resolve_assessment_policy before grading a submission."""

    lookup: RubricLookupResult
    policy: Optional[AssessmentPolicy] = None
    rubric_criteria: list[dict[str, Any]] = Field(default_factory=list)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    require_instructor_decision: bool = False
