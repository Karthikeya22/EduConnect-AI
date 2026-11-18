from unittest.mock import AsyncMock, patch

import pytest

from grading_server import ingest_service


@pytest.mark.asyncio
async def test_verify_marks_ready_with_chunks_indexed_and_ready_without_chunks_broken():
    rows = [
        {"canvas_file_id": "1", "filename": "a.pdf", "status": "ready", "chunk_count": 3},
        {"canvas_file_id": "2", "filename": "b.mp4", "status": "ready", "chunk_count": 1},
        {"canvas_file_id": "3", "filename": "c.jpg", "status": "failed", "chunk_count": 0, "last_error": "404"},
        {"canvas_file_id": "4", "filename": "d.png", "status": "pending", "chunk_count": 0},
    ]
    with patch.object(ingest_service, "list_course_file_status", new=AsyncMock(return_value=rows)):
        with patch.object(ingest_service, "_chunk_counts_by_file", new=AsyncMock(return_value={"1": 3})):
            out = await ingest_service.verify_course_file_index("2058858")
    by_id = {f["canvas_file_id"]: f for f in out["files"]}
    assert by_id["1"]["verified"] is True
    assert by_id["1"]["check"] == "indexed"
    assert by_id["2"]["verified"] is False
    assert by_id["2"]["check"] == "broken"
    assert by_id["3"]["check"] == "failed"
    assert by_id["4"]["check"] == "pending"
    assert out["summary"]["indexed"] == 1
    assert out["summary"]["broken"] == 1
    assert out["summary"]["failed"] == 1
    assert out["summary"]["pending"] == 1
