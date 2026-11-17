"""Tests for Harmonize / LTI external submission URL detection and allowlist."""
import pytest

from grading_server.app import (
    _detect_external_submission_url,
    _external_submission_url_rejection,
    _html_to_text,
    _is_lti_embed_blocked_page,
    _follow_lti_launch,
    _extract_new_window_urls,
    _text_from_canvas_submission_record,
)


def test_detects_harmonize_lti_url():
    url = (
        "https://usf-000.customer.42lines.net/lti/v1/"
        "a0fe28f46c854e559bc14f2e430f4afa/harmonize/submission/eyJabc"
    )
    assert _detect_external_submission_url(url) == url


def test_detects_url_wrapped_in_anchor_html():
    url = "https://foo.customer.42lines.net/lti/v1/x/harmonize/submission/token"
    html = f'<p><a href="{url}">{url}</a></p>'
    assert _detect_external_submission_url(html) == url


def test_ignores_normal_prose():
    assert _detect_external_submission_url("Student wrote a real essay about AI ethics.") is None


def test_ignores_non_lti_bare_url():
    assert _detect_external_submission_url("https://example.com/my-project") is None


def test_allowlist_accepts_42lines():
    assert _external_submission_url_rejection(
        "https://usf-000.customer.42lines.net/lti/v1/abc/harmonize/submission/tok"
    ) is None


def test_allowlist_rejects_arbitrary_hosts():
    assert _external_submission_url_rejection("https://evil.example.com/page") is not None


def test_html_to_text_strips_scripts():
    html = "<html><script>alert(1)</script><p>Hello <b>world</b></p></html>"
    text = _html_to_text(html)
    assert "Hello" in text
    assert "world" in text
    assert "alert" not in text


def test_detects_harmonize_new_window_interstitial():
    html = (
        "<html><body><h1>This tool needs to be loaded in a new browser window</h1>"
        "<a>Load M1 Discussion in a new window</a></body></html>"
    )
    assert _is_lti_embed_blocked_page(html, _html_to_text(html)) is True
    assert _is_lti_embed_blocked_page("<p>Student wrote about Eliza and expert systems.</p>") is False


def test_follow_lti_launch_discards_embed_blocked_interstitial(monkeypatch):
    class FakeResp:
        url = "https://tool.example/interstitial"
        text = (
            "<html><body>This tool needs to be loaded in a new browser window"
            "<a href='https://example.com/x'>open</a></body></html>"
        )

    class FakeSession:
        def get(self, *a, **k):
            return FakeResp()

        def post(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr("grading_server.app.requests.Session", FakeSession)
    out = _follow_lti_launch("https://canvas.example/sessionless")
    assert out["embed_blocked"] is True
    assert out["html"] == "" and out["text"] == ""


def test_extract_new_window_urls_from_harmonize_interstitial():
    html = (
        "<html><body><p>This tool needs to be loaded in a new browser window</p>"
        "<a href=\"https://usf-000.customer.42lines.net/app/discussion/1\">"
        "Load M1 Discussion in a new window</a></body></html>"
    )
    urls = _extract_new_window_urls(html)
    assert urls == ["https://usf-000.customer.42lines.net/app/discussion/1"]


def test_follow_lti_launch_follows_new_window_target(monkeypatch):
    interstitial = (
        "<html><body>This tool needs to be loaded in a new browser window"
        "<a href='https://usf-000.customer.42lines.net/app/post/1'>"
        "Load discussion in a new window</a></body></html>"
    )
    real = (
        "<html><body><article>"
        "<p>Eliza was an early chatbot. Expert systems later shaped tutoring tools in schools.</p>"
        "<p>I reflect on how these milestones still influence adaptive learning today.</p>"
        "</article></body></html>"
    )

    class Resp:
        def __init__(self, text, url):
            self.text = text
            self.url = url

    class FakeSession:
        def get(self, url, **k):
            if "sessionless" in url:
                return Resp(interstitial, "https://canvas.example/sessionless")
            return Resp(real, url)

        def post(self, *a, **k):
            return Resp(interstitial, "https://tool.example/launch")

    monkeypatch.setattr("grading_server.app.requests.Session", FakeSession)
    out = _follow_lti_launch("https://canvas.example/sessionless")
    assert out["embed_blocked"] is False
    assert "Eliza was an early chatbot" in out["text"]
    assert out.get("content_source") == "lti_new_window_follow"


def test_text_from_canvas_submission_prefers_discussion_entries_over_lti_url():
    html, text = _text_from_canvas_submission_record({
        "body": "",
        "url": "https://usf-000.customer.42lines.net/lti/v1/x/harmonize/submission/tok",
        "discussion_entries": [
            {"message": "<p>My figure is Eliza and it contributed conversational AI.</p>"},
        ],
    })
    assert "Eliza" in text
    assert "harmonize" not in text.lower()
