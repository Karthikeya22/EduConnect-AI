"""Authz readiness must surface before teachers hit cryptic ingest failures."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import grading_server.app as app_mod
from grading_server.utils import authz


class _Boom:
    def select(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        raise RuntimeError("PGRST205 Could not find the table 'public.memberships' in the schema cache")


class _Ok:
    def select(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=[])


class _Denied:
    def select(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        raise RuntimeError("permission denied for table memberships")


def test_health_reports_authz_not_ready_when_memberships_missing():
    with patch.object(authz, "_anon_client", lambda: SimpleNamespace(table=lambda n: _Boom())):
        r = app_mod.app.test_client().get("/api/health")
    assert r.status_code == 200
    body = r.get_json()
    assert body["status"] == "degraded"
    assert body["authz"]["ready"] is False
    assert body["authz"]["code"] == "AUTHZ_SETUP_REQUIRED"
    assert "2026_10_31_authz_scope.sql" in body["authz"]["message"]


def test_health_reports_ready_when_memberships_exists_even_if_anon_cannot_read():
    # After the migration, anon is revoked — permission denied still means schema is present.
    with patch.object(authz, "_anon_client", lambda: SimpleNamespace(table=lambda n: _Denied())):
        r = app_mod.app.test_client().get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"
    assert r.get_json()["authz"]["ready"] is True


def test_health_reports_ready_on_empty_select():
    with patch.object(authz, "_anon_client", lambda: SimpleNamespace(table=lambda n: _Ok())):
        r = app_mod.app.test_client().get("/api/health")
    assert r.get_json()["authz"]["ready"] is True


def test_setup_error_message_names_migration_and_bootstrap():
    msg = authz.authz_setup_message()
    assert "2026_10_31_authz_scope.sql" in msg
    assert "bootstrap_memberships.template.sql" in msg
