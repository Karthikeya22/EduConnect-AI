# RAG Grading Latency (Course Material Cache) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock AI grading after a small minimum material set is ready, cache course files in Supabase so they are not re-downloaded/re-embedded per assignment, and finish remaining files in the background.

**Architecture:** Add a `course_file_ingest` registry and course-scoped chunk columns; skip ingest when Canvas `updated_at` matches a ready registry row; change GradingHub to Phase A (rubric + ≤5 ranked files) then Phase B (background remainder); pass `course_id` into `/api/grade` so retrieval searches course materials.

**Tech Stack:** React/TypeScript (`GradingHub.tsx`), Flask grading server (`app.py`, `ingest_service.py`), Supabase Postgres + pgvector RPC, Gemini embeddings (existing `embed_texts`).

## Global Constraints

- Do not change Gemini grade/critique prompts or the MoE toggle.
- Do not redesign LangGraph beyond plumbing `course_id` into retrieve.
- Cap Phase A course files at **5** (name-match + newest).
- If `course_id` is missing, keep assignment-scoped ingest/retrieve (legacy fallback).
- Single file failure must not block Phase A completion when rubric ingest succeeded.
- Do not wipe the course cache on 429/quota errors.
- Spec: `docs/superpowers/specs/2026-07-29-rag-grading-latency-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `grading_server/setup_course_material_cache.sql` | Registry table, chunk column alters, unique indexes, updated RPC |
| `grading_server/ingest_service.py` | Course-file skip/upsert, registry helpers, assignment ingest unchanged |
| `grading_server/app.py` | Extend canvas-url ingest, add course-status GET, grade `course_id` + retrieve filter |
| `src/lib/courseFileRanker.ts` | Pure helper: rank/split Canvas files into Phase A / Phase B |
| `src/pages/teacher/GradingHub.tsx` | Phased ingest, unblock grade after Phase A, pass `course_id` |
| `grading_server/tests/test_course_cache.py` | Unit tests for skip logic / ranking can live in frontend vitest-less; Python tests for service helpers |
| `src/lib/courseFileRanker.test.ts` | Unit tests for file ranking (run with `npx vitest` if available, else `npx tsx` assert script) |

---

### Task 1: SQL migration — course cache schema + RPC

**Files:**
- Create: `grading_server/setup_course_material_cache.sql`
- Test: Apply in Supabase SQL editor (manual); validate with smoke selects in Step 4

**Interfaces:**
- Produces: table `course_file_ingest`; columns `course_material_chunks.course_id`, `course_material_chunks.canvas_file_id`; RPC `match_course_material_chunks(..., filter_course_id text DEFAULT NULL)`

- [ ] **Step 1: Write the SQL migration file**

Create `grading_server/setup_course_material_cache.sql` with exactly:

```sql
-- Course-level material cache (run in Supabase SQL Editor)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE patterns where possible.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Registry of ingested Canvas files per course
CREATE TABLE IF NOT EXISTS public.course_file_ingest (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    course_id       TEXT NOT NULL,
    canvas_file_id  TEXT NOT NULL,
    filename        TEXT,
    updated_at      TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ready', 'failed')),
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    ingested_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_course_file_ingest UNIQUE (course_id, canvas_file_id)
);

CREATE INDEX IF NOT EXISTS idx_cfi_course
    ON public.course_file_ingest(course_id);

ALTER TABLE public.course_file_ingest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on course_file_ingest" ON public.course_file_ingest;
CREATE POLICY "Allow all on course_file_ingest" ON public.course_file_ingest
    FOR ALL USING (true) WITH CHECK (true);

-- 2. Extend chunks for course-scoped file materials
ALTER TABLE public.course_material_chunks
    ADD COLUMN IF NOT EXISTS course_id TEXT,
    ADD COLUMN IF NOT EXISTS canvas_file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cmc_course
    ON public.course_material_chunks(course_id);

CREATE INDEX IF NOT EXISTS idx_cmc_course_file
    ON public.course_material_chunks(course_id, canvas_file_id);

-- Drop old unique if present, then add partial uniques
ALTER TABLE public.course_material_chunks
    DROP CONSTRAINT IF EXISTS uq_cmc_assignment_chunk;

DROP INDEX IF EXISTS uq_cmc_course_file_chunk;
CREATE UNIQUE INDEX uq_cmc_course_file_chunk
    ON public.course_material_chunks (course_id, canvas_file_id, chunk_index)
    WHERE canvas_file_id IS NOT NULL;

