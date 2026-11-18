"""
ingest_service.py
Core ingestion logic for course materials, rubric criteria, and exemplars.
Used by both POST /api/ingest and POST /api/ingest/file endpoints.
"""

from __future__ import annotations
import asyncio
import hashlib
import traceback
import uuid

from langchain_text_splitters import RecursiveCharacterTextSplitter

from grading_server.utils.authz import trusted_lms_host
from grading_server.utils.supabase_client import get_supabase, service_role_client
from grading_server.utils.llm_client import embed_texts as llm_embed_texts
from grading_server.utils.llm_registry import get_provider
from grading_server.utils.embedding_space import (
    INDEX_VERSION,
    EmbeddingProvenanceError,
    EmbeddingSpace,
    space_for_provider,
)


def _is_rls_denied(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "42501" in text or "row-level security" in text


# Changing chunk_size/overlap requires bumping embedding_space.INDEX_VERSION.
_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)

META_TABLE = "assignment_embedding_meta"
CHUNKS_TABLE = "course_material_chunks"
_RPC_MISSING_MARKERS = ("pgrst202", "could not find the function")


def course_file_scope_key(course_id: str, canvas_file_id: str) -> str:
    return f"course:{course_id}:file:{canvas_file_id}"


def assignment_scope_key(course_id: str, assignment_id: str) -> str:
    """Course-qualified so new data never collides with legacy, unowned 'assignment:<id>' rows."""
    return f"course:{course_id}:assignment:{assignment_id}"

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


def _strip_nul(value: str | None) -> str:
    """Postgres text rejects U+0000; PDF extractors sometimes embed it."""
    return (value or "").replace("\x00", "")


def _registry_error_code(exc: BaseException) -> str:
    """Stable last_error codes for deterministic UI retry."""
    text = str(exc)
    lower = text.lower()
    if "22p05" in lower or "\\u0000" in text or "\x00" in text or "cannot be converted to text" in lower:
        return "NUL_IN_TEXT"
    if "57014" in lower or "statement timeout" in lower:
        return "DB_TIMEOUT"
    return text[:500]


def _file_ids_from_scope_keys(course_id: str, scope_keys: list[str] | None) -> list[str]:
    prefix = f"course:{course_id}:file:"
    out: list[str] = []
    for sk in scope_keys or []:
        if isinstance(sk, str) and sk.startswith(prefix):
            fid = sk[len(prefix):].strip()
            if fid:
                out.append(fid)
    return out


def embed_texts(
    texts: list[str],
    api_key: str | None = None,
    provider: str | None = None,
    task: str = "document",
) -> list[list[float]]:
    """Module-level embed helper (patchable in tests)."""
    if not provider or not api_key:
        raise ValueError("BYOK required: provider and api_key are required for embeddings")
    return llm_embed_texts(texts, provider=provider, api_key=api_key, task=task)


async def _embed(texts: list[str], *, provider: str, api_key: str) -> list[list[float]]:
    return await asyncio.to_thread(embed_texts, texts, api_key, provider, "document")


