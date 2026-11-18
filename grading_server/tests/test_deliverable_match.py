"""Wrong-deliverable detection and main-criterion zeroing."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.assessment_policy.deliverable_match import (
    apply_wrong_deliverable_to_verdicts,
    detect_wrong_deliverable,
    is_main_only_criterion,
)


def test_detects_alternative_filename_for_pipeline_assignment():
    result = detect_wrong_deliverable(
        submission_text="This is about making good choices up front without running code.",
        filenames=["Alternative_Assignment.docx"],
        assignment_name="Running the Pipeline",
        assignment_description="Execute the model evaluation pipeline and interpret results.",
    )
    assert result.wrong_deliverable is True
    assert result.teacher_note


def test_body_alternative_cues():
    result = detect_wrong_deliverable(
        submission_text=(
            "Alternative assignment: I chose the optional alternative. "
            "Not running code; conceptual outline only."
        ),
        filenames=["writeup.pdf"],
        assignment_name="Lab 3",
        assignment_description="Run the pipeline",
    )
    assert result.wrong_deliverable is True


def test_main_only_criterion_detection():
    assert is_main_only_criterion("Running the Pipeline", "")
    assert is_main_only_criterion("Model Evaluation", "Interpret outputs")
    assert not is_main_only_criterion("Writing Quality", "grammar and clarity")


def test_apply_zeros_main_only_leaves_others():
    verdicts = [
        {
            "criterion_id": "1",
            "criterion_name": "Running the Pipeline",
            "score": 8,
            "max_score": 10,
            "status": "full",
            "justification": "Executed steps.",
            "ai_generated": False,
        },
        {
            "criterion_id": "2",
            "criterion_name": "Writing Quality",
            "score": 4,
            "max_score": 5,
            "status": "partial",
            "justification": "Clear prose.",
            "ai_generated": False,
        },
        {
            "criterion_id": "ai",
            "criterion_name": "AI advisory",
            "score": 3,
            "max_score": 5,
            "status": "partial",
            "justification": "Advisory",
            "ai_generated": True,
        },
    ]
    out = apply_wrong_deliverable_to_verdicts(verdicts, wrong=True)
    main = next(v for v in out if v["criterion_id"] == "1")
    writing = next(v for v in out if v["criterion_id"] == "2")
    ai = next(v for v in out if v["criterion_id"] == "ai")
    assert main["score"] == 0.0 and main["status"] == "missing" and main.get("wrong_deliverable")
    assert writing["score"] == 4
    assert ai["score"] == 3
