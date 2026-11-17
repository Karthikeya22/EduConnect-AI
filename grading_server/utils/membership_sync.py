"""Synchronize verified users' teacher and TA Canvas course memberships."""

from __future__ import annotations

import requests

from grading_server.utils.canvas_host import canvas_hostname, normalize_canvas_base_url
from grading_server.utils.supabase_client import service_role_client

_COURSES_PATH = (
    "/api/v1/courses?enrollment_type={enrollment_type}"
    "&state[]=available&include[]=enrollments&per_page=100"
)


class MembershipSyncError(Exception):
    """Safe, typed error exposed by the membership-sync route."""

    def __init__(self, code: str, status: int, message: str):
        super().__init__(message)
        self.code, self.status, self.message = code, status, message


def _fetch_memberships(base_url: str, canvas_token: str, enrollment_type: str) -> list[dict]:
    try:
        response = requests.get(
            f"{base_url}{_COURSES_PATH.format(enrollment_type=enrollment_type)}",
            headers={"Authorization": f"Bearer {canvas_token}"},
            allow_redirects=False,
            timeout=30,
        )
    except requests.RequestException as error:
        raise MembershipSyncError(
            "AUTH_UNAVAILABLE", 503, "Canvas membership verification is temporarily unavailable."
        ) from error
    if response.status_code in (401, 403):
        raise MembershipSyncError(
            "CANVAS_TOKEN_INVALID", 401, "The Canvas token was rejected."
        )
    if response.status_code != 200:
        raise MembershipSyncError(
            "AUTH_UNAVAILABLE", 503, "Canvas membership verification is temporarily unavailable."
        )
    try:
        courses = response.json()
    except ValueError as error:
        raise MembershipSyncError(
            "AUTH_UNAVAILABLE", 503, "Canvas membership verification returned an invalid response."
        ) from error
    if not isinstance(courses, list):
        raise MembershipSyncError(
            "AUTH_UNAVAILABLE", 503, "Canvas membership verification returned an invalid response."
        )

    return courses


def sync_canvas_memberships(*, user_id: str, canvas_base_url: str, canvas_token: str) -> dict:
    """Fetch Canvas teacher/TA courses and upsert only those server-fetched roles."""
    if not user_id:
        raise MembershipSyncError("AUTH_UNAVAILABLE", 503, "Verified user identity is unavailable.")
    try:
        base_url = normalize_canvas_base_url(canvas_base_url)
    except ValueError as error:
        raise MembershipSyncError("CANVAS_HOST_INVALID", 400, str(error)) from error
    lms_host = canvas_hostname(base_url)
    if not canvas_token:
        raise MembershipSyncError(
            "CANVAS_TOKEN_REQUIRED", 400, "A Canvas token is required."
        )

    rows_by_course: dict[str, dict] = {}
    for enrollment_type, role in (("teacher", "teacher"), ("ta", "ta")):
        for course in _fetch_memberships(base_url, canvas_token, enrollment_type):
            course_id = course.get("id")
            enrollments = course.get("enrollments", [])
            if (
                course_id is None
                or not isinstance(enrollments, list)
                or not any(
                    isinstance(enrollment, dict)
                    and enrollment.get("type") == enrollment_type
                    for enrollment in enrollments
                )
            ):
                continue
            rows_by_course.setdefault(
                str(course_id), {"course_id": str(course_id), "role": role}
            )

    rows = list(rows_by_course.values())
    try:
        service_role_client().rpc(
            "upsert_my_canvas_memberships",
            {"p_user_id": user_id, "p_lms_host": lms_host, "p_rows": rows},
        ).execute()
    except MembershipSyncError:
        raise
    except Exception as error:
        raise MembershipSyncError(
            "AUTH_UNAVAILABLE", 503, "Membership synchronization is temporarily unavailable."
        ) from error
    return {"lms_host": lms_host, "synced": rows, "count": len(rows)}
