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
