from __future__ import annotations
import time
from typing import Any

from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.budgets import RecoveryBudgets
from grading_server.evidence.coverage import mark_presented, mark_omitted_budget
from grading_server.evidence.types import CriterionClaim, RecoveryAttempt, SourceUnit


def _neighbor_ids(units: list[SourceUnit], center_ids: list[str]) -> list[str]:
    id_list = [u.source_unit_id for u in units]
    out: list[str] = []
    for cid in center_ids:
        if cid not in id_list:
            continue
        i = id_list.index(cid)
        for j in (i - 1, i, i + 1):
            if 0 <= j < len(id_list):
                out.append(id_list[j])
    return list(dict.fromkeys(out))


def run_targeted_recovery(
    *,
    verdict: dict[str, Any],
    claim: CriterionClaim,
    units: list[SourceUnit],
    adapters: EvidenceAdapters,
    budgets: RecoveryBudgets,
    inspected_so_far: set[str],
    calls_so_far: int,
    force_timeout: bool = False,
    force_budget_exhausted: bool = False,
    is_proposal: bool = False,
) -> tuple[CriterionClaim, list[SourceUnit], dict[str, Any] | None, int]:
    """
    Bounded recovery for an omission-based criterion.
    Returns (updated_claim, updated_units, revised_verdict_or_None, new_call_count).
    """
    attempts = list(claim.recovery_attempts)
    revised: dict[str, Any] | None = None
    call_count = calls_so_far
    working_units = list(units)

    def _defer_keep_score(status: str, reason: str) -> tuple[CriterionClaim, list[SourceUnit], dict[str, Any] | None, int]:
        """Budget/timeout: keep prior score so the draft total still renders; flag for review.

        shortcut: does not null the criterion on resource limits; revisit if policy requires
        nullable scores whenever recovery cannot finish.
        """
        attempts.append(RecoveryAttempt(round=1, status=status, error=reason[:200] or None))
        updated = claim.model_copy(
            update={
                "recovery_attempts": attempts,
                "review_reasons": list(claim.review_reasons) + [reason],
                "evidence_check_status": "needs_review",
                "processing_limitations": list(
                    dict.fromkeys(list(claim.processing_limitations) + ["Inspection budget reached"])
                ),
            }
        )
        revised_keep = {
            **verdict,
            "justification": (verdict.get("justification") or "")
            + f"\n\n[evidence] {reason} Prior criterion score kept for instructor review.",
        }
        return updated, working_units, revised_keep, call_count

    if force_timeout:
        return _defer_keep_score("timeout", "Recovery timed out")

    if force_budget_exhausted or call_count >= budgets.max_extra_calls:
        return _defer_keep_score("budget_exhausted", "Recovery budget exhausted")

    query = " ".join(
        [
            str(verdict.get("criterion_name") or ""),
            str(verdict.get("justification") or "")[:200],
            " ".join(verdict.get("missing_keywords") or []),
            " ".join(verdict.get("required_concepts") or []),
        ]
    ).strip() or str(verdict.get("criterion_id") or "criterion")

    t0 = time.perf_counter()
    candidates = adapters.search_units(query=query, units=working_units, limit=8)
    cand_ids = [u.source_unit_id for u in candidates]
    neigh = _neighbor_ids(working_units, cand_ids)
    fresh = [i for i in (cand_ids + neigh) if i not in inspected_so_far]
    # Candidates already in the presented window may still need reassessment
    # (paraphrase without expected keywords). Re-inspect those once.
    remaining_budget = max(1, budgets.max_inspected_units - len(inspected_so_far))
    to_inspect = (fresh or list(cand_ids))[:remaining_budget]

    if not to_inspect:
        remaining = [u.source_unit_id for u in working_units if u.source_unit_id not in inspected_so_far]
        omitted = remaining[: max(0, len(remaining))]
        working_units = mark_omitted_budget(working_units, omitted)
        attempts.append(RecoveryAttempt(round=1, status="no_candidates", inspected_unit_ids=[]))
        claim = claim.model_copy(
            update={
                "recovery_attempts": attempts,
                "claim_type": "assessed_not_demonstrated",
                "change_reason": "No additional candidate passages found after search",
                "revised_score": verdict.get("score") if isinstance(verdict.get("score"), int) else 0,
            }
        )
        return claim, working_units, None, call_count

    working_units = mark_presented(working_units, to_inspect)
    inspected_so_far.update(to_inspect)
    by_id = {u.source_unit_id: u for u in working_units}
    passages = [by_id[i].text for i in to_inspect if i in by_id and by_id[i].text]

    duration_ms = int((time.perf_counter() - t0) * 1000)
    recovered_ids = list(to_inspect)

    def _heuristic_partial_from_passages() -> dict[str, Any] | None:
        """Lift a zero/low omission score when recovered student text is substantial."""
        import math

        req = [str(x).lower() for x in (verdict.get("required_concepts") or [])]
        missing = [str(x).lower() for x in (verdict.get("missing_keywords") or [])]
        blob = "\n".join(passages).lower()
        hits = sum(1 for k in (req + missing) if k and k in blob)
        joined = " ".join(passages)
        # Substantial recovered student text is enough to reopen a zero/low omission
        # score — do not require exact missing_keyword hits (proposals paraphrase).
        if not (hits > 0 or (passages and len(joined) > 80)):
            return None
        max_score = int(verdict.get("max_score") or 0)
        old = int(verdict.get("score") or 0)
        if is_proposal and max_score:
            # Proposal plans with recovered prose: floor at ~60% (not a token +1).
            floor = max(1, math.ceil(max_score * 0.6))
            bump = max(1, max_score // 2) if hits > 0 else max(1, max_score // 3)
            new_score = min(max_score, max(old + bump, floor))
        else:
            bump = max(1, max_score // 2) if hits > 0 else max(1, max_score // 3)
            new_score = min(max_score, max(old + bump, 1)) if max_score else old
        if new_score <= old and max_score:
            new_score = min(max_score, old + 1) if old < max_score else old
        return {
            **verdict,
            "score": new_score,
            "status": "partial" if new_score < max_score else "full",
            "evidence_anchor": passages[0][:240] if passages else verdict.get("evidence_anchor"),
            "justification": (verdict.get("justification") or "")
            + "\n\n[evidence] Additional evidence recovered; criterion reassessed (not auto full credit).",
            "placement_issue": False,
            "placement_ok": True,
        }

    from grading_server.proposal_filters import finalize_raised_verdict

    # Reassess only this criterion when adapter provided
    if adapters.reassess_criterion is not None:
        call_count += 1
        adapters.bump_call()
        try:
            revised = adapters.reassess_criterion(verdict=verdict, extra_passages=passages)
            # If live reassess kept a zero despite recovered passages, apply partial floor.
            floor = _heuristic_partial_from_passages()
            if (
                floor
                and isinstance(revised, dict)
                and int(revised.get("score") or 0) < int(floor.get("score") or 0)
            ):
                revised = {
                    **revised,
                    "score": floor["score"],
                    "status": floor["status"],
                    "evidence_anchor": revised.get("evidence_anchor") or floor.get("evidence_anchor"),
                    "placement_issue": False,
                    "placement_ok": True,
                    "justification": (str(revised.get("justification") or "") + "\n\n[evidence] Score floor from recovered passages.").strip(),
                }
            revised = finalize_raised_verdict(revised, prior=verdict, is_proposal=is_proposal)
        except Exception as e:  # noqa: BLE001 — preserve prior evidence on failure
            attempts.append(
                RecoveryAttempt(
                    round=1,
                    status="failed",
                    inspected_unit_ids=to_inspect,
                    recovered_evidence_ids=[],
                    error=str(e)[:200],
                    duration_ms=duration_ms,
                )
            )
            claim = claim.model_copy(
                update={
                    "recovery_attempts": attempts,
                    "review_reasons": list(claim.review_reasons) + [f"Recovery call failed: {e}"[:200]],
                }
            )
            return claim, working_units, None, call_count
    else:
        revised = finalize_raised_verdict(
            _heuristic_partial_from_passages(), prior=verdict, is_proposal=is_proposal
        )

    attempts.append(
        RecoveryAttempt(
            round=1,
            status="ok",
            inspected_unit_ids=to_inspect,
            recovered_evidence_ids=recovered_ids if revised else [],
            duration_ms=duration_ms,
        )
    )

    updates: dict[str, Any] = {
        "recovery_attempts": attempts,
        "submission_evidence_ids": list(
            dict.fromkeys(list(claim.submission_evidence_ids) + recovered_ids)
        ),
    }
    if revised is not None:
        updates.update(
            {
                "original_score": verdict.get("score") if isinstance(verdict.get("score"), int) else claim.original_score,
                "revised_score": revised.get("score"),
                "change_reason": "Additional evidence recovered",
                "claim_type": "partially_demonstrated"
                if int(revised.get("score") or 0) < int(revised.get("max_score") or 0)
                else "demonstrated",
                "evidence_check_status": "valid",
            }
        )
    else:
        updates.update(
            {
                "claim_type": "assessed_not_demonstrated",
                "revised_score": verdict.get("score") if isinstance(verdict.get("score"), int) else 0,
                "change_reason": "Recovery inspected additional units; omission still assessed",
            }
        )

    claim = claim.model_copy(update=updates)
    return claim, working_units, revised, call_count
