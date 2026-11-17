# grading_server/tests/test_canvas_host.py
import pytest
from grading_server.utils.canvas_host import canvas_hostname, normalize_canvas_base_url

def test_accepts_instructure_https():
    assert normalize_canvas_base_url("https://usflearn.instructure.com/") == "https://usflearn.instructure.com"
    assert canvas_hostname("https://usflearn.instructure.com/courses/1") == "usflearn.instructure.com"

@pytest.mark.parametrize("url", [
    "http://usflearn.instructure.com",  # http
    "https://127.0.0.1",
    "https://localhost",
    "https://169.254.169.254",
    "https://evil.example.com",
    "https://usflearn.instructure.com.evil.com",
    "",
    "not-a-url",
])
def test_rejects_bad_hosts(url):
    with pytest.raises(ValueError):
        normalize_canvas_base_url(url)
