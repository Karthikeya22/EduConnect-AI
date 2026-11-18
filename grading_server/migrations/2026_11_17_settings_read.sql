-- Course staff could not read app_private.settings after RLS was enabled
-- with no policy. can_manage_course() then always returned false, and every
-- course-file and assignment ingest failed its row-level write check.
-- The row is only the configured Canvas hostname.

DROP POLICY IF EXISTS settings_read_authenticated ON app_private.settings;
CREATE POLICY settings_read_authenticated
ON app_private.settings
FOR SELECT
TO authenticated
USING (true);
