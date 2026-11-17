"""Grade-path latency: no unnecessary LLM hops or sequential retrieval (local mocks only)."""
from __future__ import annotations

from unittest.mock import patch

import grading_server.app as app_mod
from grading_server.tests.test_failure_to_score import (
    ANCHOR,
    GOOD_ROWS,
    FakeSB,
    _embed_ok,
    make_llm,
    run,
    state,
)


def _counting_llm(names: list[str]):
    inner = make_llm()

    def fake(prompt, model=None, temperature=None, max_tokens=None, response_schema=None, api_key=None, provider=None, **kw):
        names.append(getattr(response_schema, "__name__", ""))
        return inner(prompt, model, temperature, max_tokens, response_schema, api_key, provider, **kw)

    return fake


def _grade(st, names, sb=None):
    sb = sb or FakeSB(GOOD_ROWS)
    with patch.object(app_mod, "call_gemini", _counting_llm(names)), \
            patch.object(app_mod, "_embed_sync", _embed_ok), \
            patch.object(app_mod, "get_supabase", return_value=sb):
        return run(app_mod.run_grade(st))


def test_default_grade_skips_decompose_llm_but_still_retrieves():
    names: list[str] = []
    g = _grade(state(), names)
    assert "DecomposedCriterion" not in names
    assert names.count("LLMGradingPayload") == 2
    assert all(v.get("retrieval_status") == "ok" for v in g["verdicts"])


def test_deep_retrieve_restores_decompose_llm():
    names: list[str] = []
    _grade(state(deep_retrieve=True), names)
    assert names.count("DecomposedCriterion") == 2


class _ConcurrentSB(FakeSB):
    """Each RPC blocks until all expected callers arrive: passes only if RPCs run concurrently."""

    def __init__(self, rows, expected):
        super().__init__(rows)
        import threading
        self.barrier = threading.Barrier(expected, timeout=5)
        self.calls = 0
        self.lock = threading.Lock()

    def rpc(self, name, params):
        assert name == "match_course_material_chunks_v2"
        with self.lock:
            self.calls += 1
        self.barrier.wait()
        return super().rpc(name, params)


def _retrieve(queries, sb):
    with patch.object(app_mod, "_embed_sync", _embed_ok), patch.object(app_mod, "get_supabase", return_value=sb):
        return run(app_mod._multihop_retrieve(queries, "a1", api_key="k", course_id="k1", provider="gemini"))


def test_multihop_runs_one_rpc_per_query_concurrently():
    sb = _ConcurrentSB(GOOD_ROWS, expected=3)
    chunks, status = _retrieve(["q1", "q2", "q3"], sb)
    assert sb.calls == 3
    assert status == "ok"
    assert [c["id"] for c in chunks] == ["r1"]


def test_multihop_low_similarity_and_empty_and_error():
    from grading_server.tests.test_failure_to_score import LOW_ROWS
    assert _retrieve(["q1", "q2"], FakeSB(LOW_ROWS))[1] == "no_useful_matches"
    assert _retrieve(["q1"], FakeSB([]))[1] == "no_corpus"
    assert _retrieve(["q1"], FakeSB(rpc_exc=RuntimeError("v2 missing")))[1] == "infrastructure_error"


def _run_graph(moe, names, critique_flags=False):
    llm = _counting_llm(names)

    def fake(prompt, model=None, temperature=None, max_tokens=None, response_schema=None, api_key=None, provider=None, **kw):
        if critique_flags and getattr(response_schema, "__name__", "") == "LLMCritiquePayload":
            names.append("LLMCritiquePayload")
            return {"is_supported": False, "is_justified": False, "confidence": 0.2, "reasoning": "weak"}
        return llm(prompt, model, temperature, max_tokens, response_schema, api_key, provider, **kw)

    st = state(moe=moe)
    with patch.object(app_mod, "call_gemini", fake), patch.object(app_mod, "_embed_sync", _embed_ok), \
            patch.object(app_mod, "get_supabase", return_value=FakeSB(GOOD_ROWS)), \
            patch.object(app_mod, "run_ingest", lambda s: {}), \
            patch.object(app_mod, "run_retrieve", lambda s: {}):
        return run(app_mod.get_graph().ainvoke(st))["final_output"]


