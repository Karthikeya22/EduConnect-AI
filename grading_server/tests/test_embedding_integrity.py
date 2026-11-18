"""Embedding space identity, strict validation, provenance gate, and atomic activation (mocks only)."""
from __future__ import annotations

import asyncio
import math
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import grading_server.app as app_mod
import grading_server.ingest_service as ingest_service
from grading_server.utils import authz, llm_client, llm_registry
from grading_server.utils.embedding_space import (
    INDEX_VERSION,
    EmbeddingDimensionError,
    EmbeddingModelMismatch,
    EmbeddingProvenanceError,
    EmbeddingResponseShapeError,
    InvalidEmbeddingVector,
    space_for_provider,
    validate_embeddings,
)

D = 768
OPENAI = space_for_provider("openai")
GEMINI = space_for_provider("gemini")


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def vec(x=0.1):
    return [x] * D


# ── space identity ───────────────────────────────────────────────────────────

def test_openrouter_personas_share_space_only_because_every_field_matches():
    a, b = space_for_provider("openrouter"), space_for_provider("openrouter_claude")
    assert a == b and a.space_id == b.space_id


def test_direct_openai_and_openrouter_never_merge():
    assert OPENAI.model.split("/")[-1] == space_for_provider("openrouter").model.split("/")[-1]
    assert OPENAI.space_id != space_for_provider("openrouter").space_id


def test_model_change_under_same_provider_changes_space():
    assert replace(OPENAI, model="text-embedding-3-large").space_id != OPENAI.space_id
    assert replace(OPENAI, model_revision="2026-01").space_id != OPENAI.space_id
    assert replace(OPENAI, transform_version="raw-v2").space_id != OPENAI.space_id
    assert replace(GEMINI, task_contract="none").space_id != GEMINI.space_id


def test_nvidia_space_requests_768_matryoshka_dimensions():
    space = space_for_provider("nvidia")
    assert space.dimensions == D
    assert space.dimensions_mode == "provider_param"
    assert space.model == "nvidia/nemotron-3.5-embed-1b"

    with patch.object(
        llm_client,
        "_http_json",
        return_value={"data": [{"index": 0, "embedding": vec()}], "model": space.model},
    ) as http:
        out = llm_client.embed_texts(["q"], provider="nvidia", api_key="nv", task="query")
    assert len(out[0]) == D
    assert http.call_args.kwargs["body"]["dimensions"] == D
    assert http.call_args.kwargs["body"]["input_type"] == "query"


def test_normalize_embedding_removed():
    assert not hasattr(llm_registry, "normalize_embedding")


# ── strict validation ────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [[0.1] * 1536, [0.1] * 767, [0.1] * 769])
def test_unexpected_dimensions_raise(bad):
    with pytest.raises(EmbeddingDimensionError):
        validate_embeddings([bad], 1, OPENAI)


@pytest.mark.parametrize("bad, err", [
    ([math.nan] + [0.1] * (D - 1), InvalidEmbeddingVector),
    ([math.inf] + [0.1] * (D - 1), InvalidEmbeddingVector),
    ([0.0] * D, InvalidEmbeddingVector),
    (["x"] * D, InvalidEmbeddingVector),
])
def test_non_finite_and_zero_vectors_raise(bad, err):
    with pytest.raises(err):
        validate_embeddings([bad], 1, OPENAI)


def test_reordered_indexes_are_resorted():
    out = validate_embeddings(
        [{"index": 1, "embedding": vec(0.2)}, {"index": 0, "embedding": vec(0.1)}], 2, OPENAI
    )
    assert out[0][0] == 0.1 and out[1][0] == 0.2


@pytest.mark.parametrize("items", [
    [{"index": 0, "embedding": vec()}, {"index": 0, "embedding": vec()}],  # duplicate
    [{"index": 0, "embedding": vec()}, {"index": 2, "embedding": vec()}],  # gap
    [{"embedding": vec()}, {"index": 1, "embedding": vec()}],              # missing
    [{"index": 0, "embedding": vec()}],                                    # count
])
def test_bad_index_sets_raise(items):
    with pytest.raises(EmbeddingResponseShapeError):
        validate_embeddings(items, 2, OPENAI)


def test_returned_model_checked():
    validate_embeddings([vec()], 1, OPENAI, "text-embedding-3-small")
    validate_embeddings([vec()], 1, space_for_provider("openrouter"), "text-embedding-3-small")
    with pytest.raises(EmbeddingModelMismatch):
        validate_embeddings([vec()], 1, OPENAI, "text-embedding-3-large")


def test_compat_embed_rejects_1536_instead_of_truncating():
    with patch.object(llm_client, "_http_json", return_value={"data": [{"index": 0, "embedding": [0.5] * 1536}]}):
        with pytest.raises(EmbeddingDimensionError):
            llm_client.embed_texts(["hi"], provider="openai", api_key="sk", task="document")


