"""
ingest_service.py
Core ingestion logic for course materials, rubric criteria, and exemplars.
Used by both POST /api/ingest and POST /api/ingest/file endpoints.
"""

from __future__ import annotations
import asyncio
import traceback
from langchain_text_splitters import RecursiveCharacterTextSplitter

from grading_server.utils.supabase_client import get_supabase
from grading_server.utils.gemini_client import embed_text, embed_texts


_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)


async def ingest_course_material(
    assignment_id: str,
    course_material_text: str,
    rubric_criteria: list[dict],
    exemplars: list[dict] | None = None,
    source_name: str = "Course Material",
    api_key: str | None = None,
) -> dict:
    """
    Full ingestion pipeline:
    1. Chunk + embed course material text
    2. Upsert rubric criteria
    3. Optionally embed + upsert exemplars

    All embedding calls are parallelized using asyncio.gather().
    Returns summary counts.
    """
    sb = get_supabase()

    # ── 1. Chunk course material ──────────────────────────────────────────────
    chunks = _splitter.split_text(course_material_text) if course_material_text else []
    if not chunks and course_material_text:
        chunks = [course_material_text[:1000]]

    # ── 2. Embed chunks in parallel batches ───────────────────────────────────
    chunks_stored = 0
    if chunks:
        # Batch embed — the SDK handles batching internally
        chunk_embeddings = await asyncio.to_thread(embed_texts, chunks, api_key)

        # Build rows for upsert
        chunk_rows = []
        for i, (text, emb) in enumerate(zip(chunks, chunk_embeddings)):
            chunk_rows.append({
                "assignment_id": assignment_id,
                "chunk_text": text,
                "chunk_index": i,
                "source_title": f"{source_name} (chunk {i + 1}/{len(chunks)})",
                "embedding": emb,
            })

        # Upsert into Supabase — on_conflict replaces existing rows
        await asyncio.to_thread(
            lambda: sb.table("course_material_chunks")
                .upsert(chunk_rows, on_conflict="assignment_id,chunk_index")
                .execute()
        )
        chunks_stored = len(chunk_rows)

    # ── 3. Upsert rubric criteria ─────────────────────────────────────────────
    criteria_stored = 0
    if rubric_criteria:
        criteria_rows = []
        for i, c in enumerate(rubric_criteria):
            criteria_rows.append({
                "criterion_id": str(c.get("criterion_id") or c.get("id") or f"crit_{i}"),
                "assignment_id": str(assignment_id),
                "title": str(c.get("title") or f"Criterion {i}"),
                "description": str(c.get("description", "")),
                "max_score": int(c.get("max_score", 10)),
                "dimension": str(c.get("dimension", "content")),
            })

        await asyncio.to_thread(
            lambda: sb.table("rubric_criteria")
                .upsert(criteria_rows, on_conflict="assignment_id,criterion_id")
                .execute()
        )
        criteria_stored = len(criteria_rows)

    # ── 4. Embed + upsert exemplars (parallel) ───────────────────────────────
    exemplars_stored = 0
    if exemplars:
        # Extract texts for batch embedding
        exemplar_texts = [ex["submission_text"] for ex in exemplars]

        # Embed all exemplar texts in one call
        exemplar_embeddings = await asyncio.to_thread(embed_texts, exemplar_texts, api_key)

        exemplar_rows = []
        for ex, emb in zip(exemplars, exemplar_embeddings):
            exemplar_rows.append({
                "criterion_id": ex["criterion_id"],
                "assignment_id": assignment_id,
                "submission_text": ex["submission_text"],
                "score": int(ex["score"]),
                "max_score": int(ex["max_score"]),
                "dimension": ex.get("dimension", "content"),
                "embedding": emb,
            })

        await asyncio.to_thread(
            lambda: sb.table("exemplars")
                .upsert(exemplar_rows, on_conflict="assignment_id,criterion_id,score")
                .execute()
        )
        exemplars_stored = len(exemplar_rows)

    return {
        "status": "success",
        "chunks_stored": chunks_stored,
        "criteria_stored": criteria_stored,
        "exemplars_stored": exemplars_stored,
    }


async def delete_assignment_data(assignment_id: str) -> dict:
    """
    Delete all stored chunks, criteria, and exemplars for a given assignment.
    Returns counts of deleted items.
    """
    sb = get_supabase()

    def _delete():
        # Delete in reverse dependency order
        ex_resp = sb.table("exemplars").delete().eq("assignment_id", assignment_id).execute()
        cr_resp = sb.table("rubric_criteria").delete().eq("assignment_id", assignment_id).execute()
        ch_resp = sb.table("course_material_chunks").delete().eq("assignment_id", assignment_id).execute()
        return {
            "chunks_deleted": len(ch_resp.data) if ch_resp.data else 0,
            "criteria_deleted": len(cr_resp.data) if cr_resp.data else 0,
            "exemplars_deleted": len(ex_resp.data) if ex_resp.data else 0,
        }

    counts = await asyncio.to_thread(_delete)
    return {"status": "success", **counts}