def test_moe_off_skips_critique_and_regrade_loop():
    names: list[str] = []
    out = _run_graph(False, names)
    assert "LLMCritiquePayload" not in names
    assert names.count("LLMGradingPayload") == 2
    assert out["total"] is not None


def test_moe_on_runs_critique_and_self_correct_loop():
    names: list[str] = []
    _run_graph(True, names, critique_flags=True)
    assert names.count("LLMCritiquePayload") >= 2
    assert names.count("LLMGradingPayload") > 2


def test_run_output_persists_pipeline_duration():
    st = state(
        grade_started_at=__import__("time").time() - 1.25,
        verdicts=[{
            "criterion_id": "c1", "criterion_name": "Methodology", "dimension": "content",
            "score": 7, "max_score": 10, "status": "partial",
            "justification": "Mentions cross validation with enough detail for partial credit.",
            "evidence_anchor": ANCHOR, "missing_keywords": [], "covered_concepts": [],
            "required_concepts": [], "material_alignment": "neutral", "retrieval_status": "ok",
            "placement_ok": True, "ai_generated": False,
        }],
        assignment_id="a1",
        student_id="s1",
        course_id="k1",
        submission_concepts=[],
        relevant_chunks=[],
    )
    with patch.object(app_mod, "get_supabase", return_value=FakeSB()):
        out = run(app_mod.run_output(st))["final_output"]
    assert isinstance(out.get("_pipeline_duration_seconds"), (int, float))
    assert out["_pipeline_duration_seconds"] >= 1.0


def test_truthy_parses_form_strings():
    assert app_mod._truthy("true") and app_mod._truthy(True) and app_mod._truthy("1")
    assert not app_mod._truthy("false") and not app_mod._truthy(None) and not app_mod._truthy("")


def test_default_query_is_title_and_description():
    q = run(app_mod._decompose_criterion("Methodology", "Describe the method."))
    assert q == ["Methodology: Describe the method."]


def test_grade_llm_concurrency_is_capped():
    """Unbounded parallel criterion Gemini calls starve the thread pool and hang grades."""
    import threading
    import time

    rubric = [
        {"criterion_id": f"c{i}", "title": f"C{i}", "description": "d", "max_score": 5, "dimension": "content"}
        for i in range(6)
    ]
    st = state(rubric_criteria=rubric)
    peak = {"n": 0}
    lock = threading.Lock()
    active = {"n": 0}

    inner = make_llm()

    def slow_llm(prompt, model=None, temperature=None, max_tokens=None, response_schema=None, api_key=None, provider=None, **kw):
        name = getattr(response_schema, "__name__", "")
        if name == "LLMGradingPayload":
            with lock:
                active["n"] += 1
                peak["n"] = max(peak["n"], active["n"])
            time.sleep(0.05)
            with lock:
                active["n"] -= 1
        return inner(prompt, model, temperature, max_tokens, response_schema, api_key, provider, **kw)

    with patch.object(app_mod, "call_gemini", slow_llm), \
            patch.object(app_mod, "_embed_sync", _embed_ok), \
            patch.object(app_mod, "get_supabase", return_value=FakeSB(GOOD_ROWS)):
        run(app_mod.run_grade(st))

    assert peak["n"] <= app_mod._GRADE_LLM_CONCURRENCY, (
        f"peak concurrent grade LLMs={peak['n']} exceeded cap={app_mod._GRADE_LLM_CONCURRENCY}"
    )
    assert app_mod._GRADE_LLM_CONCURRENCY <= 3
