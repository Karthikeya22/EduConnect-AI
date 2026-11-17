"""Offline demo conversations exercising real proposal/policy/job code with mocks."""

from __future__ import annotations

from typing import Any

from grading_server.copilot import store
from grading_server.copilot.engine import handle_turn
from grading_server.copilot.types import TurnRequest


DEMO_COURSE = "101"
DEMO_ASSIGNMENT = "canvas-assign-3"
DEMO_SUBMISSIONS = ["sub-elena", "sub-alex", "sub-sarah"]
DEMO_ACTOR = "demo-teacher-0001"


def _policy() -> dict[str, Any]:
    return {
        "policy_id": "pol_demo",
        "version": 1,
        "content_hash": "hash_demo_v1",
        "course_id": DEMO_COURSE,
        "assignment_id": DEMO_ASSIGNMENT,
        "origin": "instructor",
        "lifecycle": "approved",
        "assignment_context_hash": "ctx",
        "assignment_context_version": "1",
        "disclosed_assumptions": [],
        "criteria": [
            {
                "criterion_id": "grammar",
                "title": "Grammar",
                "description": "Standard grammar expectations.",
                "max_points": 5,
                "weight": 0.25,
                "provenance": "explicit_requirement",
                "disclosed_assumptions": [],
            },
            {
                "criterion_id": "content",
                "title": "Content",
                "description": "Content quality.",
                "max_points": 15,
                "weight": 0.75,
                "provenance": "explicit_requirement",
                "disclosed_assumptions": [],
            },
        ],
        "maximum_score": 20,
        "weighting_mode": "explicit",
    }


def run_demo(scenario: str) -> dict[str, Any]:
    store.reset_stores()
    policy_box: dict[str, Any] = {"p": _policy()}

    def policy_lookup(**_k: Any):
        return policy_box["p"]

    def policy_save(draft: dict, edited_by: str):
        cur = dict(draft)
        cur["version"] = int(policy_box["p"]["version"]) + 1
        cur["content_hash"] = f"hash_demo_v{cur['version']}"
        cur["created_by"] = edited_by
        policy_box["p"] = cur
        return cur

    originals = {
        sid: {
            "total_score": 12,
            "assessment_status": "complete",
            "score": 12,
            "verdicts": [],
        }
        for sid in DEMO_SUBMISSIONS
    }

    def grade_one(sid: str) -> dict[str, Any]:
        return {
            "total_score": 14,
            "score": 14,
            "assessment_status": "complete",
            "draft": True,
            "submission_id": sid,
            "publication_blocked": True,
        }

    def load_original(sid: str):
        return originals.get(sid)

    turns: list[dict[str, Any]] = []
    cid = None

    def step(text: str, **extra: Any):
        nonlocal cid
        req = TurnRequest(
            conversation_id=cid,
            text=text,
            course_id=DEMO_COURSE,
            assignment_id=DEMO_ASSIGNMENT,
            submission_id=extra.pop("submission_id", DEMO_SUBMISSIONS[0]),
            scope_kind=extra.pop("scope_kind", "assignment"),
            known_submission_ids=list(DEMO_SUBMISSIONS),
            **extra,
        )
        resp = handle_turn(
            req,
            actor_id=DEMO_ACTOR,
            policy_lookup=policy_lookup,
            policy_save=policy_save,
            grade_one=grade_one,
            load_original=load_original,
        )
        cid = resp.conversation_id
        turns.append(resp.model_dump())
        return resp

    if scenario == "1_liberal_grammar":
        step("Be liberal about grammar")
        step("Apply to this assignment only, grammar criterion")
        last = turns[-1]
        prop = last.get("proposal")
        if prop:
            step(
                "confirm",
                confirm_proposal_id=prop["proposal_id"],
                confirm_proposal_hash=prop["proposal_hash"],
                confirm_action="save_instruction",
            )
    elif scenario == "2_kinder_feedback":
        step("Make the feedback kinder")
        last = turns[-1]
        prop = last.get("proposal")
        if prop:
            assert prop.get("feedback_only") and not prop.get("scores_change")
            step(
                "yes",
                confirm_proposal_id=prop["proposal_id"],
                confirm_proposal_hash=prop["proposal_hash"],
                confirm_action="save_instruction",
            )
    elif scenario == "3_submission_exception":
        step(
            "Allow an exception for this submission only: late upload due to LMS outage",
            submission_id=DEMO_SUBMISSIONS[0],
            scope_kind="submission",
        )
        last = turns[-1]
        prop = last.get("proposal")
        if prop:
            step(
                "confirm",
                confirm_proposal_id=prop["proposal_id"],
                confirm_proposal_hash=prop["proposal_hash"],
                confirm_action="save_instruction",
                submission_id=DEMO_SUBMISSIONS[0],
            )
    elif scenario == "4_revoke":
        # seed then revoke
        step("Make the feedback kinder")
        prop = turns[-1]["proposal"]
        step(
            "confirm",
            confirm_proposal_id=prop["proposal_id"],
            confirm_proposal_hash=prop["proposal_hash"],
            confirm_action="save_instruction",
        )
        step("Revoke that remembered instruction")
        prop2 = turns[-1]["proposal"]
        step(
            "confirm",
            confirm_proposal_id=prop2["proposal_id"],
            confirm_proposal_hash=prop2["proposal_hash"],
            confirm_action="save_instruction",
        )
    elif scenario == "5_stale_or_unauthorized":
        step("Make the feedback kinder")
        prop = turns[-1]["proposal"]
        # Stale hash
        step(
            "yes",
            confirm_proposal_id=prop["proposal_id"],
            confirm_proposal_hash="deadbeef",
            confirm_action="save_instruction",
        )
        # Cross-course text
        step("Remember this for every course I teach")
    else:
        raise ValueError(f"Unknown demo scenario: {scenario}")

    return {
        "scenario": scenario,
        "turns": turns,
        "policy": policy_box["p"],
        "instructions": [
            i.model_dump()
            for i in store.list_active_instructions(
                course_id=DEMO_COURSE, assignment_id=DEMO_ASSIGNMENT
            )
        ],
    }


SCENARIOS = [
    "1_liberal_grammar",
    "2_kinder_feedback",
    "3_submission_exception",
    "4_revoke",
    "5_stale_or_unauthorized",
]
