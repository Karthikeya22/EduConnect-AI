-- =========================================================================
-- Embedding provenance + atomic batch activation (2026-10-31)
--
-- STATUS: written, NOT executed. The owner runs this manually in the Supabase
-- SQL editor after review.
--
-- Non-destructive: only ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- and CREATE OR REPLACE FUNCTION. No DROP, no backfill, no UPDATE of existing
-- rows. Legacy chunks keep embedding_space_id = NULL and are therefore
-- quarantined: match_course_material_chunks_v2 never returns them, and the
-- grading gate reports UNKNOWN_PROVENANCE until they are re-ingested.
--
-- The existing match_course_material_chunks (v1) is left untouched, so code
-- from before this patch keeps working if the code is rolled back.
--
-- Required order: 1) this migration  2) deploy code  3) re-ingest every course
-- and assignment's materials with the provider that will be used for grading.
--
-- SUPERSEDED FUNCTIONS: 2026_10_31_authz_scope.sql re-creates both RPCs with
-- authorization checks. Never re-run this file alone after that one; if you
-- re-run it, re-run 2026_10_31_authz_scope.sql immediately afterwards.
-- =========================================================================

-- 1. Chunk-level provenance -------------------------------------------------
ALTER TABLE public.course_material_chunks
    ADD COLUMN IF NOT EXISTS course_id           TEXT,
    ADD COLUMN IF NOT EXISTS canvas_file_id      TEXT,
    ADD COLUMN IF NOT EXISTS embedding_space_id  TEXT,
    ADD COLUMN IF NOT EXISTS index_version       TEXT,
    ADD COLUMN IF NOT EXISTS ingest_batch_id     UUID,
    ADD COLUMN IF NOT EXISTS embedding_scope_key TEXT;

CREATE INDEX IF NOT EXISTS idx_cmc_scope_batch
    ON public.course_material_chunks (embedding_scope_key, ingest_batch_id);
CREATE INDEX IF NOT EXISTS idx_cmc_legacy_provenance
    ON public.course_material_chunks (assignment_id, course_id)
    WHERE embedding_space_id IS NULL;

-- 2. Scope-level provenance (active batch per scope) ----------------------
-- Scope keys: 'assignment:<assignment_id>' and 'course:<course_id>:file:<canvas_file_id>'.
-- Legacy rows ('course:<course_id>', no space_id) are left as-is and read as UNKNOWN_PROVENANCE.
ALTER TABLE public.assignment_embedding_meta
    ADD COLUMN IF NOT EXISTS space_id         TEXT,
    ADD COLUMN IF NOT EXISTS index_version    TEXT,
    ADD COLUMN IF NOT EXISTS embedding_config JSONB,
    ADD COLUMN IF NOT EXISTS active_batch_id  UUID,
    ADD COLUMN IF NOT EXISTS lms_host         TEXT;

CREATE INDEX IF NOT EXISTS idx_aem_course
    ON public.assignment_embedding_meta (course_id);

-- 3. Atomic activation ------------------------------------------------------
-- One transaction: replace this scope's chunks (including legacy rows for the
-- same file/assignment), insert the new batch with provenance, and upsert the
-- scope metadata. Any error rolls back everything, so previously active data
-- is untouched. Rows never exist in a pending state.
CREATE OR REPLACE FUNCTION public.activate_embedding_batch(
    p_scope_key          TEXT,
    p_batch_id           UUID,
    p_space_id           TEXT,
    p_index_version      TEXT,
    p_config             JSONB,
    p_embedding_provider TEXT,
    p_embedding_model    TEXT,
    p_lms_host           TEXT,
    p_assignment_id      TEXT,
    p_course_id          TEXT,
    p_canvas_file_id     TEXT,
    p_rows               JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    inserted INTEGER;
BEGIN
    IF p_scope_key IS NULL OR p_batch_id IS NULL OR p_space_id IS NULL OR p_index_version IS NULL THEN
        RAISE EXCEPTION 'activate_embedding_batch: scope, batch, space and index version are required';
    END IF;
    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'activate_embedding_batch: empty batch';
    END IF;

    IF p_canvas_file_id IS NOT NULL THEN
        IF p_course_id IS NULL OR p_scope_key <> ('course:' || p_course_id || ':file:' || p_canvas_file_id) THEN
            RAISE EXCEPTION 'activate_embedding_batch: scope key does not match course file';
        END IF;
        DELETE FROM public.course_material_chunks
         WHERE course_id = p_course_id AND canvas_file_id = p_canvas_file_id;
    ELSE
        IF p_assignment_id IS NULL OR p_scope_key <> ('assignment:' || p_assignment_id) THEN
            RAISE EXCEPTION 'activate_embedding_batch: scope key does not match assignment';
        END IF;
        DELETE FROM public.course_material_chunks
         WHERE assignment_id = p_assignment_id AND canvas_file_id IS NULL;
    END IF;

    INSERT INTO public.course_material_chunks (
        assignment_id, course_id, canvas_file_id, chunk_text, chunk_index, source_title,
        embedding, embedding_space_id, index_version, ingest_batch_id, embedding_scope_key
    )
    SELECT
        r->>'assignment_id',
        r->>'course_id',
        r->>'canvas_file_id',
        r->>'chunk_text',
        (r->>'chunk_index')::INTEGER,
        r->>'source_title',
        (r->'embedding')::TEXT::vector(768),
        p_space_id, p_index_version, p_batch_id, p_scope_key
    FROM jsonb_array_elements(p_rows) AS r;
    GET DIAGNOSTICS inserted = ROW_COUNT;

    INSERT INTO public.assignment_embedding_meta (
        scope_key, assignment_id, course_id, embedding_provider, embedding_model,
        space_id, index_version, embedding_config, active_batch_id, lms_host, updated_at
    ) VALUES (
        p_scope_key, p_assignment_id, p_course_id, p_embedding_provider, p_embedding_model,
        p_space_id, p_index_version, p_config, p_batch_id, p_lms_host, now()
    )
    ON CONFLICT (scope_key) DO UPDATE SET
        assignment_id      = EXCLUDED.assignment_id,
        course_id          = EXCLUDED.course_id,
        embedding_provider = EXCLUDED.embedding_provider,
        embedding_model    = EXCLUDED.embedding_model,
        space_id           = EXCLUDED.space_id,
        index_version      = EXCLUDED.index_version,
        embedding_config   = EXCLUDED.embedding_config,
        active_batch_id    = EXCLUDED.active_batch_id,
        lms_host           = EXCLUDED.lms_host,
        updated_at         = now();

    -- The legacy course-level row stops meaning anything once no legacy chunks remain.
    IF p_course_id IS NOT NULL THEN
        DELETE FROM public.assignment_embedding_meta m
         WHERE m.scope_key = 'course:' || p_course_id
           AND m.space_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.course_material_chunks c
                WHERE c.course_id = p_course_id AND c.embedding_space_id IS NULL
           );
    END IF;

    RETURN inserted;
