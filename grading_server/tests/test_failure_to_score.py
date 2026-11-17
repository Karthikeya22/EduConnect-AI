"""Failure-to-score integrity: a processing failure is never a zero (local mocks only)."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grading_server.app as app_mod

SUBMISSION = (
    "Introduction\n"
    "This project proposes a crop disease classifier for smallholder farms using leaf images.\n\n"
    "Methodology\n"
    "We fine-tune a convolutional network on a labelled dataset of leaf photographs and evaluate it "
    "with stratified cross validation, reporting precision and recall for each disease class.\n\n"
    "Ethical Considerations\n"
    "Farmer consent and data ownership are handled through a signed agreement with the cooperative.\n"
)
ANCHOR = "evaluate it with stratified cross validation, reporting precision and recall"

RUBRIC = [
    {"criterion_id": "c1", "title": "Methodology", "description": "Describe the method.", "max_score": 10, "dimension": "content"},
    {"criterion_id": "c2", "title": "Introduction", "description": "Frame the problem.", "max_score": 6, "dimension": "content"},
]


class FakeSB:
    def __init__(self, rows=None, rpc_exc: Exception | None = None):
        self.rows = rows or []
        self.rpc_exc = rpc_exc
        self.tables: list[str] = []

    def rpc(self, name, params):
        if self.rpc_exc:
            raise self.rpc_exc
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=list(self.rows)))

    def table(self, name):
        self.tables.append(name)
        return MagicMock()


def make_llm(fail_titles=(), all_fail=False, grade=None, prompts=None):
    grade = grade or {
        "score": 7,
        "status": "partial",
        "justification": "The methodology names cross validation and per-class metrics but omits data split detail and baselines.",
        "evidence_anchor": ANCHOR,
        "material_alignment": "contradicts",
        "placement_ok": True,
    }

    def fake(prompt, model=None, temperature=None, max_tokens=None, response_schema=None, api_key=None, provider=None, **_):
        name = getattr(response_schema, "__name__", "")
        if name == "DecomposedCriterion":
            return {"sub_queries": ["q1"]}
        if name == "LLMGradingPayload":
            if prompts is not None:
                prompts.append(prompt)
            if all_fail or any(f"Title: {t}\n" in prompt for t in fail_titles):
                raise TimeoutError("provider timed out")
            return dict(grade)
        if name == "LLMCritiquePayload":
            return {"is_supported": True, "is_justified": True, "confidence": 0.9, "reasoning": "ok"}
        raise AssertionError(f"unexpected LLM call: {name}")

    return fake


def _embed_ok(texts, provider, api_key, input_type=None):
    return [[0.1] * 768 for _ in texts]


def _embed_fail(texts, provider, api_key, input_type=None):
    raise RuntimeError("embedding endpoint down")


GOOD_ROWS = [{"id": "r1", "chunk_text": "Cross validation lecture notes", "source_title": "Week 3", "chunk_index": 0, "similarity": 0.62}]
LOW_ROWS = [{"id": "r2", "chunk_text": "Unrelated syllabus text", "source_title": "Syllabus", "chunk_index": 0, "similarity": 0.10}]


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def state(**over):
    s = {
        "assignment_id": "a1",
        "course_id": "k1",
        "student_id": "s1",
        "submission_text": SUBMISSION,
        "assignment_context": "",
        "rubric_criteria": [dict(c) for c in RUBRIC],
        "exemplars": {},
        "llm_provider": "gemini",
        "llm_api_key": "test-key",
        "verdicts": [],
        "critiques": [],
        "loop_count": 0,
    }
    s.update(over)
    return s


def grade_and_output(llm, sb=None, embed=_embed_ok, st=None):
    sb = sb or FakeSB(GOOD_ROWS)
    st = st or state()
    with patch.object(app_mod, "call_gemini", llm), patch.object(app_mod, "_embed_sync", embed), \
            patch.object(app_mod, "get_supabase", return_value=sb):
        g = run(app_mod.run_grade(st))
        st = {**st, **g}
        st.update(run(app_mod.run_critique(st)))
        out = run(app_mod.run_output(st))["final_output"]
    return g, out, sb


def by_id(out):
    return {v["criterion_id"]: v for v in out["criteria_verdicts"]}


def test_single_criterion_timeout_is_not_assessable_and_no_total():
    _, out, _ = grade_and_output(make_llm(fail_titles=["Introduction"]))
    v = by_id(out)
    assert v["c2"]["score"] is None
    assert v["c2"]["status"] == "not_assessable"
    assert v["c2"]["failure_kind"] == "processing_failed"
    assert v["c1"]["score"] is not None and v["c1"]["score"] > 0
    assert out["assessment_status"] == "partial"
    assert out["total"] is None and out["content_score"] is None
    sub = out["partial_subtotal"]
    assert sub == {"earned": v["c1"]["score"], "assessed_max": 10, "failed_criteria": ["Introduction"]}
    assert out["total_max"] == 16  # original max kept; subtotal not rescaled
    assert out["flag_for_human"] is True
    assert "Introduction" not in out["topic_mastery_radar"]


def test_total_provider_failure_never_scores_zero():
    _, out, _ = grade_and_output(make_llm(all_fail=True))
    assert all(v["score"] is None for v in out["criteria_verdicts"])
    assert out["assessment_status"] == "processing_failed"
    assert out["total"] is None
    assert out["partial_subtotal"] == {"earned": 0, "assessed_max": 0, "failed_criteria": ["Methodology", "Introduction"]}
    assert out["flag_for_human"] is True
    assert all(c["flag_for_human"] for c in out["critiques"])


def test_not_assessable_critique_makes_no_llm_call():
    calls = []

    def llm(*a, **k):
        calls.append(1)
        raise AssertionError("critique LLM must not be called")

    with patch.object(app_mod, "call_gemini", llm):
        c = run(app_mod._cp({"criterion_id": "c1", "score": None, "max_score": 5, "failure_kind": "processing_failed"}))
    assert calls == [] and c["flag_for_human"] is True


def test_genuine_zero_stays_zero_and_total_is_complete():
    zero = {
        "score": 0,
        "status": "missing",
        "justification": "The submission does not address this criterion at all; no relevant content is present.",
        "evidence_anchor": "not found",
        "material_alignment": "neutral",
        "placement_ok": True,
    }
    _, out, _ = grade_and_output(make_llm(grade=zero))
    assert [v["score"] for v in out["criteria_verdicts"]] == [0, 0]
    assert all(v["status"] == "missing" for v in out["criteria_verdicts"])
    assert out["assessment_status"] == "complete"
    assert out["total"] == 0 and out["partial_subtotal"] is None


def test_retry_failure_keeps_earlier_assessed_verdict():
    g1, _, _ = grade_and_output(make_llm())
    first = {v["criterion_id"]: v["score"] for v in g1["verdicts"]}
    st = state(verdicts=g1["verdicts"], loop_count=1)
    with patch.object(app_mod, "call_gemini", make_llm(all_fail=True)), \
            patch.object(app_mod, "_embed_sync", _embed_ok), \
            patch.object(app_mod, "get_supabase", return_value=FakeSB(GOOD_ROWS)):
        g2 = run(app_mod.run_grade(st))
    assert {v["criterion_id"]: v["score"] for v in g2["verdicts"]} == first


def test_retrieval_failures_do_not_penalize_or_inject_fallback_context():
    scores = {}
    for label, sb, embed in [
        ("infrastructure_error", FakeSB(GOOD_ROWS), _embed_fail),
        ("infrastructure_error", FakeSB(rpc_exc=RuntimeError("rpc 500")), _embed_ok),
        ("no_corpus", FakeSB([]), _embed_ok),
        ("no_useful_matches", FakeSB(LOW_ROWS), _embed_ok),
    ]:
        prompts: list[str] = []
        _, out, used = grade_and_output(make_llm(prompts=prompts), sb=sb, embed=embed)
        assert out["retrieval_status"] == label
        assert all(v["retrieval_status"] == label for v in out["criteria_verdicts"])
        # LLM said "contradicts"; without usable retrieval that must not stick.
        assert all(v["material_alignment"] == "neutral" for v in out["criteria_verdicts"])
        assert out["assessment_status"] == "complete"
        assert out["referenced_materials"] == []
        assert "course_material_chunks" not in used.tables  # no unranked fallback query
        for p in prompts:
            assert "Unrelated syllabus text" not in p and "Cross validation lecture notes" not in p
            assert "NOT evidence about the student" in p or "Set material_alignment='neutral'" in p
        scores.setdefault("all", set()).add(tuple(v["score"] for v in out["criteria_verdicts"]))
    assert len(scores["all"]) == 1, scores


def test_requires_reference_policy_is_opt_in():
    rubric = [dict(RUBRIC[0], evidence_policy="requires_reference"), dict(RUBRIC[1])]
    _, out, _ = grade_and_output(make_llm(), sb=FakeSB([]), st=state(rubric_criteria=rubric))
    v = by_id(out)
    assert v["c1"]["score"] is None and v["c1"]["failure_kind"] == "reference_unavailable"
    assert v["c2"]["score"] is not None  # submission-sufficient criterion still assessed
    assert out["assessment_status"] == "partial" and out["total"] is None


def test_ok_retrieval_uses_ranked_context():
    prompts: list[str] = []
    _, out, _ = grade_and_output(make_llm(prompts=prompts))
    assert out["retrieval_status"] == "ok"
    assert all("Cross validation lecture notes" in p for p in prompts)
