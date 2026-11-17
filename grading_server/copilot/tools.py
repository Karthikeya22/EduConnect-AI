"""Narrow, server-validated tools. Models may propose args; this module enforces authz."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from grading_server.copilot import store
from grading_server.copilot.types import (
    AuthorizedScope,
    InstructionRecord,
    InstructionType,
    Persistence,
    Proposal,
    ProposalKind,
    RegradeJob,
    ScopeKind,
    TargetManifest,
)


class ToolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _assert_same_course(scope: AuthorizedScope, course_id: str) -> None:
    if scope.course_id != course_id:
        raise ToolError("CROSS_COURSE_DENIED", "Instructions cannot span courses.")


def read_current_policy(
    *,
    policy_lookup: Callable[..., Any] | None,
    course_id: str,
    assignment_id: str,
) -> dict[str, Any] | None:
    if policy_lookup is None:
        return None
    pol = policy_lookup(course_id=course_id, assignment_id=assignment_id)
    if pol is None:
        return None
    if hasattr(pol, "model_dump"):
        return pol.model_dump()
    return dict(pol)


def inspect_submission_context(
    *,
    scope: AuthorizedScope,
    known_submission_ids: list[str],
) -> dict[str, Any]:
    _assert_same_course(scope, scope.course_id)
    sid = scope.submission_id
    if sid and known_submission_ids and sid not in known_submission_ids:
        raise ToolError(
            "UNKNOWN_SUBMISSION",
            "Submission is not in the authorized roster for this assignment.",
        )
    return {
        "course_id": scope.course_id,
        "assignment_id": scope.assignment_id,
        "submission_id": sid,
        "student_id": scope.student_id,
        "authorized": True,
    }


def find_conflicts(
    *,
    course_id: str,
    assignment_id: str,
    instruction_type: InstructionType,
    scope_kind: ScopeKind,
    submission_id: str | None,
    payload: dict[str, Any],
) -> list[InstructionRecord]:
    active = store.list_active_instructions(course_id=course_id, assignment_id=assignment_id)
    conflicts: list[InstructionRecord] = []
    for inst in active:
        if inst.instruction_type != instruction_type:
            continue
        if inst.scope_kind != scope_kind:
            # assignment vs submission conflict on same criterion key
            if {inst.scope_kind, scope_kind} == {"assignment", "submission"}:
                if payload.get("criterion_id") and payload.get("criterion_id") == inst.payload.get("criterion_id"):
                    conflicts.append(inst)
            continue
        if scope_kind == "submission" and inst.scope.submission_id != submission_id:
            continue
        if payload.get("criterion_id") and inst.payload.get("criterion_id") == payload.get("criterion_id"):
            conflicts.append(inst)
        elif instruction_type == "feedback_preference" and payload.get("tone") and inst.payload.get("tone"):
            if payload.get("tone") != inst.payload.get("tone"):
                conflicts.append(inst)
    return conflicts


def create_proposal(
    *,
    kind: ProposalKind,
    scope: AuthorizedScope,
    scope_kind: ScopeKind,
    created_by: str,
    summary: str,
    persistence: Persistence = "ephemeral",
    instruction_draft: InstructionRecord | None = None,
    previous_policy: dict[str, Any] | None = None,
    new_policy_draft: dict[str, Any] | None = None,
    known_submission_ids: list[str] | None = None,
    changed_dimensions: list[str] | None = None,
    unchanged_dimensions: list[str] | None = None,
    scores_change: bool = False,
    feedback_only: bool = False,
    conflict_ids: list[str] | None = None,
    budgeted_preview: bool = False,
    estimated_work: dict[str, Any] | None = None,
) -> Proposal:
    _assert_same_course(scope, scope.course_id)
    ids = list(known_submission_ids or [])
    if scope_kind == "submission":
        if not scope.submission_id:
            raise ToolError("SUBMISSION_REQUIRED", "Submission scope requires a submission_id.")
        if ids and scope.submission_id not in ids:
            raise ToolError("UNKNOWN_SUBMISSION", "Target submission is not authorized.")
        ids = [scope.submission_id]
    elif scope_kind == "course":
        raise ToolError(
            "COURSE_SCOPE_EXPLICIT_REQUIRED",
            "Course defaults are only accepted through an explicit confirmed course-default proposal.",
        )
    elif scope_kind == "assignment":
        # Freeze whatever roster was presented at proposal time.
        ids = list(ids)

    manifest = TargetManifest(
        course_id=scope.course_id,
        assignment_id=scope.assignment_id,
        submission_ids=ids,
        frozen=False,
    )
    body = {
        "kind": kind,
        "scope": scope.model_dump(),
        "scope_kind": scope_kind,
        "persistence": persistence,
        "instruction": instruction_draft.model_dump() if instruction_draft else None,
        "previous_policy_id": (previous_policy or {}).get("policy_id"),
        "previous_policy_version": (previous_policy or {}).get("version"),
        "previous_policy_hash": (previous_policy or {}).get("content_hash"),
        "new_policy_draft": new_policy_draft,
        "targets": ids,
        "changed_dimensions": changed_dimensions or [],
        "scores_change": scores_change,
        "feedback_only": feedback_only,
    }
    pid = store.new_id("prop")
    proposal = Proposal(
        proposal_id=pid,
        version=1,
        proposal_hash=store.stable_hash(body),
        kind=kind,
        status="conflict" if conflict_ids else "pending_confirmation",
        scope=scope,
        scope_kind=scope_kind,
        persistence=persistence,
        instruction_draft=instruction_draft,
        previous_policy_id=(previous_policy or {}).get("policy_id"),
        previous_policy_version=(previous_policy or {}).get("version"),
        previous_policy_hash=(previous_policy or {}).get("content_hash"),
        new_policy_draft=new_policy_draft,
        target_manifest=manifest,
        changed_dimensions=changed_dimensions or [],
        unchanged_dimensions=unchanged_dimensions or (["scores"] if feedback_only else []),
        estimated_work=estimated_work,
        expires_at=store.proposal_expiry_default(),
        created_by=created_by,
        created_at=store.utc_now(),
        conflict_instruction_ids=conflict_ids or [],
        summary=summary,
        scores_change=scores_change,
        feedback_only=feedback_only,
        requires_second_confirm_for_regrade=kind == "save_instruction" and scores_change,
        budgeted_preview=budgeted_preview,
    )
    return store.save_proposal(proposal)


def resolve_policy_conflict(*, keep_id: str, revoke_id: str, actor: str) -> InstructionRecord:
    if keep_id == revoke_id:
        raise ToolError("INVALID_CONFLICT_RESOLUTION", "Keep and revoke ids must differ.")
    return store.revoke_instruction(revoke_id, revoked_by=actor)


def _proposal_fresh(p: Proposal, *, expected_hash: str, current_policy_hash: str | None) -> None:
    if p.conflict_instruction_ids or p.status == "conflict":
        raise ToolError("CONFLICT_UNRESOLVED", "Resolve conflicting instructions before confirming.")
    if p.status not in ("pending_confirmation", "confirmed"):
        raise ToolError("PROPOSAL_NOT_CONFIRMABLE", f"Proposal status is {p.status}.")
    try:
        exp = datetime.fromisoformat(p.expires_at.replace("Z", "+00:00"))
        if exp < datetime.now(timezone.utc):
            store.mark_proposal(p.proposal_id, status="expired")
            raise ToolError("PROPOSAL_EXPIRED", "Proposal expired; create a new one.")
    except ValueError:
        pass
    if expected_hash and expected_hash != p.proposal_hash:
        store.mark_proposal(p.proposal_id, status="stale")
        raise ToolError("PROPOSAL_HASH_MISMATCH", "Stale or modified proposal; renew confirmation.")
    if p.previous_policy_hash and current_policy_hash and p.previous_policy_hash != current_policy_hash:
        store.mark_proposal(p.proposal_id, status="stale")
        raise ToolError(
            "POLICY_CHANGED",
            "Assessment policy changed during confirmation; proposal is stale.",
        )


def confirm_proposal(
    *,
    proposal_id: str,
    proposal_hash: str,
    actor: str,
    action: str,
    current_policy_hash: str | None = None,
    policy_save: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    p = store.get_proposal(proposal_id)
    if p is None:
        raise ToolError("PROPOSAL_NOT_FOUND", "Proposal not found.")
    _assert_same_course(p.scope, p.scope.course_id)
    _proposal_fresh(p, expected_hash=proposal_hash, current_policy_hash=current_policy_hash)

    if action == "reject":
        store.mark_proposal(proposal_id, status="rejected")
        return {"proposal": store.get_proposal(proposal_id), "instruction": None, "job": None}

    # Freeze target manifest at confirmation.
    frozen = p.target_manifest.model_copy(
        update={"frozen": True, "frozen_at": store.utc_now()}
    )
    # Reject expansion attempts: re-read and ensure ids unchanged
    if frozen.submission_ids != p.target_manifest.submission_ids:
        raise ToolError("MANIFEST_TAMPER", "Target manifest cannot expand after creation.")

    if action == "save_instruction":
        if p.kind not in ("save_instruction", "save_and_regrade", "instructor_override", "revoke_instruction"):
            raise ToolError("WRONG_ACTION", "This proposal is not a save-instruction proposal.")
        inst = None
        if p.kind == "revoke_instruction" and p.instruction_draft:
            inst = store.revoke_instruction(p.instruction_draft.instruction_id, revoked_by=actor)
        elif p.instruction_draft:
            draft = p.instruction_draft.model_copy(
                update={
                    "lifecycle": "active",
                    "approved_by": actor,
                    "approved_at": store.utc_now(),
                }
            )
            # Compile into policy version when scoring amendment
            if (
                draft.instruction_type == "assignment_policy_amendment"
                and policy_save
                and p.new_policy_draft
            ):
                saved = policy_save(p.new_policy_draft, edited_by=actor)
                if hasattr(saved, "model_dump"):
                    saved = saved.model_dump()
                draft = draft.model_copy(
                    update={
                        "affected_policy_id": saved.get("policy_id"),
                        "affected_policy_version": saved.get("version"),
                        "affected_policy_hash": saved.get("content_hash"),
                    }
                )
            inst = store.save_instruction(draft)
        store.mark_proposal(
            proposal_id,
            status="executed" if action == "save_instruction" else "confirmed",
            confirmed_at=store.utc_now(),
            confirmed_by=actor,
            target_manifest=frozen,
        )
        return {"proposal": store.get_proposal(proposal_id), "instruction": inst, "job": None}

    if action == "run_regrade":
        if p.kind not in ("run_regrade", "save_and_regrade", "preview_regrade"):
            # Allow regrade after a prior save that set requires_second_confirm
            if not (p.status == "confirmed" or p.requires_second_confirm_for_regrade):
                if p.kind == "save_instruction" and p.scores_change:
                    pass
                else:
                    raise ToolError("WRONG_ACTION", "This proposal does not authorize regrading.")
        if not frozen.submission_ids:
            raise ToolError("EMPTY_MANIFEST", "No frozen submission targets.")
        idem = f"{proposal_id}:{proposal_hash}:regrade"
        existing = store.get_job_by_idempotency(idem)
        if existing:
            return {"proposal": p, "instruction": None, "job": existing}
        job = RegradeJob(
            job_id=store.new_id("job"),
            proposal_id=proposal_id,
            proposal_hash=proposal_hash,
            status="queued",
            target_manifest=frozen,
            policy_id=p.previous_policy_id,
            policy_version=p.previous_policy_version,
            created_at=store.utc_now(),
            idempotency_key=idem,
        )
        store.save_job(job)
        store.mark_proposal(
            proposal_id,
            status="confirmed",
            confirmed_at=store.utc_now(),
            confirmed_by=actor,
            target_manifest=frozen,
        )
        return {"proposal": store.get_proposal(proposal_id), "instruction": None, "job": job}

    raise ToolError("UNKNOWN_ACTION", f"Unknown confirm action: {action}")


def start_approved_draft_regrade(
    job: RegradeJob,
    *,
    grade_one: Callable[[str], dict[str, Any]],
    load_original: Callable[[str], dict[str, Any] | None] | None = None,
) -> RegradeJob:
    """Run draft regrades for the frozen manifest. Idempotent per job."""
    if job.cancelled:
        job = job.model_copy(update={"status": "cancelled"})
        return store.save_job(job)
    if job.status in ("succeeded", "partial"):
        return job
    started = job.model_copy(update={"status": "running", "started_at": store.utc_now()})
    store.save_job(started)
    results = dict(started.results)
    originals = dict(started.originals)
    errors = dict(started.errors)
    for sid in started.target_manifest.submission_ids:
        if sid in results and results[sid].get("assessment_status") not in ("failed", "error"):
            continue
        if load_original:
            orig = load_original(sid)
            if orig:
                originals[sid] = orig
                key = store.result_key(
                    started.target_manifest.course_id,
                    started.target_manifest.assignment_id,
                    sid,
                    started.policy_version or 0,
                )
                store.preserve_original(key, orig)
        try:
            draft = grade_one(sid)
            # Distinguish real zero / partial / failed
            if draft.get("failure") or draft.get("assessment_status") == "failed":
                errors[sid] = str(draft.get("failure") or "failed")
                # do not write zeros over prior success
                key = store.result_key(
                    started.target_manifest.course_id,
                    started.target_manifest.assignment_id,
                    sid,
                    started.policy_version or "draft",
                )
                store.save_draft(key, draft)
            else:
                results[sid] = draft
                key = store.result_key(
                    started.target_manifest.course_id,
                    started.target_manifest.assignment_id,
                    sid,
                    started.policy_version or "draft",
                )
                store.save_draft(key, draft)
        except Exception as e:  # noqa: BLE001 — batch isolation
            errors[sid] = f"{type(e).__name__}: {e}"
    status = "succeeded"
    if errors and results:
        status = "partial"
    elif errors and not results:
        status = "failed"
    finished = started.model_copy(
        update={
            "status": status,
            "results": results,
            "originals": originals,
            "errors": errors,
            "finished_at": store.utc_now(),
        }
    )
    return store.save_job(finished)


def revoke_instruction_tool(instruction_id: str, *, actor: str, course_id: str) -> InstructionRecord:
    inst = store.get_instruction(instruction_id)
    if inst is None:
        raise ToolError("NOT_FOUND", "Instruction not found.")
    if inst.scope.course_id != course_id:
        raise ToolError("CROSS_COURSE_DENIED", "Cannot revoke an instruction from another course.")
    return store.revoke_instruction(instruction_id, revoked_by=actor)


def compare_versions(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "before_score": None if before is None else before.get("total_score", before.get("score")),
        "after_score": None if after is None else after.get("total_score", after.get("score")),
        "before_status": None if before is None else before.get("assessment_status"),
        "after_status": None if after is None else after.get("assessment_status"),
        "scores_identical": (before or {}).get("total_score") == (after or {}).get("total_score"),
    }


def default_expiry_iso(days: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
