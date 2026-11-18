"""Resolve assessment policy in the documented order before grading."""

from __future__ import annotations

from typing import Any, Callable

from grading_server.assessment_policy.generate import (
    build_formative_policy,
    build_inferred_policy,
    build_points_anchored_policy,
    build_template_policy,
    generate_with_bounds,
)
from grading_server.assessment_policy.hashing import assignment_context_hash
from grading_server.assessment_policy.lookup import RubricLookupError, load_instructor_rubric
from grading_server.assessment_policy.store import PolicyStore, get_default_store
from grading_server.assessment_policy.types import AssessmentPolicy, PolicyResolution, RubricLookupResult


def resolve_assessment_policy(
    *,
    course_id: str,
    assignment_id: str,
    fetch_instructor_rubric: Callable[[], list[dict[str, Any]]],
    assignment_name: str = "",
    assignment_description: str = "",
    explicit_outcomes: list[str] | None = None,
    points_possible: float | None = None,
    approved_template_id: str | None = None,
    creation_config: dict[str, Any] | None = None,
    created_by: str | None = None,
    organization_id: str | None = None,
    lms_host: str | None = None,
    store: PolicyStore | None = None,
    # Intentionally unused — submission must never influence policy.
    submission_text: str | None = None,
) -> PolicyResolution:
    """
    Order:
      1. Existing instructor rubric
      2. Existing frozen fallback for this context version
      3. New inferred policy from assignment instructions/outcomes
      4. Points-anchored prompt policy (no rubric, but points + usable prompt)
      5. Approved template (if selected)
      6. Formative-only

    Genuine absence only enters fallback. Invalid rubric / lookup failure do not.
    """
    _ = submission_text  # explicit: never used for policy construction
    store = store or get_default_store()
    # Freeze identity is assignment context + protocol/template — not LLM provider.
    # A provider swap must not silently regenerate a frozen policy.
    raw_cfg = dict(creation_config or {})
    cfg = {
        "protocol": raw_cfg.get("protocol") or "policy-gen-v1",
        **({"template_id": raw_cfg["template_id"]} if raw_cfg.get("template_id") else {}),
    }

    try:
        lookup = load_instructor_rubric(fetch_rows=fetch_instructor_rubric)
    except RubricLookupError as e:
        return PolicyResolution(
            lookup=RubricLookupResult(
                status="rubric_lookup_failed",
                diagnostic=str(e),
            ),
            error_code="RUBRIC_STORE_UNAVAILABLE",
            error_message="The rubric store could not be read. No draft was produced; retry later.",
        )

    if lookup.status == "instructor_rubric_found":
        # Instructor rubric wins; wrap as metadata-only instructor origin without replacing rows.
        ctx_hash = assignment_context_hash(
            assignment_name=assignment_name,
            assignment_description=assignment_description,
            explicit_outcomes=explicit_outcomes,
            points_possible=points_possible,
        )
        instructor_meta = AssessmentPolicy(
            policy_id=f"instructor_{assignment_id}",
            version=1,
            content_hash=ctx_hash,
            course_id=str(course_id),
            assignment_id=str(assignment_id),
            origin="instructor",
            lifecycle="approved",
            assignment_context_hash=ctx_hash,
            assignment_context_version=ctx_hash[:16],
            criteria=[],
            maximum_score=None,
            weighting_mode="explicit",
            formative_only=False,
            disclosed_assumptions=[],
        )
        return PolicyResolution(
            lookup=lookup,
            policy=instructor_meta,
            rubric_criteria=list(lookup.criteria),
        )

    if lookup.status == "rubric_invalid":
        return PolicyResolution(
            lookup=lookup,
            error_code="RUBRIC_INVALID",
            error_message=(
                "An instructor rubric exists but is invalid/unusable. "
                "It was not replaced with a fallback. Fix or replace the rubric explicitly."
            ),
            require_instructor_decision=True,
        )

    # Genuine absence → fallback resolution
    assert lookup.status == "rubric_absent"
    ctx_hash = assignment_context_hash(
        assignment_name=assignment_name,
        assignment_description=assignment_description,
        explicit_outcomes=explicit_outcomes,
        points_possible=points_possible,
    )

    frozen = store.get_active(
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        context_hash=ctx_hash,
        gen_config=cfg,
    )
    if frozen is not None:
        return PolicyResolution(
            lookup=lookup,
            policy=frozen,
            rubric_criteria=frozen.to_rubric_rows(),
        )

    def _infer() -> AssessmentPolicy | None:
        return build_inferred_policy(
            course_id=str(course_id),
            assignment_id=str(assignment_id),
            assignment_name=assignment_name,
            assignment_description=assignment_description,
            explicit_outcomes=explicit_outcomes,
            points_possible=points_possible,
            creation_config=cfg,
            created_by=created_by,
            organization_id=organization_id,
            lms_host=lms_host,
        )

    inferred, infer_diag = generate_with_bounds(_infer)
    if inferred is not None:
        frozen = store.freeze(inferred, gen_config=cfg)
        return PolicyResolution(
            lookup=lookup,
            policy=frozen,
            rubric_criteria=frozen.to_rubric_rows(),
        )

    # No structured bullets, but assignment has points + a usable prompt/title.
    def _anchored() -> AssessmentPolicy | None:
        return build_points_anchored_policy(
            course_id=str(course_id),
            assignment_id=str(assignment_id),
            assignment_name=assignment_name,
            assignment_description=assignment_description,
            points_possible=points_possible,
            creation_config=cfg,
            created_by=created_by,
            organization_id=organization_id,
            lms_host=lms_host,
        )

    anchored, anchored_diag = generate_with_bounds(_anchored)
    if anchored is not None:
        frozen = store.freeze(anchored, gen_config={**cfg, "fallback": "points_anchored"})
        return PolicyResolution(
            lookup=lookup,
            policy=frozen,
            rubric_criteria=frozen.to_rubric_rows(),
        )
    infer_diag = anchored_diag or infer_diag

    if approved_template_id:
        def _tpl() -> AssessmentPolicy | None:
            return build_template_policy(
                template_id=approved_template_id,
                course_id=str(course_id),
                assignment_id=str(assignment_id),
                assignment_name=assignment_name,
                assignment_description=assignment_description,
                points_possible=points_possible,
                created_by=created_by,
                organization_id=organization_id,
                lms_host=lms_host,
            )

        tpl, tpl_diag = generate_with_bounds(_tpl)
        if tpl is not None:
            frozen = store.freeze(tpl, gen_config={**cfg, "template_id": approved_template_id})
            return PolicyResolution(
                lookup=lookup,
                policy=frozen,
                rubric_criteria=frozen.to_rubric_rows(),
            )
        infer_diag = tpl_diag or infer_diag

    formative = build_formative_policy(
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        assignment_name=assignment_name,
        assignment_description=assignment_description,
        diagnostic=infer_diag
        or "Assignment instructions were unavailable or too ambiguous for a scored policy.",
        created_by=created_by,
    )
    # Formative policies still freeze so concurrent runs share the same disclosure snapshot.
    frozen = store.freeze(formative, gen_config=cfg)
    lookup_insufficient = RubricLookupResult(
        status="assignment_context_insufficient",
        diagnostic=frozen.diagnostic,
    )
    return PolicyResolution(
        lookup=lookup_insufficient,
        policy=frozen,
        rubric_criteria=[],
    )


