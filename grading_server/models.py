"""
models.py
Pydantic models for the RAG grading pipeline.
These define the structured output at each stage.
"""

from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class CriterionVerdict(BaseModel):
    """Result of grading a single rubric criterion."""

    criterion_id: str
    criterion_name: str = ""
    dimension: Literal["content", "structure"]
    score: int
    max_score: int
    status: Literal["full", "partial", "missing"]
    justification: str = Field(
        ...,
        description="Must cite specific parts of the submission and rubric.",
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


class GradingOutput(BaseModel):
    """Final aggregated output returned by the /api/grade endpoint."""

    assignment_id: str
    student_id: str

    # Dimension scores
    content_score: int
    content_max: int
    structure_score: int
    structure_max: int
    total: int
    total_max: int

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
    rag_coverage_level: Literal["HIGH", "MEDIUM", "LOW"] = "LOW"
    strong_match_count: int = 0
