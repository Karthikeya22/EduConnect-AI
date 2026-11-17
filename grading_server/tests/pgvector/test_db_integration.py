"""
DB-integration tests against a DISPOSABLE Postgres + pgvector (see docker-compose.yml).

Skipped unless EDUCONNECT_PG_URL points at a throwaway server and psycopg (v3) is installed.
Each run creates and drops its own database; never point this at Supabase or production.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg", reason="psycopg not installed: DB integration NOT EXECUTED")
PG_URL = os.environ.get("EDUCONNECT_PG_URL")
pytestmark = [
    pytest.mark.db_integration,
    pytest.mark.skipif(not PG_URL, reason="EDUCONNECT_PG_URL not set: DB integration NOT EXECUTED"),
]

HERE = Path(__file__).resolve().parent
MIGRATIONS = HERE.parents[1] / "migrations"
SETUP = [HERE / "00_supabase_stub.sql", HERE / "01_base_schema.sql"]
MIGRATE = [MIGRATIONS / "2026_10_31_embedding_provenance.sql", MIGRATIONS / "2026_10_31_authz_scope.sql"]

T11 = "00000000-0000-0000-0000-00000000000a"
T22 = "00000000-0000-0000-0000-00000000000b"
REVOKED = "00000000-0000-0000-0000-00000000000c"
STUDENT = "00000000-0000-0000-0000-00000000000d"
OTHER_HOST = "00000000-0000-0000-0000-00000000000e"
S1, S2, IV = "openai:text-embedding-3-small:768", "gemini:gemini-embedding-001:768", "rcts-500-50/parse-v1"


def _vec(x: float = 0.01) -> list[float]:
    return [x] * 768


def _run(conn, path: Path):
    conn.execute(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def dburl():
    name = f"educonnect_it_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(PG_URL, autocommit=True) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')
    url = psycopg.conninfo.make_conninfo(PG_URL, dbname=name)
    try:
        with psycopg.connect(url, autocommit=True) as c:
            for p in SETUP + MIGRATE + [HERE / "02_fixtures.sql"]:
                _run(c, p)
        yield url
    finally:
        with psycopg.connect(PG_URL, autocommit=True) as admin:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def conn(dburl):
    with psycopg.connect(dburl) as c:
        yield c
        c.rollback()


def as_role(c, role: str, sub: str | None = None, email: str | None = None):
    c.execute(f"SET LOCAL ROLE {role}")
    claims = {"role": role, **({"sub": sub} if sub else {}), **({"email": email} if email else {})}
    c.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))


def activate(c, *, course="11", file_id=None, assignment="101", space=S1, src="2026-10-01T00:00:00Z", n=2, x=0.01):
    scope = f"course:{course}:file:{file_id}" if file_id else f"course:{course}:assignment:{assignment}"
    batch = str(uuid.uuid4())
    rows = [{"assignment_id": assignment, "course_id": course, "canvas_file_id": file_id,
             "chunk_text": f"{scope} chunk {i}", "chunk_index": i, "source_title": scope, "embedding": _vec(x)}
            for i in range(n)]
    c.execute(
        "SELECT public.activate_embedding_batch(%s, %s::uuid, %s, %s, %s::jsonb, 'openai', 'm', 'canvas.test', %s, %s, %s, %s::jsonb)",
        (scope, batch, space, IV, json.dumps({"space_id": space, "source_updated_at": src}),
         assignment, course, file_id, json.dumps(rows)),
    )
    return scope, batch


def search(c, course="11", assignment="101", space=S1):
    return c.execute(
        "SELECT chunk_text FROM public.match_course_material_chunks_v2(%s::vector, 50, %s, %s, %s, %s)",
        (str(_vec()), assignment, course, space, IV),
    ).fetchall()


def denied(c, sql, params=()):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with c.transaction():
            c.execute(sql, params)


# ── migration mechanics ──────────────────────────────────────────────────────

def test_migrations_are_re_runnable(dburl):
    with psycopg.connect(dburl, autocommit=True) as c:
        for p in MIGRATE:
            _run(c, p)


def test_legacy_rows_preserved_and_unassigned(conn):
    n_null = conn.execute("SELECT count(*) FROM public.course_material_chunks WHERE course_id IS NULL").fetchone()[0]
    assert n_null == 1
    assert conn.execute("SELECT count(*) FROM public.rubric_criteria WHERE course_id IS NULL").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM public.grading_results WHERE course_id IS NULL").fetchone()[0] == 1


# ── grants / direct Data API ─────────────────────────────────────────────────

def test_anon_has_no_table_or_rpc_access(conn):
    as_role(conn, "anon")
    for t in ("course_material_chunks", "rubric_criteria", "grading_results", "memberships", "teacher_preferences"):
        denied(conn, f"SELECT 1 FROM public.{t} LIMIT 1")
    denied(conn, "SELECT * FROM public.match_course_material_chunks_v2(%s::vector, 1, '101', '11', %s, %s)",
           (str(_vec()), S1, IV))


def test_rpc_privileges_are_explicit(conn):
    q = "SELECT has_function_privilege(%s, %s, 'EXECUTE')"
    v2 = "public.match_course_material_chunks_v2(vector,integer,text,text,text,text)"
    act = "public.activate_embedding_batch(text,uuid,text,text,jsonb,text,text,text,text,text,text,jsonb)"
    v1 = "public.match_course_material_chunks(vector,integer,text,text)"
    mastery = "public.update_concept_mastery(text,text,text,double precision)"
    for fn in (v2, act):
        assert conn.execute(q, ("anon", fn)).fetchone()[0] is False
        assert conn.execute(q, ("authenticated", fn)).fetchone()[0] is True
    for fn in (v1, mastery):
        assert conn.execute(q, ("authenticated", fn)).fetchone()[0] is False
        assert conn.execute(q, ("anon", fn)).fetchone()[0] is False


@pytest.mark.parametrize("who", [None, T22, REVOKED, STUDENT, OTHER_HOST])
def test_rpcs_deny_non_staff_of_course(conn, who):
    as_role(conn, "authenticated", sub=who)
    denied(conn, "SELECT * FROM public.match_course_material_chunks_v2(%s::vector, 1, '101', '11', %s, %s)",
           (str(_vec()), S1, IV))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            activate(conn, file_id="f1")


def test_teacher_sees_only_own_course_rows(conn):
    as_role(conn, "authenticated", sub=T11)
    assert conn.execute("SELECT count(*) FROM public.course_material_chunks WHERE course_id IS NULL").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM public.course_material_chunks WHERE course_id = '22'").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM public.memberships").fetchone()[0] == 1  # own row only


def test_teacher_cannot_write_into_foreign_course(conn):
    as_role(conn, "authenticated", sub=T11)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            conn.execute("INSERT INTO public.rubric_criteria (criterion_id, assignment_id, course_id, title, description, max_score, dimension)"
                         " VALUES ('x', '201', '22', 't', 'd', 1, 'content')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            activate(conn, course="22", file_id="f9")


def test_teacher_preferences_are_owner_only(conn):
    as_role(conn, "authenticated", sub=T11, email="teacher11@example.test")
    rows = conn.execute("SELECT teacher_email FROM public.teacher_preferences").fetchall()
    assert rows == [("teacher11@example.test",)]


def test_memberships_cannot_be_self_granted(conn):
    as_role(conn, "authenticated", sub=T22)
    denied(conn, "INSERT INTO public.memberships (user_id, lms_host, course_id, role, verified_by)"
                 " VALUES (%s, 'canvas.test', '11', 'teacher', 'me')", (T22,))
    denied(conn, "UPDATE public.memberships SET course_id = '11'")


# ── activation / retrieval semantics ─────────────────────────────────────────

def test_file_replacement_keeps_other_files(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, file_id="fA", n=2)
    activate(conn, file_id="fB", n=3)
    activate(conn, file_id="fA", n=1, src="2026-10-02T00:00:00Z")
    counts = dict(conn.execute(
        "SELECT canvas_file_id, count(*) FROM public.course_material_chunks WHERE course_id='11' AND canvas_file_id IN ('fA','fB') GROUP BY 1"
    ).fetchall())
    assert counts == {"fA": 1, "fB": 3}


def test_every_returned_row_is_described_by_active_metadata(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, file_id="fA")
    activate(conn, assignment="101")
    bad = conn.execute("""
        SELECT count(*) FROM public.match_course_material_chunks_v2(%s::vector, 50, '101', '11', %s, %s) r
        JOIN public.course_material_chunks c ON c.id = r.id
        LEFT JOIN public.assignment_embedding_meta m
          ON m.scope_key = c.embedding_scope_key AND m.active_batch_id = c.ingest_batch_id
         AND m.space_id = %s AND m.index_version = %s AND m.course_id = '11'
        WHERE m.scope_key IS NULL
    """, (str(_vec()), S1, IV, S1, IV)).fetchone()[0]
    assert bad == 0
    texts = [t for (t,) in search(conn)]
    assert texts and not any("legacy" in t for t in texts)


def test_space_change_does_not_certify_untouched_rows(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, file_id="fA", space=S1)
    activate(conn, file_id="fB", space=S1)
    activate(conn, file_id="fA", space=S2, src="2026-10-02T00:00:00Z")
    s2 = {t for (t,) in search(conn, space=S2)}
    s1 = {t for (t,) in search(conn, space=S1)}
    assert all("file:fA" in t for t in s2) and s2
    assert all("file:fB" in t for t in s1) and s1


def test_assignment_rows_do_not_leak_across_assignments(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, assignment="101")
    activate(conn, assignment="102")
    texts = {t for (t,) in search(conn, assignment="101")}
    assert any("assignment:101" in t for t in texts) and not any("assignment:102" in t for t in texts)


def test_stale_activation_refused_and_active_batch_kept(conn):
    as_role(conn, "authenticated", sub=T11)
    _, newer = activate(conn, file_id="fA", src="2026-10-05T00:00:00Z")
    with pytest.raises(psycopg.errors.RaiseException, match="STALE_ACTIVATION"):
        with conn.transaction():
            activate(conn, file_id="fA", src="2026-10-01T00:00:00Z")
    active = conn.execute("SELECT active_batch_id::text FROM public.assignment_embedding_meta WHERE scope_key='course:11:file:fA'").fetchone()[0]
    assert active == newer


def test_duplicate_activation_leaves_exactly_one_batch(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, file_id="fA", n=2)
    _, second = activate(conn, file_id="fA", n=4)
    batches = conn.execute(
        "SELECT DISTINCT ingest_batch_id::text FROM public.course_material_chunks WHERE embedding_scope_key='course:11:file:fA'"
    ).fetchall()
    assert batches == [(second,)]


def test_failed_activation_preserves_prior_active_data(conn):
    as_role(conn, "authenticated", sub=T11)
    _, good = activate(conn, file_id="fA", n=2)
    with pytest.raises(psycopg.Error):
        with conn.transaction():
            conn.execute(
                "SELECT public.activate_embedding_batch('course:11:file:fA', %s::uuid, %s, %s, '{}'::jsonb, 'openai', 'm', 'canvas.test', '101', '11', 'fA', %s::jsonb)",
                (str(uuid.uuid4()), S1, IV, json.dumps([{"assignment_id": "101", "chunk_text": "x", "chunk_index": 0, "embedding": [0.1, 0.2]}])),
            )
    rows = conn.execute("SELECT count(*), min(ingest_batch_id::text) FROM public.course_material_chunks WHERE embedding_scope_key='course:11:file:fA'").fetchone()
    assert rows == (2, good)


def test_scoped_assignment_delete_keeps_course_files(conn):
    as_role(conn, "authenticated", sub=T11)
    activate(conn, file_id="fA")
    activate(conn, assignment="101")
    conn.execute("DELETE FROM public.course_material_chunks WHERE assignment_id='101' AND course_id='11' AND canvas_file_id IS NULL")
    assert conn.execute("SELECT count(*) FROM public.course_material_chunks WHERE canvas_file_id='fA'").fetchone()[0] == 2


def test_concurrent_activations_serialize_to_one_consistent_batch(dburl):
    errors: list[Exception] = []
    barrier = threading.Barrier(2)

    def worker(n):
        try:
            with psycopg.connect(dburl) as c:
                as_role(c, "authenticated", sub=T11)
                barrier.wait()
                activate(c, file_id="fConc", n=n, src="2026-10-03T00:00:00Z")
                c.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(n,)) for n in (3, 5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert not errors, errors
    with psycopg.connect(dburl, autocommit=True) as c:
        active, = c.execute("SELECT active_batch_id::text FROM public.assignment_embedding_meta WHERE scope_key='course:11:file:fConc'").fetchone()
        batches = c.execute("SELECT ingest_batch_id::text, count(*) FROM public.course_material_chunks WHERE embedding_scope_key='course:11:file:fConc' GROUP BY 1").fetchall()
        assert len(batches) == 1 and batches[0][0] == active and batches[0][1] in (3, 5)
        c.execute("DELETE FROM public.course_material_chunks WHERE embedding_scope_key='course:11:file:fConc'")
        c.execute("DELETE FROM public.assignment_embedding_meta WHERE scope_key='course:11:file:fConc'")
