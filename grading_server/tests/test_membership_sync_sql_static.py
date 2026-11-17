# grading_server/tests/test_membership_sync_sql_static.py
from pathlib import Path

SQL = (Path(__file__).resolve().parents[1] / "migrations" / "2026_10_31_membership_sync.sql").read_text(encoding="utf-8")


def test_definer_is_service_role_only_and_uses_explicit_principal():
    assert "SECURITY DEFINER" in SQL
    assert "SET search_path" in SQL
    assert "auth.role() IS DISTINCT FROM 'service_role'" in SQL
    assert "p_user_id uuid" in SQL
    assert "p_user_id IS NULL" in SQL
    assert "auth.uid()" not in SQL
    assert "teacher" in SQL and "ta" in SQL
    assert "r_role IS DISTINCT FROM 'teacher' AND r_role IS DISTINCT FROM 'ta'" in SQL
    assert "REVOKE ALL ON FUNCTION public.upsert_my_canvas_memberships(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;" in SQL
    assert "GRANT EXECUTE ON FUNCTION public.upsert_my_canvas_memberships(uuid, text, jsonb) TO service_role;" in SQL
    assert "TO authenticated" not in SQL
    assert "DROP FUNCTION IF EXISTS public.upsert_my_canvas_memberships(text, jsonb);" in SQL
