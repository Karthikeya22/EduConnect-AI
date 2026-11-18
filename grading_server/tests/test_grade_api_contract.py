"""/api/grade error contract through the real Flask route (local mocks only, no network)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import grading_server.app as app_mod
import grading_server.ingest_service as ingest_service
import grading_server.utils.authz as authz
import grading_server.utils.gemini_client as gemini_client
from grading_server.models import RESULT_SCHEMA_VERSION
from grading_server.tests.test_failure_to_score import GOOD_ROWS, LOW_ROWS, RUBRIC, SUBMISSION, _embed_ok, make_llm

HEADERS = {"X-LLM-Provider": "gemini", "X-LLM-Api-Key": "test-key"}
BODY = {"assignment_id": "101", "course_id": "11", "student_id": "s1", "submission_text": SUBMISSION}


class _Q:
    def __init__(self, data):
        self._data = data

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return SimpleNamespace(data=self._data)


class TableSB:
    """rubric/exemplar tables + RPC, each independently failing or returning fixtures."""

    def __init__(self, rubric=None, rows=None, table_exc=None, rpc_exc=None):
        self.rubric = rubric if rubric is not None else [dict(c) for c in RUBRIC]
        self.rows, self.table_exc, self.rpc_exc = rows or [], table_exc, rpc_exc

    def table(self, name):
        if self.table_exc and name in ("rubric_criteria", "exemplars"):
            raise self.table_exc
        return _Q(self.rubric if name == "rubric_criteria" else [])

    def rpc(self, name, params):
        if self.rpc_exc:
            raise self.rpc_exc
        return _Q(list(self.rows))


async def _compatible(**_):
    return None


def _with_concepts(llm):
    def fake(prompt, *a, **k):
        if prompt.startswith("Extract concepts"):
            return {"concepts": []}
        return llm(prompt, *a, **k)
    return fake


def post(sb, llm=None, body=None):
    import grading_server.utils.llm_client as llm_client
    import grading_server.evidence.mode as mode_mod

    llm = _with_concepts(llm or make_llm())

    def fake_chat_json(prompt, *a, **k):
        return {
            "label": "supports",
            "justification": "offline mock",
            "evidence_ids": [],
            "is_supported": True,
            "is_justified": True,
            "confidence": 0.9,
            "reasoning": "ok",
            "score": 7,
            "status": "partial",
            "evidence_anchor": "stratified cross validation",
            "missing_keywords": [],
            "supporting_materials": [],
            "covered_concepts": [],
            "required_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "criteria": [],
        }

    with patch.object(app_mod, "get_supabase", return_value=sb), \
            patch.object(app_mod, "call_gemini", llm), \
            patch.object(app_mod, "chat_json", fake_chat_json), \
            patch.object(gemini_client, "call_gemini", lambda *a, **k: {"criteria": []}), \
            patch.object(app_mod, "_embed_sync", _embed_ok), \
            patch.object(llm_client, "chat_json", fake_chat_json), \
            patch.object(mode_mod, "resolve_experiment_mode", lambda *_a, **_k: "baseline"), \
            patch.object(ingest_service, "assert_embedding_space_compatible", _compatible), \
            patch.object(
                ingest_service,
                "evaluate_embedding_space",
                AsyncMock(return_value={"status": "active", "message": "", "mismatched": []}),
            ), \
            patch.object(
                ingest_service,
                "mark_course_files_pending_reingest",
                AsyncMock(return_value=0),
            ), \
            patch.object(authz, "_authorize", lambda scope: sb):
        return app_mod.app.test_client().post("/api/grade", json=body or BODY, headers=HEADERS)


def test_rubric_store_failure_returns_503_without_a_draft():
    r = post(TableSB(table_exc=RuntimeError("connection refused")))
    assert r.status_code == 503, r.get_json()
    body = r.get_json()
    assert body["error"] == "RUBRIC_STORE_UNAVAILABLE"
    assert "total" not in body and "criteria_verdicts" not in body


def test_retrieval_rpc_failure_through_route_is_labelled_not_zero():
    r = post(TableSB(rpc_exc=RuntimeError("PGRST rpc 500")))
    assert r.status_code == 200, r.get_json()
    out = r.get_json()
    assert out["result_schema_version"] == RESULT_SCHEMA_VERSION
    assert out["retrieval_status"] == "infrastructure_error"
    assert all(v["score"] is not None and v["score"] > 0 for v in out["criteria_verdicts"])
    assert out["assessment_status"] == "complete" and out["total"] > 0


def test_empty_rubric_is_never_a_complete_zero():
    """Absence without usable assignment context → formative only, never a fabricated 0 total."""
    from grading_server.assessment_policy import reset_default_store

    reset_default_store()
    r = post(TableSB(rubric=[], rows=GOOD_ROWS))
    out = r.get_json()
    assert r.status_code == 200, out
    assert out["total"] is None
    assert out.get("policy_formative_only") is True or out.get("assessment_status") == "processing_failed"
    # Must not invent a complete numeric total for a missing policy.
    assert not (out.get("assessment_status") == "complete" and isinstance(out.get("total"), (int, float)))


def test_is_legacy_result():
    from grading_server.models import is_legacy_result
    assert is_legacy_result({"total": 7}) is True
    assert is_legacy_result({"result_schema_version": RESULT_SCHEMA_VERSION - 1}) is True
    assert is_legacy_result({"result_schema_version": True}) is True
    assert is_legacy_result({"result_schema_version": RESULT_SCHEMA_VERSION}) is False
    assert is_legacy_result(None) is False


def test_grade_validation_error_is_sanitized_for_clients():
    """Raw Pydantic dumps must not reach the browser."""
    from pydantic import ValidationError

    class BoomGraph:
        async def ainvoke(self, _state):
            raise ValidationError.from_exception_data(
                "CriterionVerdict",
                [
                    {
                        "type": "list_type",
                        "loc": ("covered_concepts",),
                        "input": "choosing a task, constructing",
                        "ctx": {},
                    }
                ],
            )

    with patch.object(app_mod, "get_graph", return_value=BoomGraph()), \
            patch.object(authz, "_authorize", lambda scope: object()):
        r = app_mod.app.test_client().post("/api/grade", json=BODY, headers=HEADERS)
    assert r.status_code == 500
    body = r.get_json()
    blob = str(body).lower()
    assert "errors.pydantic" not in blob
    assert body.get("error") == "GRADING_FAILED"
    assert "message" in body
    assert "details" not in body


def test_overwriting_legacy_db_row_preserves_it():
    legacy = {"total": 9, "criteria_verdicts": []}
    writes = []

    class SB(TableSB):
        def table(self, name):
            if name != "grading_results":
                return super().table(name)

            class T(_Q):
                def update(self, payload):
                    writes.append(payload)
                    return self
            return T([{"id": 1, "result_json": legacy}])

    out = post(SB(rows=GOOD_ROWS)).get_json()
    assert "superseded_legacy_result" not in out  # API response stays clean
    stored = writes[-1]["result_json"]
    assert stored["superseded_legacy_result"] == legacy
    assert stored["result_schema_version"] == RESULT_SCHEMA_VERSION


def test_requires_reference_without_useful_evidence_is_not_assessable_via_route():
    rubric = [dict(RUBRIC[0], evidence_policy="requires_reference"), dict(RUBRIC[1])]
    for sb in (TableSB(rubric=rubric, rows=LOW_ROWS), TableSB(rubric=rubric, rows=[]),
               TableSB(rubric=rubric, rpc_exc=RuntimeError("down"))):
        out = post(sb).get_json()
        v = {x["criterion_id"]: x for x in out["criteria_verdicts"]}
        assert v["c1"]["score"] is None and v["c1"]["failure_kind"] == "reference_unavailable"
        assert "not a judgement of the student" in v["c1"]["justification"]
        assert v["c2"]["score"] is not None
        assert out["total"] is None and out["assessment_status"] == "partial"
