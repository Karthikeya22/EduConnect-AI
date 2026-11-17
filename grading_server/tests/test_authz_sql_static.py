"""Static checks on the authz migration text. These do NOT execute SQL; see tests/pgvector for that."""
from __future__ import annotations

import re
from pathlib import Path

SQL = (Path(__file__).resolve().parents[1] / "migrations" / "2026_10_31_authz_scope.sql").read_text(encoding="utf-8")
BODY = re.sub(r"--[^\n]*", "", SQL.split("-- ROLLBACK")[0])  # executable SQL only


def _function(name: str) -> str:
    m = re.search(rf"CREATE OR REPLACE FUNCTION public\.{name}\(.*?\n\$\$;", BODY, flags=re.S)
    assert m, f"{name} not defined"
    return m.group(0)


def test_rpcs_check_authorization_before_any_work():
    for name in ("activate_embedding_batch", "match_course_material_chunks_v2"):
        fn = _function(name)
        begin = fn.index("BEGIN")
        auth = fn.index("app_private.can_manage_course(")
        first_dml = min(i for i in (fn.find("DELETE", begin), fn.find("INSERT", begin), fn.find("RETURN QUERY")) if i > 0)
        assert begin < auth < first_dml, name
        assert "ERRCODE = '42501'" in fn, name
        assert "SECURITY INVOKER" in fn and "SET search_path" in fn, name
        assert "SECURITY DEFINER" not in fn, name


def test_no_security_definer_anywhere():
    assert "SECURITY DEFINER" not in BODY


def test_anon_cannot_execute_rpcs_and_legacy_rpcs_are_closed():
    assert re.search(r"REVOKE EXECUTE ON FUNCTION public\.activate_embedding_batch\([^)]*\) FROM PUBLIC, anon;", BODY)
    assert re.search(r"REVOKE EXECUTE ON FUNCTION public\.match_course_material_chunks_v2\([^)]*\) FROM PUBLIC, anon;", BODY)
    assert "'match_course_material_chunks', 'update_concept_mastery'" in BODY
    assert "FROM PUBLIC, anon, authenticated', f.sig" in BODY


def test_activation_serializes_and_refuses_stale_batches():
    fn = _function("activate_embedding_batch")
    assert "pg_advisory_xact_lock(hashtextextended(p_scope_key, 0))" in fn
    assert fn.index("pg_advisory_xact_lock") < fn.index("DELETE FROM public.course_material_chunks")
    assert "STALE_ACTIVATION" in fn
    assert "'course:' || p_course_id || ':assignment:' || p_assignment_id" in fn
    # rows are pinned to the authorized course, not to whatever the payload claims
    assert re.search(r"SELECT\s+r ->> 'assignment_id',\s+p_course_id,", fn)


def test_retrieval_is_course_bound_on_both_chunk_and_metadata():
    fn = _function("match_course_material_chunks_v2")
    for clause in ("c.course_id = filter_course_id", "m.course_id = filter_course_id",
                   "m.active_batch_id = c.ingest_batch_id", "m.space_id = filter_space_id",
                   "m.index_version = filter_index_version"):
        assert clause in fn, clause


def test_policies_replace_open_ones_and_add_restrictive_guard():
    assert "DROP POLICY %I ON public.%I" in BODY
    assert "AS RESTRICTIVE FOR ALL TO authenticated" in BODY
    assert "REVOKE ALL ON public.%I FROM PUBLIC, anon" in BODY
    assert "USING (true)" not in BODY


def test_migration_is_non_destructive():
    for stmt in ("DROP TABLE", "TRUNCATE", "DELETE FROM public.rubric_criteria", "DELETE FROM public.grading_results",
                 "UPDATE public.", "DROP COLUMN"):
        assert stmt not in BODY, stmt
