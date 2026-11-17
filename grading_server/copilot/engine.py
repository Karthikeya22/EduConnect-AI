"""Turn engine: clarify → proposal → confirm → (optional) regrade via existing services."""

from __future__ import annotations

from typing import Any, Callable

from grading_server.copilot import store
from grading_server.copilot.intents import apply_clarification_reply, parse_teacher_text
from grading_server.copilot.tools import (
    ToolError,
    confirm_proposal,
    create_proposal,
    find_conflicts,
    inspect_submission_context,
    read_current_policy,
    revoke_instruction_tool,
    start_approved_draft_regrade,
)
from grading_server.copilot.types import (
    AuthorizedScope,
    ConversationMessage,
    ConversationTurn,
    InstructionRecord,
    IntentType,
    TurnRequest,
    TurnResponse,
)


def _msg(role: str, text: str, **kw: Any) -> ConversationMessage:
    return ConversationMessage(
        message_id=store.new_id("msg"),
        role=role,  # type: ignore[arg-type]
        text=text,
        created_at=store.utc_now(),
        **kw,
    )


def _draft_instruction(
    *,
    scope: AuthorizedScope,
    scope_kind: str,
    instruction_type: str,
    payload: dict[str, Any],
    originating: str,
    created_by: str,
    rationale: str | None = None,
    expires_at: str | None = None,
) -> InstructionRecord:
    return InstructionRecord(
        instruction_id=store.new_id("inst"),
        version=1,
        scope=scope,
        scope_kind=scope_kind,  # type: ignore[arg-type]
        instruction_type=instruction_type,  # type: ignore[arg-type]
        payload=payload,
        originating_request=originating,
        rationale=rationale,
        created_by=created_by,
        created_at=store.utc_now(),
        expires_at=expires_at,
        lifecycle="draft",
    )


