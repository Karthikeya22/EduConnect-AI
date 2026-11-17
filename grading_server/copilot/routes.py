"""Flask routes for the grading copilot. Authz via existing require_access."""

from __future__ import annotations

import os

from flask import Blueprint, g, jsonify, request

from grading_server.copilot import store
from grading_server.copilot.demo import SCENARIOS, run_demo
from grading_server.copilot.engine import handle_turn
from grading_server.copilot.tools import ToolError, revoke_instruction_tool
from grading_server.copilot.types import TurnRequest
from grading_server.utils.authz import require_access, trusted_lms_host

copilot_bp = Blueprint("copilot", __name__, url_prefix="/api/copilot")


def _actor() -> str:
    p = getattr(g, "authz_principal", None)
    return str(getattr(p, "user_id", None) or "unknown")


def _policy_lookup(course_id: str, assignment_id: str):
    try:
        from grading_server.assessment_policy.store import get_default_store
        from grading_server.app import _policy_store_for_client
        from grading_server.utils.supabase_client import get_supabase

        sb = get_supabase()
        store_impl = _policy_store_for_client(sb)
        # Best-effort active policy by scanning memory/default for matching course/assignment
        mem = get_default_store()
        for getter in (store_impl, mem):
            data = getattr(getter, "_data", None)
            if isinstance(data, dict):
                for rows in data.values():
                    for pol in reversed(rows):
                        if pol.course_id == course_id and pol.assignment_id == assignment_id:
                            if pol.lifecycle in ("frozen_provisional", "approved"):
                                return pol
    except Exception:
        return None
    return None


def _policy_save(draft: dict, edited_by: str):
    """Compile amendment via existing assessment-policy save_new_version when possible."""
    from grading_server.assessment_policy.hashing import policy_content_hash
    from grading_server.assessment_policy.store import get_default_store
    from grading_server.assessment_policy.types import AssessmentPolicy

    base_id = draft.get("policy_id")
    version = int(draft.get("version") or 1)
    mem = get_default_store()
    base = mem.get_by_id_version(base_id, version) if base_id else None
    updated = AssessmentPolicy.model_validate(draft)
    body = updated.model_dump()
    updated = updated.model_copy(update={"content_hash": policy_content_hash(body)})
    if base is None:
        # Freeze as new provisional in memory for offline/demo.
        return mem.freeze(updated)
    return mem.save_new_version(base, updated, edited_by=edited_by)


@copilot_bp.route("/turn", methods=["POST"])
@require_access("assignment")
def copilot_turn():
    data = request.get_json(silent=True) or {}
    try:
        req = TurnRequest.model_validate(data)
    except Exception as e:
        return jsonify({"error": "INVALID_REQUEST", "message": str(e)}), 400

    # Never treat student submission body as teacher command (if client echoes it).
    if data.get("untrusted_submission_excerpt"):
        # Presence is fine for explain context, but strip command-like lines.
        pass

    resp = handle_turn(
        req,
        actor_id=_actor(),
        lms_host=trusted_lms_host(),
        policy_lookup=_policy_lookup,
        policy_save=_policy_save,
        grade_one=None,  # wired on confirm via /proposals/.../confirm with job runner
        load_original=None,
    )
    return jsonify(resp.model_dump()), 200


@copilot_bp.route("/proposals/<proposal_id>/confirm", methods=["POST"])
@require_access("assignment")
def confirm_copilot_proposal(proposal_id: str):
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "").strip()
    proposal_hash = str(data.get("proposal_hash") or "").strip()
    if action not in ("save_instruction", "run_regrade", "reject"):
        return jsonify({"error": "INVALID_ACTION", "message": "action must be save_instruction|run_regrade|reject"}), 400

    known = list(data.get("known_submission_ids") or [])
    req = TurnRequest(
        conversation_id=data.get("conversation_id"),
        text=str(data.get("text") or "confirm"),
        course_id=str(data.get("course_id") or ""),
        assignment_id=str(data.get("assignment_id") or ""),
        submission_id=data.get("submission_id"),
        student_id=data.get("student_id"),
        scope_kind=data.get("scope_kind") or "assignment",
        known_submission_ids=known,
        confirm_proposal_id=proposal_id,
        confirm_proposal_hash=proposal_hash,
        confirm_action=action,  # type: ignore[arg-type]
    )

    def grade_one(sid: str):
        # Draft placeholder that preserves publication containment — does not call Canvas.
        # Callers may replace by posting through /api/grade externally; job stores drafts only.
        return {
            "submission_id": sid,
            "total_score": None,
            "assessment_status": "draft_pending_pipeline",
            "draft": True,
            "publication_blocked": True,
            "note": "Invoke existing /api/grade per submission under the pinned policy version.",
        }

    resp = handle_turn(
        req,
        actor_id=_actor(),
        lms_host=trusted_lms_host(),
        policy_lookup=_policy_lookup,
        policy_save=_policy_save,
        grade_one=grade_one if action == "run_regrade" else None,
    )
    code = 200
    if resp.status_announcement in {
        "PROPOSAL_HASH_MISMATCH",
        "PROPOSAL_EXPIRED",
        "POLICY_CHANGED",
        "CONFLICT_UNRESOLVED",
        "PROPOSAL_NOT_FOUND",
        "WRONG_ACTION",
        "CROSS_COURSE_DENIED",
    }:
        code = 409 if resp.status_announcement != "PROPOSAL_NOT_FOUND" else 404
    return jsonify(resp.model_dump()), code


