"""
authz.py
Server-side authorization for grading-server routes.

Identity: the Supabase access token (Authorization: Bearer) verified against the
project JWKS (asymmetric keys) or, for legacy projects, SUPABASE_JWT_SECRET.
Access: a non-revoked teacher/TA row in public.memberships for the configured
LMS host and course, read with the caller's own JWT under RLS. If that row is
missing, a Canvas API token that Canvas confirms is teacher/TA on the course
is accepted (trusted helpers sharing an instructor key). An assignment is
accepted only after the configured Canvas host confirms it belongs to that course.

Never used for authorization: user_metadata/app roles in the token, tenant or
org headers, BYOK LLM headers, Canvas token presence alone, CORS origin.
"""

from __future__ import annotations

import functools
import inspect
import os
import re
import threading
import time
from dataclasses import dataclass

import jwt
import requests
from flask import g, jsonify, request

from grading_server.config import CANVAS_BASE_URL, SUPABASE_JWT_SECRET, SUPABASE_KEY, SUPABASE_URL
from grading_server.utils.canvas_host import canvas_hostname
from grading_server.utils.supabase_client import bind_request_client, reset_request_client, user_scoped_client

STAFF_ROLES = frozenset({"teacher", "ta"})
_CANVAS_ID = re.compile(r"^\d{1,20}$")
# Offline Teacher Hub fixtures in src/lib/supabase.ts (canvas-get-* mock fallback).
_LOCAL_MOCK_COURSES = frozenset({"101", "102"})
_LOCAL_MOCK_ASSIGNMENT = re.compile(r"^(canvas-assign-\d+|disc-\d+)$")
_ASYMMETRIC_ALGS = ("ES256", "RS256")
_ASSIGNMENT_CACHE_TTL = 600.0
_SCHEMA_MISSING = ("pgrst205", "does not exist", "could not find the table", "could not find the relation")


def local_mock_grade_enabled() -> bool:
    """Opt-in local QA only — never on by default. Allows mock hub course/assignment ids."""
    return os.getenv("EDUCONNECT_LOCAL_MOCK_GRADE", "").strip().lower() in ("1", "true", "yes", "on")


def is_local_mock_scope(course_id: str, assignment_id: str = "") -> bool:
    if not local_mock_grade_enabled():
        return False
    if course_id not in _LOCAL_MOCK_COURSES:
        return False
    if not assignment_id:
        return True
    return bool(_LOCAL_MOCK_ASSIGNMENT.match(assignment_id))


def authz_setup_message() -> str:
    return (
        "Course access is not set up: apply grading_server/migrations/2026_10_31_embedding_provenance.sql "
        "then grading_server/migrations/2026_10_31_authz_scope.sql, set app_private.settings.lms_host, "
        "and import your teacher row with grading_server/migrations/bootstrap_memberships.template.sql. "
        "See docs/research/baseline.md §7."
    )


def _anon_client():
    """Schema probe only: no user JWT. Never used for data access."""
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def probe_authz_ready() -> dict:
    """
    Whether the memberships schema is present. Anon may be revoked after migration;
    permission-denied still means ready. Missing table means AUTHZ_SETUP_REQUIRED.
    """
    try:
        _anon_client().table("memberships").select("user_id").limit(0).execute()
        return {"ready": True, "code": None, "message": None}
    except Exception as e:
        text = str(e).lower()
        if any(m in text for m in _SCHEMA_MISSING):
            return {"ready": False, "code": "AUTHZ_SETUP_REQUIRED", "message": authz_setup_message()}
        # Table exists but anon cannot read it (expected after authz_scope).
        return {"ready": True, "code": None, "message": None}


class AuthError(Exception):
    def __init__(self, code: str, status: int, message: str):
        super().__init__(message)
        self.code, self.status, self.message = code, status, message


@dataclass(frozen=True)
class Principal:
    user_id: str
    access_token: str


def _issuer() -> str:
    return f"{SUPABASE_URL.rstrip('/')}/auth/v1"


