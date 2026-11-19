"""Guards for missing evidence, local concepts, duplicate anchors, and AI flag hygiene."""
from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.app import (
    _apply_verdict_score_guards,
    _cap_duplicate_evidence_anchors,
    _cp,
    _infer_covered_concepts,
)


def test_present_submission_keeps_rubric_score_when_quote_missing():
    """A file that is on the page is not a 25% student failure when the quote matcher misses."""
    submission = (
        "This semester I was surprised by how useful artificial intelligence is. "
        "Using AI to generate research questions, create graphs, and analyze data "
        "showed me it can support research. We used this in the methods assignment."
    )
    v = _apply_verdict_score_guards(
        {
            "score": 1.5,
            "status": "partial",
            "evidence_anchor": "not found",
            "criterion_name": "Question 1",
            "required_concepts": [],
            "covered_concepts": ["research questions"],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "Answered the surprise question and tied it to the methods assignment.",
            "credit_awarded_for": "",
            "points_withheld_because": "",
            "submission_text": submission,
            "rating_points": [3, 1.5, 0],
        },
        3,
    )
    assert v["score"] == 1.5
    withheld = str(v.get("points_withheld_because") or "").lower()
    assert withheld
    assert "depth or specificity" not in withheld
    assert "methods assignment" in withheld
    assert any("research" in c.lower() for c in v["covered_concepts"])


def test_missing_quote_on_present_work_does_not_invent_depth_reason():
    v = _apply_verdict_score_guards(
        {
            "score": 1.5,
            "status": "partial",
            "evidence_anchor": "not found",
            "criterion_name": "Question 1",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "",
            "points_withheld_because": "",
            "submission_text": "Using AI to generate research questions, create graphs, and analyze data.",
            "rating_points": [3, 1.5, 0],
        },
        3,
    )
    withheld = str(v.get("points_withheld_because") or "").lower()
    assert "quote" in withheld
    assert "depth or specificity" not in withheld


def test_off_band_score_snaps_to_nearest_rating():
    v = _apply_verdict_score_guards(
        {
            "score": 1,
            "status": "partial",
            "evidence_anchor": "not found",
            "criterion_name": "Question 1",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "Partial answer.",
            "submission_text": "Using AI to generate research questions, create graphs, and analyze data.",
            "rating_points": [3, 1.5, 0],
        },
        3,
    )
    assert v["score"] == 1.5


def test_missing_anchor_caps_at_25_percent():
    v = _apply_verdict_score_guards(
        {
            "score": 20,
            "status": "full",
            "evidence_anchor": "not found",
            "required_concepts": ["x", "y"],
            "covered_concepts": ["x", "y"],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "Excellent comprehensive coverage of every required idea.",
        },
        20,
    )
    assert v["score"] <= math.ceil(20 * 0.25)
    assert v.get("ungrounded_full") is True


def test_missing_anchor_does_not_restore_full_credit():
    v = _apply_verdict_score_guards(
        {
            "score": 4,
            "status": "partial",
            "evidence_anchor": "",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "Full credit: the student fully meets every expectation with depth.",
        },
        20,
    )
    assert v["score"] <= math.ceil(20 * 0.25)


def test_concept_inference_uses_anchor_not_whole_submission():
    required = ["cross validation", "stratified sampling"]
    covered = _infer_covered_concepts(
        required,
        [],
        "We used stratified sampling for the folds.",
    )
    assert "stratified sampling" in [c.lower() for c in covered]
    # Whole-submission mention alone is not in the haystack we pass:
    covered2 = _infer_covered_concepts(required, [], "We discussed ethics only.")
    assert covered2 == [] or all("cross" not in c.lower() for c in covered2)


def test_duplicate_evidence_anchor_capped_at_50_percent():
    shared = "Students applied Louvain community detection to the network."
    verdicts = [
        {
            "criterion_id": "c1",
            "criterion_name": "Network Structure",
            "score": 10,
            "max_score": 10,
            "status": "full",
            "evidence_anchor": shared,
            "ai_generated": False,
        },
        {
            "criterion_id": "c2",
            "criterion_name": "Visualization & Interpretation",
            "score": 10,
            "max_score": 10,
            "status": "full",
            "evidence_anchor": shared,
            "ai_generated": False,
            "justification": "Strong visual analysis.",
        },
    ]
    out = _cap_duplicate_evidence_anchors(verdicts)
    assert out[0]["score"] == 10
    assert out[1]["score"] <= math.ceil(10 * 0.50)
    assert out[1].get("duplicate_evidence_anchor") is True


def test_ai_critique_never_flags_for_human():
    row = {
        "criterion_id": "ai-1",
        "criterion_name": "Methodology Soundness (AI)",
        "ai_generated": True,
        "score": 2,
        "max_score": 20,
        "status": "partial",
        "evidence_anchor": "not found",
        "justification": "Weak",
        "placement_issue": True,
        "ungrounded_full": True,
        "material_alignment": "contradicts",
    }
    critique = asyncio.new_event_loop().run_until_complete(_cp(row))
    assert critique["flag_for_human"] is False
    assert critique["is_supported"] is True
    assert critique["is_justified"] is True
