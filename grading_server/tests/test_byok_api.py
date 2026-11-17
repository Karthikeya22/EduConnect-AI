"""API-level BYOK enforcement tests (no live LLM calls)."""
from __future__ import annotations

from unittest.mock import patch

import grading_server.app as app_mod
from grading_server.utils import authz

GRADE_BODY = {
    "assignment_id": "101",
    "course_id": "11",
    "student_id": "s1",
    "submission_text": "Hello world submission text for testing.",
}


def test_grade_without_identity_is_401_before_byok():
    res = app_mod.app.test_client().post("/api/grade", json=GRADE_BODY)
    assert res.status_code == 401
    assert res.get_json()["error"] == "AUTH_REQUIRED"


def test_grade_rejects_missing_byok():
    with patch.object(authz, "_authorize", lambda scope: object()):
        res = app_mod.app.test_client().post("/api/grade", json=GRADE_BODY)
    assert res.status_code == 401
    assert res.get_json().get("error") == "BYOK_REQUIRED"


def test_verify_llm_requires_fields():
    with patch.object(authz, "_authorize", lambda scope: object()):
        res = app_mod.app.test_client().post("/api/verify-llm", json={})
    assert res.status_code == 400


def test_llm_providers_endpoint():
    client = app_mod.app.test_client()
    res = client.get("/api/llm/providers")
    assert res.status_code == 200
    data = res.get_json()
    ids = {p["id"] for p in data["providers"]}
    assert "openrouter_claude" in ids
    assert "openai" in ids
