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
