# Grading quality root-cause fixes (design)

**Status:** Approved  
**Date:** 2026-11-18

## Problem

Dual-grade audit found five concrete defects:

1. Provenance mismatch hard-fails grading with 409 `REINGEST_REQUIRED`.
2. AI-injected criteria drive `flag_for_human` while being excluded from totals.
3. Missing `evidence_anchor` still allows generous scores (soft ~50% + restores).
4. Concept matching uses whole-submission text; anchors are reused across criteria.
5. Wrong/alternative deliverables are not gated before main-rubric scoring.

## Goals

- Grade on rubric + submission even when RAG corpus is incompatible; reingest in background.
- Keep AI criteria visible/scored in UI; never in total; never force human flags.
- Cap instructor criteria at ≤25% max when evidence anchor is missing; no restore paths.
- Infer concepts from criterion-local evidence; cap duplicate anchors.
- Detect wrong deliverable and zero/not_assess main-only criteria with an explicit flag.

## Non-goals

- Cross-provider vector migration / pad-project embeddings.
- Canvas token storage or memberships changes.
- Publishing grades to Canvas.
- Full grading-pipeline rewrite.

## Behavior

### Provenance degrade-and-grade

1. On grade, check embedding space compatibility.
2. If `REINGEST_REQUIRED` or `UNKNOWN_PROVENANCE`: enqueue background reingest for the course with current provider/key; continue grading with retrieval skipped/empty; set `materials_status=reingesting` and `rag_coverage_level` LOW/NONE.
3. If compatible: `materials_status=ready` and normal RAG.
4. Still fail closed on `EMBEDDING_MIGRATION_REQUIRED`.

### AI criteria

- Remain in `criteria_verdicts` for display.
- Remain excluded from totals.
- Excluded from `force_flag_for_human` triggers.

### Evidence / concept guards

- Missing instructor anchor → score ≤ ceil(max * 0.25); no integrity/claims_full restore when anchor missing.
- Concept haystack = evidence_anchor (+ optional local excerpt), not full submission.
- First use of an evidence_anchor among instructor criteria keeps score; later duplicates capped at ≤50%.

### Wrong deliverable

- Pre-grade deterministic signals (filename/title/body + proposal-style helpers).
- On mismatch: zero/not_assess main-only content criteria; set `wrong_deliverable=true` + teacher note; do not auto-force human flag.

## Tests

- Degrade path returns a grade (not 409) and marks materials reingesting.
- AI criterion ungrounded/placement does not set force_flag alone.
- Missing anchor ≤25%; no restore.
- Duplicate anchors capped.
- Wrong-deliverable zeros main-only criteria.
