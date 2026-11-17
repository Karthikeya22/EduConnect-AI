"""In-memory authoritative stores for copilot chat, instructions, proposals, jobs.

Chat messages are never treated as policy. Confirmed instructions live separately.
"""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from grading_server.copilot.types import (
    ConversationTurn,
    InstructionRecord,
    Proposal,
    RegradeJob,
)

_LOCK = threading.RLock()
_CONVERSATIONS: dict[str, ConversationTurn] = {}
_INSTRUCTIONS: dict[str, list[InstructionRecord]] = {}  # id -> versions
_PROPOSALS: dict[str, Proposal] = {}
_JOBS: dict[str, RegradeJob] = {}
_JOBS_BY_IDEMPOTENCY: dict[str, str] = {}
_DRAFT_RESULTS: dict[str, dict[str, Any]] = {}  # key course|assign|sub|policy_v
_ORIGINAL_RESULTS: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expiry(minutes: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def stable_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def reset_stores() -> None:
    with _LOCK:
        _CONVERSATIONS.clear()
        _INSTRUCTIONS.clear()
        _PROPOSALS.clear()
        _JOBS.clear()
        _JOBS_BY_IDEMPOTENCY.clear()
        _DRAFT_RESULTS.clear()
        _ORIGINAL_RESULTS.clear()


def get_conversation(cid: str) -> ConversationTurn | None:
    with _LOCK:
        return _CONVERSATIONS.get(cid)


def save_conversation(turn: ConversationTurn) -> ConversationTurn:
    with _LOCK:
        _CONVERSATIONS[turn.conversation_id] = turn
        return turn


def list_active_instructions(
    *,
    course_id: str,
    assignment_id: str | None = None,
    submission_id: str | None = None,
) -> list[InstructionRecord]:
    with _LOCK:
        out: list[InstructionRecord] = []
        now = datetime.now(timezone.utc)
        for versions in _INSTRUCTIONS.values():
            if not versions:
                continue
            inst = versions[-1]
            if inst.lifecycle not in ("active",):
                continue
            if inst.expires_at:
                try:
                    if datetime.fromisoformat(inst.expires_at.replace("Z", "+00:00")) < now:
                        continue
                except ValueError:
                    pass
            if inst.scope.course_id != course_id:
                continue
            if assignment_id and inst.scope.assignment_id and inst.scope.assignment_id != assignment_id:
                if inst.scope_kind != "course":
                    continue
            if inst.scope_kind == "submission":
                if not submission_id or inst.scope.submission_id != submission_id:
                    # still list for inspect; callers filter
                    pass
            out.append(inst)
        return out


def save_instruction(inst: InstructionRecord) -> InstructionRecord:
    with _LOCK:
        rows = _INSTRUCTIONS.setdefault(inst.instruction_id, [])
        if rows and rows[-1].lifecycle == "active" and rows[-1].version != inst.version:
            rows[-1] = rows[-1].model_copy(update={"lifecycle": "superseded"})
        # replace same version or append
        for i, r in enumerate(rows):
            if r.version == inst.version:
                rows[i] = inst
                return inst
        rows.append(inst)
        return inst


def get_instruction(instruction_id: str, version: int | None = None) -> InstructionRecord | None:
    with _LOCK:
        rows = _INSTRUCTIONS.get(instruction_id) or []
        if not rows:
            return None
        if version is None:
            return rows[-1]
        for r in rows:
            if r.version == version:
                return r
        return None


def revoke_instruction(instruction_id: str, *, revoked_by: str) -> InstructionRecord:
    with _LOCK:
        rows = _INSTRUCTIONS.get(instruction_id) or []
        if not rows:
            raise KeyError(instruction_id)
        cur = rows[-1]
        if cur.lifecycle == "revoked":
            return cur
        updated = cur.model_copy(
            update={
                "lifecycle": "revoked",
                "revoked_at": _now(),
                "revoked_by": revoked_by,
            }
        )
        rows[-1] = updated
        return updated


def save_proposal(p: Proposal) -> Proposal:
    with _LOCK:
        _PROPOSALS[p.proposal_id] = p
        return p


def get_proposal(proposal_id: str) -> Proposal | None:
    with _LOCK:
        return _PROPOSALS.get(proposal_id)


def mark_proposal(proposal_id: str, **updates: Any) -> Proposal:
    with _LOCK:
        p = _PROPOSALS[proposal_id]
        updated = p.model_copy(update=updates)
        _PROPOSALS[proposal_id] = updated
        return updated


def get_job(job_id: str) -> RegradeJob | None:
    with _LOCK:
        return _JOBS.get(job_id)


def get_job_by_idempotency(key: str) -> RegradeJob | None:
    with _LOCK:
        jid = _JOBS_BY_IDEMPOTENCY.get(key)
        return _JOBS.get(jid) if jid else None


def save_job(job: RegradeJob) -> RegradeJob:
    with _LOCK:
        _JOBS[job.job_id] = job
        if job.idempotency_key:
            _JOBS_BY_IDEMPOTENCY[job.idempotency_key] = job.job_id
        return job


def result_key(course_id: str, assignment_id: str, submission_id: str, policy_version: int | str) -> str:
    return f"{course_id}|{assignment_id}|{submission_id}|{policy_version}"


def preserve_original(key: str, result: dict[str, Any]) -> None:
    with _LOCK:
        _ORIGINAL_RESULTS.setdefault(key, result)


def get_original(key: str) -> dict[str, Any] | None:
    with _LOCK:
        return _ORIGINAL_RESULTS.get(key)


def save_draft(key: str, result: dict[str, Any]) -> None:
    with _LOCK:
        # Never overwrite a successful draft with a failure-generated zero payload.
        existing = _DRAFT_RESULTS.get(key)
        if existing and existing.get("assessment_status") not in (None, "failed", "error"):
            if result.get("assessment_status") in ("failed", "error") or result.get("score") == 0 and result.get(
                "failure"
            ):
                return
        _DRAFT_RESULTS[key] = result


def get_draft(key: str) -> dict[str, Any] | None:
    with _LOCK:
        return _DRAFT_RESULTS.get(key)


def proposal_expiry_default() -> str:
    return _expiry(30)


def utc_now() -> str:
    return _now()
