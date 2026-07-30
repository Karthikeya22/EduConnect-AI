# RAG Grading Latency — Course-Level Material Cache

**Date:** 2026-07-29  
**Status:** Approved for planning  
**Product:** EduConnect AI (`EduConnect-AI`)

## Problem

When a teacher opens Grading Hub and clicks **Grade with AI**, the right panel stays on **“Reading class materials, please wait…”** for a long time.

Root cause: selecting an assignment triggers `runAutoIngest` in `GradingHub.tsx`, which:

1. POSTs assignment rubric/description to `/api/ingest`
2. Fetches **all** course PDF/DOCX/TXT/PPTX files from Canvas
3. Sequentially POSTs each to `/api/ingest/canvas-url` (download + chunk + embed)
4. **Blocks** `handleFetchAiGrade` until that entire promise finishes

Course materials are stored only under `assignment_id`, so switching assignments (or re-selecting) re-ingests the same files. Embedding rate limits make this worse.

## Goals

- Unblock grading after a **minimum material set** is ready (not after every course file).
- Persist ingested files at **course** scope so later assignments reuse embeddings.
- Continue indexing remaining files in the **background** without blocking grade.
- Prefer assignment-relevant files for the minimum set (name match + newest), cap ≈ 5.

## Non-goals

- Changing Gemini grade/critique prompts or the MoE UI toggle.
- Redesigning the full LangGraph pipeline beyond passing `course_id` into retrieval.
- One-time migration/backfill of historical assignment-scoped chunks (optional later).

## Chosen approach

**Course-level ingest cache in Supabase** (Approach 1), with:

- Minimum-set gate before grading (rubric + assignment text + up to N key files)
- Smart file selection (name match vs assignment title / “rubric” / “instructions”, then newest)
- Background ingest for the rest
- Skip re-download/re-embed when registry shows same Canvas file id + unchanged `updated_at`

## Architecture

```
Assignment selected
        │
        ├─► Upsert rubric + assignment text (assignment-scoped)     [fast]
        │
        ├─► List Canvas course files
        │         │
        │         ├─ Minimum set (≤5: name-match + newest)
        │         │      └─ For each: registry hit? skip : download/embed → course cache
        │         │
        │         └─ Remainder → background ingest (same cache)
        │
        ├─► Phase A complete → allow Grade with AI
        │
        └─► /api/grade with course_id
                  └─ retrieve materials by course_id; rubric by assignment_id
```

## Data model

### Keep assignment-scoped

- `rubric_criteria` — keyed by `(assignment_id, criterion_id)`
- `exemplars` — assignment-scoped (unchanged)

### New: `course_file_ingest` registry

| Column | Purpose |
|--------|---------|
| `course_id` | Canvas course id |
| `canvas_file_id` | Stable Canvas file id |
| `filename` | Display name |
| `updated_at` | Canvas file updated_at used for invalidation |
| `status` | `pending` \| `ready` \| `failed` |
| `chunk_count` | Number of chunks stored |
| `last_error` | Optional last failure message |
| `ingested_at` | When last successfully ingested |

Unique: `(course_id, canvas_file_id)`.

### Extend: `course_material_chunks`

Add:

- `course_id` (TEXT, required for new rows)
- `canvas_file_id` (TEXT, nullable for assignment-description-only chunks)

Change uniqueness from `(assignment_id, chunk_index)` to `(course_id, canvas_file_id, chunk_index)` for file-backed chunks.

Assignment description / synthetic material may still store with `assignment_id` set and `canvas_file_id` null (or a sentinel), without blocking course-file reuse.

### RPC: `match_course_material_chunks`

Add optional `filter_course_id`. Retrieval for grading prefers:

1. Chunks matching `filter_course_id` (course materials)
2. Plus assignment-description chunks for the current `assignment_id` if needed

SQL migration file: add under `grading_server/` (e.g. `setup_course_material_cache.sql`) for the Supabase SQL editor.

## API changes

### `POST /api/ingest` (assignment materials)

Unchanged purpose: rubric + assignment description text. Must remain fast and assignment-scoped.

### `POST /api/ingest/canvas-url` (extend) or `POST /api/ingest/course-file`

Accept:

- `course_id` (required for cache path)
- `assignment_id` (optional, for logging / legacy)
- `url`, `filename`, `canvas_file_id`, `updated_at`
- `canvas_token`
- Header `X-Gemini-Api-Key` (existing)

Behavior:

1. If registry row exists with `status=ready` and same `updated_at` → return `{ skipped: true, cached: true }` without download/embed.
2. Else download, extract, chunk, embed, upsert chunks keyed by course/file, upsert registry `ready`.
3. On failure → registry `failed` + error; do not fail unrelated files.

### `GET /api/ingest/course-status?course_id=`

Returns cached/pending/failed file list for UI progress.

### `POST /api/grade`

Accept `course_id` in JSON body. Pass into graph state; `run_retrieve` uses course filter for material search. Rubric/exemplars still load by `assignment_id`.

**Fallback:** If `course_id` missing, keep current assignment-scoped behavior so older clients do not hard-break.

## Frontend changes (`GradingHub.tsx`)

### File selection (minimum set)

From Canvas course files (doc types only):

1. Score/filter names matching assignment title tokens, or containing `rubric` / `instructions` / `syllabus` / `assignment`
2. Fill remaining slots with newest by `updated_at` / `created_at`
3. Cap at **5** for Phase A

### Phased ingest

- **Phase A (blocking for grade):** `/api/ingest` + minimum set course files (skip cache hits)
- **Phase B (background):** remaining files; do **not** hold `ingestionPromisesRef` for Phase B in a way that blocks `handleFetchAiGrade`

### UI copy

- Phase A: “Reading class materials, please wait…”
- Phase A done, Phase B running: “Indexing more materials in background…”
- Grade click after Phase A: normal “Consulting context & rubrics…”

### Grade request

Include `course_id: selectedCourse` in `/api/grade` body (and attachments path).

## Error handling

| Case | Behavior |
|------|----------|
| Single file fail in Phase A | Skip; continue if rubric/assignment ingest succeeded |
| Quota / 429 | Existing Gemini retry/backoff; clear user message; do not wipe course cache |
| Registry miss / schema not applied | Log; fall back to assignment-scoped ingest for that request |
| Phase B failures | Log + status banner; grading remains available |

## Success criteria

1. Time-to-grade-ready on a course with many files is dominated by the minimum set (and is near-instant when cache is warm).
2. Second assignment in the same course mostly hits cache (no re-embed for unchanged files).
3. Changing a file’s Canvas `updated_at` re-ingests only that file.
4. Grading succeeds while Phase B is still running.
5. Relevant course chunks still appear in RAG evidence when materials exist.

## Verification plan

1. Cold course with ≥10 doc files: measure Phase A duration vs old full-ingest wait.
2. Warm course / second assignment: confirm skipped responses from course-file ingest.
3. Touch one file’s `updated_at`: only that file re-processes.
4. Start grade during Phase B: completes without waiting for all files.
5. Force one file 429/failure: Phase A still completes; UI does not soft-lock forever.

## Implementation notes (for planning)

Primary touch points:

- `src/pages/teacher/GradingHub.tsx` — phased ingest, file ranking, unblock grade
- `grading_server/ingest_service.py` — course-scoped upsert + skip logic
- `grading_server/app.py` — endpoints + grade `course_id` plumbing
- `grading_server` retrieve path in `app.py` / `nodes/retrieve.py` — `filter_course_id`
- New SQL setup script for registry + chunk columns + RPC

Ship order: SQL migration → backend cache/skip + retrieve filter → frontend phased ingest → verify warm/cold paths.
