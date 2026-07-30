"""Unit tests for course file cache helpers (mocked Supabase)."""
import asyncio
from unittest.mock import MagicMock, patch
import grading_server.ingest_service as ingest_service


def test_lookup_course_file_returns_row():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"course_id": "c1", "canvas_file_id": "f1", "updated_at": "2026-01-01", "status": "ready"}
    ]
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        row = asyncio.get_event_loop().run_until_complete(
            ingest_service.lookup_course_file("c1", "f1")
        )
    assert row["status"] == "ready"
    assert row["updated_at"] == "2026-01-01"


def test_ingest_course_file_skips_when_ready_and_same_updated_at():
    fake_sb = MagicMock()
    # lookup path
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"course_id": "c1", "canvas_file_id": "f1", "updated_at": "t1", "status": "ready", "chunk_count": 3}
    ]
    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "embed_texts") as emb:
            result = asyncio.get_event_loop().run_until_complete(
                ingest_service.ingest_course_file(
                    course_id="c1",
                    canvas_file_id="f1",
                    updated_at="t1",
                    filename="a.pdf",
                    course_material_text="hello world " * 50,
                )
            )
            emb.assert_not_called()
    assert result["skipped"] is True
    assert result["cached"] is True


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
                )
            )

    assert result["status"] == "success"
    assert result["course_cache"] is False
    assert result["chunks_stored"] == 4
    assert fake_ingest_course_material.kwargs["assignment_id"] == "a1"


def test_ingest_course_file_stamps_course_scoped_assignment_id():
    fake_sb = MagicMock()
    fake_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

    with patch.object(ingest_service, "get_supabase", return_value=fake_sb):
        with patch.object(ingest_service, "embed_texts", return_value=[[0.1, 0.2]]):
            result = asyncio.new_event_loop().run_until_complete(
                ingest_service.ingest_course_file(
                    course_id="c1",
                    canvas_file_id="f1",
                    updated_at="t2",
                    filename="syllabus.pdf",
                    course_material_text="hello world",
                    assignment_id="a1",
                )
            )

    assert result["chunks_stored"] == 1
    inserted = fake_sb.table.return_value.insert.call_args[0][0]
    assert inserted[0]["assignment_id"] == "course:c1"
    assert inserted[0]["course_id"] == "c1"
