-- =========================================================================
-- Course-scoped authorization for grading data (2026-10-31)
--
-- STATUS: written, NOT executed anywhere. Run first against the disposable
-- harness (grading_server/tests/pgvector/), then a Supabase branch/staging
-- project, and only then production. Never production first.
--
-- Requires: 2026_10_31_embedding_provenance.sql applied first.
--
-- What it does
--   * memberships: server-controlled teacher/TA rows (no client write path).
--   * app_private.can_manage_course(course_id): the single access predicate,
--     SECURITY INVOKER (reads only the caller's own membership rows under RLS;
--     no DEFINER needed, so there is no privilege to escalate).
--   * course_id on rubric_criteria / exemplars / grading_results.
--   * Replaces every existing policy on the grading tables (they were
--     USING (true)) with course-membership policies, plus a RESTRICTIVE copy
--     so a later "allow all" policy cannot silently reopen them.
--   * anon loses all access to grading tables and RPCs.
--   * activate_embedding_batch / match_course_material_chunks_v2 re-created
--     with an in-function authorization check, a per-scope advisory lock and
--     a stale-activation guard. Legacy v1 RPCs lose EXECUTE for API roles.
--
-- Data: non-destructive. No row is updated, deleted or assigned an owner.
-- Legacy rows with course_id IS NULL become invisible to every API role
-- (quarantined, preserved). They are never auto-assigned to a course.
-- Two unique constraints are replaced by course-qualified equivalents so that
-- re-ingesting into a course cannot collide with invisible legacy rows.
--
-- After applying: import memberships with bootstrap_memberships.template.sql
-- (manual, reviewed). Until then every grading request fails closed (403).
-- =========================================================================

BEGIN;

-- 0. Deployment settings --------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO authenticated;

-- The only Canvas instance memberships are honoured for. Unset => deny all.
CREATE TABLE IF NOT EXISTS app_private.settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
REVOKE ALL ON app_private.settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_private.settings TO authenticated;
-- RLS with no policy hides every row, and can_manage_course() then denies every write.
DROP POLICY IF EXISTS settings_read_authenticated ON app_private.settings;
CREATE POLICY settings_read_authenticated ON app_private.settings
    FOR SELECT TO authenticated USING (true);

