"""Partial-score faculty explanation fields and prompt contract."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.app import LLMGradingPayload, _apply_verdict_score_guards
from grading_server.models import CriterionVerdict


def test_llm_payload_accepts_credit_and_withheld_fields():
    p = LLMGradingPayload(
        score=9,
        justification="Solid recommendation with a thin model comparison.",
        evidence_anchor="GPT would be my model of choice because it can interact with students",
        status="partial",
        credit_awarded_for="Names GPT for tutoring with interaction benefits.",
        points_withheld_because="Does not fully justify why GPT over BERT for the chosen task.",
    )
    assert p.credit_awarded_for.startswith("Names GPT")
    assert "BERT" in p.points_withheld_because


def test_criterion_verdict_persists_explanation_fields():
    v = CriterionVerdict(
        criterion_id="c1",
        criterion_name="Recommendation",
        dimension="content",
        score=9,
        max_score=10,
        status="partial",
        justification="Partial credit.",
        evidence_anchor="quote",
        credit_awarded_for="Clear task recommendation.",
        points_withheld_because="Comparison justification is thin for full marks.",
    )
    dumped = v.model_dump()
    assert dumped["credit_awarded_for"] == "Clear task recommendation."
    assert "thin" in dumped["points_withheld_because"]


def test_score_guard_fills_withheld_when_partial_and_empty():
    v = _apply_verdict_score_guards(
        {
            "score": 9,
            "status": "partial",
            "evidence_anchor": "Students should use GPT for interactive tutoring with follow-up questions.",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": "Good recommendation.",
            "credit_awarded_for": "Recommends GPT for tutoring.",
            "points_withheld_because": "",
        },
        10,
    )
    assert v["score"] <= 9
    assert str(v.get("points_withheld_because") or "").strip()


def test_missing_anchor_cap_does_not_keep_glowing_credit_copy():
    """Score may be capped, but faculty copy must not praise as complete/meets-requirements."""
    v = _apply_verdict_score_guards(
        {
            "score": 5,
            "status": "full",
            "evidence_anchor": "not found",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The submission provides a comprehensive overview of LLMs and meets the assignment's requirements."
            ),
            "credit_awarded_for": (
                "The submission provides a comprehensive overview of Large Language Models and meets requirements."
            ),
            "points_withheld_because": "",
        },
        5,
    )
    assert v["score"] <= 2  # ≤25% of 5
    credit = str(v.get("credit_awarded_for") or "").lower()
    just = str(v.get("justification") or "").lower()
    withheld = str(v.get("points_withheld_because") or "").lower()
    assert "comprehensive" not in credit and "meets" not in credit
    assert "comprehensive" not in just or "limited credit" in just
    assert "evidence_anchor" not in withheld
    assert "verifiable" in withheld or "quote" in withheld


def test_grade_prompt_requires_faculty_explanation_fields():
    from grading_server import app as app_mod
    import inspect

    src = inspect.getsource(app_mod)
    assert "credit_awarded_for" in src
    assert "points_withheld_because" in src
    assert "FACULTY EXPLANATION" in src
    assert "do NOT change scoring standards" in src
