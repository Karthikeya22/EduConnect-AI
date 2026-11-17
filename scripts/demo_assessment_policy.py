#!/usr/bin/env python
"""Offline demo: source-linked assignment-level fallback assessment policies.

Artificial fixtures + in-memory freeze store. No paid APIs, no Canvas writes,
no real student data.

Run from EduConnect-AI:
  set PYTHONPATH=.
  py scripts/demo_assessment_policy.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from grading_server.assessment_policy import reset_default_store, resolve_assessment_policy
from grading_server.assessment_policy.store import InMemoryPolicyStore


def _banner(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


CLEAR = (
    "Complete the design brief.\n"
    "- Identify the primary user need (5 points)\n"
    "- Propose one measurable success metric (5 points)\n"
    "- List two risks and mitigations (5 points)\n"
)


def demo_provisional_shared_policy():
    _banner("DEMO 1: Assignment without rubric → provisional policy shared by two submissions")
    reset_default_store()
    store = InMemoryPolicyStore()
    a = resolve_assessment_policy(
        course_id="11",
        assignment_id="9001",
        fetch_instructor_rubric=lambda: [],
        assignment_name="Design brief",
        assignment_description=CLEAR,
        points_possible=15,
        store=store,
        submission_text="Student A talks about onboarding friction and a retention metric.",
    )
    b = resolve_assessment_policy(
        course_id="11",
        assignment_id="9001",
        fetch_instructor_rubric=lambda: [],
        assignment_name="Design brief",
        assignment_description=CLEAR,
        points_possible=15,
        store=store,
        submission_text="Student B writes an unrelated poem about trees.",
    )
    print("origin:", a.policy.origin, "lifecycle:", a.policy.lifecycle)
    print("shared policy_id:", a.policy.policy_id, "==", b.policy.policy_id, "?", a.policy.policy_id == b.policy.policy_id)
    print("content_hash match:", a.policy.content_hash == b.policy.content_hash)
    print("criteria:")
    for c in a.policy.criteria:
        print(f"  - {c.criterion_id}: {c.title} ({c.max_points} pts, {c.provenance})")
        if c.source_excerpts:
            print(f"    source: {c.source_excerpts[0].excerpt[:100]!r}")
    print("label metadata:", a.policy.result_metadata()["policy_label"])


def demo_formative_ambiguous():
    _banner("DEMO 2: Ambiguous assignment → formative-only (no fabricated total)")
    reset_default_store()
    store = InMemoryPolicyStore()
    res = resolve_assessment_policy(
        course_id="11",
        assignment_id="9002",
        fetch_instructor_rubric=lambda: [],
        assignment_name="Homework",
        assignment_description="See Canvas.",
        store=store,
    )
    print("origin:", res.policy.origin, "formative_only:", res.policy.formative_only)
    print("maximum_score:", res.policy.maximum_score)
    print("diagnostic:", res.policy.diagnostic)
    print("assumptions:", res.policy.disclosed_assumptions)


def demo_approve_and_version_change():
    _banner("DEMO 3: Instructor approval + explicit version change")
    reset_default_store()
    store = InMemoryPolicyStore()
    res = resolve_assessment_policy(
        course_id="11",
        assignment_id="9003",
        fetch_instructor_rubric=lambda: [],
        assignment_name="Design brief",
        assignment_description=CLEAR,
        points_possible=15,
        store=store,
    )
    approved = store.approve(res.policy.policy_id, res.policy.version, approved_by="instructor_demo")
    print("approved lifecycle:", approved.lifecycle, "by:", approved.approved_by)
    edited = approved.model_copy(
        update={
            "disclosed_assumptions": list(approved.disclosed_assumptions)
            + ["Instructor raised methods weight in a new version."],
            "criteria": [
                c.model_copy(update={"max_points": (6.0 if i == 0 else c.max_points)})
                for i, c in enumerate(approved.criteria)
            ],
        }
    )
    # Keep weights consistent enough for demo; re-sum maximum.
    edited = edited.model_copy(
        update={"maximum_score": float(sum(c.max_points for c in edited.criteria))}
    )
    from grading_server.assessment_policy.hashing import policy_content_hash

    edited = edited.model_copy(update={"content_hash": policy_content_hash(edited.model_dump())})
    new_p = store.save_new_version(approved, edited, edited_by="instructor_demo")
    print("new version:", new_p.version, "lifecycle:", new_p.lifecycle)
    print("old approved remains distinct content_hash?", approved.content_hash != new_p.content_hash)
    print(
        json.dumps(
            {
                "example_policy_id": new_p.policy_id,
                "version": new_p.version,
                "origin": new_p.origin,
                "criteria": [
                    {
                        "id": c.criterion_id,
                        "title": c.title,
                        "max_points": c.max_points,
                        "source_requirement_ids": c.source_requirement_ids,
                        "excerpt": c.source_excerpts[0].excerpt if c.source_excerpts else None,
                    }
                    for c in new_p.criteria
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    demo_provisional_shared_policy()
    demo_formative_ambiguous()
    demo_approve_and_version_change()
    print("\nDone. Simulated offline behavior only — not paper accuracy results.")