async def activate_embedding_batch(
    *,
    scope_key: str,
    space: EmbeddingSpace,
    provider: str,
    rows: list[dict],
    assignment_id: str | None,
    course_id: str | None,
    canvas_file_id: str | None,
    source_updated_at: str | None = None,
    extra_config: dict | None = None,
) -> str:
    """Atomically replace a scope's chunks and record provenance (single DB transaction).

    Any failure raises; the RPC rolls back, so previously active data is untouched.
    Nothing is deleted from Python. The RPC serializes activations per scope and
    rejects one whose source_updated_at is older than the active one (STALE_ACTIVATION).
    """
    if len(rows) != len({r["chunk_index"] for r in rows}):
        raise ValueError("duplicate chunk_index in batch")
    clean_rows: list[dict] = []
    for r in rows:
        clean = dict(r)
        if "chunk_text" in clean:
            clean["chunk_text"] = _strip_nul(clean.get("chunk_text"))
        if "source_title" in clean:
            clean["source_title"] = _strip_nul(str(clean.get("source_title") or ""))
        clean_rows.append(clean)
    batch_id = str(uuid.uuid4())
    cfg = get_provider(provider)
    config = {**(extra_config or {}), **space.config(), "index_version": INDEX_VERSION, "lms_host": trusted_lms_host()}
    if source_updated_at:
        config["source_updated_at"] = source_updated_at
    params = {
        "p_scope_key": scope_key,
        "p_batch_id": batch_id,
        "p_space_id": space.space_id,
        "p_index_version": INDEX_VERSION,
        "p_config": config,
        "p_embedding_provider": cfg.id,
        "p_embedding_model": cfg.embedding_model,
        "p_lms_host": trusted_lms_host(),
        "p_assignment_id": assignment_id,
        "p_course_id": course_id,
        "p_canvas_file_id": canvas_file_id,
        "p_rows": clean_rows,
    }
    sb = get_supabase()
    try:
        await asyncio.to_thread(lambda: sb.rpc("activate_embedding_batch", params).execute())
    except Exception as e:
        if any(m in str(e).lower() for m in _RPC_MISSING_MARKERS) or _is_schema_missing_error(e):
            raise EmbeddingProvenanceError(
                "Run grading_server/migrations/2026_10_31_embedding_provenance.sql before ingesting.",
                code="EMBEDDING_MIGRATION_REQUIRED",
            ) from e
        raise
    return batch_id


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


def _load_provenance_sync(assignment_id: str, course_id: str) -> tuple[list[dict], bool]:
    """Metadata rows retrieval can combine (this assignment + the course's files, plus the
    legacy course row) and whether any visible chunk in the course lacks provenance."""
    sb = get_supabase()
    cid = str(course_id)
    own = assignment_scope_key(cid, str(assignment_id))
    rows = sb.table(META_TABLE).select("scope_key,space_id,index_version").eq("course_id", cid).execute().data or []
    metas = [
        m for m in rows
        if m.get("scope_key") in (own, f"course:{cid}") or str(m.get("scope_key", "")).startswith(f"course:{cid}:file:")
    ]
    legacy = sb.table(CHUNKS_TABLE).select("id").eq("course_id", cid).is_(
        "embedding_space_id", "null"
    ).limit(1).execute().data or []
    return metas, bool(legacy)


async def evaluate_embedding_space(
    *,
    assignment_id: str,
    course_id: str,
    space: EmbeddingSpace,
) -> dict:
    """Non-raising provenance check for degrade-and-grade.

    Returns dict with:
      status: active | no_corpus | reingest_required | unknown_provenance | migration_required
      message: human-readable detail
      mismatched: list of scope_keys when status is reingest_required
    """
    try:
        metas, has_legacy_chunks = await asyncio.to_thread(_load_provenance_sync, str(assignment_id), course_id)
    except Exception as e:
        if _is_schema_missing_error(e):
            return {
                "status": "migration_required",
                "message": "Provenance columns are missing; apply the embedding provenance migration.",
                "mismatched": [],
            }
        raise
    if has_legacy_chunks or any(not m.get("space_id") for m in metas):
        return {
            "status": "unknown_provenance",
            "message": "Stored course materials have no recorded embedding space. Re-ingest them with the current provider.",
            "mismatched": [m.get("scope_key") for m in metas if m.get("scope_key")],
        }
    mismatched = [
        m["scope_key"]
        for m in metas
        if m["space_id"] != space.space_id or m.get("index_version") != INDEX_VERSION
    ]
    if mismatched:
        return {
            "status": "reingest_required",
            "message": (
                f"Materials in {', '.join(sorted(mismatched))} were embedded in a different space or index version. "
                "Reindexing in the background; this grade uses rubric + submission only."
            ),
            "mismatched": mismatched,
        }
    return {
        "status": "active" if metas else "no_corpus",
        "message": "",
        "mismatched": [],
    }


