"""Canvas download allowlist and credential forwarding (no network: requests.get is faked)."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import grading_server.app as app_mod
from grading_server.app import (
    _canvas_url_rejection,
    _download_canvas_bytes,
    _download_canvas_file_bytes,
    _normalize_canvas_file_url,
    _pick_media_source_url,
)
from grading_server.utils.authz import trusted_lms_host

HOST = trusted_lms_host()


@pytest.mark.parametrize("url", [
    f"https://{HOST}/files/1/download?download_frd=1",
    "https://inst-fs-iad-prod.inscloudgate.net/files/abc",
    "https://a13-222153164.cluster13.canvas-user-content.com/files/222153164/download",
    "https://cluster13.canvas-user-content.com/x",
])
def test_allows_configured_canvas_and_file_storage(url):
    assert _canvas_url_rejection(url) is None


@pytest.mark.parametrize("url", [
    "http://localhost:8000/secret",
    "http://127.0.0.1/secret",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/secret",
    "file:///etc/passwd",
    "https://evil.example.com/payload.pdf",
    f"https://{HOST}.evil.com/payload.pdf",
    "https://canvas.attacker.example/files/2",
    "https://otherschool.instructure.com/files/2",
])
def test_rejects_unconfigured_and_internal_hosts(url):
    assert _canvas_url_rejection(url) is not None


class _Resp:
    def __init__(self, status, location=None, body=b"ok"):
        self.status_code, self.headers, self._body = status, {}, body
        self.content = body
        if location:
            self.headers["Location"] = location
        self.is_redirect = location is not None

    def iter_content(self, chunk_size):
        yield self._body

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_token_only_sent_to_configured_host_and_redirects_revalidated():
    calls = []
    hops = {
        f"https://{HOST}/files/1/download": _Resp(302, "https://inst-fs-iad-prod.inscloudgate.net/f?sig=1"),
        "https://inst-fs-iad-prod.inscloudgate.net/f?sig=1": _Resp(200, body=b"PDFDATA"),
    }

    def fake_get(url, headers=None, **kw):
        calls.append((url, dict(headers or {})))
        assert kw.get("allow_redirects") is False
        return hops[url]

    with patch.object(app_mod.requests, "get", fake_get):
        assert _download_canvas_bytes(f"https://{HOST}/files/1/download", "canvas-secret") == b"PDFDATA"
    assert "Authorization" in calls[0][1]
    assert "Authorization" not in calls[1][1]


def test_redirect_to_canvas_user_content_cdn_is_allowed():
    hops = {
        f"https://{HOST}/files/1/download": _Resp(
            302, "https://a13-1.cluster13.canvas-user-content.com/files/1/download"
        ),
        "https://a13-1.cluster13.canvas-user-content.com/files/1/download": _Resp(200, body=b"%PDF"),
    }

    def fake_get(url, headers=None, **kw):
        return hops[url]

    with patch.object(app_mod.requests, "get", fake_get):
        assert _download_canvas_bytes(f"https://{HOST}/files/1/download", "tok") == b"%PDF"


def test_redirect_to_unapproved_host_is_refused():
    def fake_get(url, headers=None, **kw):
        return _Resp(302, "http://169.254.169.254/latest/meta-data/")

    with patch.object(app_mod.requests, "get", fake_get):
        with pytest.raises(ValueError):
            _download_canvas_bytes(f"https://{HOST}/files/1/download", "canvas-secret")


def test_normalize_rewrites_browser_proxy_paths():
    assert _normalize_canvas_file_url("/canvas-api/files/9/download") == f"https://{HOST}/files/9/download"
    assert _normalize_canvas_file_url("/files/9/download") == f"https://{HOST}/files/9/download"


def test_pick_media_source_prefers_mp4():
    url = _pick_media_source_url([
        {"url": "https://cdn.example/a.webm", "content_type": "video/webm", "bitrate": 900},
        {"url": "https://cdn.example/a.mp4", "content_type": "video/mp4", "bitrate": 100},
    ])
    assert url.endswith("a.mp4")


def test_download_file_bytes_refreshes_stale_url_via_files_api():
    stale = f"https://{HOST}/files/9/download?verifier=old"
    fresh = f"https://{HOST}/files/9/download?verifier=new"
    hops = {
        f"https://{HOST}/api/v1/files/9": _JsonResp(200, {"id": 9, "url": fresh}),
        fresh: _Resp(200, body=b"VIDEO"),
    }

    def fake_get(url, headers=None, **kw):
        return hops[url]

    with patch.object(app_mod.requests, "get", fake_get):
        out = _download_canvas_file_bytes(
            file_url=stale,
            canvas_file_id="9",
            canvas_token="tok",
        )
    assert out == b"VIDEO"


def test_download_file_bytes_falls_back_to_media_sources_on_404():
    listed = f"https://{HOST}/files/9/download"
    stream = "https://media.instructuremedia.com/clip.mp4"
    calls = {"n": 0}

    def fake_get(url, headers=None, **kw):
        calls["n"] += 1
        if url.endswith("/api/v1/files/9"):
            return _JsonResp(200, {"id": 9, "url": listed, "media_entry_id": "m1"})
        if url == listed:
            return _Resp(404, body=b"missing")
        if url.endswith("/media_objects/m1/media_sources"):
            return _JsonResp(200, [{"url": stream, "content_type": "video/mp4", "bitrate": 800}])
        if url == stream:
            return _Resp(200, body=b"STREAM")
        raise AssertionError(url)

    with patch.object(app_mod.requests, "get", fake_get):
        out = _download_canvas_file_bytes(
            file_url=listed,
            canvas_file_id="9",
            canvas_token="tok",
        )
    assert out == b"STREAM"
    assert calls["n"] >= 3


class _JsonResp(_Resp):
    def __init__(self, status, payload):
        import json
        super().__init__(status, body=json.dumps(payload).encode("utf-8"))

    def json(self):
        import json
        return json.loads(self._body.decode("utf-8"))
