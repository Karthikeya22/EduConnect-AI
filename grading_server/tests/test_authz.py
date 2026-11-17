"""Authorization boundary (local only: tokens signed with a test secret; DB and Canvas are fakes)."""
from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest

import grading_server.app as app_mod
import grading_server.ingest_service as ingest_service
from grading_server.utils import authz, supabase_client

SECRET = "test-only-secret-not-a-real-key-0123456789"
HOST = authz.trusted_lms_host()
USER = "00000000-0000-0000-0000-0000000000aa"


def token(sub=USER, role="authenticated", exp=None, aud="authenticated", iss=None, key=SECRET, **extra):
    claims = {"sub": sub, "role": role, "aud": aud, "iss": iss or authz._issuer(),
              "exp": exp or int(time.time()) + 600, **extra}
    if sub is None:
        claims.pop("sub")
    return jwt.encode(claims, key, algorithm="HS256")


class MembershipTable:
    """Applies eq filters like PostgREST; ignores is_() so revoked rows can reach the Python check."""

    def __init__(self, rows, exc=None):
        self.rows, self.exc, self.filters = rows, exc, {}

    def select(self, *_):
        return self

    def eq(self, k, v):
        self.filters[k] = v
        return self

    def is_(self, *_):
        return self

    def execute(self):
        if self.exc:
            raise self.exc
        return SimpleNamespace(data=[r for r in self.rows if all(str(r.get(k)) == str(v) for k, v in self.filters.items())])


class FakeUserClient:
    def __init__(self, rows=(), exc=None):
        self.rows, self.exc = list(rows), exc

    def table(self, name):
        assert name == "memberships"
        return MembershipTable(self.rows, self.exc)


def member(course="11", role="teacher", revoked_at=None, user=USER, host=HOST):
    return {"user_id": user, "course_id": course, "lms_host": host, "role": role, "revoked_at": revoked_at}


def canvas(status_by_path):
    def fake_get(url, headers=None, **kw):
        assert url.startswith(f"https://{HOST}/api/v1/courses/")
        for suffix, status in status_by_path.items():
            if url.endswith(suffix):
                return SimpleNamespace(status_code=status)
        return SimpleNamespace(status_code=404)
    return fake_get


@pytest.fixture(autouse=True)
def _env():
    authz._assignment_cache.clear()
    with patch.object(authz, "SUPABASE_JWT_SECRET", SECRET):
        yield


def status_call(tok=None, rows=(), course="11", exc=None, headers=None):
    client = FakeUserClient(rows, exc)
    h = dict(headers or {})
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    seen = {}

    async def files(cid):
        seen["client"] = supabase_client.get_supabase()
        return []

    with patch.object(authz, "user_scoped_client", lambda t: client), \
            patch.object(ingest_service, "list_course_file_status", files):
        r = app_mod.app.test_client().get(f"/api/ingest/course-status?course_id={course}", headers=h)
    return r, seen.get("client"), client


def grade_call(tok, rows, canvas_status, course="11", assignment="101", canvas_token="ct"):
    client = FakeUserClient(rows)
    reached = []
    with patch.object(authz, "user_scoped_client", lambda t: client), \
            patch.object(authz.requests, "get", canvas(canvas_status)), \
            patch.object(app_mod, "resolve_llm_credentials", lambda req: reached.append(1) or (None, None)):
        r = app_mod.app.test_client().post("/api/grade", json={
            "course_id": course, "assignment_id": assignment, "student_id": "s1", "submission_text": "x" * 50,
        }, headers={"Authorization": f"Bearer {tok}", "X-Canvas-Token": canvas_token})
    return r, bool(reached)


def code(r):
    return r.status_code, r.get_json().get("error")


# ── identity ────────────────────────────────────────────────────────────────

def test_missing_identity():
    r, _, _ = status_call(None, rows=[member()])
    assert code(r) == (401, "AUTH_REQUIRED")


@pytest.mark.parametrize("bad, expected", [
    (lambda: token(key="wrong-secret-wrong-secret-wrong-secret!!"), "INVALID_TOKEN"),
    (lambda: token(exp=int(time.time()) - 10), "TOKEN_EXPIRED"),
    (lambda: token(aud="other"), "INVALID_TOKEN"),
    (lambda: token(iss="https://evil.example/auth/v1"), "INVALID_TOKEN"),
    (lambda: token(sub=None, role="anon"), "INVALID_TOKEN"),
    (lambda: token(role="service_role"), "INVALID_TOKEN"),
    (lambda: "not-a-jwt", "INVALID_TOKEN"),
])
def test_invalid_identity(bad, expected):
    r, _, _ = status_call(bad(), rows=[member()])
    assert code(r) == (401, expected)


