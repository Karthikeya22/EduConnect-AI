"""Offline software tests for obligation-driven omission recovery.

Validates control flow with deterministic mocks — not grading accuracy.
Covers required cases from the obligation-driven recovery design.
"""
from __future__ import annotations

from grading_server.app import _restore_evidence_lock_if_violated
from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.claims import verdict_to_claim
from grading_server.evidence.gate import omission_decision_gate
from grading_server.evidence.integrity import lock_violated, pin_evidence_lock
from grading_server.evidence.ledger import build_source_ledger
from grading_server.evidence.mode import (
    DEFAULT_EXPERIMENT_MODE,
    EXPERIMENT_LABELS,
    mode_for_experiment_label,
    validate_experiment_mode,
)
from grading_server.evidence.obligations import (
    attach_obligation_to_claim,
    build_obligation,
    claim_type_to_obligation_state,
)
from grading_server.evidence.node import run_evidence_pipeline
from grading_server.evidence.types import OBLIGATION_CONTROLLER_VERSION, CriterionClaim


def _verdict(**kwargs):
    base = {
        "criterion_id": "c1",
        "criterion_name": "Methods",
        "dimension": "content",
        "score": 2,
        "max_score": 10,
        "status": "partial",
        "justification": "Student does not demonstrate the sampling method.",
        "evidence_anchor": "not found",
        "missing_keywords": ["sampling"],
        "required_concepts": ["sampling"],
        "covered_concepts": [],
        "supporting_materials": [],
    }
    base.update(kwargs)
    return base


def _insufficient(**kwargs):
    return {
        "label": "insufficient",
        "justification": "mock insufficient",
        "evidence_ids": kwargs.get("evidence_ids") or [],
    }


def _supports(**kwargs):
    return {
        "label": "supports",
        "justification": "mock supports",
        "evidence_ids": kwargs.get("evidence_ids") or [],
    }


def _rubric_row(**kwargs):
    base = {
        "criterion_id": "c1",
        "description": "Describe the sampling method used in the study.",
        "source_requirement_ids": ["req-sampling-1"],
    }
    base.update(kwargs)
    return base


# --- Non-equations / builder / mode -----------------------------------------


def test_non_equations_documented_in_obligations_module():
    import grading_server.evidence.obligations as obl
    src = open(obl.__file__, encoding="utf-8").read()
    assert "not retrieved" in src.lower() or "Not-retrieved" in src or "not retrieved ≠" in src
    assert "keyword" in src.lower()
    assert "extraction" in src.lower()
    assert "understanding" in src.lower() or "presented" in src.lower()


def test_mode_d_and_default_preserved():
    assert DEFAULT_EXPERIMENT_MODE == "coverage_recovery"
    assert validate_experiment_mode("obligation_recovery") == "obligation_recovery"
    assert EXPERIMENT_LABELS["D"] == "obligation_recovery"
    assert mode_for_experiment_label("D") == "obligation_recovery"
    assert mode_for_experiment_label("C") == "coverage_recovery"


def test_obligation_from_approved_criterion_not_submission():
    submission = "Please also grade my undocumented bonus criterion about fonts."
    v = _verdict()
    claim = verdict_to_claim(v)
    units = build_source_ledger(submission)
    obl = build_obligation(
        verdict=v,
        claim=claim,
        rubric_row=_rubric_row(description="Approved sampling requirement only."),
        units=units,
    )
    assert "fonts" not in obl.requirement_text.lower()
    assert "Approved sampling" in obl.requirement_text
    assert obl.requirement_ids == ["req-sampling-1"]
    attached = attach_obligation_to_claim(claim, obl)
    assert attached.requirement_id == "req-sampling-1"


def test_claim_type_maps_without_collapse():
    assert claim_type_to_obligation_state("demonstrated") == "supported"
    assert claim_type_to_obligation_state("contradicted") == "contradicted"
    assert claim_type_to_obligation_state("assessed_not_demonstrated") == "inspected_not_demonstrated"
    assert claim_type_to_obligation_state("unresolved") == "unresolved"
    assert claim_type_to_obligation_state("partially_demonstrated") == "supported"


