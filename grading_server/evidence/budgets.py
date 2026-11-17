from __future__ import annotations
from dataclasses import dataclass

RECOVERY_BUDGET_VERSION = "recovery_budget_v1"


@dataclass(frozen=True)
class RecoveryBudgets:
    max_rounds: int = 2
    max_inspected_units: int = 24
    max_extra_calls: int = 6
    timeout_seconds: float = 45.0
    version: str = RECOVERY_BUDGET_VERSION


def default_budgets() -> RecoveryBudgets:
    return RecoveryBudgets()
