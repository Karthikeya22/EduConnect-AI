#!/usr/bin/env python
"""Offline demonstration of obligation-driven omission recovery (SIMULATED).

Uses artificial submissions and mocked adapters through the real gate +
obligation controller + evidence pipeline. Not for paper accuracy results.

Run from repo root (EduConnect-AI):
  set PYTHONPATH=.
  py scripts/demo_obligation_recovery.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.evidence.adapters import EvidenceAdapters
from grading_server.evidence.node import run_evidence_pipeline
from grading_server.evidence.types import OBLIGATION_CONTROLLER_VERSION


def _banner(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def _print_trace(verdict: dict, block) -> None:
    claim = verdict.get("criterion_claim") or {}
    obl = claim.get("obligation") or {}
    print("score:", verdict.get("score"), "| status:", verdict.get("status"))
    print("gate:", claim.get("gate_decision"), "| obligation_state:", claim.get("obligation_state"))
    print("requirement:", (obl.get("requirement_text") or "")[:120])
    print("requirement_ids:", obl.get("requirement_ids"))
    print("controller_version:", block.obligation_controller_version)
    print("evidence_lock:", json.dumps(verdict.get("evidence_lock"), indent=2)[:400])
    attempts = claim.get("recovery_attempts") or []
    if attempts:
        print("action traces:")
        for a in attempts:
            print(
                " ",
                a.get("action"),
                "|",
                a.get("status"),
                "| before→after:",
                a.get("obligation_state_before"),
                "→",
                a.get("obligation_state_after"),
                "|",
                (a.get("reason") or "")[:80],
            )
    print("labels:", block.labels)


def case_false_omission_via_controller():
    _banner("DEMO 1: Obligation controller recovers evidence outside initial window")
    submission = (
        "Introduction to tutoring systems.\n\n"
        "Body discusses interface design only.\n\n"
        "Methods appendix: We employed stratified sampling (n=120) across three schools."
    )
    before = {
        "criterion_id": "methods",
        "criterion_name": "Methods",
        "dimension": "content",
        "score": 1,
        "max_score": 10,
        "status": "partial",
        "justification": "Student does not demonstrate a sampling method.",
        "evidence_anchor": "not found",
        "missing_keywords": ["sampling"],
        "required_concepts": ["sampling"],
        "covered_concepts": [],
        "supporting_materials": [],
    }
    adapters = EvidenceAdapters(
        assess_evidence=lambda **kw: {
            "label": "insufficient",
            "justification": "initial window lacked methods",
            "evidence_ids": kw.get("evidence_ids") or [],
        },
        search_units=lambda **kw: [
            u for u in kw["units"] if "sampling" in (u.text or "").lower()
        ][:3],
        reassess_criterion=lambda *, verdict, extra_passages: {
            **verdict,
            "score": 7,
            "status": "partial",
            "evidence_anchor": (extra_passages[0] if extra_passages else "")[:160],
            "justification": "Recovered methods appendix under obligation controller.",
        },
    )
    after, block, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[before],
        submission_text=submission,
        presented_chunk_texts=[submission[:55]],
        rubric_criteria=[
            {
                "criterion_id": "methods",
                "description": "Describe the sampling method used in the study.",
                "source_requirement_ids": ["req-sampling-1"],
            }
        ],
        adapters=adapters,
    )
    print("BEFORE score:", before["score"], "| AFTER score:", after[0]["score"], "| flag:", flag)
    assert block.obligation_controller_version == OBLIGATION_CONTROLLER_VERSION
    _print_trace(after[0], block)


def case_extraction_gap_defers():
    _banner("DEMO 2: Extraction gap → defer (failed extraction ≠ student failure)")
    v = {
        "criterion_id": "appendix",
        "criterion_name": "Appendix completeness",
        "dimension": "content",
        "score": 0,
        "max_score": 5,
        "status": "missing",
        "justification": "Appendix content absent.",
        "evidence_anchor": "not found",
        "missing_keywords": ["appendix"],
        "required_concepts": [],
        "covered_concepts": [],
        "supporting_materials": [],
    }
    after, block, flag = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[v],
        submission_text="",
        extraction_failed=True,
        extraction_limitations=["appendix_pdf_corrupt"],
        rubric_criteria=[
            {
                "criterion_id": "appendix",
                "description": "Include a readable appendix.",
                "source_requirement_ids": ["req-appendix"],
            }
        ],
        adapters=EvidenceAdapters(
            assess_evidence=lambda **kw: {
                "label": "unavailable",
                "justification": "no text",
                "evidence_ids": [],
            }
        ),
    )
    print("score:", after[0]["score"], "status:", after[0]["status"], "flag_human:", flag)
    _print_trace(after[0], block)


def case_supported_zero():
    _banner("DEMO 3: Genuine inspected omission → supported zero (not auto-raised)")
    submission = "This reflection covers classroom seating and lunch menus only."
    v = {
        "criterion_id": "methods",
        "criterion_name": "Methods",
        "dimension": "content",
        "score": 0,
        "max_score": 10,
        "status": "missing",
        "justification": "No sampling method demonstrated.",
        "evidence_anchor": "not found",
        "missing_keywords": ["sampling"],
        "required_concepts": ["sampling"],
        "covered_concepts": [],
        "supporting_materials": [],
    }
    after, block, _ = run_evidence_pipeline(
        experiment_mode="obligation_recovery",
        verdicts=[v],
        submission_text=submission,
        presented_chunk_texts=[submission],
        rubric_criteria=[
            {
                "criterion_id": "methods",
                "description": "Describe the sampling method used in the study.",
                "source_requirement_ids": ["req-sampling-1"],
            }
        ],
        adapters=EvidenceAdapters(
            assess_evidence=lambda **kw: {
                "label": "insufficient",
                "justification": "no methods content",
                "evidence_ids": kw.get("evidence_ids") or [],
            }
        ),
    )
    print("score:", after[0]["score"], "(must not invent an upward revision)")
    _print_trace(after[0], block)


def case_baseline_no_controller():
    _banner("DEMO 4: Experiment A (baseline) — no controller calls")
    after, block, _ = run_evidence_pipeline(
        experiment_mode="baseline",
        verdicts=[
            {
                "criterion_id": "methods",
                "criterion_name": "Methods",
                "dimension": "content",
                "score": 2,
                "max_score": 10,
                "status": "partial",
                "justification": "Low score on methods.",
                "evidence_anchor": "not found",
                "missing_keywords": ["sampling"],
                "required_concepts": ["sampling"],
                "covered_concepts": [],
                "supporting_materials": [],
            }
        ],
        submission_text="Later: We used stratified sampling.",
        presented_chunk_texts=["Later"],
        adapters=EvidenceAdapters(),
    )
    print("score unchanged:", after[0]["score"])
    print("claims:", len(block.claims), "| controller:", block.obligation_controller_version)


def main() -> int:
    print("Obligation-driven recovery demo (simulated software behavior).")
    print("Live default remains coverage_recovery; mode D is opt-in research.")
    case_false_omission_via_controller()
    case_extraction_gap_defers()
    case_supported_zero()
    case_baseline_no_controller()
    print("\nDone. No accuracy claims; artificial fixtures only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
