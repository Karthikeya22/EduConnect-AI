#!/usr/bin/env python
"""Offline demonstration of coverage-aware omission checking (SIMULATED software behavior).

Uses artificial submissions and mocked adapters through the real evidence pipeline.
Not for paper accuracy results.

Run from repo root (EduConnect-AI):
  set PYTHONPATH=.
  py scripts/demo_coverage_recovery.py
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


def _banner(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def case_false_omission_corrected():
    _banner("DEMO 1 (simulated): False omission corrected via recovered evidence")
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
        }
    )
    after, block, _ = run_evidence_pipeline(
        experiment_mode="coverage_recovery",
        verdicts=[before],
        submission_text=submission,
        presented_chunk_texts=[submission[:60]],
        adapters=adapters,
    )
    print("BEFORE score:", before["score"], "| AFTER score:", after[0]["score"])
    print("Claim:", json.dumps(after[0].get("criterion_claim"), indent=2)[:800])
    print("Labels:", block.labels)


def case_extraction_limited_review():
    _banner("DEMO 2 (simulated): Extraction-limited criterion routed for review")
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
        experiment_mode="coverage_recovery",
        verdicts=[v],
        submission_text="",
        extraction_failed=True,
        extraction_limitations=["appendix_pdf_corrupt"],
        adapters=EvidenceAdapters(
            assess_evidence=lambda **kw: {
                "label": "unavailable",
                "justification": "no text",
                "evidence_ids": [],
            }
        ),
    )
    print("score:", after[0]["score"], "status:", after[0]["status"], "flag_human:", flag)
    print("review:", after[0]["criterion_claim"].get("review_reasons"))
    print("labels:", block.labels)


def case_supported_zero():
    _banner("DEMO 3 (simulated): Supported zero preserved")
    submission = "A short reflection on cafeteria food quality."
    v = {
        "criterion_id": "methods",
        "criterion_name": "Methods",
        "dimension": "content",
        "score": 0,
        "max_score": 10,
        "status": "missing",
        "justification": "No research method is demonstrated.",
        "evidence_anchor": "not found",
        "missing_keywords": ["sampling", "experiment"],
        "required_concepts": ["sampling"],
        "covered_concepts": [],
        "supporting_materials": [],
    }
    after, _, _ = run_evidence_pipeline(
        experiment_mode="coverage_recovery",
        verdicts=[v],
        submission_text=submission,
        presented_chunk_texts=[submission],
        adapters=EvidenceAdapters(
            assess_evidence=lambda **kw: {
                "label": "insufficient",
                "justification": "no methods content",
                "evidence_ids": kw.get("evidence_ids") or [],
            }
        ),
    )
    print("score:", after[0]["score"], "claim_type:", after[0]["criterion_claim"]["claim_type"])
    assert after[0]["score"] == 0


if __name__ == "__main__":
    print("EduConnect AI — coverage recovery offline demo")
    print("Label: SIMULATED SOFTWARE BEHAVIOR — not grading accuracy evidence.")
    case_false_omission_corrected()
    case_extraction_limited_review()
    case_supported_zero()
    print("\nDone.")