async def assert_embedding_space_compatible(
    *,
    assignment_id: str,
    course_id: str,
    space: EmbeddingSpace,
) -> str:
    """Gate grading on stored-vector provenance across assignment and course scopes.

    Returns "active" (all stored data is in `space`) or "no_corpus" (nothing stored).
    Raises EmbeddingProvenanceError: UNKNOWN_PROVENANCE (legacy metadata or chunks
    without a recorded space), REINGEST_REQUIRED (different space or index version),
    EMBEDDING_MIGRATION_REQUIRED (provenance columns absent). Provider/model strings
    are never used to certify data.

    Prefer evaluate_embedding_space() on the live grade path (degrade-and-grade).
    """
    result = await evaluate_embedding_space(
        assignment_id=assignment_id, course_id=course_id, space=space,
    )
    status = result["status"]
    if status == "migration_required":
        raise EmbeddingProvenanceError(result["message"], code="EMBEDDING_MIGRATION_REQUIRED")
    if status == "unknown_provenance":
        raise EmbeddingProvenanceError(result["message"], code="UNKNOWN_PROVENANCE")
    if status == "reingest_required":
        raise EmbeddingProvenanceError(result["message"], code="REINGEST_REQUIRED")
    return status


async def mark_course_files_pending_reingest(
    course_id: str,
    *,
    reason: str = "REINGEST_REQUIRED",
    mismatched_scope_keys: list[str] | None = None,
) -> int:
    """Mark mismatched course_file_ingest rows pending so UI/auto-ingest reindexes them.

    When mismatched_scope_keys is provided, only course-file scopes are marked.
    Assignment-only mismatches mark nothing. An empty list means corpus-wide
    (legacy unknown provenance) and marks every registry row for the course.
    chunk_count is preserved so prior index evidence stays visible until replaced.
    """
    if not course_id:
        return 0

    file_ids: list[str] | None
    if mismatched_scope_keys is None:
        file_ids = None
    else:
        file_ids = _file_ids_from_scope_keys(str(course_id), mismatched_scope_keys)
        if mismatched_scope_keys and not file_ids:
            return 0
        if not file_ids:
            file_ids = None

    def _mark(client) -> int:
        q = (
            client.table("course_file_ingest")
            .update({"status": "pending", "last_error": str(reason)[:500]})
            .eq("course_id", str(course_id))
        )
        if file_ids is not None:
            q = q.in_("canvas_file_id", file_ids)
        res = q.execute()
        data = res.data or []
        return len(data) if isinstance(data, list) else 0

    try:
        return await asyncio.to_thread(_mark, get_supabase())
    except Exception as e:
        if _is_schema_missing_error(e):
            return 0
        if _is_rls_denied(e):
            try:
                return await asyncio.to_thread(_mark, service_role_client())
            except Exception:
                print(f"[course_cache] mark pending reingest failed: {e}")
                return 0
        print(f"[course_cache] mark pending reingest failed: {e}")
        return 0


async def mark_course_file_failed(
    course_id: str,
    canvas_file_id: str,
    *,
    filename: str = "",
    updated_at: str = "",
    last_error: str = "",
) -> None:
    """Persist a file-level ingest failure even when parse/download never reached ingest_course_file."""
    if not course_id or not canvas_file_id:
        return
    try:
        await _upsert_registry({
            "course_id": str(course_id),
            "canvas_file_id": str(canvas_file_id),
            "filename": filename or "",
            "updated_at": updated_at or "",
            "status": "failed",
            "chunk_count": 0,
            "last_error": str(last_error or "INGEST_FAILED")[:500],
        })
    except Exception as e:
        print(f"[course_cache] mark failed registry write skipped: {e}")


def course_cache_is_fresh(
    registry_row: dict | None,
    meta: dict | None,
    *,
    course_id: str,
    canvas_file_id: str,
    updated_at: str,
    space: EmbeddingSpace,
) -> bool:
    """Skip re-embedding only when the stored file is provably the same source in the same space."""
    if not registry_row or not meta:
        return False
    return (
        registry_row.get("status") == "ready"
        and (registry_row.get("updated_at") or "") == updated_at
        and str(registry_row.get("course_id")) == str(course_id)
        and str(registry_row.get("canvas_file_id")) == str(canvas_file_id)
        and meta.get("scope_key") == course_file_scope_key(course_id, canvas_file_id)
        and meta.get("space_id") == space.space_id
        and meta.get("index_version") == INDEX_VERSION
        and bool(trusted_lms_host())
        and meta.get("lms_host") == trusted_lms_host()
    )


def assignment_content_hash(text: str | None, source_name: str) -> str:
    return hashlib.sha256(f"{source_name}\x00{text or ''}".encode("utf-8")).hexdigest()