@functools.lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{_issuer()}/.well-known/jwks.json", cache_keys=True, lifespan=600)


def verify_access_token(token: str) -> Principal:
    """Verify signature, exp, aud and iss; identity comes from `sub` only."""
    if not token:
        raise AuthError("AUTH_REQUIRED", 401, "Sign in again: a Supabase access token is required.")
    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        raise AuthError("INVALID_TOKEN", 401, "Malformed access token.")
    if alg == "HS256":
        if not SUPABASE_JWT_SECRET:
            raise AuthError("AUTH_NOT_CONFIGURED", 503, "Server is missing SUPABASE_JWT_SECRET for HS256 tokens.")
        key = SUPABASE_JWT_SECRET
    elif alg in _ASYMMETRIC_ALGS:
        try:
            key = _jwks_client().get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError:
            raise AuthError("AUTH_UNAVAILABLE", 503, "Could not load the project signing keys.")
        except jwt.PyJWTError:
            raise AuthError("INVALID_TOKEN", 401, "Unknown signing key.")
    else:
        raise AuthError("INVALID_TOKEN", 401, "Unsupported token algorithm.")
    try:
        claims = jwt.decode(
            token, key, algorithms=[alg], audience="authenticated", issuer=_issuer(),
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("TOKEN_EXPIRED", 401, "Session expired; sign in again.")
    except jwt.PyJWTError:
        raise AuthError("INVALID_TOKEN", 401, "Access token failed verification.")
    # The anon/service keys are also JWTs; only a signed-in user session is an identity.
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise AuthError("INVALID_TOKEN", 401, "Token is not a signed-in user session.")
    return Principal(user_id=str(claims["sub"]), access_token=token)


def _bearer() -> str:
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header[:7].lower() == "bearer " else ""


def trusted_lms_host() -> str:
    from urllib.parse import urlparse
    return (urlparse(CANVAS_BASE_URL or "").hostname or "").lower()


def request_lms_host(params: dict | None = None) -> str:
    """Resolve a validated request Canvas host, falling back to server config."""
    params = _request_params() if params is None else params
    for key in ("canvas_base_url", "lms_host"):
        value = params.get(key)
        if not value:
            continue
        try:
            return canvas_hostname(str(value))
        except ValueError:
            continue
    return trusted_lms_host()


def canvas_staff_role_for_course(course_id: str, canvas_token: str, host: str | None = None) -> str | None:
    """Return 'teacher'/'ta' if Canvas says this token is staff on the course; else None."""
    host = (host or request_lms_host() or "").lower()
    if not host or not canvas_token or not _CANVAS_ID.match(str(course_id)):
        return None
    url = f"https://{host}/api/v1/courses/{course_id}?include[]=enrollments"
    headers = {"Authorization": f"Bearer {canvas_token}", "User-Agent": "EduConnect-AI/1.0"}
    try:
        response = requests.get(url, headers=headers, timeout=15, allow_redirects=False)
    except requests.RequestException as e:
        raise AuthError("AUTH_UNAVAILABLE", 503, "Canvas could not be reached to verify course access.") from e
    if response.status_code in (401, 403):
        return None
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise AuthError(
            "AUTH_UNAVAILABLE", 503,
            f"Canvas returned {response.status_code} while verifying course access.",
        )
    try:
        payload = response.json()
    except ValueError as e:
        raise AuthError("AUTH_UNAVAILABLE", 503, "Canvas returned an invalid course access response.") from e
    enrollments = payload.get("enrollments") if isinstance(payload, dict) else None
    if not isinstance(enrollments, list):
        return None
    found: set[str] = set()
    for enrollment in enrollments:
        if not isinstance(enrollment, dict):
            continue
        raw = str(enrollment.get("type") or "").strip().lower()
        if raw in STAFF_ROLES:
            found.add(raw)
        elif raw == "teacherenrollment":
            found.add("teacher")
        elif raw == "taenrollment":
            found.add("ta")
    if "teacher" in found:
        return "teacher"
    if "ta" in found:
        return "ta"
    return None


def _ensure_membership_for_rls(user_id: str, course_id: str, role: str) -> str:
    """Persist Canvas-confirmed staff access so Postgres RLS can_manage_course() passes.

    RLS matches memberships.lms_host to app_private.settings.lms_host, which must
    equal the configured Canvas host — not a free-form request host.
    """
    host = trusted_lms_host()
    if not host:
        raise AuthError("AUTH_NOT_CONFIGURED", 503, "CANVAS_BASE_URL is not configured.")
    try:
        from grading_server.utils.supabase_client import service_role_client

        service_role_client().rpc(
            "upsert_my_canvas_memberships",
            {
                "p_user_id": user_id,
                "p_lms_host": host,
                "p_rows": [{"course_id": str(course_id), "role": role}],
            },
        ).execute()
    except AuthError:
        raise
    except Exception as e:
        print(f"[AUTHZ] membership upsert failed: {type(e).__name__}: {e}")
        raise AuthError(
            "AUTH_UNAVAILABLE",
            503,
            "Canvas staff access was verified, but course membership could not be saved for database writes. "
            "Check SUPABASE_SERVICE_ROLE_KEY on the grading server.",
        ) from e
    return host


def require_course_role(client, principal: Principal, course_id: str, roles=STAFF_ROLES) -> dict:
    """Return the caller's active membership row or raise. Read under RLS with the caller's JWT."""
    # RLS host is the configured Canvas host; request host is only for Canvas API calls.
    rls_host = trusted_lms_host()
    request_host = request_lms_host() or rls_host
    if not rls_host:
        raise AuthError("AUTH_NOT_CONFIGURED", 503, "CANVAS_BASE_URL is not configured.")
    try:
        rows = (
            client.table("memberships")
            .select("user_id,course_id,lms_host,role,revoked_at")
            .eq("user_id", principal.user_id)
            .eq("lms_host", rls_host)
            .eq("course_id", course_id)
            .is_("revoked_at", "null")
            .execute()
            .data
            or []
        )
    except Exception as e:
        text = str(e).lower()
        if any(m in text for m in _SCHEMA_MISSING):
            raise AuthError("AUTHZ_SETUP_REQUIRED", 503, authz_setup_message()) from e
        raise AuthError(
            "AUTHZ_SETUP_REQUIRED", 503,
            authz_setup_message() + f" (memberships query failed: {type(e).__name__})",
        ) from e
    for row in rows:
        if (
            str(row.get("user_id")) == principal.user_id
            and str(row.get("course_id")) == course_id
            and row.get("lms_host") == rls_host
            and row.get("revoked_at") is None
            and row.get("role") in roles
        ):
            return row

    canvas_token = _canvas_token(_request_params())
    if not canvas_token:
        raise AuthError("COURSE_ACCESS_DENIED", 403, "You are not an active teacher or TA of this course.")
    role = canvas_staff_role_for_course(course_id, canvas_token, request_host)
    if role not in roles:
        raise AuthError("COURSE_ACCESS_DENIED", 403, "You are not an active teacher or TA of this course.")
    host = _ensure_membership_for_rls(principal.user_id, course_id, role)
    return {
        "user_id": principal.user_id,
        "course_id": str(course_id),
        "lms_host": host,
        "role": role,
        "revoked_at": None,
    }


_assignment_cache: dict[tuple[str, str, str], float] = {}
_assignment_lock = threading.Lock()


def assignment_in_course(course_id: str, assignment_id: str, canvas_token: str) -> bool:
    """Ask the configured Canvas host whether the assignment/discussion belongs to the course."""
    host = request_lms_host()
    key = (host, course_id, assignment_id)
    with _assignment_lock:
        if _assignment_cache.get(key, 0) > time.monotonic():
            return True
    if not canvas_token:
        raise AuthError("ASSIGNMENT_SCOPE_UNVERIFIED", 403, "A Canvas token is required to verify the assignment's course.")
    if not host:
        raise AuthError("AUTH_NOT_CONFIGURED", 503, "CANVAS_BASE_URL is not configured.")
    base = f"https://{host}/api/v1/courses/{course_id}"
    headers = {"Authorization": f"Bearer {canvas_token}", "User-Agent": "EduConnect-AI/1.0"}
    try:
        for path in (f"assignments/{assignment_id}", f"discussion_topics/{assignment_id}"):
            r = requests.get(f"{base}/{path}", headers=headers, timeout=15, allow_redirects=False)
            if r.status_code == 200:
                with _assignment_lock:
                    _assignment_cache[key] = time.monotonic() + _ASSIGNMENT_CACHE_TTL
                return True
            if r.status_code not in (401, 403, 404):
                raise AuthError("AUTH_UNAVAILABLE", 503, f"Canvas returned {r.status_code} while verifying the assignment.")
    except requests.RequestException as e:
        raise AuthError("AUTH_UNAVAILABLE", 503, "Canvas could not be reached to verify the assignment.") from e
    return False


def _request_params() -> dict:
    data = request.get_json(silent=True) if request.is_json else None
    params = dict(request.args)
    params.update(request.form.to_dict() if request.form else {})
    params.update(data if isinstance(data, dict) else {})
    params.update(request.view_args or {})
    return params


def _canvas_token(params: dict) -> str:
    return str(request.headers.get("X-Canvas-Token") or params.get("canvas_token") or "")


def _authorize(scope: str):
    principal = verify_access_token(_bearer())
    g.authz_principal = principal
    client = user_scoped_client(principal.access_token)
    if scope == "identity":
        return client
    params = _request_params()
    course_id = str(params.get("course_id") or "").strip()
    assignment_id = str(params.get("assignment_id") or "").strip()
    # Local mock hub (EDUCONNECT_LOCAL_MOCK_GRADE=1): identity-only for fixture course/assignment ids.
    if is_local_mock_scope(course_id, assignment_id if scope == "assignment" or assignment_id else ""):
        return client
    if not _CANVAS_ID.match(course_id):
        raise AuthError("COURSE_REQUIRED", 400, "A numeric course_id is required.")
    require_course_role(client, principal, course_id)
    # Course-file ingest stores chunks under assignment_id "course:{course_id}".
    # Accept that sentinel on course-scoped routes only — never on assignment scope.
    if (
        scope == "course"
        and assignment_id
        and assignment_id == f"course:{course_id}"
    ):
        return client
    if scope == "assignment" or assignment_id:
        if not _CANVAS_ID.match(assignment_id):
            raise AuthError("ASSIGNMENT_REQUIRED", 400, "A numeric assignment_id is required.")
        if not assignment_in_course(course_id, assignment_id, _canvas_token(params)):
            raise AuthError("ASSIGNMENT_NOT_IN_COURSE", 403, "That assignment does not belong to this course.")
    return client


def require_access(scope: str):
    """Route guard. scope: 'identity' | 'course' | 'assignment'. Binds the user-scoped DB client."""
    assert scope in ("identity", "course", "assignment")

    def deco(view):
        def deny(e: AuthError):
            return jsonify({"error": e.code, "message": e.message}), e.status

        if inspect.iscoroutinefunction(view):
            @functools.wraps(view)
            async def wrapper(*a, **k):
                try:
                    client = _authorize(scope)
                except AuthError as e:
                    return deny(e)
                token = bind_request_client(client)
                try:
                    return await view(*a, **k)
                finally:
                    reset_request_client(token)
        else:
            @functools.wraps(view)
            def wrapper(*a, **k):
                try:
                    client = _authorize(scope)
                except AuthError as e:
                    return deny(e)
                token = bind_request_client(client)
                try:
                    return view(*a, **k)
                finally:
                    reset_request_client(token)
        return wrapper

    return deco
