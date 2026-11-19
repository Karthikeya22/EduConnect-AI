"""Platform invariants for grading + materials — must stay green forever.

These catch the exact failure classes that take the product down:
- empty retrieval treated as ok → max() crash / all criteria processing_failed
- pending reingest wiping prior-index visibility
"""
from __future__ import annotations

from pathlib import Path

from grading_server.retrieval_guards import coerce_retrieval, top_chunk_similarity

ROOT = Path(__file__).resolve().parents[1]
APP_PY = ROOT / "app.py"


def test_coerce_empty_ok_becomes_no_corpus():
    chunks, status = coerce_retrieval([], "ok")
    assert chunks == []
    assert status == "no_corpus"


def test_coerce_ok_with_chunks_stays_ok():
    rows = [{"similarity": 0.9}]
    chunks, status = coerce_retrieval(rows, "ok")
    assert chunks is not rows  # copy
    assert status == "ok"
    assert chunks[0]["similarity"] == 0.9


def test_top_similarity_empty_is_zero_not_valueerror():
    assert top_chunk_similarity([]) == 0.0
    assert top_chunk_similarity(None) == 0.0
    assert top_chunk_similarity([{"similarity": 0.4}, {"similarity": 0.7}]) == 0.7


def test_app_source_never_sets_degraded_ok_empty():
    """Static ban: the exact bug that zeroed every criterion with ValueError."""
    src = APP_PY.read_text(encoding="utf-8")
    assert 'retrieved_chunks, retrieval_status = [], "ok"' not in src
    assert "coerce_retrieval(" in src
    assert "top_chunk_similarity(" in src


def test_app_source_uses_guards_on_grade_path():
    src = APP_PY.read_text(encoding="utf-8")
    # After retrieve / degrade, grade path must coerce before building material ctx.
    assert "retrieved_chunks, retrieval_status = coerce_retrieval(" in src


if __name__ == "__main__":
    test_coerce_empty_ok_becomes_no_corpus()
    test_coerce_ok_with_chunks_stays_ok()
    test_top_similarity_empty_is_zero_not_valueerror()
    test_app_source_never_sets_degraded_ok_empty()
    test_app_source_uses_guards_on_grade_path()
    print("OK: platform invariants")
