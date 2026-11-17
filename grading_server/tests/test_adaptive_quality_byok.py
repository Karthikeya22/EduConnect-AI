"""Adaptive quality criteria must use the BYOK-aware call_gemini, not gemini_client."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grading_server.app as app_mod


def test_adaptive_quality_criteria_uses_module_call_gemini_with_provider():
    seen = {}

    def fake_call_gemini(prompt, **kwargs):
        seen["kwargs"] = kwargs
        return {
            "criteria": [
                {
                    "criterion_id": "q1",
                    "title": "Writing Quality",
                    "description": "Coherence",
                    "max_score": 5,
                    "dimension": "structure",
                }
            ]
        }

    class SB:
        def table(self, name):
            q = MagicMock()
            if name == "rubric_criteria":
                q.execute.return_value = SimpleNamespace(
                    data=[
                        {
                            "criterion_id": "c1",
                            "title": "Intro",
                            "description": "d",
                            "max_score": 5,
                            "dimension": "content",
                        }
                    ]
                )
            else:
                q.execute.return_value = SimpleNamespace(data=[])
            q.select.return_value = q
            q.eq.return_value = q
            return q

    async def fake_to_thread(fn, *a, **k):
        return fn(*a, **k)

    state = {
        "assignment_id": "101",
        "course_id": "11",
        "llm_provider": "openai",
        "llm_api_key": "sk-test",
    }

    with patch.object(app_mod, "get_supabase", return_value=SB()), \
            patch.object(app_mod, "call_gemini", fake_call_gemini), \
            patch.object(app_mod.asyncio, "to_thread", fake_to_thread):
        import asyncio

        out = asyncio.run(app_mod.run_retrieve(state))

    assert "kwargs" in seen
    assert seen["kwargs"].get("provider") == "openai"
    assert seen["kwargs"].get("api_key") == "sk-test"
    titles = [c.get("title", "") for c in out.get("rubric_criteria", [])]
    assert any("AI-Generated" in t for t in titles)
