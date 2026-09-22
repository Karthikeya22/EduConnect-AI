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
from grading_server.utils.llm_client import embed_texts as llm_embed_texts
from grading_server.utils.llm_registry import get_provider


_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)

_SCHEMA_MISSING_MARKERS = (
    "pgrst205",
    "pgrst204",
    "does not exist",
    "could not find the table",
    "could not find the",
    "schema cache",
)


def _is_schema_missing_error(err: Exception) -> bool:
    msg = str(err).lower()
    return any(marker in msg for marker in _SCHEMA_MISSING_MARKERS)


def embed_texts(texts: list[str], api_key: str | None = None, provider: str | None = None) -> list[list[float]]:
    """Module-level embed helper (patchable in tests)."""
    if not provider or not api_key:
        raise ValueError("BYOK required: provider and api_key are required for embeddings")
    return llm_embed_texts(texts, provider=provider, api_key=api_key)


async def _embed(texts: list[str], *, provider: str, api_key: str) -> list[list[float]]:
    return await asyncio.to_thread(embed_texts, texts, api_key, provider)


async def set_embedding_meta(
    *,
    scope_key: str,
    embedding_provider: str,
    assignment_id: str | None = None,
    course_id: str | None = None,
) -> None:
    """Persist which provider produced embeddings for this scope."""
    try:
        cfg = get_provider(embedding_provider)
        sb = get_supabase()
        row = {
            "scope_key": scope_key,
            "assignment_id": assignment_id,
            "course_id": course_id,
            "embedding_provider": cfg.id,
            "embedding_model": cfg.embedding_model,
        }

        def _upsert():
            sb.table("assignment_embedding_meta").upsert(
                row, on_conflict="scope_key"
            ).execute()

        await asyncio.to_thread(_upsert)
    except Exception as e:
        if not _is_schema_missing_error(e):
            print(f"[embedding_meta] upsert failed: {e}")


async def get_embedding_meta(scope_key: str) -> dict | None:
    try:
        sb = get_supabase()

        def _sel():
            return (
                sb.table("assignment_embedding_meta")
                .select("*")
                .eq("scope_key", scope_key)
                .limit(1)
                .execute()
            )

        resp = await asyncio.to_thread(_sel)
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as e:
        if not _is_schema_missing_error(e):
            print(f"[embedding_meta] select failed: {e}")
        return None


async def assert_embedding_provider_compatible(
    *,
    assignment_id: str,
    course_id: str | None,
    provider: str,
) -> None:
    """
    Raise RuntimeError with code REINGEST_REQUIRED if stored embeddings
    were produced by a different provider.
    """
    keys = [f"assignment:{assignment_id}"]
    if course_id:
        keys.append(f"course:{course_id}")

    for key in keys:
        meta = await get_embedding_meta(key)
        if not meta:
            continue
        stored = (meta.get("embedding_provider") or "").strip().lower()
        if stored and stored != provider.strip().lower():
            raise RuntimeError(
                "REINGEST_REQUIRED:"
                f"Course materials were embedded with '{stored}', but grading "
                f"is using '{provider}'. Re-ingest materials with the current "
                "provider before grading."
            )


async def ingest_course_material(
    assignment_id: str,
    course_material_text: str,
    rubric_criteria: list[dict],
    exemplars: list[dict] | None = None,
    source_name: str = "Course Material",
    api_key: str | None = None,
    provider: str | None = None,
) -> dict:
    """
    Full ingestion pipeline:
    1. Chunk + embed course material text
    2. Upsert rubric criteria
    3. Optionally embed + upsert exemplars
    """
    if not provider or not api_key:
        raise ValueError("BYOK required: provider and api_key are required for ingest")

    sb = get_supabase()

    chunks = _splitter.split_text(course_material_text) if course_material_text else []
    if not chunks and course_material_text:
        chunks = [course_material_text[:1000]]

    chunks_stored = 0
    if chunks:
        chunk_embeddings = await _embed(chunks, provider=provider, api_key=api_key)

        chunk_rows = []
        for i, (text, emb) in enumerate(zip(chunks, chunk_embeddings)):
            chunk_rows.append({
                "assignment_id": assignment_id,
                "chunk_text": text,
                "chunk_index": i,
                "source_title": f"{source_name} (chunk {i + 1}/{len(chunks)})",
                "embedding": emb,
            })

        def _write_assignment_chunks():
            try:
                sb.table("course_material_chunks").delete().eq(
                    "assignment_id", str(assignment_id)
                ).is_("canvas_file_id", "null").execute()
            except Exception:
                sb.table("course_material_chunks").delete().eq(
                    "assignment_id", str(assignment_id)
                ).execute()
            sb.table("course_material_chunks").insert(chunk_rows).execute()

        await asyncio.to_thread(_write_assignment_chunks)
        chunks_stored = len(chunk_rows)

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

    exemplars_stored = 0
    if exemplars:
        exemplar_texts = [ex["submission_text"] for ex in exemplars]
        exemplar_embeddings = await _embed(
            exemplar_texts, provider=provider, api_key=api_key
        )

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

    await set_embedding_meta(
        scope_key=f"assignment:{assignment_id}",
        embedding_provider=provider,
        assignment_id=str(assignment_id),
    )

    return {
        "status": "success",
        "chunks_stored": chunks_stored,
        "criteria_stored": criteria_stored,
        "exemplars_stored": exemplars_stored,
        "embedding_provider": provider,
    }


