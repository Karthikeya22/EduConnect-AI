"""Post-verify evidence locks — prevent silent mutation of verified omission judgments."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from grading_server.evidence.types import ClaimType, EvidenceLock


def _lock_hash(score: Any, anchor: str, claim_type: str) -> str:
    blob = json.dumps(
        {"score": score, "anchor": anchor, "claim_type": claim_type},
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def pin_evidence_lock(verdict: dict[str, Any], claim_type: ClaimType | str) -> EvidenceLock:
    score = verdict.get("score")
    anchor = str(verdict.get("evidence_anchor") or "")
    ct = str(claim_type or "unresolved")
    return EvidenceLock(
        score=float(score) if isinstance(score, (int, float)) else None,
        evidence_anchor=anchor,
        claim_type=ct,  # type: ignore[arg-type]
        content_hash=_lock_hash(score, anchor, ct),
        evidence_verified=True,
    )


def lock_violated(verdict: dict[str, Any], lock: EvidenceLock | dict[str, Any] | None) -> bool:
    """True when score/anchor/omission claim diverged from the pinned lock."""
    if not lock:
        return False
    if isinstance(lock, dict):
        lock = EvidenceLock.model_validate(lock)
    claim = verdict.get("criterion_claim") or {}
    claim_type = str(claim.get("claim_type") or "")
    score = verdict.get("score")
    anchor = str(verdict.get("evidence_anchor") or "")
    # Compare score with float tolerance
    locked_score = lock.score
    score_changed = False
    if locked_score is None and score is not None:
        score_changed = True
    elif locked_score is not None and score is None:
        score_changed = True
    elif locked_score is not None and isinstance(score, (int, float)):
        score_changed = abs(float(score) - float(locked_score)) > 1e-9
    anchor_changed = anchor != lock.evidence_anchor
    claim_changed = claim_type != str(lock.claim_type)
    # Only care about omission-related claim flips or score/anchor changes
    omission_types = {"assessed_not_demonstrated", "unresolved", "contradicted"}
    if claim_changed and (
        claim_type in omission_types or str(lock.claim_type) in omission_types
    ):
        return True
    return score_changed or anchor_changed
