"""Regression: missing max_score must not KeyError / 500 the whole grade."""
import asyncio
from unittest.mock import AsyncMock, patch

import grading_server.app as app_mod


def test_normalize_criterion_accepts_points_only():
    row = app_mod._normalize_criterion({"id": "c1", "title": "Methods", "points": 8})
    assert row["criterion_id"] == "c1"
    assert row["max_score"] == 8.0
    assert row["title"] == "Methods"


def test_normalize_criterion_fills_missing_max_score():
    row = app_mod._normalize_criterion({"criterion_id": "ai_q", "title": "Integrity (AI-Generated)"})
    assert row["max_score"] == 10.0
    assert row["criterion_id"] == "ai_q"


def test_normalize_rubric_drops_non_dicts():
    out = app_mod._normalize_rubric([None, "x", {"criterion_id": "ok", "max_score": 5, "title": "T"}])
    assert len(out) == 1
    assert out[0]["criterion_id"] == "ok"


def test_gp_does_not_keyerror_without_max_score():
    async def _run():
        with patch.object(
            app_mod,
            "call_gemini",
            return_value={
                "score": 3,
                "justification": "ok",
                "evidence_anchor": "not found",
                "placement_ok": True,
                "material_alignment": "neutral",
                "supporting_materials": [],
                "covered_concepts": [],
                "required_concepts": [],
                "missing_keywords": [],
            },
        ):
            return await app_mod._gp(
                {"criterion_id": "ai_q", "title": "Quality (AI-Generated)", "description": "x"},
                "=== MATERIAL ALIGNMENT ===\n",
                "student wrote methods and results here with enough text",
                [],
                api_key="k",
                provider="openai",
                retrieval_status="no_corpus",
            )

    verdict = asyncio.run(_run())
    assert verdict["criterion_id"] == "ai_q"
    assert verdict["max_score"] == 10.0


def test_run_grade_isolates_criterion_failure():
    async def _run():
        state = {
            "assignment_id": "a1",
            "course_id": "c1",
            "submission_text": "A full student submission with enough text to grade.",
            "rubric_criteria": [
                {"criterion_id": "good", "title": "Good", "description": "d", "max_score": 5},
                {"criterion_id": "bad", "title": "Bad", "description": "d", "max_score": 5},
            ],
            "exemplars": {},
            "critiques": [],
            "verdicts": [],
        }

        async def gp_side_effect(c, *a, **k):
            if c.get("criterion_id") == "bad":
                raise RuntimeError("boom")
            return {
                "criterion_id": "good",
                "criterion_name": "Good",
                "score": 4,
                "max_score": 5,
                "status": "partial",
            }

        with patch.object(app_mod, "_llm_creds", return_value=("openai", "k")):
            with patch.object(app_mod, "_decompose_criterion", new=AsyncMock(return_value=["q"])):
                with patch.object(app_mod, "_multihop_retrieve", new=AsyncMock(return_value=([], "no_corpus"))):
                    with patch.object(app_mod, "_gp", side_effect=gp_side_effect):
                        return await app_mod.run_grade(state)

    out = asyncio.run(_run())
    by_id = {v["criterion_id"]: v for v in out["verdicts"]}
    assert by_id["good"]["score"] == 4
    assert by_id["bad"]["status"] == "not_assessable"
    assert by_id["bad"]["failure_kind"] == "processing_failed"
