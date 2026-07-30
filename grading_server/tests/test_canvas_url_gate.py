"""Unit tests for the Canvas download URL allowlist used by /api/ingest/canvas-url."""
import pytest

from grading_server.app import _canvas_url_rejection


@pytest.mark.parametrize("url", [
    "https://usflearn.instructure.com/files/1/download?download_frd=1",
    "https://canvas.myschool.edu/files/2",
    "https://inst-fs-iad-prod.inscloudgate.net/files/abc",
])
def test_allows_canvas_hosts(url):
    assert _canvas_url_rejection(url) is None


@pytest.mark.parametrize("url", [
    "http://localhost:8000/secret",
    "http://127.0.0.1/secret",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/secret",
    "file:///etc/passwd",
    "https://evil.example.com/payload.pdf",
    "https://usflearn.instructure.com.evil.com/payload.pdf",
])
def test_rejects_non_canvas_and_internal_hosts(url):
    assert _canvas_url_rejection(url) is not None