END;
$$;

-- 4. Space-filtered retrieval ----------------------------------------------
-- Returns only chunks of the ACTIVE batch for their scope whose space and index
-- version match the caller. Assignment and course rows from different spaces
-- can never be combined; legacy rows (NULL provenance) never match.
CREATE OR REPLACE FUNCTION public.match_course_material_chunks_v2(
    query_embedding      vector(768),
    match_count          INT,
    filter_assignment_id TEXT,
    filter_course_id     TEXT,
    filter_space_id      TEXT,
    filter_index_version TEXT
)
RETURNS TABLE (
    id           UUID,
    chunk_text   TEXT,
    source_title TEXT,
    chunk_index  INTEGER,
    similarity   FLOAT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        c.id,
        c.chunk_text,
        c.source_title,
        c.chunk_index,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM public.course_material_chunks c
    JOIN public.assignment_embedding_meta m
      ON m.scope_key = c.embedding_scope_key
     AND m.active_batch_id = c.ingest_batch_id
    WHERE filter_space_id IS NOT NULL
      AND filter_index_version IS NOT NULL
      AND c.embedding IS NOT NULL
      AND c.embedding_space_id = filter_space_id
      AND m.space_id = filter_space_id
      AND c.index_version = filter_index_version
      AND m.index_version = filter_index_version
      AND (
            (filter_assignment_id IS NOT NULL AND c.assignment_id = filter_assignment_id AND c.canvas_file_id IS NULL)
         OR (filter_course_id IS NOT NULL AND c.course_id = filter_course_id)
      )
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
$$;

NOTIFY pgrst, 'reload schema';

-- 5. Hardening (run only AFTER the server uses a service-role key; see
--    docs/audit/containment-and-auth.md, database checklist step 3).
--    Today the server uses the anon key, so revoking now would break ingestion.
-- REVOKE EXECUTE ON FUNCTION public.activate_embedding_batch(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- =========================================================================
-- ROLLBACK (manual, owner only). Drops only what this file added. The new
-- columns hold provenance for re-ingested data; dropping them re-quarantines
-- nothing and loses that provenance, so re-ingest would be needed again.
--
-- DROP FUNCTION IF EXISTS public.match_course_material_chunks_v2(vector(768), INT, TEXT, TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.activate_embedding_batch(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
-- DROP INDEX IF EXISTS public.idx_cmc_scope_batch;
-- DROP INDEX IF EXISTS public.idx_cmc_legacy_provenance;
-- DROP INDEX IF EXISTS public.idx_aem_course;
-- ALTER TABLE public.course_material_chunks
--     DROP COLUMN IF EXISTS embedding_space_id,
--     DROP COLUMN IF EXISTS index_version,
--     DROP COLUMN IF EXISTS ingest_batch_id,
--     DROP COLUMN IF EXISTS embedding_scope_key;
-- ALTER TABLE public.assignment_embedding_meta
--     DROP COLUMN IF EXISTS space_id,
--     DROP COLUMN IF EXISTS index_version,
--     DROP COLUMN IF EXISTS embedding_config,
--     DROP COLUMN IF EXISTS active_batch_id,
--     DROP COLUMN IF EXISTS lms_host;
-- (course_id / canvas_file_id predate this migration; do not drop them.)
-- =========================================================================
