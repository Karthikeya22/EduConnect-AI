-- =========================================================================
-- Copilot authoritative memory (NOT chat) — 2026-11-02
--
-- STATUS: written, NOT executed. Apply only on disposable/staging after review.
-- Runtime currently uses in-memory stores (tests + offline demos).
--
-- Chat transcripts stay ephemeral / separate. Only confirmed instructions,
-- proposals, and regrade jobs belong here.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.copilot_instructions (
    instruction_id           TEXT NOT NULL,
    version                  INTEGER NOT NULL CHECK (version >= 1),
    organization_id          TEXT,
    lms_host                 TEXT,
    course_id                TEXT NOT NULL,
    assignment_id            TEXT NOT NULL,
    submission_id            TEXT,
    scope_kind               TEXT NOT NULL CHECK (
        scope_kind IN ('submission', 'assignment', 'course', 'none')
    ),
    instruction_type         TEXT NOT NULL CHECK (
        instruction_type IN (
            'feedback_preference',
            'assignment_policy_amendment',
            'submission_exception',
            'course_default',
            'instructor_score_override'
        )
    ),
    payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    originating_request      TEXT NOT NULL,
    rationale                TEXT,
    created_by               TEXT NOT NULL,
    approved_by              TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at              TIMESTAMPTZ,
    expires_at               TIMESTAMPTZ,
    lifecycle                TEXT NOT NULL CHECK (
        lifecycle IN ('draft', 'active', 'superseded', 'revoked', 'expired')
    ),
    supersedes_id            TEXT,
    revoked_at               TIMESTAMPTZ,
    revoked_by               TEXT,
    affected_policy_id       TEXT,
    affected_policy_version  INTEGER,
    affected_policy_hash     TEXT,
    PRIMARY KEY (instruction_id, version)
);

CREATE TABLE IF NOT EXISTS public.copilot_proposals (
    proposal_id              TEXT PRIMARY KEY,
    version                  INTEGER NOT NULL DEFAULT 1,
    proposal_hash            TEXT NOT NULL,
    kind                     TEXT NOT NULL,
    status                   TEXT NOT NULL,
    course_id                TEXT NOT NULL,
    assignment_id            TEXT NOT NULL,
    proposal_json            JSONB NOT NULL,
    expires_at               TIMESTAMPTZ NOT NULL,
    created_by               TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at             TIMESTAMPTZ,
    confirmed_by             TEXT
);

CREATE TABLE IF NOT EXISTS public.copilot_regrade_jobs (
    job_id                   TEXT PRIMARY KEY,
    proposal_id              TEXT NOT NULL,
    proposal_hash            TEXT NOT NULL,
    idempotency_key          TEXT NOT NULL UNIQUE,
    status                   TEXT NOT NULL,
    course_id                TEXT NOT NULL,
    assignment_id            TEXT NOT NULL,
    target_manifest          JSONB NOT NULL,
    job_json                 JSONB NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversations are NOT authoritative memory; optional short-lived storage only.
CREATE TABLE IF NOT EXISTS public.copilot_conversations (
    conversation_id          TEXT PRIMARY KEY,
    course_id                TEXT NOT NULL,
    assignment_id            TEXT NOT NULL,
    created_by               TEXT NOT NULL,
    messages_json            JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_regrade_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_conversations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.copilot_instructions FROM PUBLIC, anon;
REVOKE ALL ON public.copilot_proposals FROM PUBLIC, anon;
REVOKE ALL ON public.copilot_regrade_jobs FROM PUBLIC, anon;
REVOKE ALL ON public.copilot_conversations FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON public.copilot_instructions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.copilot_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.copilot_regrade_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.copilot_conversations TO authenticated;

-- Staff of the course only (reuses app_private.can_manage_course from authz migration).
CREATE POLICY copilot_instructions_staff ON public.copilot_instructions
    FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

CREATE POLICY copilot_proposals_staff ON public.copilot_proposals
    FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

CREATE POLICY copilot_jobs_staff ON public.copilot_regrade_jobs
    FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

CREATE POLICY copilot_conversations_staff ON public.copilot_conversations
    FOR ALL TO authenticated
    USING (app_private.can_manage_course(course_id))
    WITH CHECK (app_private.can_manage_course(course_id));

COMMIT;