def test_hs256_without_configured_secret_fails_closed():
    with patch.object(authz, "SUPABASE_JWT_SECRET", None):
        r, _, _ = status_call(token(), rows=[member()])
    assert code(r) == (503, "AUTH_NOT_CONFIGURED")


def test_sync_canvas_memberships_route_requires_identity():
    response = app_mod.app.test_client().post("/api/authz/sync-canvas-memberships")
    assert code(response) == (401, "AUTH_REQUIRED")


def test_request_lms_host_prefers_valid_request_host_and_falls_back_to_configured_host():
    assert authz.request_lms_host(
        {"canvas_base_url": "https://another-school.instructure.com"}
    ) == "another-school.instructure.com"
    assert authz.request_lms_host(
        {"lms_host": "https://evil.example.com"}
    ) == HOST


# ── membership ──────────────────────────────────────────────────────────────

def test_forged_role_tenant_and_byok_do_not_grant_access():
    tok = token(user_metadata={"role": "admin"}, app_metadata={"role": "teacher", "courses": ["11"]})
    r, _, _ = status_call(tok, rows=[], headers={
        "X-Tenant-Id": "11", "X-Org-Id": "usf", "X-LLM-Provider": "openai", "X-LLM-Api-Key": "sk",
        "X-Canvas-Token": "ct",
    })
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_foreign_course_denied():
    r, _, _ = status_call(token(), rows=[member(course="11")], course="22")
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_other_users_membership_does_not_count():
    r, _, _ = status_call(token(), rows=[member(user="00000000-0000-0000-0000-0000000000bb")])
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_other_lms_host_membership_does_not_count():
    r, _, _ = status_call(token(), rows=[member(host="other.instructure.com")])
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_revoked_membership_denied():
    r, _, _ = status_call(token(), rows=[member(revoked_at="2026-10-01T00:00:00Z")])
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_student_membership_denied():
    r, _, _ = status_call(token(), rows=[member(role="student")])
    assert code(r) == (403, "COURSE_ACCESS_DENIED")


def test_missing_membership_table_fails_closed():
    r, _, _ = status_call(token(), rows=[], exc=RuntimeError("PGRST205 relation memberships does not exist"))
    assert code(r) == (503, "AUTHZ_SETUP_REQUIRED")


def test_non_numeric_course_rejected():
    r, _, _ = status_call(token(), rows=[member()], course="11;drop")
    assert code(r) == (400, "COURSE_REQUIRED")


def test_authorized_request_binds_user_scoped_client():
    r, bound, client = status_call(token(), rows=[member()])
    assert r.status_code == 200
    assert bound is client
    with pytest.raises(RuntimeError):
        supabase_client.get_supabase()  # nothing leaks outside the request


# ── assignment ↔ course ─────────────────────────────────────────────────────

def test_mismatched_assignment_denied_before_any_grading():
    r, reached = grade_call(token(), [member()], canvas_status={})
    assert code(r) == (403, "ASSIGNMENT_NOT_IN_COURSE")
    assert not reached


def test_assignment_requires_canvas_token_to_verify():
    r, reached = grade_call(token(), [member()], canvas_status={"assignments/101": 200}, canvas_token="")
    assert code(r) == (403, "ASSIGNMENT_SCOPE_UNVERIFIED")
    assert not reached


def test_canvas_outage_is_503_not_access_decision():
    r, _ = grade_call(token(), [member()], canvas_status={"assignments/101": 500})
    assert code(r) == (503, "AUTH_UNAVAILABLE")


def test_verified_assignment_reaches_handler():
    r, reached = grade_call(token(), [member()], canvas_status={"assignments/101": 200})
    assert reached and code(r) == (401, "BYOK_REQUIRED")  # authz passed; BYOK is checked next


def test_discussion_topic_counts_as_assignment():
    r, reached = grade_call(token(), [member()], canvas_status={"discussion_topics/101": 200})
    assert reached


def _request_path(rule: str) -> str:
    """Fill converters so the route matches. A literal ``<int:version>`` never reaches the guard."""
    import re

    def repl(match: re.Match) -> str:
        converter = match.group(1) or "string"
        if converter in ("int", "float"):
            return "101"
        if converter == "path":
            return "file.txt"
        return "sample"

    return re.sub(r"<(?:([^:>]+):)?([^>]+)>", repl, rule)


def test_every_data_route_is_guarded():
    public = {"/api/health", "/api/llm/providers", "/static/<path:filename>"}
    for rule in app_mod.app.url_map.iter_rules():
        if rule.rule in public:
            continue
        r = app_mod.app.test_client().open(
            _request_path(rule.rule), method=sorted(rule.methods - {"HEAD", "OPTIONS"})[0]
        )
        assert r.status_code == 401, f"{rule.rule} is not guarded ({r.status_code})"