def assignment_cache_is_fresh(meta: dict | None, *, scope_key: str, content_hash: str, space: EmbeddingSpace) -> bool:
    """Skip re-embedding assignment text only when the same text is active in the same space."""
    if not meta:
        return False
    cfg = meta.get("embedding_config") or {}
    return (
        meta.get("scope_key") == scope_key
        and cfg.get("content_hash") == content_hash
        and meta.get("space_id") == space.space_id
        and meta.get("index_version") == INDEX_VERSION
        and bool(meta.get("active_batch_id"))
        and bool(trusted_lms_host())
        and meta.get("lms_host") == trusted_lms_host()
    )


async def ingest_course_material(
    assignment_id: str,
    course_material_text: str,
    rubric_criteria: list[dict],
    exemplars: list[dict] | None = None,
    source_name: str = "Course Material",
    api_key: str | None = None,
    provider: str | None = None,
    course_id: str | None = None,
) -> dict:
    """
    Full ingestion pipeline (every row is scoped to course_id + assignment_id):
    1. Chunk + embed course material text
    2. Upsert rubric criteria
    3. Optionally embed + upsert exemplars
    """
    if not provider or not api_key:
        raise ValueError("BYOK required: provider and api_key are required for ingest")
    if not course_id:
        raise ValueError("course_id is required: ingested data is course-scoped")
    course_id = str(course_id)
    space = space_for_provider(provider)

    sb = get_supabase()

    course_material_text = _strip_nul(course_material_text)
    source_name = _strip_nul(source_name) or "Course Material"
    chunks = _splitter.split_text(course_material_text) if course_material_text else []
    if not chunks and course_material_text:
        chunks = [course_material_text[:1000]]

    scope_key = assignment_scope_key(course_id, str(assignment_id))
    content_hash = assignment_content_hash(course_material_text, source_name)
    chunks_stored = 0
    text_cached = bool(chunks) and assignment_cache_is_fresh(
        await get_embedding_meta(scope_key), scope_key=scope_key, content_hash=content_hash, space=space
    )
    if text_cached:
        chunks_stored = len(chunks)
    elif chunks:
        chunk_embeddings = await _embed(chunks, provider=provider, api_key=api_key)
        if len(chunk_embeddings) != len(chunks):
            raise ValueError(f"embedded {len(chunk_embeddings)} of {len(chunks)} chunks")

        chunk_rows = []
        for i, (text, emb) in enumerate(zip(chunks, chunk_embeddings)):
            chunk_rows.append({
                "assignment_id": str(assignment_id),
                "course_id": course_id,
                "canvas_file_id": None,
                "chunk_text": text,
                "chunk_index": i,
                "source_title": f"{source_name} (chunk {i + 1}/{len(chunks)})",
                "embedding": emb,
            })

        await activate_embedding_batch(
            scope_key=scope_key,
            space=space,
            provider=provider,
            rows=chunk_rows,
            assignment_id=str(assignment_id),
            course_id=course_id,
            canvas_file_id=None,
            extra_config={"content_hash": content_hash},
        )
        chunks_stored = len(chunk_rows)

    criteria_stored = 0
    if rubric_criteria:
        criteria_rows = []
        for i, c in enumerate(rubric_criteria):
            criteria_rows.append({
                "criterion_id": str(c.get("criterion_id") or c.get("id") or f"crit_{i}"),
                "assignment_id": str(assignment_id),
                "course_id": course_id,
                "title": str(c.get("title") or f"Criterion {i}"),
                "description": str(c.get("description", "")),
                "max_score": int(c.get("max_score", c.get("points", c.get("max_points", 10))) or 10),
                "dimension": str(c.get("dimension", "content")),
            })

        await asyncio.to_thread(
            lambda: sb.table("rubric_criteria")
                .upsert(criteria_rows, on_conflict="course_id,assignment_id,criterion_id")
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
                "criterion_id": str(ex.get("criterion_id") or ex.get("id") or ""),
                "assignment_id": assignment_id,
                "course_id": course_id,
                "submission_text": ex["submission_text"],
                "score": int(ex["score"]),
                "max_score": int(ex.get("max_score", ex.get("points", ex.get("max_points", 10))) or 10),
                "dimension": ex.get("dimension", "content"),
                "embedding": emb,
            })

        await asyncio.to_thread(
            lambda: sb.table("exemplars")
                .upsert(exemplar_rows, on_conflict="course_id,assignment_id,criterion_id,score")
                .execute()
        )
        exemplars_stored = len(exemplar_rows)

    return {
        "status": "success",
        "skipped": text_cached,
        "cached": text_cached,
        "chunks_stored": chunks_stored,
        "criteria_stored": criteria_stored,
        "exemplars_stored": exemplars_stored,
        "embedding_provider": provider,
        "embedding_space_id": space.space_id,
        "index_version": INDEX_VERSION,
    }


