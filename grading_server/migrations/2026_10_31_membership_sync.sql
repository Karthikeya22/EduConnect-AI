-- =========================================================================
-- Canvas membership sync RPC (2026-10-31)
--
-- SECURITY DEFINER with a pinned search path. Only service_role may invoke
-- it; Flask supplies the verified request principal as p_user_id.
-- Roles limited to teacher/ta; source canvas_token_sync.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.upsert_my_canvas_memberships(
  p_user_id uuid,
  p_lms_host text,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  synced int := 0;
  r jsonb;
  cid text;
  r_role text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_lms_host IS NULL OR length(p_lms_host) < 3 OR p_lms_host ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'invalid lms_host';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a json array';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    cid := r->>'course_id';
    r_role := r->>'role';
    IF cid IS NULL OR cid !~ '^[0-9]{1,20}$' THEN
      CONTINUE;
    END IF;
    IF r_role IS DISTINCT FROM 'teacher' AND r_role IS DISTINCT FROM 'ta' THEN
      CONTINUE;
    END IF;

    UPDATE public.memberships m
       SET role = r_role,
           verified_at = now(),
           verified_by = 'canvas_api',
           source = 'canvas_token_sync',
           revoked_at = NULL
     WHERE m.user_id = p_user_id
       AND m.lms_host = p_lms_host
       AND m.course_id = cid
       AND m.revoked_at IS NULL;

    IF NOT FOUND THEN
      UPDATE public.memberships m
         SET role = r_role,
             verified_at = now(),
             verified_by = 'canvas_api',
             source = 'canvas_token_sync',
             revoked_at = NULL
        FROM (
          SELECT id
            FROM public.memberships
           WHERE user_id = p_user_id
             AND lms_host = p_lms_host
             AND course_id = cid
             AND revoked_at IS NOT NULL
           ORDER BY verified_at DESC NULLS LAST
           LIMIT 1
        ) pick
       WHERE m.id = pick.id;
    END IF;

    INSERT INTO public.memberships (
      user_id, lms_host, course_id, role, source, verified_by, verified_at, revoked_at
    )
    SELECT p_user_id, p_lms_host, cid, r_role, 'canvas_token_sync', 'canvas_api', now(), NULL
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.memberships m2
        WHERE m2.user_id = p_user_id
          AND m2.lms_host = p_lms_host
          AND m2.course_id = cid
          AND m2.revoked_at IS NULL
     );

    synced := synced + 1;
  END LOOP;

  RETURN synced;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_my_canvas_memberships(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_my_canvas_memberships(uuid, text, jsonb) TO service_role;
DROP FUNCTION IF EXISTS public.upsert_my_canvas_memberships(text, jsonb);

NOTIFY pgrst, 'reload schema';
