-- =========================================================================
-- Assessment policies (fallback / provisional / approved) — 2026-11-02
--
-- STATUS: written, NOT executed anywhere. Run first against a disposable
-- harness or Supabase branch/staging. Never production first.
--
-- Purpose: persist one frozen assignment-level assessment policy per
-- (course_id, assignment_id, assignment_context_hash, generation_config_key)
-- so concurrent grading requests share the same provisional criteria.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.assessment_policies (
    id                       BIGSERIAL PRIMARY KEY,
    policy_id                TEXT NOT NULL,
    version                  INTEGER NOT NULL CHECK (version >= 1),
    course_id                TEXT NOT NULL CHECK (course_id ~ '^[0-9]{1,20}$'),
    assignment_id            TEXT NOT NULL,
    assignment_context_hash  TEXT NOT NULL,
    generation_config_key    TEXT NOT NULL,
    content_hash             TEXT NOT NULL,
    lifecycle                TEXT NOT NULL CHECK (
        lifecycle IN ('draft', 'frozen_provisional', 'approved', 'superseded')
    ),
    origin                   TEXT NOT NULL CHECK (
        origin IN ('instructor', 'inferred', 'approved_template', 'formative')
    ),
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    policy_json              JSONB NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (policy_id, version)
);

-- At most one active frozen/approved policy per scope key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_policies_active_scope
    ON public.assessment_policies (
        course_id, assignment_id, assignment_context_hash, generation_config_key
    )
    WHERE is_active = TRUE
      AND lifecycle IN ('frozen_provisional', 'approved');

CREATE INDEX IF NOT EXISTS idx_assessment_policies_assignment
    ON public.assessment_policies (course_id, assignment_id);

ALTER TABLE public.assessment_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assessment_policies FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.assessment_policies TO authenticated;

DROP POLICY IF EXISTS assessment_policies_staff ON public.assessment_policies;
CREATE POLICY assessment_policies_staff ON public.assessment_policies
    FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

DROP POLICY IF EXISTS assessment_policies_staff_restrictive ON public.assessment_policies;
CREATE POLICY assessment_policies_staff_restrictive ON public.assessment_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

COMMIT;
