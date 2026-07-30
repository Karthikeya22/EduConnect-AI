# Final Review Fix Report — `feat/rag-grading-latency`

Status: **DONE**. All 3 Critical and all 6 Important findings are fixed. Gemini prompts and MoE
behavior were not touched.

## Critical

1. **SQL RPC overload** (`grading_server/setup_course_material_cache.sql`)
   Added explicit `DROP FUNCTION IF EXISTS public.match_course_material_chunks(...)` for the 3-arg
   and 4-arg signatures (both `vector(768)` and `vector(3072)` spellings) before
   `CREATE OR REPLACE`, and appended `NOTIFY pgrst, 'reload schema';` so PostgREST picks up the new
   signature immediately. Note: Postgres ignores type modifiers when identifying functions, so the
   `768`/`3072` drops resolve to the same signature; the duplicates are harmless no-ops.

2. **Partial unique index vs. assignment upsert** (`grading_server/ingest_service.py`)
   `ingest_course_material` no longer upserts with `on_conflict="assignment_id,chunk_index"` — that
   index is now partial (`WHERE canvas_file_id IS NULL`) and `ON CONFLICT` cannot infer it. It now
   deletes rows for the assignment where `canvas_file_id IS NULL`, then inserts. If the
   `canvas_file_id` column does not exist yet (pre-migration DB), it falls back to deleting by
   `assignment_id` only. Rubric and exemplar upserts are unchanged.
   Same reasoning applied to `ingest_course_file`: the course-file write is now delete-then-insert
   instead of an upsert against the other partial index.

3. **Schema-missing fallback** (`grading_server/ingest_service.py`)
   Added `_is_schema_missing_error()` (matches `PGRST205`, `PGRST204`, "does not exist",
   "could not find the table", "schema cache"). `ingest_course_file` now falls back to
   `ingest_course_material(assignment_id=..., rubric_criteria=[], source_name=filename, ...)` when
   either the registry upsert or the chunk write fails for a missing schema, and returns that result
   (with `course_cache: false`) instead of bubbling up a 500.

## Important

4. **GradingHub Phase A accounting** (`src/pages/teacher/GradingHub.tsx`)
   Phase A counts succeeded/failed files. Any failure now shows an amber `warning` banner
   ("Materials partially indexed — N of M files failed…") instead of unconditional success; the
   warning is also what the banner returns to after Phase B finishes. `ingestFile` returns the
   parsed JSON and the 800 ms pace is skipped when the response has `cached: true` or
   `skipped: true` (Phase B's 400 ms pace likewise).

5. **Course-scoped stamping** (`grading_server/ingest_service.py`)
   Course file chunks are stamped `assignment_id = f"course:{course_id}"` instead of the triggering
   assignment id, so `delete_assignment_data(<assignment>)` can no longer wipe chunks shared with
   other assignments. The legacy (schema-missing) fallback still uses the triggering assignment id,
   since course-scoped retrieval is unavailable on that path.

6. **UI copy** (`src/pages/teacher/GradingHub.tsx`)
   Removed the `backgroundIndexing` state and both grading-spinner branches that showed
   "Indexing more materials in background…". While grading, the row button shows "Grading…" and the
   detail panel shows "CONSULTING CONTEXT & RUBRICS…" (the pre-grade blocking wait still shows
   "Reading class materials, please wait…"). Background indexing is now reported on the ingest
   banner only.

7. **`match_count` reverted to 5** in `_multihop_retrieve` (`grading_server/app.py`).

8. **`RUBRIC_MISSING_RETRY`** (`src/pages/teacher/GradingHub.tsx`)
   Extracted `postAssignmentIngest(assignmentId)` (shared with auto-ingest). On `rubric_missing`,
   the client now performs one rubric/description ingest attempt and then one grade retry; if the
   ingest attempt itself fails, the row fails with a clear "No rubric exists for this assignment
   (rubric upload failed: …)" message instead of retrying blindly.

9. **SSRF gate** (`grading_server/app.py`, `grading_server/config.py`)
   Added `_canvas_url_rejection()`: requires `http(s)`; rejects `localhost`,
   `metadata.google.internal`, and any private/loopback/link-local/reserved/multicast IP literal
   (covers `127.0.0.1`, `10.x`, `169.254.169.254`); then requires the host to match
   `instructure.com`, `inscloudgate.net`, `instructuremedia.com`, a `canvas.` prefix, or the host of
   the new `CANVAS_BASE_URL` config (default `https://usflearn.instructure.com`, override via env).
   The download keeps `timeout=30` and is now streamed with a 25 MB cap, enforced both from
   `Content-Length` and while reading the body.

## Verification

- `py -3 -m pytest grading_server/tests/test_course_cache_helpers.py grading_server/tests/test_canvas_url_gate.py -q` → **14 passed** (4 pre-existing deprecation warnings).
  Added tests: schema-missing fallback, `course:<id>` stamping, and the URL allowlist (allow/reject tables).
- `npx tsx src/lib/courseFileRanker.test.ts` → `courseFileRanker.test.ts PASS`.
- `npm run lint` (`tsc --noEmit`) → exit 0.
- Flask test client: `/api/health` → 200 `{"status":"ok"}`; `/api/ingest/course-status` → 400
  `course_id is required`; `/api/ingest/canvas-url` with `169.254.169.254` → 400 "Refusing to fetch a
  private or link-local address"; with `evil.example.com` → 400 "not a recognized Canvas host".
- IDE diagnostics clean for `app.py`, `ingest_service.py`, `GradingHub.tsx`.

## Remaining concerns

- `grading_server/setup_ingestion_tables.sql` still creates the 3-argument
  `match_course_material_chunks`; re-running that older script after this migration would
  re-introduce the overload. Not changed to keep scope tight.
- Assignment-description chunks are still keyed only by `(assignment_id, chunk_index)`, so two
  different non-file sources ingested under one assignment continue to replace each other. This
  matches the previous upsert behavior; it was not part of the review findings.
- The SSRF gate validates only the initial URL; `requests` still follows Canvas redirects to CDN
  hosts (which is required for real Canvas downloads).
- Live Canvas/Supabase verification was not run (needs an authenticated course and the migration
  applied to Supabase).
