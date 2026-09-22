"""Unit tests for stricter grading guards (no Gemini / network)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.app import (
    _analyze_genre_signals,
    _apply_genre_criterion_caps,
    _apply_verdict_score_guards,
    _criterion_section_hint,
    _dedupe_overlapping_ai_penalties,
    _detect_submission_genre,
    _evidence_anchor_in_submission,
    _extract_submission_sections,
    _filter_proposal_missing_keywords,
    _genre_grading_guide,
    _holistic_consistency_nudge,
    _is_proposal_style_submission,
    _resolve_section_for_criterion,
)


def test_evidence_missing_caps_score():
    v = _apply_verdict_score_guards(
        {
            "score": 10,
            "status": "full",
            "evidence_anchor": "not found",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
        },
        10,
    )
    assert v["status"] == "partial"
    assert v["score"] <= 5
    assert v.get("ungrounded_full") is True


def test_partial_cannot_keep_max():
    v = _apply_verdict_score_guards(
        {
            "score": 10,
            "status": "partial",
            "evidence_anchor": "Student discussed methodology in detail here.",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
        },
        10,
    )
    assert v["status"] == "partial"
    assert v["score"] == 9


def test_contradiction_caps_score():
    v = _apply_verdict_score_guards(
        {
            "score": 10,
            "status": "full",
            "evidence_anchor": "We used a sample size of one million.",
            "required_concepts": [],
            "covered_concepts": [],
            "material_alignment": "contradicts",
            "placement_ok": True,
        },
        10,
    )
    assert v["status"] == "partial"
    assert v["score"] <= 6


def test_concept_coverage_caps_full_marks():
    v = _apply_verdict_score_guards(
        {
            "score": 10,
            "status": "full",
            "evidence_anchor": "A reasonably long evidence quote from the student submission text.",
            "required_concepts": ["A", "B", "C", "D"],
            "covered_concepts": ["A"],
            "material_alignment": "neutral",
            "placement_ok": True,
        },
        10,
    )
    # hit=1/4=0.25, but evidenced answers use floor 0.50 → ceil(10*0.50)=5
    assert v["score"] <= 5
    assert v["score"] >= 5 or "concept coverage" in (v.get("justification") or "").lower()


def test_section_extraction_and_hint():
    text = (
        "# Introduction\n"
        "This paper studies X.\n\n"
        "# Methods\n"
        "We surveyed 50 users.\n\n"
        "# Discussion\n"
        "Results suggest Y.\n"
    )
    sections = _extract_submission_sections(text)
    titles = [s["title"].lower() for s in sections]
    assert any("introduction" in t for t in titles)
    assert any("methods" in t for t in titles)

    hint = _criterion_section_hint("Methods & Approach", "Describe methodology")
    assert hint == "methodology" or hint == "methods"
    matched = _resolve_section_for_criterion(sections, "methods")
    assert matched is not None
    assert "surveyed" in matched["body"].lower()


def test_holistic_nudge_reduces_all_full_thin():
    verdicts = [
        {
            "criterion_id": "c1",
            "score": 5,
            "max_score": 5,
            "status": "full",
            "evidence_anchor": "short",
            "justification": "ok",
            "ai_generated": False,
        },
        {
            "criterion_id": "c2",
            "score": 5,
            "max_score": 5,
            "status": "full",
            "evidence_anchor": "tiny",
            "justification": "ok",
            "ai_generated": False,
        },
        {
            "criterion_id": "c3",
            "score": 5,
            "max_score": 5,
            "status": "full",
            "evidence_anchor": "hi",
            "justification": "ok",
            "ai_generated": False,
        },
    ]
    out, flagged = _holistic_consistency_nudge(verdicts)
    assert flagged is True
    assert all(v["score"] < v["max_score"] for v in out)


def test_detect_research_paper_from_context_and_text():
    text = (
        "# Abstract\nStudy of X.\n"
        "# Introduction\nBackground.\n"
        "# Methods\nSurvey.\n"
        "# Results\nFindings.\n"
        "# Discussion\nMeaning.\n"
        "# References\nSmith, J. (2020). Title.\n"
    )
    genre = _detect_submission_genre(
        ["paper.pdf"],
        text,
        "Assignment: Write a research paper with APA citations",
    )
    assert genre == "research_paper"
    sections = _extract_submission_sections(text)
    signals = _analyze_genre_signals(genre, text + "\n(Smith, 2020)\n", sections)
    assert signals["has_references"] is True
    guide = _genre_grading_guide(genre, signals, "structure")
    assert "citation" in guide.lower() or "References" in guide


def test_detect_presentation_and_code():
    assert _detect_submission_genre(["deck.pptx"], "Slide 1\nIntro", "Create a presentation") == "presentation"
    assert _detect_submission_genre(["main.py"], "def foo():\n    return 1\n", "Programming homework") == "code"
    assert _detect_submission_genre(["analysis.ipynb"], "# cell\n", "Jupyter notebook lab") == "notebook"
    assert _detect_submission_genre(["report.docx"], "Executive summary\n", "Submit a Word report") == "document"


def test_genre_cap_weak_citations():
    v = {
        "score": 10,
        "max_score": 10,
        "status": "full",
        "evidence_anchor": "Students mentioned some sources in the introduction paragraph here.",
        "required_concepts": [],
        "covered_concepts": [],
        "material_alignment": "neutral",
        "placement_ok": True,
        "justification": "Looks fine",
    }
    signals = {
        "has_references": False,
        "in_text_citation_count": 0,
        "canonical_section_count": 1,
        "section_count": 1,
    }
    out = _apply_genre_criterion_caps(
        dict(v),
        "research_paper",
        signals,
        "Citations & References",
        "Use APA in-text citations and a References section",
    )
    assert out["score"] <= 4
    assert out["status"] == "partial"


def test_extract_sections_from_plain_title_case_paper():
    """Word List Paragraph titles arrive as plain lines — must still become sections."""
    text = (
        "Introduction\n"
        "This paper studies explainable AI for credit decisions.\n\n"
        "Literature Review\n"
        "Prior work on random forests and LIME is reviewed here.\n\n"
        "AI Solution\n"
        "We propose a random forest classifier with LIME explanations.\n\n"
        "Methodology\n"
        "We trained models and compared accuracy across three stages.\n\n"
        "Ethical Considerations\n"
        "LIME helps auditors understand biased predictions fairly.\n\n"
        "Results\n"
        "Accuracy progressed from 69% to 61% to 92% across models.\n\n"
        "Challenges and Solutions\n"
        "Class imbalance was addressed with resampling.\n\n"
        "Conclusion\n"
        "The approach improves transparency for academic integrity.\n"
    )
    sections = _extract_submission_sections(text)
    titles = " | ".join(s["title"].lower() for s in sections)
    for needed in (
        "introduction",
        "literature review",
        "ai solution",
        "methodology",
        "ethical",
        "results",
        "challenges",
        "conclusion",
    ):
        assert needed in titles, f"missing section '{needed}' in: {titles}"

    ethical = _resolve_section_for_criterion(sections, "ethical considerations")
    assert ethical is not None
    assert "lime helps auditors" in ethical["body"].lower()
    assert "accuracy progressed" not in ethical["body"].lower()


def test_placement_cap_skipped_when_section_map_unreliable():
    """Do not hard-cap 'misplaced' when we failed to parse a usable section map."""
    v = _apply_verdict_score_guards(
        {
            "score": 18,
            "status": "full",
            "evidence_anchor": "LIME helps auditors understand biased predictions fairly in this study.",
            "required_concepts": ["ethics", "bias", "transparency"],
            "covered_concepts": ["ethics", "bias", "transparency"],
            "material_alignment": "neutral",
            "placement_ok": False,
            "placement_issue": True,
            "section_map_reliable": False,
        },
        20,
    )
    # Without a reliable section map, placement must not crush a well-evidenced score.
    assert v["score"] >= 16
    assert "misplaced" not in (v.get("justification") or "").lower()


def test_concept_coverage_with_evidence_uses_gentler_floor():
    """LLM-omitted covered_concepts should not near-zero a grounded criterion."""
    v = _apply_verdict_score_guards(
        {
            "score": 18,
            "status": "full",
            "evidence_anchor": "Accuracy progressed from 69% to 61% to 92% across models in results.",
            "required_concepts": ["accuracy", "random forest", "lime", "baseline"],
            "covered_concepts": [],  # model forgot to fill despite quoting results
            "material_alignment": "neutral",
            "placement_ok": True,
            "submission_text": (
                "We used a random forest and LIME. Accuracy progressed from 69% to 61% to 92% "
                "across models versus the baseline."
            ),
        },
        20,
    )
    assert v["score"] >= 14


def test_evidence_anchor_accepts_near_verbatim_quote():
    from grading_server.app import _evidence_anchor_in_submission

    sub = (
        "Hasanov et al. (2021) showed that adaptive learning systems improve retention. "
        "Tang and Hew (2022) similarly argue for learner-centered AI."
    )
    # LLM often tweaks punctuation / spacing
    anchor = "Hasanov et al. (2021) showed that adaptive learning systems improve retention"
    assert _evidence_anchor_in_submission(anchor, sub) is True
    # Light paraphrase + citation fingerprint should still count as grounded
    paraphrase = "Hasanov et al. (2021) showed adaptive learning improves retention in online courses."
    assert _evidence_anchor_in_submission(paraphrase, sub) is True
    assert _evidence_anchor_in_submission("Totally fabricated quote about Mars colonies.", sub) is False


def test_praise_with_zero_llm_score_is_reconciled_upward():
    """status=missing + glowing justification must not remain 0 when evidence exists."""
    v = _apply_verdict_score_guards(
        {
            "score": 0,
            "status": "missing",
            "criterion_name": "Introduction",
            "evidence_anchor": "We propose a random forest classifier with LIME explanations for credit decisions.",
            "required_concepts": ["problem statement", "significance", "proposed approach", "scope"],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The introduction is comprehensive and well-articulated; it fully addresses the "
                "criterion by framing the problem, significance, and proposed AI approach."
            ),
            "submission_text": (
                "Introduction\nWe propose a random forest classifier with LIME explanations for "
                "credit decisions. This addresses fairness and transparency at scale."
            ),
        },
        3,
    )
    assert v["score"] >= 2
    assert v["status"] != "missing"


def test_academic_integrity_not_crushed_by_citation_genre_cap():
    v = {
        "score": 4,
        "max_score": 4,
        "status": "full",
        "criterion_name": "Academic Integrity (AI-Generated)",
        "evidence_anchor": "I used AI only to polish wording and disclose that use here.",
        "required_concepts": [],
        "covered_concepts": [],
        "material_alignment": "neutral",
        "placement_ok": True,
        "justification": (
            "The student disclosed AI use for wording only, aligning with the rubric's leniency "
            "clause, and there is no evidence of plagiarism."
        ),
        "submission_text": (
            "Disclosure: I used AI only to polish wording and disclose that use here. "
            "All analysis and claims are my own."
        ),
    }
    signals = {
        "has_references": False,
        "in_text_citation_count": 0,
        "canonical_section_count": 5,
        "section_count": 8,
    }
    # Simulate the real path: guards first, then genre caps
    guarded = _apply_verdict_score_guards(dict(v), 4)
    out = _apply_genre_criterion_caps(
        guarded,
        "research_paper",
        signals,
        "Academic Integrity (AI-Generated)",
        "Assess citation integrity and AI disclosure / plagiarism risk",
    )
    assert out["score"] >= 3
    assert "Genre cap: research-paper citation" not in (out.get("justification") or "")


def test_praise_justification_not_zeroed_by_empty_concept_lists():
    v = _apply_verdict_score_guards(
        {
            "score": 6,
            "status": "full",
            "evidence_anchor": "We propose a random forest classifier with LIME explanations for credit decisions.",
            "required_concepts": ["problem statement", "significance", "proposed approach", "scope"],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The introduction is comprehensive and well-articulated; it fully addresses the "
                "criterion by framing the problem, significance, and proposed AI approach."
            ),
            "submission_text": (
                "Introduction\nWe propose a random forest classifier with LIME explanations for "
                "credit decisions. This addresses fairness and transparency at scale."
            ),
        },
        6,
    )
    assert v["score"] >= 4


def test_full_credit_narrative_not_demoted_by_empty_concept_graph():
    """'Meets all requirements' must not become a concept-coverage zero-cap."""
    v = _apply_verdict_score_guards(
        {
            "score": 4,
            "status": "full",
            "criterion_name": "Literature Review",
            "evidence_anchor": "Hasanov et al. (2021) showed that adaptive learning systems improve retention.",
            "required_concepts": ["gap analysis", "theoretical framing", "prior interventions", "synthesis"],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The literature review comprehensively and effectively reviews relevant literature, "
                "meeting all requirements of the rubric criterion."
            ),
            "submission_text": (
                "Literature Review\nHasanov et al. (2021) showed that adaptive learning systems "
                "improve retention. Tang and Hew (2022) argue for learner-centered AI."
            ),
        },
        4,
    )
    assert v["score"] == 4
    assert v["status"] == "full"
    assert "concept" not in (v.get("justification") or "").lower() or "0/4" not in (v.get("justification") or "")


def test_critical_expected_outcomes_not_falsely_reconciled_upward():
    v = _apply_verdict_score_guards(
        {
            "score": 1,
            "status": "partial",
            "criterion_name": "Expected Outcomes/Results",
            "evidence_anchor": "Results show random forest accuracy reached 92% on the held-out test set.",
            "required_concepts": ["expected outcomes"],
            "covered_concepts": [],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The student's paper includes a Results section that comprehensively presents the "
                "actual findings. However, it completely omits any discussion of anticipated or "
                "expected outcomes and does not fulfill the requirement of this specific criterion."
            ),
            "submission_text": (
                "Results\nResults show random forest accuracy reached 92% on the held-out test set."
            ),
        },
        8,
    )
    assert v["score"] <= 4
    assert "reconciled upward" not in (v.get("justification") or "").lower()


def test_positive_expected_outcomes_not_concept_capped_to_70_percent():
    """Glowing Expected Outcomes write-up must not be floored to 14/20 by concept match."""
    v = _apply_verdict_score_guards(
        {
            "score": 20,
            "status": "full",
            "criterion_name": "Expected Outcomes/Results",
            "evidence_anchor": "We expect the pilot to reduce false negatives by about 15% versus the baseline tutor.",
            "required_concepts": ["expected outcomes", "metrics", "preliminary work", "hypotheses"],
            "covered_concepts": ["expected outcomes", "metrics"],
            "material_alignment": "neutral",
            "placement_ok": True,
            "justification": (
                "The section is comprehensive, specific, and well-articulated. Outcomes are based on "
                "research and preliminary work as required by the assignment."
            ),
            "submission_text": (
                "Expected Outcomes\nWe expect the pilot to reduce false negatives by about 15% versus "
                "the baseline tutor, based on preliminary prototype runs."
            ),
        },
        20,
    )
    assert v["score"] >= 18
    assert "concept match rate" not in (v.get("justification") or "").lower()


def test_ai_methodology_does_not_double_penalize_rubric_methodology():
    verdicts = [
        {
            "criterion_name": "Methodology",
            "score": 13,
            "max_score": 20,
            "status": "partial",
            "ai_generated": False,
            "justification": "Largely omits specific algorithms, models, or software used.",
        },
        {
            "criterion_name": "Methodology Soundness and Rigor (AI-Generated)",
            "score": 10,
            "max_score": 20,
            "status": "partial",
            "ai_generated": True,
            "justification": "Largely omits specific algorithms, models, or software used to develop/implement.",
        },
    ]
    out = _dedupe_overlapping_ai_penalties(verdicts)
    ai = next(v for v in out if v.get("ai_generated"))
    assert ai["score"] == 20
    assert ai["status"] == "full"


def test_proposal_filters_empirical_missing_keywords():
    text = (
        "We propose a conceptual framework for adaptive tutoring. A pilot evaluation is planned "
        "for next semester; the proposed system will later be implemented."
    )
    assert _is_proposal_style_submission(text, "Write a project proposal") is True
    filtered = _filter_proposal_missing_keywords(
        ["Data Pre-Processing", "algorithms", "Data Splitting", "Supervised Technique"],
        True,
    )
    assert "algorithms" in filtered
    assert not any("split" in str(x).lower() or "supervised" in str(x).lower() or "pre-process" in str(x).lower() for x in filtered)


def test_docx_heading_and_list_paragraph_titles_become_markdown():
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    import io
    from grading_server.utils.file_parsers import _parse_docx

    doc = Document()
    # Ensure List Paragraph exists
    styles = doc.styles
    try:
        styles["List Paragraph"]
    except KeyError:
        styles.add_style("List Paragraph", WD_STYLE_TYPE.PARAGRAPH)

    doc.add_paragraph("Introduction", style="Heading 1")
    doc.add_paragraph("This paper studies explainable AI.")
    p = doc.add_paragraph("Ethical Considerations")
    p.style = styles["List Paragraph"]
    run = p.runs[0] if p.runs else p.add_run("Ethical Considerations")
    run.bold = True
    doc.add_paragraph("We discuss fairness and disclosure.")
    doc.add_paragraph("Results", style="Heading 1")
    doc.add_paragraph("Accuracy reached 92%.")

    buf = io.BytesIO()
    doc.save(buf)
    text = _parse_docx(buf.getvalue(), api_key=None)
    assert re_search_heading(text, "Introduction")
    assert re_search_heading(text, "Ethical Considerations")
    assert re_search_heading(text, "Results")

    sections = _extract_submission_sections(text)
    ethical = _resolve_section_for_criterion(sections, "ethical considerations")
    assert ethical is not None
    assert "fairness" in ethical["body"].lower()


def re_search_heading(text: str, title: str) -> bool:
    import re
    pat = r"(?im)^(?:#+\s*)?" + re.escape(title) + r"\s*$"
    return bool(re.search(pat, text))


if __name__ == "__main__":
    test_evidence_missing_caps_score()
    test_partial_cannot_keep_max()
    test_contradiction_caps_score()
    test_concept_coverage_caps_full_marks()
    test_section_extraction_and_hint()
    test_holistic_nudge_reduces_all_full_thin()
    test_detect_research_paper_from_context_and_text()
    test_detect_presentation_and_code()
    test_genre_cap_weak_citations()
    test_extract_sections_from_plain_title_case_paper()
    test_placement_cap_skipped_when_section_map_unreliable()
    test_concept_coverage_with_evidence_uses_gentler_floor()
    test_evidence_anchor_accepts_near_verbatim_quote()
    test_praise_with_zero_llm_score_is_reconciled_upward()
    test_academic_integrity_not_crushed_by_citation_genre_cap()
    test_praise_justification_not_zeroed_by_empty_concept_lists()
    test_full_credit_narrative_not_demoted_by_empty_concept_graph()
    test_critical_expected_outcomes_not_falsely_reconciled_upward()
    test_positive_expected_outcomes_not_concept_capped_to_70_percent()
    test_ai_methodology_does_not_double_penalize_rubric_methodology()
    test_proposal_filters_empirical_missing_keywords()
    test_docx_heading_and_list_paragraph_titles_become_markdown()
    print("OK: all strict grading guard tests passed")