def handle_turn(
    req: TurnRequest,
    *,
    actor_id: str,
    lms_host: str | None = None,
    policy_lookup: Callable[..., Any] | None = None,
    policy_save: Callable[..., Any] | None = None,
    grade_one: Callable[[str], dict[str, Any]] | None = None,
    load_original: Callable[[str], dict[str, Any] | None] | None = None,
    explain_grade: Callable[[AuthorizedScope], str] | None = None,
) -> TurnResponse:
    # Partial voice transcripts never execute actions.
    if req.is_partial_transcript or req.source == "voice_partial":
        cid = req.conversation_id or store.new_id("conv")
        conv = store.get_conversation(cid) or ConversationTurn(
            conversation_id=cid,
            scope=AuthorizedScope(
                course_id=req.course_id,
                assignment_id=req.assignment_id,
                submission_id=req.submission_id,
                student_id=req.student_id,
                lms_host=lms_host,
            ),
        )
        conv.messages.append(
            _msg("teacher", req.text, is_partial_transcript=True, source="voice_partial")
        )
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text="Listening… edit the final transcript before sending.",
            intent="clarify",
            spoken_summary=None,
            status_announcement="Partial transcript received; no action taken.",
        )

    scope = AuthorizedScope(
        course_id=req.course_id,
        assignment_id=req.assignment_id,
        submission_id=req.submission_id,
        student_id=req.student_id,
        lms_host=lms_host,
    )
    # Reject invented IDs outside known roster when provided.
    try:
        inspect_submission_context(scope=scope, known_submission_ids=req.known_submission_ids)
    except ToolError as e:
        return TurnResponse(
            conversation_id=req.conversation_id or store.new_id("conv"),
            assistant_text=e.message,
            intent="unsupported",
            status_announcement=e.code,
        )

    cid = req.conversation_id or store.new_id("conv")
    conv = store.get_conversation(cid) or ConversationTurn(conversation_id=cid, scope=scope)
    conv.scope = scope

    # Explicit confirmation path (bound to proposal id+hash).
    if req.confirm_proposal_id and req.confirm_action:
        return _confirm(
            conv,
            req,
            actor_id=actor_id,
            policy_lookup=policy_lookup,
            policy_save=policy_save,
            grade_one=grade_one,
            load_original=load_original,
        )

    conv.messages.append(_msg("teacher", req.text, source=req.source))  # type: ignore[arg-type]

    if conv.waiting_for:
        parsed = apply_clarification_reply(
            conv.waiting_for, req.text, has_submission=bool(req.submission_id)
        )
        conv.waiting_for = None
    else:
        parsed = parse_teacher_text(
            req.text, scope_kind=req.scope_kind, has_submission=bool(req.submission_id)
        )

    if parsed.injection_suspected or parsed.cross_course:
        text = parsed.clarification or "Request denied."
        conv.messages.append(_msg("assistant", text))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent="unsupported",
            status_announcement="Request rejected.",
            instructions=store.list_active_instructions(
                course_id=req.course_id, assignment_id=req.assignment_id
            ),
        )

    if parsed.needs_clarification and parsed.clarification:
        if parsed.notes and "ambiguous_leniency" in parsed.notes:
            conv.waiting_for = "liberal_scope"
        elif parsed.intent == "save_preference":
            conv.waiting_for = "remember_meta"
        text = parsed.clarification
        conv.messages.append(_msg("assistant", text))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            clarification=parsed.clarification,
            intent="clarify",
            spoken_summary="Need a bit more detail before proposing a change.",
            status_announcement="Clarification required.",
        )

    intent: IntentType = parsed.intent
    policy = read_current_policy(
        policy_lookup=policy_lookup, course_id=req.course_id, assignment_id=req.assignment_id
    )

    if intent == "inspect_instructions":
        rows = store.list_active_instructions(course_id=req.course_id, assignment_id=req.assignment_id)
        if not rows:
            text = "No active remembered instructions for this assignment."
        else:
            lines = [
                f"- {r.instruction_id} v{r.version} ({r.instruction_type}, {r.scope_kind}): {r.originating_request[:80]}"
                for r in rows
            ]
            text = "Active remembered instructions:\n" + "\n".join(lines)
        conv.messages.append(_msg("assistant", text))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent=intent,
            instructions=rows,
            spoken_summary=f"{len(rows)} active instructions.",
            status_announcement="Listed remembered instructions.",
        )

    if intent == "revoke_instruction":
        rows = store.list_active_instructions(course_id=req.course_id, assignment_id=req.assignment_id)
        if not rows:
            text = "Nothing to revoke — no active instructions."
            conv.messages.append(_msg("assistant", text))
            store.save_conversation(conv)
            return TurnResponse(
                conversation_id=cid,
                assistant_text=text,
                intent=intent,
                status_announcement="No instructions to revoke.",
            )
        target = rows[-1]
        draft = target.model_copy(update={"lifecycle": "draft"})
        proposal = create_proposal(
            kind="revoke_instruction",
            scope=scope,
            scope_kind=target.scope_kind,
            created_by=actor_id,
            summary=f"Revoke instruction {target.instruction_id}",
            instruction_draft=draft,
            known_submission_ids=req.known_submission_ids,
            scores_change=False,
            feedback_only=False,
        )
        text = (
            f"Proposal to revoke {target.instruction_id} (v{target.version}). "
            "Confirm to apply — nothing is revoked until you confirm."
        )
        conv.messages.append(_msg("assistant", text))
        conv.pending_proposal_id = proposal.proposal_id
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent=intent,
            proposal=proposal,
            instructions=rows,
            spoken_summary="Revoke proposal ready for confirmation.",
            status_announcement="Revoke proposal awaiting confirmation.",
        )

    if intent == "explain_grade":
        explanation = (
            explain_grade(scope)
            if explain_grade
            else (
                "I can explain criterion scores from the current draft once a submission is selected. "
                "I will not invent student IDs or claim a regrade completed."
            )
        )
        conv.messages.append(_msg("assistant", explanation))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=explanation,
            intent=intent,
            spoken_summary="Grade explanation ready.",
            status_announcement="Explanation provided.",
        )

    # Build proposal for actionable intents
    scope_kind = parsed.suggested_scope or req.scope_kind
    if scope_kind == "none":
        scope_kind = "assignment"

    if intent == "feedback_tone":
        payload = {"tone": "kinder", "detail": "supportive", "scores_unchanged": True}
        conflicts = find_conflicts(
            course_id=req.course_id,
            assignment_id=req.assignment_id,
            instruction_type="feedback_preference",
            scope_kind=scope_kind,  # type: ignore[arg-type]
            submission_id=req.submission_id,
            payload=payload,
        )
        if conflicts and not parsed.remember:
            # still propose; surface conflict
            pass
        draft = _draft_instruction(
            scope=scope,
            scope_kind=scope_kind,
            instruction_type="feedback_preference",
            payload=payload,
            originating=req.text,
            created_by=actor_id,
            rationale="Teacher requested kinder feedback without score changes.",
        )
        persistence = "until_revoked" if parsed.remember else "ephemeral"
        if parsed.remember and "persistence:until_expiry" in (parsed.notes or []):
            persistence = "until_expiry"
            from grading_server.copilot.tools import default_expiry_iso

            draft = draft.model_copy(update={"expires_at": default_expiry_iso(14)})
        if parsed.remember is False and "remember" in req.text.lower():
            # require explicit permission path — ask first
            conv.waiting_for = "remember_meta"
            text = (
                "Feedback can be kinder without changing scores. "
                "Should this be remembered? If yes, specify scope and duration."
            )
            conv.messages.append(_msg("assistant", text))
            store.save_conversation(conv)
            return TurnResponse(
                conversation_id=cid,
                assistant_text=text,
                clarification=text,
                intent="clarify",
                status_announcement="Persistence permission required.",
            )
        proposal = create_proposal(
            kind="save_instruction",
            scope=scope,
            scope_kind=scope_kind,  # type: ignore[arg-type]
            created_by=actor_id,
            summary="Change feedback tone to kinder; scores unchanged.",
            persistence=persistence,  # type: ignore[arg-type]
            instruction_draft=draft,
            previous_policy=policy,
            known_submission_ids=(
                [req.submission_id] if scope_kind == "submission" and req.submission_id else req.known_submission_ids
            ),
            changed_dimensions=["feedback_tone"],
            unchanged_dimensions=["scores", "criteria", "weights"],
            scores_change=False,
            feedback_only=True,
            conflict_ids=[c.instruction_id for c in conflicts],
        )
        text = (
            "Proposed feedback-tone change (scores stay the same). "
            + (
                f"Conflict with {len(conflicts)} active instruction(s) — resolve before confirming. "
                if conflicts
                else "Confirm to save this preference. Regrading is not required for tone-only changes."
            )
        )
        conv.messages.append(_msg("assistant", text))
        conv.pending_proposal_id = proposal.proposal_id
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent=intent,
            proposal=proposal,
            spoken_summary="Feedback tone proposal ready.",
            status_announcement="Proposal awaiting confirmation.",
            instructions=store.list_active_instructions(
                course_id=req.course_id, assignment_id=req.assignment_id
            ),
        )

    if intent in ("criterion_interpretation", "scoring_policy", "submission_exception", "instructor_score_override"):
        criterion_id = parsed.criterion_hint or "grammar"
        itype = {
            "criterion_interpretation": "assignment_policy_amendment",
            "scoring_policy": "assignment_policy_amendment",
            "submission_exception": "submission_exception",
            "instructor_score_override": "instructor_score_override",
        }[intent]
        if intent == "submission_exception" or intent == "instructor_score_override":
            scope_kind = "submission"
        payload: dict[str, Any] = {
            "criterion_id": criterion_id,
            "interpretation": "liberal_but_explicit" if intent == "criterion_interpretation" else "policy_edit",
        }
        if intent == "instructor_score_override":
            payload = {
                "override": True,
                "not_evidence_derived": True,
                "note": "Explicit instructor override — not an AI/evidence grade.",
            }
        if intent == "submission_exception":
            payload["rationale_required"] = True
            payload["do_not_generalize"] = True
        conflicts = find_conflicts(
            course_id=req.course_id,
            assignment_id=req.assignment_id,
            instruction_type=itype,  # type: ignore[arg-type]
            scope_kind=scope_kind,  # type: ignore[arg-type]
            submission_id=req.submission_id,
            payload=payload,
        )
        draft = _draft_instruction(
            scope=scope,
            scope_kind=scope_kind,
            instruction_type=itype,
            payload=payload,
            originating=req.text,
            created_by=actor_id,
            rationale=req.text if intent == "submission_exception" else None,
        )
        new_policy = None
        if itype == "assignment_policy_amendment" and policy:
            new_policy = dict(policy)
            # Annotate disclosed assumption — do not invent criterion rows.
            assumptions = list(new_policy.get("disclosed_assumptions") or [])
            assumptions.append(f"Copilot amendment: {criterion_id} — {payload.get('interpretation')}")
            new_policy["disclosed_assumptions"] = assumptions
            for c in new_policy.get("criteria") or []:
                if criterion_id.lower() in str(c.get("title", "")).lower() or c.get("criterion_id") == criterion_id:
                    desc = c.get("description") or ""
                    c["description"] = desc + " [Instructor interpretation: apply liberally where reasonable.]"
                    c["disclosed_assumptions"] = list(c.get("disclosed_assumptions") or []) + [
                        "liberal_interpretation_pending_confirm"
                    ]
        targets = req.known_submission_ids
        if scope_kind == "submission":
            targets = [req.submission_id] if req.submission_id else []
        proposal = create_proposal(
            kind="save_instruction",
            scope=scope,
            scope_kind=scope_kind,  # type: ignore[arg-type]
            created_by=actor_id,
            summary=f"Propose {intent} for {criterion_id} ({scope_kind}).",
            persistence="until_revoked",
            instruction_draft=draft,
            previous_policy=policy,
            new_policy_draft=new_policy,
            known_submission_ids=targets,
            changed_dimensions=["criteria_interpretation"] if intent != "instructor_score_override" else ["instructor_override"],
            unchanged_dimensions=["canvas_publication"],
            scores_change=True,
            feedback_only=False,
            conflict_ids=[c.instruction_id for c in conflicts],
            estimated_work={"submissions": len(targets)} if targets else None,
        )
        text = (
            f"Proposed {intent.replace('_', ' ')} at {scope_kind} scope. "
            "Saving the instruction and running a draft regrade are separate confirmations. "
            "Canvas publication remains blocked. "
        )
        if scope_kind == "assignment":
            text += f"Target manifest freezes {len(targets)} submission(s) at confirmation. "
        if conflicts:
            text += "Conflicting instructions must be resolved first."
        conv.messages.append(_msg("assistant", text))
        conv.pending_proposal_id = proposal.proposal_id
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent=intent,
            proposal=proposal,
            spoken_summary="Policy proposal ready for confirmation.",
            status_announcement="Proposal awaiting confirmation.",
            instructions=store.list_active_instructions(
                course_id=req.course_id, assignment_id=req.assignment_id
            ),
        )

    if intent == "preview_regrade":
        # Previews that need model calls are budgeted and explicit.
        proposal = create_proposal(
            kind="preview_regrade",
            scope=scope,
            scope_kind=scope_kind,  # type: ignore[arg-type]
            created_by=actor_id,
            summary="Budgeted draft regrade preview (no Canvas publish).",
            previous_policy=policy,
            known_submission_ids=req.known_submission_ids,
            scores_change=True,
            budgeted_preview=True,
            estimated_work={"submissions": len(req.known_submission_ids), "budget": "explicit"},
        )
        text = (
            "Preview regrade is a budgeted operation and will not run automatically. "
            "Confirm to start draft regrades for the frozen target list only."
        )
        conv.messages.append(_msg("assistant", text))
        conv.pending_proposal_id = proposal.proposal_id
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            intent=intent,
            proposal=proposal,
            spoken_summary="Regrade preview proposal ready.",
            status_announcement="Budgeted preview awaiting confirmation.",
        )

    if intent == "save_preference":
        conv.waiting_for = "remember_meta"
        text = parsed.clarification or (
            "What should be remembered, at which scope, and for how long?"
        )
        conv.messages.append(_msg("assistant", text))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=cid,
            assistant_text=text,
            clarification=text,
            intent="clarify",
            status_announcement="Persistence details required.",
        )

    text = "That request is not supported in the grading copilot."
    conv.messages.append(_msg("assistant", text))
    store.save_conversation(conv)
    return TurnResponse(
        conversation_id=cid,
        assistant_text=text,
        intent="unsupported",
        status_announcement="Unsupported request.",
    )


