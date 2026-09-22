"""API-level BYOK enforcement tests (no live LLM calls)."""
from __future__ import annotations

import grading_server.app as app_mod


def test_grade_rejects_missing_byok():
    client = app_mod.app.test_client()
    res = client.post(
        "/api/grade",
        json={
            "assignment_id": "a1",
            "student_id": "s1",
            "submission_text": "Hello world submission text for testing.",
        },
    )
    assert res.status_code == 401
    data = res.get_json()
    assert data.get("error") == "BYOK_REQUIRED"


def test_verify_llm_requires_fields():
    client = app_mod.app.test_client()
    res = client.post("/api/verify-llm", json={})
    assert res.status_code == 400


def test_llm_providers_endpoint():
    client = app_mod.app.test_client()
    res = client.get("/api/llm/providers")
    assert res.status_code == 200
    data = res.get_json()
    ids = {p["id"] for p in data["providers"]}
    assert "openrouter_claude" in ids
    assert "openai" in ids