async def delete_assignment_data(assignment_id: str, course_id: str) -> dict:
    """
    Delete this assignment's description chunks, criteria, and exemplars within one course.
    Shared course-file chunks (canvas_file_id set) are never touched here.
    """
    if not assignment_id or not course_id or str(assignment_id).startswith("course:"):
        raise ValueError("delete requires a real assignment_id and its course_id")
    sb = get_supabase()
    aid, cid = str(assignment_id), str(course_id)

    def _delete():
        ex_resp = sb.table("exemplars").delete().eq("assignment_id", aid).eq("course_id", cid).execute()
        ch_resp = (
            sb.table("course_material_chunks").delete()
            .eq("assignment_id", aid).eq("course_id", cid).is_("canvas_file_id", "null").execute()
        )
        cr_resp = sb.table("rubric_criteria").delete().eq("assignment_id", aid).eq("course_id", cid).execute()
        try:
            sb.table("assignment_embedding_meta").delete().eq("scope_key", assignment_scope_key(cid, aid)).execute()
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


async def cached_course_file_hit(
    course_id: str,
    canvas_file_id: str,
    updated_at: str,
    *,
    provider: str,
) -> dict | None:
    """Return a skip payload when this Canvas file is already embedded. No download."""
    existing = await lookup_course_file(course_id, canvas_file_id)
    if not existing or existing.get("status") != "ready":
        return None
    scope_key = course_file_scope_key(course_id, canvas_file_id)
    meta = await get_embedding_meta(scope_key)
    space = space_for_provider(provider)
    if not course_cache_is_fresh(
        existing, meta,
        course_id=course_id,
        canvas_file_id=canvas_file_id,
        updated_at=updated_at or "",
        space=space,
    ):
        return None
    return {
        "status": "success",
        "skipped": True,
        "cached": True,
        "chunks_stored": int(existing.get("chunk_count") or 0),
        "filename": existing.get("filename") or "",
    }


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
    """Write registry under the caller's JWT; if RLS blocks, retry with service role.

    Flask already authorized the caller as course staff. Trusted helpers may not
    have a memberships row yet when the JWT-scoped write runs.
    """

    def _up(client):
        client.table("course_file_ingest").upsert(
            row, on_conflict="course_id,canvas_file_id"
        ).execute()

    try:
        await asyncio.to_thread(_up, get_supabase())
    except Exception as e:
        if not _is_rls_denied(e):
            raise
        print(f"[course_cache] registry RLS denied; retrying with service role: {e}")
        await asyncio.to_thread(_up, service_role_client())


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
    space = space_for_provider(provider)

    updated_at = updated_at or ""
    scope_key = course_file_scope_key(course_id, canvas_file_id)
    existing = await lookup_course_file(course_id, canvas_file_id)
    if existing and existing.get("status") == "ready":
        meta = await get_embedding_meta(scope_key)
        if course_cache_is_fresh(
            existing, meta,
            course_id=course_id, canvas_file_id=canvas_file_id, updated_at=updated_at, space=space,
        ):
            return {
                "status": "success",
                "skipped": True,
                "cached": True,
                "chunks_stored": int(existing.get("chunk_count") or 0),
            }

    aid = f"course:{course_id}"
    course_material_text = _strip_nul(course_material_text)
    filename = _strip_nul(filename) or filename

    async def _legacy_fallback() -> dict:
        result = await ingest_course_material(
            assignment_id=str(assignment_id or aid),
            course_material_text=course_material_text,
            rubric_criteria=[],
            source_name=filename,
            api_key=api_key,
            provider=provider,
            course_id=str(course_id),
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
        if len(embeddings) != len(chunks):
            raise ValueError(f"embedded {len(embeddings)} of {len(chunks)} chunks")
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

        try:
            await activate_embedding_batch(
                scope_key=scope_key,
                space=space,
                provider=provider,
                rows=chunk_rows,
                assignment_id=str(assignment_id) if assignment_id else None,
                course_id=str(course_id),
                canvas_file_id=str(canvas_file_id),
                source_updated_at=updated_at or None,
            )
        except Exception as e:
            if "STALE_ACTIVATION" not in str(e):
                raise
            # A newer version of this file is already active; keep it and its registry row.
            return {"status": "success", "skipped": True, "cached": False, "superseded": True, "chunks_stored": 0}

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
            "embedding_provider": provider,
            "embedding_space_id": space.space_id,
            "index_version": INDEX_VERSION,
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
                "last_error": _registry_error_code(e),
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


async def _chunk_counts_by_file(course_id: str) -> dict[str, int]:
    """Count stored course_material_chunks per canvas_file_id for this course."""
    sb = get_supabase()

    def _q():
        resp = (
            sb.table("course_material_chunks")
            .select("canvas_file_id")
            .eq("course_id", str(course_id))
            .not_.is_("canvas_file_id", "null")
            .execute()
        )
        counts: dict[str, int] = {}
        for row in resp.data or []:
            fid = str(row.get("canvas_file_id") or "").strip()
            if not fid:
                continue
            counts[fid] = counts.get(fid, 0) + 1
        return counts

    try:
        return await asyncio.to_thread(_q)
    except Exception as e:
        print(f"[course_cache] chunk count verify failed: {e}")
        return {}


async def verify_course_file_index(course_id: str) -> dict:
    """
    Cross-check the course_file_ingest registry against stored chunks.

    A file is verified only when status is ready and at least one chunk exists
    for that course_id + canvas_file_id. Registry ready with zero chunks is broken.
    """
    rows = await list_course_file_status(course_id)
    chunk_counts = await _chunk_counts_by_file(course_id)
    files: list[dict] = []
    summary = {
        "indexed": 0,
        "failed": 0,
        "pending": 0,
        "broken": 0,
        "total_registry": len(rows),
        "files_with_chunks": sum(1 for n in chunk_counts.values() if n > 0),
    }
    for row in rows:
        fid = str(row.get("canvas_file_id") or "")
        stored = int(chunk_counts.get(fid, 0))
        status = str(row.get("status") or "")
        reported = int(row.get("chunk_count") or 0)
        verified = status == "ready" and stored > 0
        broken = status == "ready" and stored <= 0
        item = {
            **row,
            "stored_chunks": stored,
            "verified": verified,
            "check": (
                "indexed" if verified
                else "broken" if broken
                else status if status in ("failed", "pending") else "unknown"
            ),
            "chunk_count_match": stored == reported if status == "ready" else None,
        }
        files.append(item)
        if verified:
            summary["indexed"] += 1
        elif broken:
            summary["broken"] += 1
        elif status == "failed":
            summary["failed"] += 1
        elif status == "pending":
            summary["pending"] += 1
    return {"course_id": str(course_id), "files": files, "summary": summary}


def plan_removed_file_reconciliation(
    course_id: str,
    registry_rows: list[dict],
    canvas_file_ids: list[str] | None,
    listing_complete: bool,
) -> dict:
    """
    Decide which cached course files Canvas no longer lists. Planning only: nothing is deleted here.

    A failed, partial (unfinished pagination) or permission-limited listing proves nothing about
    deletion, so the result is status 'unknown' with no candidates. Removal of a candidate is a
    separate, per-file, course-scoped step (course:<cid>:file:<fid>) that the owner approves.
    """
    if canvas_file_ids is None or not listing_complete:
        return {"status": "unknown", "course_id": str(course_id), "removed_candidates": []}
    listed = {str(f) for f in canvas_file_ids}
    candidates = sorted(
        str(r["canvas_file_id"]) for r in registry_rows
        if str(r.get("course_id")) == str(course_id) and str(r.get("canvas_file_id")) not in listed
    )
    return {"status": "complete", "course_id": str(course_id), "removed_candidates": candidates}