def _confirm(
    conv: ConversationTurn,
    req: TurnRequest,
    *,
    actor_id: str,
    policy_lookup,
    policy_save,
    grade_one,
    load_original,
) -> TurnResponse:
    policy = read_current_policy(
        policy_lookup=policy_lookup, course_id=req.course_id, assignment_id=req.assignment_id
    )
    current_hash = (policy or {}).get("content_hash")
    try:
        out = confirm_proposal(
            proposal_id=req.confirm_proposal_id or "",
            proposal_hash=req.confirm_proposal_hash or "",
            actor=actor_id,
            action=req.confirm_action or "reject",
            current_policy_hash=current_hash,
            policy_save=policy_save,
        )
    except ToolError as e:
        text = e.message
        conv.messages.append(_msg("assistant", text))
        store.save_conversation(conv)
        return TurnResponse(
            conversation_id=conv.conversation_id,
            assistant_text=text,
            intent="unsupported",
            status_announcement=e.code,
        )

    job = out.get("job")
    if job and req.confirm_action == "run_regrade" and grade_one:
        job = start_approved_draft_regrade(job, grade_one=grade_one, load_original=load_original)

    inst = out.get("instruction")
    proposal = out.get("proposal")
    if req.confirm_action == "reject":
        text = "Proposal rejected. No policy or grades were changed."
    elif req.confirm_action == "save_instruction":
        text = (
            f"Instruction saved"
            + (f" ({inst.instruction_id})" if inst else "")
            + ". Existing submissions were not regraded. Confirm a separate regrade proposal to run drafts."
        )
    else:
        text = (
            f"Draft regrade job {job.job_id if job else '?'} status={job.status if job else 'n/a'}. "
            "Original results remain available. Publication remains blocked."
        )
    conv.messages.append(_msg("assistant", text))
    store.save_conversation(conv)
    return TurnResponse(
        conversation_id=conv.conversation_id,
        assistant_text=text,
        intent="preview_regrade" if req.confirm_action == "run_regrade" else "save_preference",
        proposal=proposal,
        job=job,
        instructions=store.list_active_instructions(
            course_id=req.course_id, assignment_id=req.assignment_id
        ),
        spoken_summary="Action completed after confirmation.",
        status_announcement=text,
    )


# Re-export for revoke helper used by routes
__all__ = ["handle_turn", "revoke_instruction_tool"]