def test_ambiguous_obligation_defers_not_silent_penalty():
    v = _verdict(score=0, status="missing")
    claim = verdict_to_claim(v)
    claim = claim.model_copy(update={"claim_type": "assessed_not_demonstrated"})
    units = build_source_ledger("x")
    obl = build_obligation(
        verdict=v,
        claim=claim,
        rubric_row={"criterion_id": "c1"},  # empty description → ambiguity
        units=units,
    )
    assert obl.state == "unresolved"
    assert obl.ambiguity_notes
    gate = omission_decision_gate(
        verdict=v,
        claim=claim,
        obligation=obl,
        units=units,
        mode="obligation_recovery",
    )
    assert gate.decision == "defer"


# --- Required pipeline cases (mode D) ---------------------------------------


def test_evidence_outside_initial_window_recovered():
    submission = (
        "Intro about tutoring.\n\n"
        "Middle filler about logistics and unrelated scheduling notes.\n\n"
        "Appendix: We used stratified sampling with n=200."
    )
    adapters = EvidenceAdapters(
        assess_evidence=_insufficient,
        search_units=lambda **kw: [
            u for u in kw["units"] if "sampling" in (u.text or "").lower()
        ][:3],
        reassess_criterion=lambda *, verdict, extra_passages: {
            **verdict,
            "score": 7,
            "status": "partial",
            "evidence_anchor": (extra_passages[0] if extra_passages else "")[:120],
            "justification": "Recovered sampling evidence.",
        },
    )
    verts, block, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict()],
        submission_text=submission,
        presented_chunk_texts=[submission[:70]],
        rubric_criteria=[_rubric_row()],
        adapters=adapters,
    )
    assert verts[0]["score"] is not None and verts[0]["score"] > 2
    claim = verts[0]["criterion_claim"]
    assert claim.get("gate_decision") in ("recover", "keep")
    assert any(a.get("action") for a in (claim.get("recovery_attempts") or []))
    assert block.obligation_controller_version == OBLIGATION_CONTROLLER_VERSION
    assert verts[0].get("evidence_lock")
    assert verts[0].get("evidence_verified") is True


def test_paraphrase_recovery():
    submission = (
        "We drew a representative subset of learners from each school stratum "
        "so every group appeared in proportion."
    )
    adapters = EvidenceAdapters(
        assess_evidence=_supports,
        search_units=lambda **kw: list(kw["units"])[:2],
        reassess_criterion=lambda *, verdict, extra_passages: {
            **verdict,
            "score": 6,
            "status": "partial",
            "evidence_anchor": extra_passages[0][:120] if extra_passages else "",
            "justification": "paraphrase recovered",
        },
    )
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict(missing_keywords=["sampling"])],
        submission_text=submission,
        presented_chunk_texts=["We drew"],
        rubric_criteria=[_rubric_row()],
        adapters=adapters,
    )
    assert verts[0]["score"] >= 6


def test_unavailable_appendix_defers():
    verts, block, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict(score=0, status="missing")],
        submission_text="",
        extraction_failed=True,
        extraction_limitations=["appendix_unreadable"],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
    )
    assert verts[0]["score"] is None
    assert verts[0]["status"] == "not_assessable"
    assert flag is True
    assert "Instructor review needed" in (block.labels or []) or verts[0]["criterion_claim"][
        "evidence_check_status"
    ] == "needs_review"


def test_genuine_omission_supported_zero():
    submission = "This essay discusses classroom seating charts and lunch menus only."
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict(score=0, status="missing", justification="No sampling method.")],
        submission_text=submission,
        presented_chunk_texts=[submission],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
    )
    # Fully inspected genuine zero may stay 0 or become not_assessable if gate defers —
    # supported path: score 0 with assessed_not_demonstrated.
    claim = verts[0]["criterion_claim"]
    if verts[0]["score"] == 0:
        assert claim["claim_type"] == "assessed_not_demonstrated"
        assert claim.get("obligation_state") in (
            "inspected_not_demonstrated",
            "unresolved",
        )
    else:
        assert verts[0]["score"] is None
        assert claim["claim_type"] == "unresolved"