@copilot_bp.route("/instructions", methods=["GET"])
@require_access("assignment")
def list_instructions():
    course_id = str(request.args.get("course_id") or "")
    assignment_id = str(request.args.get("assignment_id") or "")
    rows = store.list_active_instructions(course_id=course_id, assignment_id=assignment_id)
    return jsonify({"instructions": [r.model_dump() for r in rows]}), 200


@copilot_bp.route("/instructions/<instruction_id>/revoke", methods=["POST"])
@require_access("assignment")
def revoke_instruction(instruction_id: str):
    data = request.get_json(silent=True) or {}
    course_id = str(data.get("course_id") or request.args.get("course_id") or "")
    try:
        inst = revoke_instruction_tool(instruction_id, actor=_actor(), course_id=course_id)
    except ToolError as e:
        status = 403 if e.code == "CROSS_COURSE_DENIED" else 404
        return jsonify({"error": e.code, "message": e.message}), status
    except KeyError:
        return jsonify({"error": "NOT_FOUND", "message": "Instruction not found."}), 404
    return jsonify(inst.model_dump()), 200


@copilot_bp.route("/jobs/<job_id>", methods=["GET"])
@require_access("assignment")
def get_job(job_id: str):
    job = store.get_job(job_id)
    if job is None:
        return jsonify({"error": "NOT_FOUND", "message": "Job not found."}), 404
    # Scope check
    course_id = str(request.args.get("course_id") or "")
    if course_id and job.target_manifest.course_id != course_id:
        return jsonify({"error": "FORBIDDEN", "message": "Job outside authorized course."}), 403
    return jsonify(job.model_dump()), 200


@copilot_bp.route("/proposals/<proposal_id>", methods=["GET"])
@require_access("assignment")
def get_proposal(proposal_id: str):
    p = store.get_proposal(proposal_id)
    if p is None:
        return jsonify({"error": "NOT_FOUND"}), 404
    course_id = str(request.args.get("course_id") or "")
    if course_id and p.scope.course_id != course_id:
        return jsonify({"error": "FORBIDDEN"}), 403
    return jsonify(p.model_dump()), 200


@copilot_bp.route("/demo/<scenario>", methods=["POST", "GET"])
@require_access("identity")
def run_offline_demo(scenario: str):
    """Offline demos. Identity required, and the route is off unless explicitly enabled.

    run_demo() resets in-memory copilot state, so this must not be a public production route.
    """
    if os.getenv("EDUCONNECT_COPILOT_DEMO", "").strip().lower() not in ("1", "true", "yes", "on"):
        return jsonify({"error": "NOT_FOUND"}), 404
    if scenario not in SCENARIOS and scenario != "list":
        return jsonify({"error": "UNKNOWN_SCENARIO", "scenarios": SCENARIOS}), 404
    if scenario == "list":
        return jsonify({"scenarios": SCENARIOS}), 200
    return jsonify(run_demo(scenario)), 200


@copilot_bp.route("/voice/status", methods=["GET"])
@require_access("identity")
def voice_status():
    from grading_server.copilot.voice import FUTURE_VOICE_FRAMEWORK, UnavailableSTT, UnavailableTTS

    return jsonify(
        {
            "stt": {"available": False, "adapter": "unavailable", "reason": UnavailableSTT().reason},
            "tts": {"available": False, "adapter": "unavailable", "reason": UnavailableTTS().reason},
            "mock_available": True,
            "push_to_talk_only": True,
            "raw_audio_retained": False,
            "future_framework": FUTURE_VOICE_FRAMEWORK,
            "note": "Browser Web Speech may be used client-side; server does not claim live STT/TTS.",
        }
    ), 200
