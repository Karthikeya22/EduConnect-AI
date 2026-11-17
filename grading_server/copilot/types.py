"""Conversational grading copilot contracts (chat ≠ authoritative memory)."""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

IntentType = Literal[
    "explain_grade",
    "feedback_tone",
    "criterion_interpretation",
    "scoring_policy",
    "submission_exception",
    "save_preference",
    "preview_regrade",
    "inspect_instructions",
    "revoke_instruction",
    "instructor_score_override",
    "unsupported",
    "clarify",
]

ScopeKind = Literal["submission", "assignment", "course", "none"]
Persistence = Literal["ephemeral", "session", "until_revoked", "until_expiry"]
ProposalKind = Literal[
    "save_instruction",
    "run_regrade",
    "save_and_regrade",
    "revoke_instruction",
    "preview_regrade",
    "instructor_override",
]
InstructionType = Literal[
    "feedback_preference",
    "assignment_policy_amendment",
    "submission_exception",
    "course_default",
    "instructor_score_override",
]
Lifecycle = Literal["draft", "active", "superseded", "revoked", "expired"]
ProposalStatus = Literal[
    "pending_confirmation",
    "confirmed",
    "executed",
    "rejected",
    "expired",
    "stale",
    "conflict",
]
JobStatus = Literal["queued", "running", "succeeded", "partial", "failed", "cancelled"]


class AuthorizedScope(BaseModel):
    organization_id: Optional[str] = None
    lms_host: Optional[str] = None
    course_id: str
    assignment_id: str
    submission_id: Optional[str] = None
    student_id: Optional[str] = None


class ConversationMessage(BaseModel):
    message_id: str
    role: Literal["teacher", "assistant", "system"]
    text: str
    created_at: str
    is_partial_transcript: bool = False
    source: Literal["text", "voice_final", "voice_partial", "demo"] = "text"


class ConversationTurn(BaseModel):
    conversation_id: str
    messages: list[ConversationMessage] = Field(default_factory=list)
    scope: AuthorizedScope
    waiting_for: Optional[str] = None  # clarification slot
    pending_proposal_id: Optional[str] = None


class InstructionRecord(BaseModel):
    instruction_id: str
    version: int
    scope: AuthorizedScope
    scope_kind: ScopeKind
    instruction_type: InstructionType
    payload: dict[str, Any] = Field(default_factory=dict)
    originating_request: str
    rationale: Optional[str] = None
    created_by: str
    approved_by: Optional[str] = None
    created_at: str
    approved_at: Optional[str] = None
    expires_at: Optional[str] = None
    lifecycle: Lifecycle = "draft"
    supersedes_id: Optional[str] = None
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = None
    affected_policy_id: Optional[str] = None
    affected_policy_version: Optional[int] = None
    affected_policy_hash: Optional[str] = None


class TargetManifest(BaseModel):
    """Frozen at confirmation — new submissions must not join silently."""

    course_id: str
    assignment_id: str
    submission_ids: list[str] = Field(default_factory=list)
    frozen_at: Optional[str] = None
    frozen: bool = False


class Proposal(BaseModel):
    proposal_id: str
    version: int
    proposal_hash: str
    kind: ProposalKind
    status: ProposalStatus = "pending_confirmation"
    scope: AuthorizedScope
    scope_kind: ScopeKind
    persistence: Persistence = "ephemeral"
    instruction_draft: Optional[InstructionRecord] = None
    previous_policy_id: Optional[str] = None
    previous_policy_version: Optional[int] = None
    previous_policy_hash: Optional[str] = None
    new_policy_draft: Optional[dict[str, Any]] = None
    target_manifest: TargetManifest
    changed_dimensions: list[str] = Field(default_factory=list)
    unchanged_dimensions: list[str] = Field(default_factory=list)
    estimated_work: Optional[dict[str, Any]] = None
    expires_at: str
    created_by: str
    created_at: str
    confirmed_at: Optional[str] = None
    confirmed_by: Optional[str] = None
    conflict_instruction_ids: list[str] = Field(default_factory=list)
    summary: str = ""
    scores_change: bool = False
    feedback_only: bool = False
    requires_second_confirm_for_regrade: bool = False
    budgeted_preview: bool = False


class RegradeJob(BaseModel):
    job_id: str
    proposal_id: str
    proposal_hash: str
    status: JobStatus = "queued"
    target_manifest: TargetManifest
    policy_id: Optional[str] = None
    policy_version: Optional[int] = None
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    results: dict[str, Any] = Field(default_factory=dict)  # submission_id -> draft result
    originals: dict[str, Any] = Field(default_factory=dict)
    errors: dict[str, str] = Field(default_factory=dict)
    idempotency_key: str = ""
    cancelled: bool = False


class TurnRequest(BaseModel):
    conversation_id: Optional[str] = None
    text: str
    course_id: str
    assignment_id: str
    submission_id: Optional[str] = None
    student_id: Optional[str] = None
    scope_kind: ScopeKind = "assignment"
    is_partial_transcript: bool = False
    source: Literal["text", "voice_final", "voice_partial", "demo"] = "text"
    known_submission_ids: list[str] = Field(default_factory=list)
    confirm_proposal_id: Optional[str] = None
    confirm_proposal_hash: Optional[str] = None
    confirm_action: Optional[Literal["save_instruction", "run_regrade", "reject"]] = None


class TurnResponse(BaseModel):
    conversation_id: str
    assistant_text: str
    clarification: Optional[str] = None
    intent: IntentType
    proposal: Optional[Proposal] = None
    instructions: list[InstructionRecord] = Field(default_factory=list)
    job: Optional[RegradeJob] = None
    spoken_summary: Optional[str] = None  # never includes names/grades by default
    status_announcement: str = ""
