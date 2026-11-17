from __future__ import annotations
import os
from typing import Any

ExperimentMode = str  # runtime; validated values below
ALLOWED_MODES = frozenset(
    {"baseline", "verification_only", "coverage_recovery", "obligation_recovery"}
)
# Live Teacher Hub path: automatic verify + bounded recovery (no instructor mode picker).
# Mode D (obligation_recovery) is opt-in research — does not change this default.
DEFAULT_EXPERIMENT_MODE = "coverage_recovery"

# Experiment labels for harness comparisons (identical policy/corpus/submission versions).
EXPERIMENT_LABELS = {
    "A": "baseline",
    "B": "verification_only",
    "C": "coverage_recovery",
    "D": "obligation_recovery",
}


def _truthy(raw: Any) -> bool:
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return bool(raw)


def validate_experiment_mode(raw: Any, *, fallback: str | None = None) -> str:
    """Normalize a mode string. Unknown/missing → fallback (default coverage_recovery)."""
    default = fallback if fallback in ALLOWED_MODES else DEFAULT_EXPERIMENT_MODE
    if raw is None or raw == "":
        return default
    mode = str(raw).strip().lower()
    if mode not in ALLOWED_MODES:
        return default
    return mode


def server_configured_mode() -> str:
    """Operator ablation override via env; otherwise automatic coverage_recovery."""
    return validate_experiment_mode(os.getenv("EDUCONNECT_EVIDENCE_MODE"))


def client_mode_override_allowed() -> bool:
    """Opt-in only for local research UIs. Default: client cannot choose mode."""
    return _truthy(os.getenv("EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE"))


def resolve_experiment_mode(client_raw: Any = None) -> str:
    """
    Teacher Hub /api/grade policy:
    - Default automatic path = coverage_recovery (verify always; recover only on omission penalties).
    - Operators may force baseline / verification_only / obligation_recovery via EDUCONNECT_EVIDENCE_MODE.
    - Client body experiment_mode is ignored unless EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE=1.
    Ablation harnesses call run_evidence_pipeline(..., experiment_mode=...) directly.
    """
    if client_mode_override_allowed() and client_raw not in (None, ""):
        return validate_experiment_mode(client_raw)
    return server_configured_mode()


def mode_for_experiment_label(label: str) -> str:
    """Map harness labels A/B/C/D to server modes."""
    key = str(label or "").strip().upper()
    return EXPERIMENT_LABELS.get(key, DEFAULT_EXPERIMENT_MODE)