DROP INDEX IF EXISTS uq_cmc_assignment_desc_chunk;
CREATE UNIQUE INDEX uq_cmc_assignment_desc_chunk
    ON public.course_material_chunks (assignment_id, chunk_index)
    WHERE canvas_file_id IS NULL;

-- 3. RPC: match by course_id and/or assignment_id (union)
CREATE OR REPLACE FUNCTION match_course_material_chunks(
    query_embedding vector(768),
    match_count int DEFAULT 8,
    filter_assignment_id text DEFAULT NULL,
    filter_course_id text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    chunk_text text,
    source_title text,
    chunk_index integer,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cmc.id,
        cmc.chunk_text,
        cmc.source_title,
        cmc.chunk_index,
        1 - (cmc.embedding <=> query_embedding) AS similarity
    FROM public.course_material_chunks cmc
    WHERE
        cmc.embedding IS NOT NULL
        AND (
            (filter_course_id IS NOT NULL AND cmc.course_id = filter_course_id)
            OR (filter_assignment_id IS NOT NULL AND cmc.assignment_id = filter_assignment_id)
            OR (filter_course_id IS NULL AND filter_assignment_id IS NULL)
        )
    ORDER BY cmc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

- [ ] **Step 2: Document apply step in a one-line comment at top of file**

Ensure the first comment line says: `Run this entire script in the Supabase SQL Editor once before using course cache.`

- [ ] **Step 3: Apply migration**

Run the script in the project’s Supabase SQL Editor (`https://supabase.com/dashboard` → project → SQL).

Expected: success, no errors.

- [ ] **Step 4: Smoke-check tables**

In SQL editor:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'course_material_chunks'
  AND column_name IN ('course_id', 'canvas_file_id');

SELECT to_regclass('public.course_file_ingest');
```

Expected: both columns listed; `course_file_ingest` not null.

- [ ] **Step 5: Commit**

```bash
git add grading_server/setup_course_material_cache.sql
git commit -m "feat: add SQL migration for course-level material cache"
```

---

### Task 2: Backend ingest helpers — skip cache + course-scoped upsert

**Files:**
- Modify: `grading_server/ingest_service.py`
- Create: `grading_server/tests/test_course_cache_helpers.py`

**Interfaces:**
- Consumes: Supabase `course_file_ingest`, `course_material_chunks`; `embed_texts(texts, api_key)`
- Produces:
  - `async def lookup_course_file(course_id: str, canvas_file_id: str) -> dict | None`
  - `async def ingest_course_file(*, course_id: str, canvas_file_id: str, updated_at: str, filename: str, course_material_text: str, assignment_id: str | None = None, api_key: str | None = None) -> dict`
  - Return shape on cache hit: `{"status":"success","skipped":True,"cached":True,"chunks_stored":0}`
  - Return shape on ingest: `{"status":"success","skipped":False,"cached":False,"chunks_stored":N}`

- [ ] **Step 1: Write failing tests**

Create `grading_server/tests/test_course_cache_helpers.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `py -m pytest grading_server/tests/test_course_cache_helpers.py -v`

Expected: FAIL with `AttributeError: module ... has no attribute 'lookup_course_file'` (or similar).

- [ ] **Step 3: Implement helpers in `ingest_service.py`**

Append (keep existing `ingest_course_material` for assignment rubric/description; when upserting assignment description chunks keep `canvas_file_id` null and use existing assignment unique index):

```python
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
```

Also add:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `py -m pytest grading_server/tests/test_course_cache_helpers.py -v`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add grading_server/ingest_service.py grading_server/tests/test_course_cache_helpers.py
git commit -m "feat: add course file ingest cache helpers with skip-on-hit"
```

---

### Task 3: Flask routes — course-file ingest, status, grade `course_id`

**Files:**
- Modify: `grading_server/app.py` (`GradingState`, `_multihop_retrieve`, `grade_submission`, `ingest_canvas_url`, add `course_status`)

**Interfaces:**
- Consumes: `ingest_course_file`, `lookup_course_file`, `list_course_file_status`
- Produces:
  - `POST /api/ingest/canvas-url` body fields: `course_id`, `canvas_file_id`, `updated_at` (+ existing)
  - `GET /api/ingest/course-status?course_id=`
  - `POST /api/grade` accepts `course_id`; graph state includes `course_id`

- [ ] **Step 1: Extend `GradingState` and retrieve filter**

In `grading_server/app.py`, add `course_id: str | None` to `GradingState`.

Change `_multihop_retrieve` signature and RPC call:

```python
async def _multihop_retrieve(
    sub_queries: list[str],
    assignment_id: str,
    api_key: str | None = None,
    course_id: str | None = None,
) -> list[dict]:
    ...
                params = {
                    "query_embedding": vec,
                    "match_count": 15,
                    "filter_assignment_id": assignment_id,
                }
                if course_id:
                    params["filter_course_id"] = course_id
                chunks = sb.rpc("match_course_material_chunks", params).execute().data or []
```

Find every call site of `_multihop_retrieve(` and pass `course_id=state.get("course_id")`.

- [ ] **Step 2: Pass `course_id` in `grade_submission`**

Where `get_graph().ainvoke({...})` is built, add:

```python
"course_id": data.get("course_id") or request.form.get("course_id"),
```

- [ ] **Step 3: Update `ingest_canvas_url` to use course cache when `course_id` + `canvas_file_id` provided**

After text extraction succeeds, replace the bare `ingest_course_material(...)` file path with:

```python
        from grading_server.ingest_service import ingest_course_file, ingest_course_material

        course_id = data.get("course_id")
        canvas_file_id = data.get("canvas_file_id")
        updated_at = data.get("updated_at") or ""
        custom_gemini_key = request.headers.get("X-Gemini-Api-Key")

        if course_id and canvas_file_id:
            result = await ingest_course_file(
                course_id=str(course_id),
                canvas_file_id=str(canvas_file_id),
                updated_at=str(updated_at),
                filename=data.get("filename") or filename,
                course_material_text=course_material_text,
                assignment_id=assignment_id,
                api_key=custom_gemini_key,
            )
            return jsonify(result), 200

        # Legacy fallback (assignment-scoped)
        result = await ingest_course_material(
            assignment_id=assignment_id,
            course_material_text=course_material_text,
            rubric_criteria=[],
            source_name=filename,
            api_key=custom_gemini_key,
        )
        return jsonify(result), 200
```

On exception for course path, return 500 JSON `{"error":"Canvas URL ingestion failed"}` (existing). Do not clear other registry rows.

- [ ] **Step 4: Add course status endpoint**

```python
@app.route("/api/ingest/course-status", methods=["GET"])
async def course_ingest_status():
    course_id = request.args.get("course_id")
    if not course_id:
        return jsonify({"error": "course_id is required"}), 400
    from grading_server.ingest_service import list_course_file_status
    files = await list_course_file_status(course_id)
    return jsonify({"course_id": course_id, "files": files}), 200
```

- [ ] **Step 5: Manual smoke against running server**

With server on 5557:

```powershell
Invoke-WebRequest "http://127.0.0.1:5557/api/ingest/course-status?course_id=test" -UseBasicParsing
```

Expected: 200 JSON with `"files": []` (or rows). Not 404.

- [ ] **Step 6: Commit**

```bash
git add grading_server/app.py
git commit -m "feat: wire course cache into ingest, status, and grade retrieve"
```

---

### Task 4: Frontend file ranker helper

**Files:**
- Create: `src/lib/courseFileRanker.ts`
- Create: `src/lib/courseFileRanker.test.ts` (or assert via `npx tsx` script if no vitest)

**Interfaces:**
- Consumes: Canvas file objects with at least `id`, `display_name`, optional `updated_at` / `created_at` / `url`
- Produces:
  - `export type CanvasCourseFile = { id: string | number; display_name: string; url?: string; updated_at?: string; created_at?: string; [k: string]: unknown }`
  - `export function selectPhaseFiles(files: CanvasCourseFile[], assignmentTitle: string, phaseALimit = 5): { phaseA: CanvasCourseFile[]; phaseB: CanvasCourseFile[] }`

- [ ] **Step 1: Write failing test**

Create `src/lib/courseFileRanker.test.ts`:

```typescript
import { selectPhaseFiles, CanvasCourseFile } from './courseFileRanker';

const files: CanvasCourseFile[] = [
  { id: 1, display_name: 'unrelated_notes.pdf', updated_at: '2026-01-01T00:00:00Z' },
  { id: 2, display_name: 'EME6356_Reflection_rubric.pdf', updated_at: '2026-01-02T00:00:00Z' },
  { id: 3, display_name: 'syllabus.docx', updated_at: '2026-01-03T00:00:00Z' },
  { id: 4, display_name: 'zzz_old.txt', updated_at: '2025-01-01T00:00:00Z' },
  { id: 5, display_name: 'instructions_reflection.pdf', updated_at: '2026-01-04T00:00:00Z' },
  { id: 6, display_name: 'extra6.pdf', updated_at: '2026-01-05T00:00:00Z' },
  { id: 7, display_name: 'extra7.pdf', updated_at: '2026-01-06T00:00:00Z' },
];

const { phaseA, phaseB } = selectPhaseFiles(files, 'EME 6356 Reflection Paper', 5);
if (phaseA.length !== 5) throw new Error(`expected 5 phaseA, got ${phaseA.length}`);
if (!phaseA.some(f => String(f.id) === '2')) throw new Error('rubric match missing from phaseA');
if (!phaseA.some(f => String(f.id) === '5')) throw new Error('instructions match missing from phaseA');
if (phaseA.length + phaseB.length !== files.length) throw new Error('partition incomplete');
console.log('courseFileRanker.test.ts PASS');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx --yes tsx src/lib/courseFileRanker.test.ts`

Expected: FAIL module not found / export missing.

- [ ] **Step 3: Implement `src/lib/courseFileRanker.ts`**

```typescript
export type CanvasCourseFile = {
  id: string | number;
  display_name: string;
  url?: string;
  updated_at?: string;
  created_at?: string;
  [k: string]: unknown;
};

const KEYWORD_RE = /rubric|instructions|syllabus|assignment/i;

function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function fileTime(f: CanvasCourseFile): number {
  const raw = f.updated_at || f.created_at || '';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function scoreFile(f: CanvasCourseFile, titleTokens: string[]): number {
  const name = (f.display_name || '').toLowerCase();
  let score = 0;
  if (KEYWORD_RE.test(name)) score += 100;
  for (const tok of titleTokens) {
    if (name.includes(tok)) score += 20;
  }
  // Newer files get a small boost for tie-breaks among non-matches
  score += Math.min(10, fileTime(f) / 1e12);
  return score;
}

export function isDocCourseFile(f: CanvasCourseFile): boolean {
  const n = (f.display_name || '').toLowerCase();
  return n.endsWith('.pdf') || n.endsWith('.docx') || n.endsWith('.txt') || n.endsWith('.pptx');
}

export function selectPhaseFiles(
  files: CanvasCourseFile[],
  assignmentTitle: string,
  phaseALimit = 5
): { phaseA: CanvasCourseFile[]; phaseB: CanvasCourseFile[] } {
  const docs = files.filter(isDocCourseFile);
  const tokens = tokenizeTitle(assignmentTitle || '');
  const ranked = [...docs].sort((a, b) => {
    const ds = scoreFile(b, tokens) - scoreFile(a, tokens);
    if (ds !== 0) return ds;
    return fileTime(b) - fileTime(a);
  });
  const phaseA = ranked.slice(0, Math.max(0, phaseALimit));
  const phaseAIds = new Set(phaseA.map((f) => String(f.id)));
  const phaseB = ranked.filter((f) => !phaseAIds.has(String(f.id)));
  return { phaseA, phaseB };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx --yes tsx src/lib/courseFileRanker.test.ts`

Expected: `courseFileRanker.test.ts PASS`

- [ ] **Step 5: Commit**

```bash
git add src/lib/courseFileRanker.ts src/lib/courseFileRanker.test.ts
git commit -m "feat: add course file ranker for Phase A minimum set"
```

---

### Task 5: GradingHub phased ingest + pass `course_id`

**Files:**
- Modify: `src/pages/teacher/GradingHub.tsx`

**Interfaces:**
- Consumes: `selectPhaseFiles` from `src/lib/courseFileRanker.ts`; APIs `/api/ingest`, `/api/ingest/canvas-url`, `/api/grade`
- Produces: Phase A promise in `ingestionPromisesRef` only; Phase B fire-and-forget; grade body includes `course_id`

- [ ] **Step 1: Import ranker and add background-indexing state**

Near other imports:

```typescript
import { selectPhaseFiles, CanvasCourseFile } from '../../lib/courseFileRanker';
```

Add state:

```typescript
const [backgroundIndexing, setBackgroundIndexing] = useState(false);
```

- [ ] **Step 2: Replace `runAutoIngest` body with Phase A / Phase B**

Replace the current auto-ingest effect logic so that:

1. Upsert `/api/ingest` (rubric + description) as today.
2. `getCourseFiles` → `selectPhaseFiles(files, currentItem?.name || currentItem?.title || '', 5)`.
3. Ingest **only** `phaseA` files sequentially with payload including:

```typescript
{
  assignment_id: selectedAssignment,
  course_id: selectedCourse,
  url: file.url,
  filename: file.display_name,
  canvas_file_id: String(file.id),
  updated_at: file.updated_at || file.created_at || '',
  canvas_token: localStorage.getItem('custom_canvas_token') || ''
}
```

4. On Phase A complete: `setIngestedAssignments`, set status success / clear loading; **resolve** the promise stored in `ingestionPromisesRef` so grading unblocks.
5. Start Phase B **without** awaiting in that same promise:

```typescript
void (async () => {
  setBackgroundIndexing(true);
  setIngestStatus({ type: 'loading', msg: 'Indexing more materials in background...' });
  for (const file of phaseB) {
    try {
      // same POST /api/ingest/canvas-url payload as Phase A
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      console.error(`Background ingest failed: ${file.display_name}`, e);
    }
  }
  setBackgroundIndexing(false);
  setIngestStatus({ type: 'success', msg: 'Materials auto-ingested' });
  setTimeout(() => setIngestStatus(null), 5000);
})();
```

6. Single file failure in Phase A: `console.error` and continue (do not throw out of Phase A).

7. Keep `ingestionPromisesRef.current[selectedAssignment] = phaseAPromise` where `phaseAPromise` resolves after Phase A only.

- [ ] **Step 3: Update UI copy for background indexing**

Where ingest banner / spinner text is shown, if `backgroundIndexing` and not waiting on Phase A for this student, show “Indexing more materials in background…”. Keep “Reading class materials, please wait…” only while `ingestingStudents` has the student (Phase A wait).

- [ ] **Step 4: Pass `course_id` into `/api/grade` bodies**

In `backendReq` JSON bodies (both attachment and non-attachment branches), add:

```typescript
course_id: selectedCourse,
```

- [ ] **Step 5: Manual verification checklist**

1. Restart `npm run dev`.
2. Open Grading Hub, select assignment with many course files.
3. Confirm Phase A finishes and grade becomes available while banner may still say background indexing.
4. Grade one student — should not sit on “Reading class materials…” for full-course duration.
5. Re-select another assignment in same course — network tab should show many `skipped`/`cached` responses.

- [ ] **Step 6: Commit**

```bash
git add src/pages/teacher/GradingHub.tsx
git commit -m "feat: phase course ingest so grading unblocks after minimum set"
```

---

### Task 6: End-to-end verification

**Files:**
- None required (manual + optional log notes)

**Interfaces:**
- Consumes: running app at `http://localhost:3000`, API `http://127.0.0.1:5557`

- [ ] **Step 1: Confirm migration applied** (re-run smoke SQL from Task 1 if unsure)

- [ ] **Step 2: Cold-path timing**

Select a course/assignment with ≥10 doc files. Note time until grade button leaves “Reading class materials…”.

Expected: roughly ingest time for ≤5 files + rubric, not all files.

- [ ] **Step 3: Warm-path cache hits**

Select a second assignment in the same course. Watch backend logs / Network for `/api/ingest/canvas-url` responses with `"skipped": true` / `"cached": true`.

Expected: most Phase A files skipped.

- [ ] **Step 4: Grade during Phase B**

While “Indexing more materials in background…” is visible, grade Camille (or any student).

Expected: grade completes (or fails for unrelated Gemini reasons), not blocked on remaining files.

- [ ] **Step 5: Commit verification note (optional)**

If you capture timings, append a short note under `docs/superpowers/specs/2026-07-29-rag-grading-latency-design.md` Verification results — only if the user wants it documented. Otherwise skip commit.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Course-level persist / skip by `updated_at` | Tasks 1–3 |
| Minimum set name-match + newest, cap 5 | Tasks 4–5 |
| Don’t block grade on full ingest | Task 5 |
| Background remainder | Task 5 |
| `course_id` on grade + retrieve | Task 3 |
| Status endpoint | Task 3 |
| Legacy fallback without `course_id` | Task 3 |
| Single-file failure tolerance | Tasks 2, 5 |
| Quota doesn’t wipe cache | Task 2 (failed status only for that file) |
| Verification cold/warm/Phase B | Task 6 |

## Placeholder / consistency check

- Function names consistent: `ingest_course_file`, `lookup_course_file`, `list_course_file_status`, `selectPhaseFiles`.
- Payload fields consistent: `course_id`, `canvas_file_id`, `updated_at`.
- RPC param: `filter_course_id`.
- No TBD/TODO left in tasks.
