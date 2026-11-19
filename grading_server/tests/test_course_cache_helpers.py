"""Unit tests for course file cache helpers (mocked Supabase)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import grading_server.ingest_service as ingest_service
from grading_server.utils.embedding_space import INDEX_VERSION, space_for_provider


def test_lookup_course_file_returns_row():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"course_id": "c1", "canvas_file_id": "f1", "updated_at": "2026-01-01", "status": "ready"}
    ]
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        row = asyncio.new_event_loop().run_until_complete(
            ingest_service.lookup_course_file("c1", "f1")
        )
    assert row["status"] == "ready"
    assert row["updated_at"] == "2026-01-01"


def test_ingest_course_file_skips_only_when_source_space_and_index_match():
    fake_sb = MagicMock()
    # lookup path
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"course_id": "c1", "canvas_file_id": "f1", "updated_at": "t1", "status": "ready", "chunk_count": 3}
    ]
    meta = {
        "scope_key": "course:c1:file:f1",
        "space_id": space_for_provider("openai").space_id,
        "index_version": INDEX_VERSION,
        "lms_host": ingest_service.trusted_lms_host(),
        # Provider string alone no longer certifies a cache hit.
        "embedding_provider": "openai",
    }
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "get_embedding_meta", return_value=meta):
            with patch.object(ingest_service, "embed_texts") as emb:
                result = asyncio.new_event_loop().run_until_complete(
                    ingest_service.ingest_course_file(
                        course_id="c1",
                        canvas_file_id="f1",
                        updated_at="t1",
                        filename="a.pdf",
                        course_material_text="hello world " * 50,
                        provider="openai",
                        api_key="sk-test",
                    )
                )
                emb.assert_not_called()
    assert result["skipped"] is True
    assert result["cached"] is True


def _assignment_ingest(meta, text="alpha beta gamma " * 100, provider="openai"):
    fake_sb = MagicMock()
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb), \
            patch.object(ingest_service, "get_embedding_meta", return_value=meta), \
            patch.object(ingest_service, "embed_texts", side_effect=lambda t, *a, **k: [[0.1] * 768 for _ in t]) as emb:
        res = asyncio.new_event_loop().run_until_complete(ingest_service.ingest_course_material(
            assignment_id="a1", course_material_text=text, rubric_criteria=[{"criterion_id": "c1", "title": "T"}],
            api_key="sk", provider=provider, course_id="k1",
        ))
    activations = [c for c in fake_sb.rpc.call_args_list if c.args[0] == "activate_embedding_batch"]
    return res, emb, activations, fake_sb


def _active_meta(text="alpha beta gamma " * 100, provider="openai"):
    return {
        "scope_key": "course:k1:assignment:a1",
        "space_id": space_for_provider(provider).space_id,
        "index_version": INDEX_VERSION,
        "active_batch_id": "b1",
        "lms_host": ingest_service.trusted_lms_host(),
        "embedding_config": {"content_hash": ingest_service.assignment_content_hash(text, "Course Material")},
    }


def test_assignment_ingest_records_content_hash_then_skips_same_text():
    res, emb, acts, _ = _assignment_ingest(None)
    assert emb.called and len(acts) == 1 and res["skipped"] is False
    cfg = acts[0].args[1]["p_config"]
    assert cfg["content_hash"] == ingest_service.assignment_content_hash("alpha beta gamma " * 100, "Course Material")

    res, emb, acts, sb = _assignment_ingest(_active_meta())
    emb.assert_not_called()
    assert acts == [] and res["skipped"] is True and res["cached"] is True
    assert any(c.args == ("rubric_criteria",) for c in sb.table.call_args_list)  # rubric still upserted


def test_assignment_ingest_reembeds_when_text_or_space_changes():
    _, emb, acts, _ = _assignment_ingest(_active_meta(), text="different text " * 80)
    assert emb.called and len(acts) == 1
    _, emb, acts, _ = _assignment_ingest(_active_meta(provider="openai"), provider="gemini")
    assert emb.called and len(acts) == 1
    stale = {**_active_meta(), "index_version": "old"}
    _, emb, _, _ = _assignment_ingest(stale)
    assert emb.called


def test_ingest_course_file_falls_back_when_schema_missing():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    fake_sb.table.return_value.upsert.return_value.execute.side_effect = Exception(
        "{'code': 'PGRST205', 'message': \"Could not find the table 'public.course_file_ingest' in the schema cache\"}"
    )

    async def fake_ingest_course_material(**kwargs):
        fake_ingest_course_material.kwargs = kwargs
        return {"status": "success", "chunks_stored": 4, "criteria_stored": 0, "exemplars_stored": 0}

    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "ingest_course_material", fake_ingest_course_material):
            result = asyncio.new_event_loop().run_until_complete(
                ingest_service.ingest_course_file(
                    course_id="c1",
                    canvas_file_id="f1",
                    updated_at="t2",
                    filename="syllabus.pdf",
                    course_material_text="hello world " * 50,
                    assignment_id="a1",
                    provider="openai",
                    api_key="sk-test",
                )
            )

    assert result["status"] == "success"
    assert result["course_cache"] is False
    assert result["chunks_stored"] == 4
    assert fake_ingest_course_material.kwargs["assignment_id"] == "a1"
    assert fake_ingest_course_material.kwargs["provider"] == "openai"


def test_ingest_course_file_stamps_course_scoped_assignment_id():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "embed_texts", return_value=[[0.1] * 768]):
            result = asyncio.new_event_loop().run_until_complete(
                ingest_service.ingest_course_file(
                    course_id="c1",
                    canvas_file_id="f1",
                    updated_at="t2",
                    filename="syllabus.pdf",
                    course_material_text="hello world",
                    assignment_id="a1",
                    provider="openai",
                    api_key="sk-test",
                )
            )

    assert result["chunks_stored"] == 1
    name, params = fake_sb.rpc.call_args[0]
    assert name == "activate_embedding_batch"
    assert params["p_scope_key"] == "course:c1:file:f1"
    assert params["p_rows"][0]["assignment_id"] == "course:c1"
    assert params["p_rows"][0]["course_id"] == "c1"
    fake_sb.table.return_value.insert.assert_not_called()


def test_ingest_course_file_reembeds_when_meta_only_matches_provider():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"course_id": "c1", "canvas_file_id": "f1", "updated_at": "t1", "status": "ready", "chunk_count": 3}
    ]
    legacy_meta = {"scope_key": "course:c1", "embedding_provider": "openai"}
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "get_embedding_meta", return_value=legacy_meta):
            with patch.object(ingest_service, "embed_texts", return_value=[[0.1] * 768]) as emb:
                result = asyncio.new_event_loop().run_until_complete(
                    ingest_service.ingest_course_file(
                        course_id="c1", canvas_file_id="f1", updated_at="t1", filename="a.pdf",
                        course_material_text="hello world", provider="openai", api_key="sk-test",
                    )
                )
    emb.assert_called_once()
    assert result["cached"] is False


def test_cached_course_file_hit_skips_download_when_fresh():
    meta = {
        "scope_key": "course:c1:file:f1",
        "space_id": space_for_provider("openai").space_id,
        "index_version": INDEX_VERSION,
        "lms_host": ingest_service.trusted_lms_host(),
    }
    with patch.object(ingest_service, "lookup_course_file", new=AsyncMock(return_value={
        "course_id": "c1", "canvas_file_id": "f1", "updated_at": "t1", "status": "ready",
        "chunk_count": 4, "filename": "m9_reading.pdf",
    })):
        with patch.object(ingest_service, "get_embedding_meta", new=AsyncMock(return_value=meta)):
            hit = asyncio.new_event_loop().run_until_complete(
                ingest_service.cached_course_file_hit("c1", "f1", "t1", provider="openai")
            )
    assert hit["cached"] is True
    assert hit["chunks_stored"] == 4
    assert hit["filename"] == "m9_reading.pdf"


def test_cached_hit_skips_pending_with_chunks_and_heals_ready():
    meta = {
        "scope_key": "course:c1:file:f1",
        "space_id": space_for_provider("openai").space_id,
        "index_version": INDEX_VERSION,
        "lms_host": ingest_service.trusted_lms_host(),
    }
    existing = {
        "course_id": "c1", "canvas_file_id": "f1", "updated_at": "t1", "status": "pending",
        "chunk_count": 4, "filename": "m9_reading.pdf",
    }
    with patch.object(ingest_service, "lookup_course_file", new=AsyncMock(return_value=existing)), \
            patch.object(ingest_service, "get_embedding_meta", new=AsyncMock(return_value=meta)), \
            patch.object(ingest_service, "_heal_registry_ready", new=AsyncMock()) as heal:
        hit = asyncio.new_event_loop().run_until_complete(
            ingest_service.cached_course_file_hit("c1", "f1", "t1", provider="openai")
        )
    assert hit["cached"] is True
    heal.assert_awaited_once()


def test_strip_nul_and_activate_strips_chunk_text():
    assert ingest_service._strip_nul("a\x00b") == "ab"
    assert ingest_service._registry_error_code(RuntimeError("code': '22P05'")) == "NUL_IN_TEXT"
    assert ingest_service._registry_error_code(RuntimeError("canceling statement due to statement timeout")) == "DB_TIMEOUT"

    fake_sb = MagicMock()
    space = space_for_provider("openai")
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb), \
            patch.object(ingest_service, "trusted_lms_host", return_value="canvas.test"):
        asyncio.new_event_loop().run_until_complete(
            ingest_service.activate_embedding_batch(
                scope_key="course:c1:file:f1",
                space=space,
                provider="openai",
                rows=[{
                    "assignment_id": "course:c1",
                    "course_id": "c1",
                    "canvas_file_id": "f1",
                    "chunk_text": "hello\x00world",
                    "chunk_index": 0,
                    "source_title": "a\x00.pdf",
                    "embedding": [0.1] * 768,
                }],
                assignment_id=None,
                course_id="c1",
                canvas_file_id="f1",
            )
        )
    name, params = fake_sb.rpc.call_args[0]
    assert name == "activate_embedding_batch"
    assert params["p_rows"][0]["chunk_text"] == "helloworld"
    assert params["p_rows"][0]["source_title"] == "a.pdf"
    assert "\x00" not in params["p_rows"][0]["chunk_text"]


def test_mark_pending_reingest_scopes_to_mismatched_file_keys():
    fake_sb = MagicMock()
    chain = fake_sb.table.return_value.update.return_value.eq.return_value
    chain.in_.return_value.execute.return_value.data = [{"canvas_file_id": "f1"}]
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        n = asyncio.new_event_loop().run_until_complete(
            ingest_service.mark_course_files_pending_reingest(
                "c1",
                reason="REINGEST_REQUIRED",
                mismatched_scope_keys=["course:c1:file:f1", "course:c1:assignment:a1"],
            )
        )
    assert n == 1
    fake_sb.table.return_value.update.return_value.eq.return_value.in_.assert_called_once_with(
        "canvas_file_id", ["f1"]
    )


def test_mark_pending_reingest_assignment_only_marks_nothing():
    fake_sb = MagicMock()
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        n = asyncio.new_event_loop().run_until_complete(
            ingest_service.mark_course_files_pending_reingest(
                "c1",
                mismatched_scope_keys=["course:c1:assignment:a1"],
            )
        )
    assert n == 0
    fake_sb.table.assert_not_called()