# ── task modes ───────────────────────────────────────────────────────────────

def test_openai_body_has_dimensions_and_no_task_field():
    body = llm_client._compat_embed_body(llm_registry.get_provider("openai"), ["a"], "query")
    assert body == {"model": "text-embedding-3-small", "input": ["a"], "dimensions": D}


def test_nvidia_body_input_type_per_task():
    cfg = llm_registry.get_provider("nvidia")
    assert llm_client._compat_embed_body(cfg, ["a"], "document")["input_type"] == "passage"
    query_body = llm_client._compat_embed_body(cfg, ["a"], "query")
    assert query_body["input_type"] == "query"
    assert query_body["dimensions"] == D
    assert query_body["model"] == "nvidia/nemotron-3.5-embed-1b"


@pytest.mark.parametrize("task, expected", [("document", "RETRIEVAL_DOCUMENT"), ("query", "RETRIEVAL_QUERY")])
def test_gemini_task_type(task, expected):
    seen = {}

    def embed_content(model, contents, config):
        seen["config"] = config
        return SimpleNamespace(embeddings=[SimpleNamespace(values=vec()) for _ in contents])

    fake = SimpleNamespace(models=SimpleNamespace(embed_content=embed_content))
    with patch.object(llm_client, "_gemini_client", return_value=fake):
        out = llm_client.embed_texts(["a", "b"], provider="gemini", api_key="g", task=task)
    assert len(out) == 2
    assert seen["config"].task_type == expected
    assert seen["config"].output_dimensionality == D


def test_embed_texts_requires_task():
    with pytest.raises(ValueError):
        llm_client.embed_texts(["a"], provider="openai", api_key="sk", task="passage")


# ── provenance gate ──────────────────────────────────────────────────────────

def gate(metas, legacy=False, course_id="k1", space=OPENAI):
    with patch.object(ingest_service, "_load_provenance_sync", return_value=(metas, legacy)):
        return run(ingest_service.assert_embedding_space_compatible(
            assignment_id="a1", course_id=course_id, space=space,
        ))


def meta(scope, space=OPENAI, iv=INDEX_VERSION):
    return {"scope_key": scope, "space_id": space.space_id if space else None, "index_version": iv}


def test_gate_ok_and_no_corpus():
    assert gate([meta("assignment:a1"), meta("course:k1:file:f1")]) == "active"
    assert gate([]) == "no_corpus"


def test_evaluate_embedding_space_reports_reingest_without_raising():
    with patch.object(
        ingest_service,
        "_load_provenance_sync",
        return_value=([meta("course:k1:file:f1", space=GEMINI)], False),
    ):
        result = run(
            ingest_service.evaluate_embedding_space(
                assignment_id="a1", course_id="k1", space=OPENAI
            )
        )
    assert result["status"] == "reingest_required"
    assert "course:k1:file:f1" in result["mismatched"]


def test_gate_missing_metadata_is_unknown_provenance():
    with pytest.raises(EmbeddingProvenanceError) as e:
        gate([{"scope_key": "course:k1", "space_id": None, "index_version": None}])
    assert e.value.code == "UNKNOWN_PROVENANCE"
    with pytest.raises(EmbeddingProvenanceError) as e2:
        gate([], legacy=True)  # chunks with no recorded space
    assert e2.value.code == "UNKNOWN_PROVENANCE"


def test_gate_mixed_assignment_and_course_scopes():
    with pytest.raises(EmbeddingProvenanceError) as e:
        gate([meta("assignment:a1"), meta("course:k1:file:f1", space=space_for_provider("openrouter"))])
    assert e.value.code == "REINGEST_REQUIRED" and "course:k1:file:f1" in str(e.value)
    with pytest.raises(EmbeddingProvenanceError) as e2:
        gate([meta("assignment:a1"), meta("course:k1:file:f2", space=None)])
    assert e2.value.code == "UNKNOWN_PROVENANCE"


def test_gate_index_version_change_requires_reingest():
    with pytest.raises(EmbeddingProvenanceError) as e:
        gate([meta("assignment:a1", iv="rcts-1000-100/parse-v1")])
    assert e.value.code == "REINGEST_REQUIRED"


def test_gate_does_not_certify_by_provider_string():
    # Same provider + model strings but no space_id: still unknown.
    row = {"scope_key": "assignment:a1", "space_id": None, "index_version": INDEX_VERSION,
           "embedding_provider": "openai", "embedding_model": "text-embedding-3-small"}
    with pytest.raises(EmbeddingProvenanceError) as e:
        gate([row])
    assert e.value.code == "UNKNOWN_PROVENANCE"