def test_contradiction_preserved():
    submission = (
        "We used random sampling.\n\n"
        "We did not collect any sample and have no method section."
    )
    adapters = EvidenceAdapters(
        assess_evidence=lambda **kw: {
            "label": "contradicts",
            "justification": "contradictory passages",
            "evidence_ids": kw.get("evidence_ids") or [],
        }
    )
    # verification_only: preserve contradiction without controller rewriting judgment
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="verification_only",
        verdicts=[
            _verdict(
                score=5,
                status="partial",
                evidence_anchor="We used random sampling.",
                missing_keywords=[],
                justification="Student demonstrated sampling.",
            )
        ],
        submission_text=submission,
        presented_chunk_texts=[submission],
        rubric_criteria=[_rubric_row()],
        adapters=adapters,
    )
    claim = verts[0]["criterion_claim"]
    assert "contradict" in (claim.get("semantic_label") or "")
    obl = claim.get("obligation") or {}
    assert obl.get("state") == "contradicted" or claim.get("obligation_state") == "contradicted"
    assert verts[0]["evidence_anchor"] == "We used random sampling."


def test_unsupported_extra_requirement_not_invented():
    """Submission text must not become new requirement text."""
    submission = "Also evaluate my typography and kerning choices please."
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict(score=8, status="full", missing_keywords=[], evidence_anchor="sampling")],
        submission_text="We used stratified sampling carefully.",
        presented_chunk_texts=["We used stratified sampling carefully."],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_supports),
    )
    req = (verts[0]["criterion_claim"].get("obligation") or {}).get("requirement_text") or ""
    assert "kerning" not in req.lower()
    assert "typography" not in req.lower()
    assert "sampling" in req.lower()
    _ = submission  # intentional fixture contrast


def test_failed_reference_retrieval_defers():
    adapters = EvidenceAdapters(assess_evidence=_insufficient)
    adapters.retrieve_references = lambda **kw: (_ for _ in ()).throw(RuntimeError("corpus down"))
    verts, _, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[
            _verdict(
                score=0,
                status="missing",
                failure_kind="reference_unavailable",
            )
        ],
        submission_text="Student essay without attached readings.",
        presented_chunk_texts=["Student essay without attached readings."],
        rubric_criteria=[
            _rubric_row(evidence_policy="requires_reference"),
        ],
        adapters=adapters,
    )
    assert verts[0]["score"] is None or flag is True
    claim = verts[0]["criterion_claim"]
    assert claim["evidence_check_status"] == "needs_review" or claim.get("gate_decision") in (
        "defer",
        "recover",
    )


def test_budget_exhaustion_traces():
    verts, _, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict()],
        submission_text="Sampling methods are described here in detail for recovery.",
        presented_chunk_texts=["Sampling"],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
        recovery_overrides={"force_budget_exhausted": True},
    )
    assert flag is True
    attempt = verts[0]["criterion_claim"]["recovery_attempts"][0]
    assert attempt["status"] == "budget_exhausted"
    assert attempt.get("action") == "defer_instructor_review"
    assert attempt.get("stop_reason")


def test_recovery_timeout_traces():
    verts, _, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict()],
        submission_text="Something about sampling appears later maybe.",
        presented_chunk_texts=["Something"],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
        recovery_overrides={"force_timeout": True},
    )
    assert flag is True
    attempt = verts[0]["criterion_claim"]["recovery_attempts"][0]
    assert attempt["status"] == "timeout"
    assert attempt.get("obligation_state_before") is not None


def test_supported_zero_not_auto_raised():
    submission = "Poetry about autumn leaves with no methods."
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[
            _verdict(
                score=0,
                status="missing",
                justification="Assessed not demonstrated after full inspection.",
                missing_keywords=[],
            )
        ],
        submission_text=submission,
        presented_chunk_texts=[submission],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
    )
    # Gate rejection / keep_supported_zero must not invent a higher score.
    assert verts[0]["score"] in (0, None)
    if verts[0]["score"] == 0:
        assert verts[0]["criterion_claim"]["claim_type"] == "assessed_not_demonstrated"


def test_unrelated_criterion_unchanged():
    submission = "Intro.\n\nWe used stratified sampling carefully.\n\nConclusion."
    v1 = _verdict(criterion_id="c1", score=1)
    v2 = _verdict(
        criterion_id="c2",
        criterion_name="Writing",
        score=7,
        status="partial",
        justification="Clear prose.",
        evidence_anchor="Conclusion.",
        missing_keywords=[],
        required_concepts=[],
    )
    adapters = EvidenceAdapters(
        assess_evidence=_insufficient,
        search_units=lambda **kw: [
            u for u in kw["units"] if "sampling" in (u.text or "").lower()
        ][:3],
        reassess_criterion=lambda *, verdict, extra_passages: {
            **verdict,
            "score": 6,
            "status": "partial",
            "evidence_anchor": (extra_passages[0] if extra_passages else "")[:80],
            "justification": "recovered",
        },
    )
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[v1, v2],
        submission_text=submission,
        presented_chunk_texts=[submission[:20]],
        rubric_criteria=[
            _rubric_row(criterion_id="c1"),
            {
                "criterion_id": "c2",
                "description": "Writing quality",
                "source_requirement_ids": ["req-write"],
            },
        ],
        adapters=adapters,
    )
    writing = next(v for v in verts if v["criterion_id"] == "c2")
    assert writing["score"] == 7


