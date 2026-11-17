"""Approved task/subject templates. Assumptions are always disclosed."""

from __future__ import annotations

from typing import Any

# shortcut: small static catalog only; expand when instructors curate a DB catalog.
APPROVED_TEMPLATES: dict[str, dict[str, Any]] = {
    "short_response": {
        "template_id": "short_response",
        "title": "Short response",
        "assumptions": [
            "Template assumes a short written response demonstrating understanding of the prompt.",
            "Weights are template defaults, not assignment-specified.",
        ],
        "criteria": [
            {
                "criterion_id": "tpl_understanding",
                "title": "Understanding of the prompt",
                "description": "Addresses the asked question with relevant concepts.",
                "max_points": 5.0,
                "weight": 0.5,
                "dimension": "content",
            },
            {
                "criterion_id": "tpl_support",
                "title": "Support and clarity",
                "description": "Provides reasoning or examples that support the answer.",
                "max_points": 5.0,
                "weight": 0.5,
                "dimension": "content",
            },
        ],
    },
    "lab_report": {
        "template_id": "lab_report",
        "title": "Lab report",
        "assumptions": [
            "Template assumes methods, results, and discussion sections.",
            "Weights are template defaults, not assignment-specified.",
        ],
        "criteria": [
            {
                "criterion_id": "tpl_methods",
                "title": "Methods",
                "description": "Describes procedure clearly enough to understand what was done.",
                "max_points": 10.0,
                "weight": 0.4,
                "dimension": "content",
            },
            {
                "criterion_id": "tpl_results",
                "title": "Results",
                "description": "Reports findings with appropriate detail.",
                "max_points": 8.0,
                "weight": 0.3,
                "dimension": "content",
            },
            {
                "criterion_id": "tpl_discussion",
                "title": "Discussion",
                "description": "Interprets results and notes limitations.",
                "max_points": 7.0,
                "weight": 0.3,
                "dimension": "content",
            },
        ],
    },
}


def get_approved_template(template_id: str | None) -> dict[str, Any] | None:
    if not template_id:
        return None
    return APPROVED_TEMPLATES.get(str(template_id).strip())


def list_approved_templates() -> list[dict[str, Any]]:
    return [
        {"template_id": t["template_id"], "title": t["title"], "assumptions": list(t["assumptions"])}
        for t in APPROVED_TEMPLATES.values()
    ]
