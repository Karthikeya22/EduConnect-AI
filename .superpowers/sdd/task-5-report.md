# Task 5 Report: GradingHub phased ingest + `course_id`

## Status

Implemented the requested Task 5 changes in `src/pages/teacher/GradingHub.tsx`.

Commit: `e725c55 feat: phase course ingest so grading unblocks after minimum set`

## Implementation

- Imported `selectPhaseFiles` and `CanvasCourseFile` from `courseFileRanker`.
- Added `backgroundIndexing` UI state.
- Kept rubric and assignment-description ingestion in blocking Phase A.
- Ranked course documents with `selectPhaseFiles(..., 5)`, capping blocking file ingestion at five.
- Ingested Phase A files sequentially and continued after an individual file failure.
- Added `course_id`, `canvas_file_id`, and `updated_at` to Canvas URL ingest payloads.
- Started Phase B as fire-and-forget work after Phase A, with 400 ms pacing and isolated per-file failures.
- Ensured `ingestionPromisesRef` stores only the promise that completes after Phase A starts Phase B, so grading does not await Phase B.
- Added background indexing copy to the ingest banner and grading spinners.
- Added `course_id` to both attachment and text-only `/api/grade` request bodies.
- Gemini prompts were not changed.

## Verification

- Red static requirement check failed before implementation because phased-ingest markers were absent.
- Post-change static requirement check passed.
- `npm run lint` passed (`tsc --noEmit`).
- `npm run build` passed (534 modules transformed).
- IDE diagnostics reported no errors in `GradingHub.tsx`.

## Concerns / Follow-up

- Manual Canvas verification from the brief was not run because it requires an authenticated course, assignment, and browser session.
- The production build emits an existing JSZip chunking warning because GradingHub imports JSZip statically while UniversalPreviewer imports it dynamically; this does not fail the build.
- The working tree contained unrelated pre-existing changes. Only `src/pages/teacher/GradingHub.tsx` is intended for the Task 5 commit.

## Important/High Review Fixes

- Checked the assignment-level `/api/ingest` response and surface its response text (or `Assignment ingest failed`) through the existing auto-ingest error status.
- Restored the `CourseMaterialsModal` import, state, Manage Materials button, and modal render from `53a2b72`; restored the deleted modal file from `HEAD`.
- Kept the existing one-time `RUBRIC_MISSING_RETRY` behavior and corrected its status to say that grading is retried once.
- Preserved the Phase A cap of five files, fire-and-forget Phase B indexing, and `course_id` in both grading request variants.

## Review Fix Verification

- Red static regression check: failed as expected with all four review regressions detected.
- Green static regression check: passed assignment-ingest response handling, modal restoration, accurate retry status, Phase A cap, and `course_id` checks.
- `npm run lint`: passed (`tsc --noEmit`, exit code 0).
- IDE diagnostics: no errors in `GradingHub.tsx` or `CourseMaterialsModal.tsx`.
