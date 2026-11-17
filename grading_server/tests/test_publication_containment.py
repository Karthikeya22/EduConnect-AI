"""Grade publication containment (Rule #1): the grading server must never write grades to Canvas."""
import ast
from pathlib import Path
from unittest.mock import patch

import grading_server.app as app_mod
import grading_server.config as config

APP_SRC = Path(app_mod.__file__).read_text(encoding="utf-8")


def test_app_has_no_outbound_write_calls():
    tree = ast.parse(APP_SRC)
    writes = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in {"put", "post", "patch", "delete"} and getattr(node.func.value, "id", "") == "requests":
                writes.append(node.lineno)
    assert writes == [], f"outbound write calls at lines {writes}"
    assert "posted_grade" not in APP_SRC


def test_no_publication_route():
    rules = [r.rule for r in app_mod.app.url_map.iter_rules()]
    for rule in rules:
        low = rule.lower()
        assert "publish" not in low and "post-grade" not in low and "post_grade" not in low, rule


def test_grade_endpoint_makes_no_canvas_write_even_when_invoked():
    """Directly invoke /api/grade with requests write verbs patched to explode."""
    def boom(*a, **k):
        raise AssertionError("outbound write attempted")

    client = app_mod.app.test_client()
    with patch("requests.put", boom), patch("requests.post", boom), patch("requests.patch", boom):
        # No BYOK headers -> rejected before any work; proves no write on the entry path.
        res = client.post("/api/grade", json={"assignment_id": "a", "student_id": "s", "submission_text": "x" * 50})
    assert res.status_code == 401


def test_dev_server_defaults_are_contained():
    with patch.dict("os.environ", {}, clear=True):
        import importlib
        try:
            fresh = importlib.reload(config)
            assert fresh.FLASK_DEBUG is False
            assert fresh.FLASK_HOST == "127.0.0.1"
        finally:
            importlib.reload(config)


def test_render_dev_server_binds_public_interface():
    with patch.dict("os.environ", {"RENDER": "true", "PORT": "10000"}, clear=True):
        import importlib
        try:
            fresh = importlib.reload(config)
            assert fresh.FLASK_HOST == "0.0.0.0"
            assert fresh.FLASK_DEBUG is False
        finally:
            importlib.reload(config)
