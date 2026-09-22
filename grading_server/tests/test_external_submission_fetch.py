"""Tests for Harmonize / LTI external submission URL detection and allowlist."""
import pytest

from grading_server.app import (
    _detect_external_submission_url,
    _external_submission_url_rejection,
    _html_to_text,
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
