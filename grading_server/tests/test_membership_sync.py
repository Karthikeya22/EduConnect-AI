from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grading_server.utils.membership_sync as sync


class FakeResp:
    def __init__(self, status, data):
        self.status_code = status
        self._data = data

    def json(self):
        return self._data


def test_sync_upserts_teacher_and_ta_courses_only():
    calls = []

    def fake_get(url, headers=None, **kw):
        calls.append(url)
        assert kw.get("allow_redirects") is False
        assert kw.get("timeout") == 30
        assert headers == {"Authorization": "Bearer tok"}
        assert "usflearn.instructure.com" in url
        if "enrollment_type=teacher" in url:
            return FakeResp(200, [
                {"id": 2081428, "enrollments": [{"type": "teacher"}]},
                {"id": 99, "enrollments": [{"type": "student"}]},
            ])
        return FakeResp(200, [
            {"id": 42, "enrollments": [{"type": "ta"}]},
            {"id": 100, "enrollments": [{"type": "student"}]},
        ])

    sb = MagicMock()
    sb.rpc.return_value.execute.return_value = SimpleNamespace(data=1)
    with patch.object(sync.requests, "get", fake_get), \
         patch.object(sync, "service_role_client", return_value=sb):
        out = sync.sync_canvas_memberships(
            user_id="00000000-0000-0000-0000-000000000001",
            canvas_base_url="https://usflearn.instructure.com",
            canvas_token="tok",
        )

    assert calls == [
        "https://usflearn.instructure.com/api/v1/courses?enrollment_type=teacher&state[]=available&include[]=enrollments&per_page=100",
        "https://usflearn.instructure.com/api/v1/courses?enrollment_type=ta&state[]=available&include[]=enrollments&per_page=100",
    ]
    assert out == {
        "lms_host": "usflearn.instructure.com",
        "synced": [
            {"course_id": "2081428", "role": "teacher"},
            {"course_id": "42", "role": "ta"},
        ],
        "count": 2,
    }
    sb.rpc.assert_called_once_with(
        "upsert_my_canvas_memberships",
        {
            "p_user_id": "00000000-0000-0000-0000-000000000001",
            "p_lms_host": "usflearn.instructure.com",
            "p_rows": [
                {"course_id": "2081428", "role": "teacher"},
                {"course_id": "42", "role": "ta"},
            ],
        },
    )


def test_sync_rejects_missing_canvas_token():
    with patch.object(sync, "service_role_client") as service_role_client:
        try:
            sync.sync_canvas_memberships(
                user_id="00000000-0000-0000-0000-000000000001",
                canvas_base_url="https://usflearn.instructure.com",
                canvas_token="",
            )
        except sync.MembershipSyncError as error:
            assert error.code == "CANVAS_TOKEN_REQUIRED"
        else:
            raise AssertionError("Expected a missing Canvas token to be rejected")
    service_role_client.assert_not_called()


def test_sync_route_requires_identity_and_calls_sync():
    import grading_server.app as app_mod
    import grading_server.utils.authz as authz

    def authorize(scope):
        from flask import g
        g.authz_principal = SimpleNamespace(user_id="00000000-0000-0000-0000-000000000001")
        return object()

    with patch.object(authz, "_authorize", authorize), \
         patch(
             "grading_server.utils.membership_sync.sync_canvas_memberships",
             return_value={
                 "lms_host": "usflearn.instructure.com",
                 "synced": [{"course_id": "1", "role": "teacher"}],
                 "count": 1,
             },
         ) as sync_memberships:
        response = app_mod.app.test_client().post(
            "/api/authz/sync-canvas-memberships",
            json={
                "canvas_base_url": "https://usflearn.instructure.com",
                "courses": [{"course_id": "untrusted"}],
            },
            headers={"Authorization": "Bearer x", "X-Canvas-Token": "tok"},
        )

    assert response.status_code == 200
    assert response.get_json()["count"] == 1
    sync_memberships.assert_called_once_with(
        user_id="00000000-0000-0000-0000-000000000001",
        canvas_base_url="https://usflearn.instructure.com",
        canvas_token="tok",
    )