-- 1. Memberships ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    lms_host    TEXT NOT NULL,
    org_id      TEXT,
    course_id   TEXT NOT NULL CHECK (course_id ~ '^[0-9]{1,20}$'),
    role        TEXT NOT NULL CHECK (role IN ('teacher', 'ta', 'student')),
    source      TEXT NOT NULL DEFAULT 'manual_reviewed',
    verified_by TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_active
    ON public.memberships (user_id, lms_host, course_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_course ON public.memberships (course_id);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.memberships TO authenticated;
DROP POLICY IF EXISTS memberships_read_own ON public.memberships;
CREATE POLICY memberships_read_own ON public.memberships
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- No INSERT/UPDATE/DELETE policy: only the owner (SQL editor / service role) writes.

-- 2. Access predicate -----------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.can_manage_course(p_course_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_course_id IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM public.memberships mb
            WHERE mb.user_id = auth.uid()
              AND mb.course_id = p_course_id
              AND mb.revoked_at IS NULL
              AND mb.role IN ('teacher', 'ta')
              AND mb.lms_host = (SELECT s.value FROM app_private.settings s WHERE s.key = 'lms_host')
       );
$$;
REVOKE ALL ON FUNCTION app_private.can_manage_course(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_course(TEXT) TO authenticated;

-- 3. Course scope on grading tables -----------------------------------------
ALTER TABLE public.rubric_criteria ADD COLUMN IF NOT EXISTS course_id TEXT;
ALTER TABLE public.exemplars       ADD COLUMN IF NOT EXISTS course_id TEXT;
ALTER TABLE public.grading_results ADD COLUMN IF NOT EXISTS course_id TEXT;

CREATE INDEX IF NOT EXISTS idx_rubric_course_assignment ON public.rubric_criteria (course_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_exemplars_course_assignment ON public.exemplars (course_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_grading_results_course_lookup
    ON public.grading_results (course_id, assignment_id, student_id);

-- Course-qualified uniqueness (NULL course_id legacy rows never collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_course_assignment_criterion
    ON public.rubric_criteria (course_id, assignment_id, criterion_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exemplar_course_assignment_criterion_score
    ON public.exemplars (course_id, assignment_id, criterion_id, score);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmc_course_assignment_desc_chunk
    ON public.course_material_chunks (course_id, assignment_id, chunk_index)
    WHERE canvas_file_id IS NULL;
ALTER TABLE public.rubric_criteria DROP CONSTRAINT IF EXISTS uq_rubric_assignment_criterion;
ALTER TABLE public.exemplars DROP CONSTRAINT IF EXISTS uq_exemplar_criterion_assignment_score;
DROP INDEX IF EXISTS public.uq_cmc_assignment_desc_chunk;

-- 4. Policies + grants ----------------------------------------------------
DO $$
DECLARE
    t   TEXT;
    pol RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'rubric_criteria', 'exemplars', 'grading_results', 'course_material_chunks',
        'assignment_embedding_meta', 'course_file_ingest'
    ] LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE EXCEPTION 'authz_scope: table public.% is missing; apply the setup SQL first', t;
        END IF;
        FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
            'USING (app_private.can_manage_course(course_id)) '
            'WITH CHECK (app_private.can_manage_course(course_id))',
            t || '_course_staff', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
            'USING (app_private.can_manage_course(course_id)) '
            'WITH CHECK (app_private.can_manage_course(course_id))',
            t || '_course_staff_required', t);
    END LOOP;
END;
$$;

-- teacher_preferences holds Canvas tokens and BYOK keys: owner-only by verified email.
DO $$
DECLARE pol RECORD;
BEGIN
    IF to_regclass('public.teacher_preferences') IS NOT NULL THEN
        FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'teacher_preferences' LOOP
            EXECUTE format('DROP POLICY %I ON public.teacher_preferences', pol.policyname);
        END LOOP;
        ALTER TABLE public.teacher_preferences ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.teacher_preferences FROM PUBLIC, anon;
        GRANT SELECT, INSERT, UPDATE ON public.teacher_preferences TO authenticated;
        CREATE POLICY teacher_preferences_own ON public.teacher_preferences
            FOR ALL TO authenticated
            USING (teacher_email = (SELECT auth.jwt() ->> 'email'))
            WITH CHECK (teacher_email = (SELECT auth.jwt() ->> 'email'));
    END IF;

    IF to_regclass('public.student_knowledge_graph') IS NOT NULL THEN
        FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_knowledge_graph' LOOP
            EXECUTE format('DROP POLICY %I ON public.student_knowledge_graph', pol.policyname);
        END LOOP;
        ALTER TABLE public.student_knowledge_graph ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.student_knowledge_graph FROM PUBLIC, anon;
        GRANT SELECT ON public.student_knowledge_graph TO authenticated;
        CREATE POLICY student_knowledge_graph_course_staff ON public.student_knowledge_graph
            FOR SELECT TO authenticated USING (app_private.can_manage_course(course_id));
    END IF;
END;
$$;

-- 5. Atomic activation (same signature; authorization + serialization added) --
-- Concurrency: one advisory lock per scope serializes activations, so two ingests
-- of one file/assignment can never interleave their delete/insert. A batch built
-- from an OLDER Canvas source (embedding_config.source_updated_at) than the active
-- one is refused with STALE_ACTIVATION; prior active data is untouched. Equal
-- source timestamps (duplicate activation) are allowed: last writer replaces the
-- scope wholesale, so the active batch is always one consistent batch.
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
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    inserted    INTEGER;
    active_src  TEXT;
    new_src     TEXT := p_config ->> 'source_updated_at';
BEGIN
    IF NOT app_private.can_manage_course(p_course_id) THEN
        RAISE EXCEPTION 'activate_embedding_batch: not authorized for course %', p_course_id
            USING ERRCODE = '42501';
    END IF;
    IF p_scope_key IS NULL OR p_batch_id IS NULL OR p_space_id IS NULL OR p_index_version IS NULL THEN
        RAISE EXCEPTION 'activate_embedding_batch: scope, batch, space and index version are required';
    END IF;
    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'activate_embedding_batch: empty batch';
    END IF;

    IF p_canvas_file_id IS NOT NULL THEN
        IF p_scope_key <> ('course:' || p_course_id || ':file:' || p_canvas_file_id) THEN
            RAISE EXCEPTION 'activate_embedding_batch: scope key does not match course file';
        END IF;
    ELSE
        IF p_assignment_id IS NULL
           OR p_scope_key <> ('course:' || p_course_id || ':assignment:' || p_assignment_id) THEN
            RAISE EXCEPTION 'activate_embedding_batch: scope key does not match course assignment';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_scope_key, 0));

    SELECT m.embedding_config ->> 'source_updated_at' INTO active_src
      FROM public.assignment_embedding_meta m
     WHERE m.scope_key = p_scope_key;
    IF active_src IS NOT NULL AND new_src IS NOT NULL
       AND new_src::timestamptz < active_src::timestamptz THEN
        RAISE EXCEPTION 'STALE_ACTIVATION: % is older than active source %', new_src, active_src;
    END IF;

    IF p_canvas_file_id IS NOT NULL THEN
        DELETE FROM public.course_material_chunks
         WHERE course_id = p_course_id AND canvas_file_id = p_canvas_file_id;
    ELSE
        DELETE FROM public.course_material_chunks
         WHERE course_id = p_course_id AND assignment_id = p_assignment_id AND canvas_file_id IS NULL;
    END IF;

    INSERT INTO public.course_material_chunks (
        assignment_id, course_id, canvas_file_id, chunk_text, chunk_index, source_title,
        embedding, embedding_space_id, index_version, ingest_batch_id, embedding_scope_key
    )
    SELECT
        r ->> 'assignment_id',
        p_course_id,
        p_canvas_file_id,
        r ->> 'chunk_text',
        (r ->> 'chunk_index')::INTEGER,
        r ->> 'source_title',
        (r -> 'embedding')::TEXT::vector(768),
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

    DELETE FROM public.assignment_embedding_meta m
     WHERE m.scope_key = 'course:' || p_course_id
       AND m.space_id IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.course_material_chunks c
            WHERE c.course_id = p_course_id AND c.embedding_space_id IS NULL
       );

    RETURN inserted;
END;
$$;

-- 6. Retrieval (same signature; course required and authorized) ------------
-- Every returned row is described by the active metadata row it joined
-- (same scope key, active batch, space and index version).
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
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    IF NOT app_private.can_manage_course(filter_course_id) THEN
        RAISE EXCEPTION 'match_course_material_chunks_v2: not authorized for course %', filter_course_id
            USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT
        c.id,
        c.chunk_text,
        c.source_title,
        c.chunk_index,
        (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
    FROM public.course_material_chunks c
    JOIN public.assignment_embedding_meta m
      ON m.scope_key = c.embedding_scope_key
     AND m.active_batch_id = c.ingest_batch_id
    WHERE filter_space_id IS NOT NULL
      AND filter_index_version IS NOT NULL
      AND c.embedding IS NOT NULL
      AND c.course_id = filter_course_id
      AND m.course_id = filter_course_id
      AND c.embedding_space_id = filter_space_id
      AND m.space_id = filter_space_id
      AND c.index_version = filter_index_version
      AND m.index_version = filter_index_version
      AND (
            (filter_assignment_id IS NOT NULL AND c.canvas_file_id IS NULL AND c.assignment_id = filter_assignment_id)
         OR c.canvas_file_id IS NOT NULL
      )
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. RPC privileges (direct Data API calls) -----------------------------------
REVOKE EXECUTE ON FUNCTION public.activate_embedding_batch(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.activate_embedding_batch(TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.match_course_material_chunks_v2(vector, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.match_course_material_chunks_v2(vector, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Legacy RPCs: unfiltered v1 search and the unscoped mastery writer.
DO $$
DECLARE f RECORD;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS sig
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('match_course_material_chunks', 'update_concept_mastery')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    END LOOP;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (manual, owner only; restores the previous OPEN state; do not run
-- on a deployment that has real student data unless you intend to reopen it).
--
-- BEGIN;
-- -- a) reopen tables exactly as before (USING (true)) -- this re-exposes data:
-- DO $$ DECLARE t TEXT; BEGIN
--   FOREACH t IN ARRAY ARRAY['rubric_criteria','exemplars','grading_results',
--     'course_material_chunks','assignment_embedding_meta','course_file_ingest'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_course_staff', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_course_staff_required', t);
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)', 'Allow all on ' || t, t);
--     EXECUTE format('GRANT ALL ON public.%I TO anon', t);
--   END LOOP; END $$;
-- -- b) previous function bodies: re-run section 3 and 4 of
-- --    2026_10_31_embedding_provenance.sql (they expect 'assignment:<id>' scope keys;
-- --    rows activated under 'course:<cid>:assignment:<aid>' then read as unknown provenance).
-- -- c) previous unique constraints (FAILS if two courses now share an
-- --    assignment_id/criterion_id; resolve duplicates by hand, never by bulk delete):
-- -- ALTER TABLE public.rubric_criteria ADD CONSTRAINT uq_rubric_assignment_criterion UNIQUE (assignment_id, criterion_id);
-- -- ALTER TABLE public.exemplars ADD CONSTRAINT uq_exemplar_criterion_assignment_score UNIQUE (assignment_id, criterion_id, score);
-- -- CREATE UNIQUE INDEX uq_cmc_assignment_desc_chunk ON public.course_material_chunks (assignment_id, chunk_index) WHERE canvas_file_id IS NULL;
-- COMMIT;
-- Columns course_id, memberships and app_private are left in place (harmless; drop by hand if wanted).
-- =========================================================================