def test_generation_provider_change_with_same_space_needs_no_reingest():
    stored = [meta("assignment:a1", space=space_for_provider("openrouter"))]
    assert gate(stored, space=space_for_provider("openrouter_claude")) == "active"


def test_gate_schema_missing_is_migration_required():
    with patch.object(ingest_service, "_load_provenance_sync",
                      side_effect=Exception("column course_material_chunks.embedding_space_id does not exist")):
        with pytest.raises(EmbeddingProvenanceError) as e:
            run(ingest_service.assert_embedding_space_compatible(assignment_id="a1", course_id=None, space=OPENAI))
    assert e.value.code == "EMBEDDING_MIGRATION_REQUIRED"


def test_grade_endpoint_degrades_and_grades_on_provenance_mismatch():
    """Provenance mismatch must not 409 — schedule reingest and still grade (degraded RAG)."""
    client = app_mod.app.test_client()
    headers = {"X-LLM-Provider": "openai", "X-LLM-Api-Key": "sk-test"}

    async def fake_ainvoke(payload):
        assert payload.get("rag_degraded") is True
        assert payload.get("materials_status") == "reingesting"
        return {
            "final_output": {
                "result_schema_version": 2,
                "assessment_status": "complete",
                "total": 7,
                "total_max": 10,
                "content_score": 7,
                "content_max": 10,
                "structure_score": 0,
                "structure_max": 0,
                "criteria_verdicts": [],
                "flag_for_human": False,
                "overall_confidence": 0.9,
                "misconception_hint": "",
                "rag_coverage_level": "NONE",
                "strong_match_count": 0,
                "referenced_materials": [],
                "critiques": [],
                "topic_mastery_radar": {},
                "materials_status": "reingesting",
                "rag_degraded": True,
            }
        }

    graph_obj = MagicMock()
    graph_obj.ainvoke = fake_ainvoke
    with patch.object(
        ingest_service,
        "_load_provenance_sync",
        return_value=([meta("course:11", space=GEMINI)], False),
    ), patch.object(
        ingest_service, "mark_course_files_pending_reingest", return_value=2
    ) as mark, patch.object(
        authz, "_authorize", lambda scope: object()
    ), patch.object(app_mod, "get_graph", return_value=graph_obj):
        res = client.post(
            "/api/grade",
            headers=headers,
            json={
                "assignment_id": "101",
                "course_id": "11",
                "student_id": "s1",
                "submission_text": "A submission long enough to pass the empty-text checks for grading.",
            },
        )
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["total"] == 7
    assert body["materials_status"] == "reingesting"
    assert body.get("rag_coverage_level") in ("LOW", "NONE")
    mark.assert_called()


def test_grade_endpoint_still_blocks_embedding_migration_required():
    client = app_mod.app.test_client()
    headers = {"X-LLM-Provider": "openai", "X-LLM-Api-Key": "sk-test"}
    with patch.object(
        ingest_service,
        "_load_provenance_sync",
        side_effect=Exception("column course_material_chunks.embedding_space_id does not exist"),
    ), patch.object(authz, "_authorize", lambda scope: object()), patch.object(
        app_mod, "get_graph"
    ) as graph:
        res = client.post(
            "/api/grade",
            headers=headers,
            json={
                "assignment_id": "101",
                "course_id": "11",
                "student_id": "s1",
                "submission_text": "A submission long enough to pass the empty-text checks for grading.",
            },
        )
    assert res.status_code == 503
    assert res.get_json()["error"] == "EMBEDDING_MIGRATION_REQUIRED"
    graph.assert_not_called()


# ── atomic activation ────────────────────────────────────────────────────────

class RecordingSB:
    def __init__(self, rpc_exc=None):
        self.rpc_exc = rpc_exc
        self.rpc_calls = []
        self.table_ops = []

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        if self.rpc_exc:
            raise self.rpc_exc
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=len(params["p_rows"])))

    def table(self, name):
        sb = self

        class T:
            def __getattr__(self, op):
                def call(*a, **k):
                    sb.table_ops.append((name, op))
                    return self
                return call

            def execute(self):
                return SimpleNamespace(data=[])

        return T()


def ingest(sb, provider="openai"):
    with patch.object(ingest_service, "get_supabase", return_value=sb), \
            patch.object(ingest_service, "embed_texts", side_effect=lambda t, *a, **k: [vec() for _ in t]):
        return run(ingest_service.ingest_course_material(
            assignment_id="a1", course_material_text="alpha beta gamma " * 100,
            rubric_criteria=[], api_key="sk", provider=provider, course_id="k1",
        ))