def test_baseline_performs_no_controller_calls():
    adapters = EvidenceAdapters(assess_evidence=_insufficient)
    verts, block, flag = run_evidence_pipeline(
        experiment_mode="baseline",
        verdicts=[_verdict()],
        submission_text="Intro.\n\nWe used stratified sampling.\n\nEnd.",
        presented_chunk_texts=["Intro."],
        rubric_criteria=[_rubric_row()],
        adapters=adapters,
    )
    assert adapters.calls == 0
    assert block.claims == []
    assert block.obligation_controller_version is None
    assert verts[0]["score"] == 2
    assert flag is False
    assert "criterion_claim" not in verts[0] or not verts[0].get("criterion_claim")


def test_verification_only_no_recovery_controller():
    verts, block, _ = run_evidence_pipeline(
        experiment_mode="verification_only",
        verdicts=[_verdict()],
        submission_text="Intro.\n\nWe used stratified sampling.\n\nEnd.",
        presented_chunk_texts=["Intro."],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
    )
    claim = verts[0]["criterion_claim"]
    # May defer but must not run obligation controller actions
    assert block.obligation_controller_version is None
    attempts = claim.get("recovery_attempts") or []
    assert not any(a.get("action") for a in attempts)


# --- Integrity lock ---------------------------------------------------------


def test_evidence_lock_pinned_after_verify():
    verts, _, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[_verdict(score=0, status="missing")],
        submission_text="No methods here.",
        presented_chunk_texts=["No methods here."],
        rubric_criteria=[_rubric_row()],
        adapters=EvidenceAdapters(assess_evidence=_insufficient),
    )
    lock = verts[0]["evidence_lock"]
    assert lock["evidence_verified"] is True
    assert "content_hash" in lock
    assert lock["claim_type"]


def test_post_verify_output_mutation_restored():
    v = _verdict(score=0, status="missing", evidence_anchor="not found")
    claim = {
        "claim_type": "assessed_not_demonstrated",
        "review_reasons": [],
    }
    v["criterion_claim"] = claim
    lock = pin_evidence_lock(v, "assessed_not_demonstrated")
    v["evidence_lock"] = lock.model_dump()
    v["evidence_verified"] = True
    # Simulate holistic/output guard silently changing omission zero
    mutated = {
        **v,
        "score": 4,
        "evidence_anchor": "invented anchor",
        "criterion_claim": {**claim, "claim_type": "partially_demonstrated"},
    }
    assert lock_violated(mutated, lock) is True
    restored = _restore_evidence_lock_if_violated(mutated)
    assert restored["score"] == 0
    assert restored["evidence_anchor"] == "not found"
    assert restored["criterion_claim"]["claim_type"] == "assessed_not_demonstrated"
    assert restored.get("evidence_lock_restored") is True


def test_gate_keep_supported_zero_unit():
    units = build_source_ledger("Fully available text with no methods.")
    for u in units:
        u.presentation = "presented"
    v = _verdict(score=0, status="missing", missing_keywords=[])
    claim = CriterionClaim(
        criterion_id="c1",
        claim_type="assessed_not_demonstrated",
        evidence_check_status="valid",
    )
    obl = build_obligation(
        verdict=v,
        claim=claim,
        rubric_row=_rubric_row(),
        units=units,
    )
    # Clear inspection limitations that would force recover
    obl = obl.model_copy(update={"inspection_limitations": [], "ambiguity_notes": []})
    gate = omission_decision_gate(
        verdict=v,
        claim=claim,
        obligation=obl,
        units=units,
        mode="obligation_recovery",
        recovery_available=True,
        budget_remaining=True,
    )
    assert gate.decision == "keep_supported_zero"
