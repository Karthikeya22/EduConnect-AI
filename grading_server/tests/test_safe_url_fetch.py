"""Unit tests for SSRF-safe public link fetch (no network to private hosts)."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.utils.safe_url_fetch import (
    fetch_public_link_text,
    html_to_text,
    validate_public_https_url,
)
from grading_server.utils.media_extract import media_kind_from_filename, mime_for_media
from grading_server.app import (
    _detect_any_https_submission_url,
    _detect_external_submission_url,
    _detect_submission_genre,
)


def test_validate_rejects_http_and_localhost():
    assert validate_public_https_url("http://example.com/x")[1]
    assert validate_public_https_url("https://127.0.0.1/secret")[1]
    assert validate_public_https_url("https://localhost/x")[1]


def test_validate_rejects_private_dns(monkeypatch):
    def fake_ips(hostname):
        return ["10.0.0.5"]

    monkeypatch.setattr(
        "grading_server.utils.safe_url_fetch._host_ips", fake_ips
    )
    _, rej = validate_public_https_url("https://evil.internal.example/path")
    assert rej and "private" in rej.lower()


def test_html_to_text_strips_script():
    html = "<html><script>alert(1)</script><p>Hello world findings</p></html>"
    text = html_to_text(html)
    assert "Hello world findings" in text
    assert "alert" not in text


def test_fetch_marks_powerbi_shell_not_extractable():
    html = "<html><body><div id='root'></div></body></html>"
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Content-Type": "text/html"}
    mock_resp.iter_content = lambda chunk_size=65536: [html.encode("utf-8")]
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("grading_server.utils.safe_url_fetch.requests.get", return_value=mock_resp):
        with patch(
            "grading_server.utils.safe_url_fetch._host_ips",
            return_value=["8.8.8.8"],
        ):
            with patch(
                "grading_server.utils.safe_url_fetch.validate_public_https_url",
                return_value=("https://app.powerbi.com/links/FwG5j3I7kU?ctid=abc", None),
            ):
                out = fetch_public_link_text(
                    "https://app.powerbi.com/links/FwG5j3I7kU?ctid=abc"
                )
    assert out["extractable"] is False
    reason = (out.get("reason") or "").lower()
    assert "sign-in" in reason or "interactive" in reason or "power" in reason


def test_detect_url_helpers():
    pbi = "https://app.powerbi.com/links/FwG5j3I7kU?ctid=abc"
    assert _detect_any_https_submission_url(pbi) == pbi
    assert _detect_external_submission_url(pbi) is None
    lti = "https://example.42lines.net/lti/launch?x=1"
    assert _detect_external_submission_url(lti) == lti
    assert _detect_any_https_submission_url(lti) == lti


def test_media_kind_and_genre():
    assert media_kind_from_filename("talk.mp3") == "audio"
    assert media_kind_from_filename("demo.MP4") == "video"
    assert mime_for_media("a.wav", "audio").startswith("audio/")
    assert _detect_submission_genre(["oral.mp3"], "hello") == "audio"
    assert _detect_submission_genre(["demo.mp4"], "hello") == "video"
    assert _detect_submission_genre(
        [], "[VIDEO TRANSCRIPT]\nHi\n[VIDEO VISUAL NOTES]\nSlide"
    ) == "video"
