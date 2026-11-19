# Ingest resume + RAG retain — Design

**Date:** 2026-11-19  
**Status:** Approved (Approach 2, option A)  
**Goal:** After a failed/interrupted materials run, Continue must not re-index saved files from scratch; grading must keep using retained chunks when they still exist.

## Core invariant

A Canvas course file is **already indexed** (skip download + skip re-embed) when:

1. Stored chunk count > 0 (`stored_chunks` / `chunk_count`)
2. Registry `updated_at` matches Canvas file `updated_at`
3. Embedding meta matches current `space_id` + `index_version` (+ LMS host), same as today’s freshness checks **except** `status` need not be `ready`

On skip: return `cached/skipped` and **heal** registry `status` → `ready` if it was `pending`.

Only these need work: missing row, `failed`, broken (0 chunks), stale `updated_at`, or pending/ready with no usable chunks.

## Surfaces

| Surface | Change |
|---|---|
| `course_cache_is_fresh` / `cached_course_file_hit` / `ingest_course_file` | Freshness without requiring `ready`; heal pending→ready on hit |
| `selectFilesNeedingIngest` | Exclude pending-with-chunks + matching stamp |
| `CourseMaterialsModal` | Default selection = needing-ingest only |
| Grade `/api/grade` | On `reingest_required`, schedule pending mark but set `rag_degraded` only when **usable_count == 0** for current space; otherwise keep retrieve |

## RAG

- Do not force empty retrieval solely because reingest was scheduled.
- If some metas still match current space → retrieve them; `materials_status` may still be `reingesting`.
- If no usable metas in current space → `rag_degraded` + `no_corpus` path (existing guards).
- Keep `coerce_retrieval` / empty-`max()` invariants.

## Out of scope

Similarity thresholds, chunking, prompts, Render plan upgrades, checkpoint “last file id” cursors.

## Tests

1. pending + chunks + matching stamp/meta → skip + heal ready  
2. `selectFilesNeedingIngest` excludes retained pending; includes failed/broken/stale  
3. Modal default selection uses needing-ingest helper  
4. Grade: usable chunks remain → `rag_degraded` false even when reingest scheduled  
5. All-mismatched space → still `rag_degraded` true  

## Success

Half-failed ingest + Continue → only leftovers work; indexed count does not wipe to zero; grades still see retained materials when vectors remain.