def test_activation_writes_provenance_in_one_rpc():
    sb = RecordingSB()
    res = ingest(sb)
    (name, p), = sb.rpc_calls
    assert name == "activate_embedding_batch"
    assert p["p_scope_key"] == "course:k1:assignment:a1" and p["p_space_id"] == OPENAI.space_id
    assert p["p_course_id"] == "k1" and all(r["course_id"] == "k1" for r in p["p_rows"])
    assert p["p_index_version"] == INDEX_VERSION and p["p_config"]["space_id"] == OPENAI.space_id
    assert [r["chunk_index"] for r in p["p_rows"]] == list(range(len(p["p_rows"])))
    assert ("course_material_chunks", "delete") not in sb.table_ops  # no delete from Python
    assert ("course_material_chunks", "insert") not in sb.table_ops
    assert res["embedding_space_id"] == OPENAI.space_id


def test_activation_failure_raises_and_leaves_active_data_untouched():
    sb = RecordingSB(rpc_exc=RuntimeError("deadlock detected"))
    with pytest.raises(RuntimeError, match="deadlock"):
        ingest(sb)
    assert not any(t == "course_material_chunks" for t, _ in sb.table_ops)
    writes = {"insert", "update", "upsert", "delete"}
    assert not any(t == "assignment_embedding_meta" and op in writes for t, op in sb.table_ops)


def test_missing_activation_rpc_is_migration_required_without_deleting():
    sb = RecordingSB(rpc_exc=RuntimeError("PGRST202 Could not find the function public.activate_embedding_batch"))
    with pytest.raises(EmbeddingProvenanceError) as e:
        ingest(sb)
    assert e.value.code == "EMBEDDING_MIGRATION_REQUIRED"
    assert not any(op == "delete" for _, op in sb.table_ops)


def test_course_file_activation_failure_marks_registry_failed_only():
    sb = RecordingSB(rpc_exc=RuntimeError("timeout"))
    with patch.object(ingest_service, "get_supabase", return_value=sb), \
            patch.object(ingest_service, "lookup_course_file", return_value=None), \
            patch.object(ingest_service, "embed_texts", side_effect=lambda t, *a, **k: [vec() for _ in t]):
        with pytest.raises(RuntimeError):
            run(ingest_service.ingest_course_file(
                course_id="k1", canvas_file_id="f1", updated_at="t1", filename="a.pdf",
                course_material_text="alpha " * 200, provider="openai", api_key="sk",
            ))
    assert {t for t, _ in sb.table_ops} == {"course_file_ingest"}
    assert sb.rpc_calls[0][1]["p_scope_key"] == "course:k1:file:f1"


# ── course cache key ─────────────────────────────────────────────────────────

def fresh(**over):
    reg = {"status": "ready", "updated_at": "t1", "course_id": "k1", "canvas_file_id": "f1"}
    m = {"scope_key": "course:k1:file:f1", "space_id": OPENAI.space_id, "index_version": INDEX_VERSION,
         "lms_host": ingest_service.trusted_lms_host()}
    space = over.pop("space", OPENAI)
    updated_at = over.pop("updated_at", "t1")
    m.update(over)
    return ingest_service.course_cache_is_fresh(reg, m, course_id="k1", canvas_file_id="f1",
                                                updated_at=updated_at, space=space)


def test_cache_hit_requires_every_key():
    assert ingest_service.trusted_lms_host()
    assert fresh() is True
    assert fresh(updated_at="t2") is False
    assert fresh(space=space_for_provider("openrouter")) is False
    assert fresh(index_version="old") is False
    assert fresh(lms_host="evil.example.com") is False
    assert fresh(scope_key="course:k2:file:f1") is False
    assert ingest_service.course_cache_is_fresh(None, None, course_id="k1", canvas_file_id="f1",
                                                updated_at="t1", space=OPENAI) is False


# ── retrieval uses the space-filtered RPC, no fallback ───────────────────────

def test_retrieval_rpc_error_is_infrastructure_error_without_fallback_context():
    calls = []

    class SB:
        def rpc(self, name, params):
            calls.append((name, params))
            raise RuntimeError("PGRST202 Could not find the function match_course_material_chunks_v2")

        def table(self, name):
            raise AssertionError(f"no table fallback allowed: {name}")

    with patch.object(app_mod, "_embed_sync", lambda t, p, k, task: [vec() for _ in t]), \
            patch.object(app_mod, "get_supabase", return_value=SB()):
        chunks, status = run(app_mod._multihop_retrieve(["q"], "a1", api_key="sk", course_id="k1", provider="openai"))
    assert (chunks, status) == ([], "infrastructure_error")
    name, params = calls[0]
    assert name == "match_course_material_chunks_v2"
    assert params["filter_space_id"] == OPENAI.space_id and params["filter_index_version"] == INDEX_VERSION