def _plain_submission_excerpt(submission_text: str, limit: int = 180) -> str:
    """Strip Canvas HTML chrome so formative evidence shows student prose."""
    import re

    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", submission_text or "")
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<link\b[^>]*>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "not found"
    return (text[:limit] + "…") if len(text) > limit else text


def formative_observation_verdicts(submission_text: str, policy: AssessmentPolicy) -> list[dict[str, Any]]:
    """Bounded formative observations — never an authoritative total."""
    text = _plain_submission_excerpt(submission_text, limit=10_000)
    length = len(text)
    has_structure = any(
        h in text.lower()
        for h in ("introduction", "method", "conclusion", "discussion", "result")
    )
    excerpt = _plain_submission_excerpt(text, limit=180)
    return [
        {
            "criterion_id": "formative_presence",
            "criterion_name": "Formative: response presence",
            "dimension": "content",
            "score": None,
            "max_score": 0,
            "status": "not_assessable",
            "failure_kind": None,
            "justification": (
                f"Observed ~{length} characters of submission text. "
                "No official score: assignment expectations were insufficient to form a scoring policy. "
                f"Policy diagnostic: {policy.diagnostic or 'n/a'}"
            ),
            "evidence_anchor": excerpt,
            "missing_keywords": [],
            "supporting_materials": [],
            "covered_concepts": [],
            "required_concepts": [],
            "ai_generated": False,
            "formative_only": True,
        },
        {
            "criterion_id": "formative_structure",
            "criterion_name": "Formative: structural cues",
            "dimension": "structure",
            "score": None,
            "max_score": 0,
            "status": "not_assessable",
            "failure_kind": None,
            "justification": (
                "Structural section cues "
                + ("appear present." if has_structure else "were not clearly detected.")
                + " This is a formative observation under a disclosed general framework, "
                "not a graded criterion."
            ),
            "evidence_anchor": "not found" if not has_structure else "section headings observed",
            "missing_keywords": [],
            "supporting_materials": [],
            "covered_concepts": [],
            "required_concepts": [],
            "ai_generated": False,
            "formative_only": True,
        },
    ]
