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


def test_grade_prompt_requires_faculty_explanation_fields():
    from grading_server import app as app_mod
    import inspect

    src = inspect.getsource(app_mod)
    assert "credit_awarded_for" in src
    assert "points_withheld_because" in src
    assert "FACULTY EXPLANATION" in src
