"""Deterministic obligation-driven recovery controller (documented rules, not learned)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.budgets import RecoveryBudgets
from grading_server.evidence.coverage import mark_omitted_budget, mark_presented
from grading_server.evidence.recovery import _neighbor_ids, run_targeted_recovery
from grading_server.evidence.types import (
    OBLIGATION_CONTROLLER_VERSION,
    BudgetSnapshot,
    CriterionClaim,
    EvidenceObligation,
    ObligationState,
    RecoveryAction,
    RecoveryAttempt,
    SourceUnit,
)

CONTROLLER_VERSION = OBLIGATION_CONTROLLER_VERSION


@dataclass
class SubmissionBudget:
    """Shared per-submission counters — request ordering must not unlock unlimited recovery."""

    budgets: RecoveryBudgets
    inspected: set[str] = field(default_factory=set)
    calls: int = 0
    rounds: int = 0

    def snapshot(self) -> BudgetSnapshot:
        return BudgetSnapshot(
            inspected=len(self.inspected),
            calls=self.calls,
            rounds=self.rounds,
        )

    def exhausted(self) -> bool:
        return (
            self.calls >= self.budgets.max_extra_calls
            or len(self.inspected) >= self.budgets.max_inspected_units
            or self.rounds >= self.budgets.max_rounds
        )


def select_recovery_actions(
    *,
    obligation: EvidenceObligation,
    claim: CriterionClaim,
    units: list[SourceUnit],
    adapters: EvidenceAdapters,
) -> list[tuple[RecoveryAction, str]]:
    """
    Documented rule order — not a learned router.

    Returns ordered (action, reason) pairs to attempt until stop.
    """
    actions: list[tuple[RecoveryAction, str]] = []
    extraction_gap = any(
        "extraction" in (x or "").lower() or "Extraction" in (x or "")
        for x in (obligation.extraction_limitations + claim.processing_limitations)
    )
    has_retry = callable(getattr(adapters, "retry_extraction", None))

    if extraction_gap:
        if has_retry:
            actions.append(
                ("retry_extraction", "Extraction limitation recorded; safe retry adapter present")
            )
        actions.append(
            (
                "defer_instructor_review",
                "Extraction incomplete is not student failure; defer when retry unsupported",
            )
        )
        return actions

    if obligation.reference_evidence_needed and not claim.reference_evidence_ids:
        has_ref = callable(getattr(adapters, "retrieve_references", None))
        if has_ref:
            actions.append(
                (
                    "retrieve_approved_references",
                    "Criterion requires reference evidence; approved corpus retrieval available",
                )
            )
        actions.append(
            (
                "defer_instructor_review",
                "Reference evidence unavailable; cannot invent requirements from submission",
            )
        )
        return actions

    # Keyword/absence-style omission: inspect → neighbors → remaining → defer
    actions.append(("inspect_passages", "Search additional submission passages (keyword≠concept)"))
    actions.append(("include_neighbors", "Include neighboring source-unit context"))
    if any(u.presentation in ("available", "not_processed") for u in units):
        actions.append(
            ("inspect_remaining_units", "Inspect remaining unprocessed source units within budget")
        )
    actions.append(
        ("defer_instructor_review", "Stop when budget or inspection cannot resolve obligation")
    )
    return actions


def _append_attempt(
    claim: CriterionClaim,
    attempt: RecoveryAttempt,
) -> CriterionClaim:
    return claim.model_copy(
        update={"recovery_attempts": list(claim.recovery_attempts) + [attempt]}
    )


def run_obligation_controller(
    *,
    verdict: dict[str, Any],
    claim: CriterionClaim,
    obligation: EvidenceObligation,
    units: list[SourceUnit],
    adapters: EvidenceAdapters,
    budget: SubmissionBudget,
    force_timeout: bool = False,
    force_budget_exhausted: bool = False,
    is_proposal: bool = False,
) -> tuple[CriterionClaim, EvidenceObligation, list[SourceUnit], dict[str, Any] | None]:
    """
    Execute selected recovery actions under submission-scoped budgets.
    Reuses run_targeted_recovery ops for inspect/neighbor/remaining paths.
    """
    if force_timeout or force_budget_exhausted or budget.exhausted():
        before = budget.snapshot()
        reason = (
            "Recovery timed out"
            if force_timeout
            else "Recovery budget exhausted"
        )
        status = "timeout" if force_timeout else "budget_exhausted"
        attempt = RecoveryAttempt(
            round=budget.rounds + 1,
            status=status,
            action="defer_instructor_review",
            reason=reason,
            obligation_state_before=obligation.state,
            obligation_state_after="unresolved",
            budget_before=before,
            budget_after=before,
            judgment_changed=False,
            stop_reason=reason,
            error=reason,
        )
        claim = _append_attempt(claim, attempt)
        claim = claim.model_copy(
            update={
                "review_reasons": list(claim.review_reasons) + [reason],
                "evidence_check_status": "needs_review",
                "gate_decision": "defer",
            }
        )
        obligation = obligation.model_copy(update={"state": "unresolved"})
        revised = {
            **verdict,
            "justification": (verdict.get("justification") or "")
            + f"\n\n[evidence] {reason} Prior criterion score kept for instructor review.",
        }
        return claim, obligation, units, revised

    plan = select_recovery_actions(
        obligation=obligation, claim=claim, units=units, adapters=adapters
    )
    working_units = list(units)
    revised: dict[str, Any] | None = None
    state_before: ObligationState = obligation.state

    for action, reason in plan:
        if budget.exhausted():
            break
        budget.rounds += 1
        before = budget.snapshot()
        t0 = time.perf_counter()

        if action == "defer_instructor_review":
            attempt = RecoveryAttempt(
                round=budget.rounds,
                status="ok",
                action=action,
                reason=reason,
                obligation_state_before=state_before,
                obligation_state_after="unresolved",
                budget_before=before,
                budget_after=budget.snapshot(),
                judgment_changed=False,
                stop_reason=reason,
                duration_ms=int((time.perf_counter() - t0) * 1000),
            )
            claim = _append_attempt(claim, attempt)
            claim = claim.model_copy(
                update={
                    "review_reasons": list(claim.review_reasons) + [reason],
                    "evidence_check_status": "needs_review",
                    "claim_type": "unresolved",
                    "gate_decision": "defer",
                }
            )
            obligation = obligation.model_copy(update={"state": "unresolved"})
            # Do not auto-raise; unresolved → keep prior or null via caller.
            revised = {
                **verdict,
                "score": None,
                "status": "not_assessable",
                "failure_kind": "processing_failed",
                "justification": (verdict.get("justification") or "")
                + f"\n\n[evidence] {reason}",
            }
            return claim, obligation, working_units, revised

        if action == "retry_extraction":
            retry_fn: Callable[..., Any] | None = getattr(adapters, "retry_extraction", None)
            if not callable(retry_fn):
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="failed",
                    action=action,
                    reason="retry_extraction unsupported by adapters",
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=False,
                    stop_reason="unsupported_retry_extraction",
                    error="unsupported",
                )
                claim = _append_attempt(claim, attempt)
                continue
            budget.calls += 1
            adapters.bump_call()
            try:
                new_units = retry_fn(units=working_units)
                if new_units:
                    working_units = list(new_units)
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="ok",
                    action=action,
                    reason=reason,
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=False,
                    duration_ms=int((time.perf_counter() - t0) * 1000),
                )
                claim = _append_attempt(claim, attempt)
            except Exception as e:  # noqa: BLE001
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="failed",
                    action=action,
                    reason=reason,
                    error=str(e)[:200],
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=False,
                    stop_reason="retry_extraction_failed",
                )
                claim = _append_attempt(claim, attempt)
            continue

        if action == "retrieve_approved_references":
            ref_fn: Callable[..., Any] | None = getattr(adapters, "retrieve_references", None)
            if not callable(ref_fn):
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="failed",
                    action=action,
                    reason="retrieve_approved_references unsupported",
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=False,
                    stop_reason="unsupported_reference_retrieval",
                    error="unsupported",
                )
                claim = _append_attempt(claim, attempt)
                continue
            budget.calls += 1
            adapters.bump_call()
            try:
                ref_ids = list(ref_fn(criterion_id=obligation.criterion_id) or [])
                claim = claim.model_copy(
                    update={
                        "reference_evidence_ids": list(
                            dict.fromkeys(list(claim.reference_evidence_ids) + [str(x) for x in ref_ids])
                        )
                    }
                )
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="ok",
                    action=action,
                    reason=reason,
                    recovered_evidence_ids=[str(x) for x in ref_ids],
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=bool(ref_ids),
                    duration_ms=int((time.perf_counter() - t0) * 1000),
                )
                claim = _append_attempt(claim, attempt)
                if not ref_ids:
                    continue
            except Exception as e:  # noqa: BLE001
                attempt = RecoveryAttempt(
                    round=budget.rounds,
                    status="failed",
                    action=action,
                    reason=reason,
                    error=str(e)[:200],
                    obligation_state_before=state_before,
                    obligation_state_after=state_before,
                    budget_before=before,
                    budget_after=budget.snapshot(),
                    judgment_changed=False,
                    stop_reason="reference_retrieval_failed",
                )
                claim = _append_attempt(claim, attempt)
            continue

        # inspect_passages / include_neighbors / inspect_remaining_units → reuse targeted recovery
        if action in ("inspect_passages", "include_neighbors", "inspect_remaining_units"):
            prior_score = verdict.get("score")
            claim2, working_units, revised, budget.calls = run_targeted_recovery(
                verdict=verdict,
                claim=claim,
                units=working_units,
                adapters=adapters,
                budgets=budget.budgets,
                inspected_so_far=budget.inspected,
                calls_so_far=budget.calls,
                is_proposal=is_proposal,
            )
            # Enrich the last attempt written by run_targeted_recovery with controller fields.
            attempts = list(claim2.recovery_attempts)
            if attempts:
                last = attempts[-1]
                changed = bool(
                    revised is not None
                    and revised.get("score") != prior_score
                )
                after_state: ObligationState = state_before
                if changed and isinstance(revised.get("score"), (int, float)) and float(revised["score"]) > 0:
                    after_state = "supported"
                elif last.status in ("no_candidates",) or (
                    revised is None and last.status == "ok"
                ):
                    after_state = "inspected_not_demonstrated"
                attempts[-1] = last.model_copy(
                    update={
                        "action": action,
                        "reason": reason,
                        "obligation_state_before": state_before,
                        "obligation_state_after": after_state,
                        "budget_before": before,
                        "budget_after": budget.snapshot(),
                        "judgment_changed": changed,
                        "stop_reason": None if changed else last.error,
                    }
                )
                claim2 = claim2.model_copy(update={"recovery_attempts": attempts})
            claim = claim2
            if revised is not None and revised.get("score") != prior_score:
                obligation = obligation.model_copy(
                    update={
                        "state": "supported",
                        "available_supporting_ids": list(
                            dict.fromkeys(
                                list(obligation.available_supporting_ids)
                                + list(claim.submission_evidence_ids or [])
                            )
                        ),
                    }
                )
                claim = claim.model_copy(
                    update={
                        "obligation": obligation,
                        "obligation_state": obligation.state,
                        "gate_decision": "recover",
                    }
                )
                return claim, obligation, working_units, revised
            # No judgment change — try next action
            state_before = obligation.state
            continue

    # Exhausted plan without resolution
    before = budget.snapshot()
    attempt = RecoveryAttempt(
        round=budget.rounds,
        status="no_candidates",
        action="defer_instructor_review",
        reason="Controller actions exhausted without resolving obligation",
        obligation_state_before=state_before,
        obligation_state_after="unresolved",
        budget_before=before,
        budget_after=budget.snapshot(),
        judgment_changed=False,
        stop_reason="actions_exhausted",
    )
    claim = _append_attempt(claim, attempt)
    remaining = [u.source_unit_id for u in working_units if u.source_unit_id not in budget.inspected]
    if remaining:
        working_units = mark_omitted_budget(working_units, remaining)
    obligation = obligation.model_copy(update={"state": "unresolved"})
    claim = claim.model_copy(
        update={
            "obligation": obligation,
            "obligation_state": "unresolved",
            "evidence_check_status": "needs_review",
            "gate_decision": "defer",
            "review_reasons": list(claim.review_reasons)
            + ["Controller could not resolve omission obligation"],
        }
    )
    revised = {
        **verdict,
        "score": None,
        "status": "not_assessable",
        "failure_kind": "processing_failed",
        "justification": (verdict.get("justification") or "")
        + "\n\n[evidence] Unresolved obligation after recovery actions; not a fabricated student zero.",
    }
    return claim, obligation, working_units, revised
