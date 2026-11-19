# Ingest resume + RAG retain — Implementation Plan

> **For agentic workers:** Implement tasks in order. Commit after tests pass.

**Spec:** `docs/superpowers/specs/2026-11-19-ingest-resume-rag-retain-design.md`

## Files

- `grading_server/ingest_service.py` — freshness, cache hit heal, `usable_count` on evaluate
- `grading_server/app.py` — grade path uses usable_count for rag_degraded
- `src/lib/courseFileRanker.ts` (+ test) — selectFilesNeedingIngest
- `src/components/modals/CourseMaterialsModal.tsx` — default selection
- Tests: `test_course_cache_helpers.py`, `test_embedding_integrity.py`

## Task 1: Server freshness + heal

1. Change `course_cache_is_fresh` to require `chunk_count > 0` instead of `status == ready`
2. On `cached_course_file_hit` / early skip in `ingest_course_file`, heal pending→ready
3. Test pending+fresh → cached skip

## Task 2: evaluate usable_count + grade RAG

1. `evaluate_embedding_space` returns `usable_count` (metas matching current space)
2. Grade: reingest schedules pending; `rag_degraded = usable_count == 0` (unknown_provenance → degraded)
3. Update embedding integrity test expectations

## Task 3: Frontend resume selection

1. Fix `selectFilesNeedingIngest` for pending-with-chunks
2. Modal selects needing-ingest only
3. Tests green

## Task 4: Commit + push
