-- =========================================================================
-- Membership bootstrap (TEMPLATE: copy, fill, review, then run by hand)
--
-- Memberships are the only thing that grants access to grading data. They are
-- written by the project owner from records the owner has checked (Canvas
-- course roster / enrollment API viewed by an admin), never from a value the
-- user supplied (user_metadata, tenant headers, BYOK, a Canvas token).
--
-- Procedure
--   1. Apply 2026_10_31_authz_scope.sql (disposable DB -> staging -> prod).
--   2. Set the Canvas host once (must equal the hostname of CANVAS_BASE_URL).
--   3. For each teacher/TA: confirm in Canvas (Admin > Courses > People) that
--      they hold a TeacherEnrollment/TaEnrollment in that course, then add a row.
--   4. Have a second person review the filled file before running it.
--   5. Revoke instead of delete, so the audit trail stays (step 6).
--
-- Legacy rows with course_id IS NULL stay quarantined. Do NOT bulk-assign
-- them a course; re-ingest materials and re-grade through the app instead.
-- =========================================================================

BEGIN;

-- 2. Canvas host (no scheme, no path), e.g. 'usflearn.instructure.com'
INSERT INTO app_private.settings (key, value)
VALUES ('lms_host', '<canvas-host>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 3. One row per verified teacher/TA per course.
--    user_id: auth.users.id of the person's Supabase account (look up by email).
INSERT INTO public.memberships (user_id, lms_host, org_id, course_id, role, source, verified_by)
SELECT u.id, '<canvas-host>', NULL, '<canvas-course-id>', 'teacher', 'manual_reviewed', '<reviewer-name>'
  FROM auth.users u
 WHERE u.email = '<teacher-email>'
ON CONFLICT DO NOTHING;

-- Check before COMMIT: every intended row present, nothing unexpected.
SELECT m.course_id, u.email, m.role, m.verified_by, m.verified_at
  FROM public.memberships m JOIN auth.users u ON u.id = m.user_id
 WHERE m.revoked_at IS NULL
 ORDER BY m.course_id, u.email;

COMMIT;

-- 6. Revocation (takes effect on the next request; nothing is cached server-side
--    except Canvas assignment-in-course checks, which do not grant access alone).
-- UPDATE public.memberships SET revoked_at = now()
--  WHERE user_id = (SELECT id FROM auth.users WHERE email = '<email>')
--    AND course_id = '<canvas-course-id>' AND revoked_at IS NULL;
