"""Assignment-context hashing for policy freeze identity."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _norm(text: str) -> str:
    return "\n".join(line.strip() for line in (text or "").replace("\r\n", "\n").split("\n")).strip()


def assignment_context_hash(
    *,
    assignment_name: str = "",
    assignment_description: str = "",
    explicit_outcomes: list[str] | None = None,
    points_possible: float | None = None,
) -> str:
    payload = {
        "name": _norm(assignment_name),
        "description": _norm(assignment_description),
        "outcomes": [_norm(o) for o in (explicit_outcomes or []) if _norm(o)],
        "points_possible": points_possible,
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def policy_content_hash(policy_body: dict[str, Any]) -> str:
    """Hash immutable scoring content only (exclude timestamps / approver)."""
    keys = (
        "criteria",
        "maximum_score",
        "weighting_mode",
        "weighting_assumptions",
        "origin",
        "assignment_context_hash",
        "generation_protocol_version",
        "creation_config",
        "formative_only",
        "disclosed_assumptions",
        "source_document_versions",
    )
    slim = {k: policy_body.get(k) for k in keys}
    blob = json.dumps(slim, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def generation_config_key(config: dict[str, Any] | None) -> str:
    cfg = dict(config or {})
    cfg.setdefault("protocol", "policy-gen-v1")
    blob = json.dumps(cfg, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
