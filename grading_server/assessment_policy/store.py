"""Persist and freeze assignment-level assessment policies.

Concurrency: at most one active frozen policy per (course, assignment, context_hash, gen_config).
Losing writers re-read and use the persisted winner. Exactly-once LLM execution is NOT claimed.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Protocol

from grading_server.assessment_policy.hashing import generation_config_key
from grading_server.assessment_policy.types import AssessmentPolicy

_LOCK = threading.RLock()
_MEMORY: dict[str, list[AssessmentPolicy]] = {}


def _scope_key(
    course_id: str,
    assignment_id: str,
    context_hash: str,
    gen_config: dict[str, Any] | None,
) -> str:
    return f"{course_id}|{assignment_id}|{context_hash}|{generation_config_key(gen_config)}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PolicyStore(Protocol):
    def get_active(
        self,
        *,
        course_id: str,
        assignment_id: str,
        context_hash: str,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy | None: ...

    def freeze(
        self,
        policy: AssessmentPolicy,
        *,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy: ...

    def get_by_id_version(self, policy_id: str, version: int) -> AssessmentPolicy | None: ...

    def approve(
        self,
        policy_id: str,
        version: int,
        *,
        approved_by: str,
    ) -> AssessmentPolicy: ...

    def save_new_version(
        self,
        base: AssessmentPolicy,
        updated: AssessmentPolicy,
        *,
        edited_by: str,
    ) -> AssessmentPolicy: ...


class InMemoryPolicyStore:
    """Process-local store used by tests and offline demos."""

    def __init__(self, data: dict[str, list[AssessmentPolicy]] | None = None):
        self._data = data if data is not None else _MEMORY

    def get_active(
        self,
        *,
        course_id: str,
        assignment_id: str,
        context_hash: str,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy | None:
        key = _scope_key(course_id, assignment_id, context_hash, gen_config)
        with _LOCK:
            rows = self._data.get(key) or []
            for p in reversed(rows):
                if p.lifecycle in ("frozen_provisional", "approved") and p.assignment_context_hash == context_hash:
                    return p
            return None

    def freeze(
        self,
        policy: AssessmentPolicy,
        *,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy:
        key = _scope_key(
            policy.course_id,
            policy.assignment_id,
            policy.assignment_context_hash,
            gen_config if gen_config is not None else policy.creation_config,
        )
        with _LOCK:
            existing = self.get_active(
                course_id=policy.course_id,
                assignment_id=policy.assignment_id,
                context_hash=policy.assignment_context_hash,
                gen_config=gen_config if gen_config is not None else policy.creation_config,
            )
            if existing is not None:
                return existing
            frozen = policy.model_copy(
                update={"lifecycle": "frozen_provisional", "created_at": policy.created_at or _now()}
            )
            self._data.setdefault(key, []).append(frozen)
            return frozen

    def get_by_id_version(self, policy_id: str, version: int) -> AssessmentPolicy | None:
        with _LOCK:
            for rows in self._data.values():
                for p in rows:
                    if p.policy_id == policy_id and p.version == version:
                        return p
            return None

    def approve(self, policy_id: str, version: int, *, approved_by: str) -> AssessmentPolicy:
        with _LOCK:
            found = self.get_by_id_version(policy_id, version)
            if found is None:
                raise KeyError(f"policy {policy_id}@v{version} not found")
            if found.lifecycle == "superseded":
                raise ValueError("Cannot approve a superseded policy version")
            approved = found.model_copy(
                update={
                    "lifecycle": "approved",
                    "approved_by": approved_by,
                    "approved_at": _now(),
                }
            )
            # Replace in place
            for key, rows in self._data.items():
                for i, p in enumerate(rows):
                    if p.policy_id == policy_id and p.version == version:
                        rows[i] = approved
                        return approved
            raise KeyError(f"policy {policy_id}@v{version} not found")

    def save_new_version(
        self,
        base: AssessmentPolicy,
        updated: AssessmentPolicy,
        *,
        edited_by: str,
    ) -> AssessmentPolicy:
        """Instructor edit creates a new version; prior active becomes superseded."""
        key = _scope_key(
            base.course_id,
            base.assignment_id,
            updated.assignment_context_hash,
            updated.creation_config,
        )
        with _LOCK:
            new_version = int(base.version) + 1
            new_p = updated.model_copy(
                update={
                    "policy_id": base.policy_id,
                    "version": new_version,
                    "lifecycle": "frozen_provisional",
                    "created_by": edited_by,
                    "created_at": _now(),
                    "approved_by": None,
                    "approved_at": None,
                }
            )
            rows = self._data.setdefault(key, [])
            for i, p in enumerate(rows):
                if p.policy_id == base.policy_id and p.lifecycle in ("frozen_provisional", "approved"):
                    rows[i] = p.model_copy(update={"lifecycle": "superseded"})
            # Also supersede under old context key if assignment changed.
            old_key = _scope_key(
                base.course_id,
                base.assignment_id,
                base.assignment_context_hash,
                base.creation_config,
            )
            if old_key != key:
                for i, p in enumerate(self._data.get(old_key) or []):
                    if p.policy_id == base.policy_id and p.lifecycle in ("frozen_provisional", "approved"):
                        self._data[old_key][i] = p.model_copy(update={"lifecycle": "superseded"})
            rows.append(new_p)
            return new_p


class SupabasePolicyStore:
    """
    Adapter for assessment_policies table.
    Migration required (see migrations/2026_11_02_assessment_policies.sql).
    Falls back by raising if the table is missing so callers can use memory in tests.
    """

    def __init__(self, sb: Any):
        self._sb = sb

    def _row_to_policy(self, row: dict[str, Any]) -> AssessmentPolicy:
        return AssessmentPolicy.model_validate(row["policy_json"])

    def get_active(
        self,
        *,
        course_id: str,
        assignment_id: str,
        context_hash: str,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy | None:
        gkey = generation_config_key(gen_config)
        res = (
            self._sb.table("assessment_policies")
            .select("policy_json")
            .eq("course_id", str(course_id))
            .eq("assignment_id", str(assignment_id))
            .eq("assignment_context_hash", context_hash)
            .eq("generation_config_key", gkey)
            .eq("is_active", True)
            .in_("lifecycle", ["frozen_provisional", "approved"])
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return self._row_to_policy(rows[0])

    def freeze(
        self,
        policy: AssessmentPolicy,
        *,
        gen_config: dict[str, Any] | None = None,
    ) -> AssessmentPolicy:
        # Optimistic: insert active row; on unique conflict, re-read winner.
        gkey = generation_config_key(gen_config if gen_config is not None else policy.creation_config)
        frozen = policy.model_copy(update={"lifecycle": "frozen_provisional"})
        payload = {
            "policy_id": frozen.policy_id,
            "version": frozen.version,
            "course_id": frozen.course_id,
            "assignment_id": frozen.assignment_id,
            "assignment_context_hash": frozen.assignment_context_hash,
            "generation_config_key": gkey,
            "content_hash": frozen.content_hash,
            "lifecycle": frozen.lifecycle,
            "origin": frozen.origin,
            "is_active": True,
            "policy_json": frozen.model_dump(),
        }
        try:
            self._sb.table("assessment_policies").insert(payload).execute()
            return frozen
        except Exception:
            existing = self.get_active(
                course_id=policy.course_id,
                assignment_id=policy.assignment_id,
                context_hash=policy.assignment_context_hash,
                gen_config=gen_config if gen_config is not None else policy.creation_config,
            )
            if existing is not None:
                return existing
            raise

    def get_by_id_version(self, policy_id: str, version: int) -> AssessmentPolicy | None:
        res = (
            self._sb.table("assessment_policies")
            .select("policy_json")
            .eq("policy_id", policy_id)
            .eq("version", version)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return self._row_to_policy(rows[0]) if rows else None

    def approve(self, policy_id: str, version: int, *, approved_by: str) -> AssessmentPolicy:
        found = self.get_by_id_version(policy_id, version)
        if found is None:
            raise KeyError(f"policy {policy_id}@v{version} not found")
        if found.lifecycle == "superseded":
            raise ValueError("Cannot approve a superseded policy version")
        approved = found.model_copy(
            update={"lifecycle": "approved", "approved_by": approved_by, "approved_at": _now()}
        )
        self._sb.table("assessment_policies").update(
            {"lifecycle": "approved", "policy_json": approved.model_dump(), "is_active": True}
        ).eq("policy_id", policy_id).eq("version", version).execute()
        return approved

    def save_new_version(
        self,
        base: AssessmentPolicy,
        updated: AssessmentPolicy,
        *,
        edited_by: str,
    ) -> AssessmentPolicy:
        gkey = generation_config_key(updated.creation_config)
        new_p = updated.model_copy(
            update={
                "policy_id": base.policy_id,
                "version": int(base.version) + 1,
                "lifecycle": "frozen_provisional",
                "created_by": edited_by,
                "created_at": _now(),
                "approved_by": None,
                "approved_at": None,
            }
        )
        self._sb.table("assessment_policies").update(
            {"lifecycle": "superseded", "is_active": False}
        ).eq("policy_id", base.policy_id).eq("is_active", True).execute()
        self._sb.table("assessment_policies").insert(
            {
                "policy_id": new_p.policy_id,
                "version": new_p.version,
                "course_id": new_p.course_id,
                "assignment_id": new_p.assignment_id,
                "assignment_context_hash": new_p.assignment_context_hash,
                "generation_config_key": gkey,
                "content_hash": new_p.content_hash,
                "lifecycle": new_p.lifecycle,
                "origin": new_p.origin,
                "is_active": True,
                "policy_json": new_p.model_dump(),
            }
        ).execute()
        return new_p


_DEFAULT_STORE: InMemoryPolicyStore | None = None


def get_default_store() -> InMemoryPolicyStore:
    global _DEFAULT_STORE
    if _DEFAULT_STORE is None:
        _DEFAULT_STORE = InMemoryPolicyStore()
    return _DEFAULT_STORE


def reset_default_store() -> InMemoryPolicyStore:
    """Test helper: clear process-local policies."""
    global _DEFAULT_STORE, _MEMORY
    with _LOCK:
        _MEMORY = {}
        _DEFAULT_STORE = InMemoryPolicyStore(_MEMORY)
        return _DEFAULT_STORE