async def lookup_course_file(course_id: str, canvas_file_id: str) -> dict | None:
    sb = get_supabase()

    def _q():
        resp = (
            sb.table("course_file_ingest")
            .select("*")
            .eq("course_id", str(course_id))
            .eq("canvas_file_id", str(canvas_file_id))
            .limit(1)
            .execute()
        )
        return (resp.data or [None])[0]

    try:
        return await asyncio.to_thread(_q)
    except Exception as e:
        print(f"[course_cache] lookup failed (schema missing?): {e}")
        return None


async def _upsert_registry(row: dict) -> None:
    sb = get_supabase()
    await asyncio.to_thread(
        lambda: sb.table("course_file_ingest")
        .upsert(row, on_conflict="course_id,canvas_file_id")
        .execute()
    )


async def ingest_course_file(
    *,
    course_id: str,
    canvas_file_id: str,
    updated_at: str,
    filename: str,
    course_material_text: str,
    assignment_id: str | None = None,
    api_key: str | None = None,
) -> dict:
    """Ingest one Canvas file into course-scoped chunk cache, or skip if fresh."""
    updated_at = updated_at or ""
    existing = await lookup_course_file(course_id, canvas_file_id)
    if existing and existing.get("status") == "ready" and (existing.get("updated_at") or "") == updated_at:
        return {
            "status": "success",
            "skipped": True,
            "cached": True,
            "chunks_stored": int(existing.get("chunk_count") or 0),
        }

    sb = get_supabase()
    aid = str(assignment_id or f"course:{course_id}")

    try:
        await _upsert_registry({
            "course_id": str(course_id),
            "canvas_file_id": str(canvas_file_id),
            "filename": filename,
            "updated_at": updated_at,
            "status": "pending",
            "chunk_count": 0,
            "last_error": None,
        })

        chunks = _splitter.split_text(course_material_text) if course_material_text else []
        if not chunks and course_material_text:
            chunks = [course_material_text[:1000]]
        if not chunks:
            raise ValueError("No text extracted from file")

        embeddings = await asyncio.to_thread(embed_texts, chunks, api_key)
        chunk_rows = []
        for i, (text, emb) in enumerate(zip(chunks, embeddings)):
            chunk_rows.append({
                "assignment_id": aid,
                "course_id": str(course_id),
                "canvas_file_id": str(canvas_file_id),
                "chunk_text": text,
                "chunk_index": i,
                "source_title": f"{filename} (chunk {i + 1}/{len(chunks)})",
                "embedding": emb,
            })

        # Replace prior chunks for this course file
        def _write():
            sb.table("course_material_chunks").delete().eq("course_id", str(course_id)).eq(
                "canvas_file_id", str(canvas_file_id)
            ).execute()
            sb.table("course_material_chunks").upsert(
                chunk_rows, on_conflict="course_id,canvas_file_id,chunk_index"
            ).execute()

        try:
            await asyncio.to_thread(_write)
        except Exception:
            # Fallback if unique index name differs: insert after delete only
            def _write_fallback():
                sb.table("course_material_chunks").delete().eq("course_id", str(course_id)).eq(
                    "canvas_file_id", str(canvas_file_id)
                ).execute()
                sb.table("course_material_chunks").insert(chunk_rows).execute()
            await asyncio.to_thread(_write_fallback)

        from datetime import datetime, timezone
        await _upsert_registry({
            "course_id": str(course_id),
            "canvas_file_id": str(canvas_file_id),
            "filename": filename,
            "updated_at": updated_at,
            "status": "ready",
            "chunk_count": len(chunk_rows),
            "last_error": None,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        })
        return {
            "status": "success",
            "skipped": False,
            "cached": False,
            "chunks_stored": len(chunk_rows),
        }
    except Exception as e:
        traceback.print_exc()
        try:
            await _upsert_registry({
                "course_id": str(course_id),
                "canvas_file_id": str(canvas_file_id),
                "filename": filename,
                "updated_at": updated_at,
                "status": "failed",
                "chunk_count": 0,
                "last_error": str(e)[:500],
            })
        except Exception:
            pass
        raise


async def list_course_file_status(course_id: str) -> list[dict]:
    sb = get_supabase()

    def _q():
        resp = (
            sb.table("course_file_ingest")
            .select("course_id,canvas_file_id,filename,updated_at,status,chunk_count,last_error,ingested_at")
            .eq("course_id", str(course_id))
            .execute()
        )
        return resp.data or []

    try:
        return await asyncio.to_thread(_q)
    except Exception as e:
        print(f"[course_cache] status failed: {e}")
        return []