async def delete_assignment_data(assignment_id: str) -> dict:
    """
    Delete all stored chunks, criteria, and exemplars for a given assignment.
    Returns counts of deleted items.
    """
    sb = get_supabase()

    def _delete():
        ex_resp = sb.table("exemplars").delete().eq("assignment_id", assignment_id).execute()
        ch_resp = sb.table("course_material_chunks").delete().eq("assignment_id", assignment_id).execute()
        cr_resp = sb.table("rubric_criteria").delete().eq("assignment_id", assignment_id).execute()
        try:
            sb.table("assignment_embedding_meta").delete().eq(
                "scope_key", f"assignment:{assignment_id}"
            ).execute()
        except Exception:
            pass
        return {
            "exemplars": len(ex_resp.data or []),
            "chunks": len(ch_resp.data or []),
            "criteria": len(cr_resp.data or []),
        }

    counts = await asyncio.to_thread(_delete)
    return {
        "status": "success",
        "chunks_deleted": counts.get("chunks", 0),
        "criteria_deleted": counts.get("criteria", 0),
        "exemplars_deleted": counts.get("exemplars", 0),
    }


def _lookup_course_file_sync(course_id: str, canvas_file_id: str):
    sb = get_supabase()
    return (
        sb.table("course_file_ingest")
        .select("*")
        .eq("course_id", str(course_id))
        .eq("canvas_file_id", str(canvas_file_id))
        .limit(1)
        .execute()
    )


async def lookup_course_file(course_id: str, canvas_file_id: str) -> dict | None:
    try:
        resp = await asyncio.to_thread(_lookup_course_file_sync, course_id, canvas_file_id)
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as e:
        if _is_schema_missing_error(e):
            return None
        raise


async def _upsert_registry(row: dict) -> None:
    sb = get_supabase()

    def _up():
        sb.table("course_file_ingest").upsert(
            row, on_conflict="course_id,canvas_file_id"
        ).execute()

    await asyncio.to_thread(_up)


async def ingest_course_file(
    *,
    course_id: str,
    canvas_file_id: str,
    updated_at: str,
    filename: str,
    course_material_text: str,
    assignment_id: str | None = None,
    api_key: str | None = None,
    provider: str | None = None,
) -> dict:
    """Ingest one Canvas file into course-scoped chunk cache, or skip if fresh."""
    if not provider or not api_key:
        raise ValueError("BYOK required: provider and api_key are required for ingest")

    updated_at = updated_at or ""
    existing = await lookup_course_file(course_id, canvas_file_id)
    if existing and existing.get("status") == "ready" and (existing.get("updated_at") or "") == updated_at:
        meta = await get_embedding_meta(f"course:{course_id}")
        stored = (meta or {}).get("embedding_provider")
        if not stored or stored == provider:
            return {
                "status": "success",
                "skipped": True,
                "cached": True,
                "chunks_stored": int(existing.get("chunk_count") or 0),
            }

    sb = get_supabase()
    aid = f"course:{course_id}"

    async def _legacy_fallback() -> dict:
        result = await ingest_course_material(
            assignment_id=str(assignment_id or aid),
            course_material_text=course_material_text,
            rubric_criteria=[],
            source_name=filename,
            api_key=api_key,
            provider=provider,
        )
        return {**result, "skipped": False, "cached": False, "course_cache": False}

    try:
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
        except Exception as e:
            if not _is_schema_missing_error(e):
                raise
            print(f"[course_cache] registry unavailable, falling back to assignment scope: {e}")
            return await _legacy_fallback()

        chunks = _splitter.split_text(course_material_text) if course_material_text else []
        if not chunks and course_material_text:
            chunks = [course_material_text[:1000]]
        if not chunks:
            raise ValueError("No text extracted from file")

        embeddings = await _embed(chunks, provider=provider, api_key=api_key)
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

        def _write():
            sb.table("course_material_chunks").delete().eq("course_id", str(course_id)).eq(
                "canvas_file_id", str(canvas_file_id)
            ).execute()
            sb.table("course_material_chunks").insert(chunk_rows).execute()

        try:
            await asyncio.to_thread(_write)
        except Exception as e:
            if not _is_schema_missing_error(e):
                raise
            print(f"[course_cache] chunk columns unavailable, falling back to assignment scope: {e}")
            return await _legacy_fallback()

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
        await set_embedding_meta(
            scope_key=f"course:{course_id}",
            embedding_provider=provider,
            course_id=str(course_id),
            assignment_id=str(assignment_id) if assignment_id else None,
        )
        return {
            "status": "success",
            "skipped": False,
            "cached": False,
            "chunks_stored": len(chunk_rows),
            "embedding_provider": provider,
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
