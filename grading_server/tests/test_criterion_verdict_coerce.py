"""LLM often returns concept lists as a single comma-separated string — coerce to list[str]."""
from grading_server.models import CriterionVerdict


def _base(**overrides):
    payload = {
        "criterion_id": "c1",
        "criterion_name": "Running the Pipeline",
        "dimension": "content",
        "score": 4,
        "max_score": 5,
        "status": "partial",
        "justification": "Student covered core steps.",
        "evidence_anchor": "choosing a task",
    }
    payload.update(overrides)
    return payload


def test_covered_concepts_string_is_split_into_list():
    v = CriterionVerdict(
        **_base(
            covered_concepts="choosing a task, constructing the pipeline, proposing a next step"
        )
    )
    assert v.covered_concepts == [
        "choosing a task",
        "constructing the pipeline",
        "proposing a next step",
    ]


def test_required_concepts_and_missing_keywords_strings_coerce():
    v = CriterionVerdict(
        **_base(
            required_concepts="accuracy, recall",
            missing_keywords="baseline",
            supporting_materials="Lecture 3 slides",
        )
    )
    assert v.required_concepts == ["accuracy", "recall"]
    assert v.missing_keywords == ["baseline"]
    assert v.supporting_materials == ["Lecture 3 slides"]


def test_list_inputs_pass_through():
    v = CriterionVerdict(**_base(covered_concepts=["a", "b"]))
    assert v.covered_concepts == ["a", "b"]


def test_proposal_filter_does_not_split_string_into_characters():
    from grading_server.app import _filter_proposal_missing_keywords

    filtered = _filter_proposal_missing_keywords(
        "Data Pre-Processing, algorithms, Data Splitting",
        True,
    )
    assert "algorithms" in filtered
    assert filtered == ["algorithms"]
    assert not any(len(x) == 1 for x in filtered)
