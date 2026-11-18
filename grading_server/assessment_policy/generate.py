"""Build assessment policies from assignment requirements or approved templates.

Never reads student submission content. Generation attempts are bounded.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from grading_server.assessment_policy.hashing import (
    assignment_context_hash,
    generation_config_key,
    policy_content_hash,
)
from grading_server.assessment_policy.requirements import (
    Requirement,
    assignment_text_to_plain,
    context_is_sufficient,
    extract_requirements,
    prompt_context_usable,
)
from grading_server.assessment_policy.templates import get_approved_template
from grading_server.assessment_policy.types import (
    DEFAULT_EQUAL_WEIGHT_LABEL,
    POLICY_GENERATION_PROTOCOL_VERSION,
    AssessmentPolicy,
    PerformanceDescriptor,
    PolicyCriterion,
    SourceExcerpt,
)
from grading_server.assessment_policy.validate import validate_policy

MAX_GENERATION_ATTEMPTS = 2

_DEFAULT_DESCRIPTORS = [
    PerformanceDescriptor(level="full", description="Fully addresses the requirement.", min_ratio=1.0),
    PerformanceDescriptor(level="partial", description="Partially addresses the requirement.", min_ratio=0.5),
    PerformanceDescriptor(level="missing", description="Does not address the requirement.", min_ratio=0.0),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _allocate_points(
    reqs: list[Requirement],
    points_possible: float | None,
) -> tuple[list[float], str, list[str]]:
    """Respect explicit points; otherwise equal split labeled as inferred."""
    assumptions: list[str] = []
    explicit = [r.explicit_points for r in reqs]
    if all(p is not None for p in explicit):
        pts = [float(p) for p in explicit]  # type: ignore[arg-type]
        mode = "explicit"
        if points_possible is not None and abs(sum(pts) - float(points_possible)) > 1e-9:
            assumptions.append(
                f"Explicit per-criterion points sum to {sum(pts)}; "
                f"assignment points_possible={points_possible} was not used to rescale."
            )
        return pts, mode, assumptions

    n = max(1, len(reqs))
    if points_possible is not None and float(points_possible) > 0:
        total = float(points_possible)
        # Exact equal split using floats — no integer truncation.
        each = total / n
        pts = [each] * n
        # Fix residual on last criterion to preserve exact total.
        pts[-1] = total - sum(pts[:-1])
        assumptions.append(
            f"Per-criterion points were not specified; equal split of {total} points "
            f"({DEFAULT_EQUAL_WEIGHT_LABEL})."
        )
        return pts, "inferred_equal", assumptions

    # No defensible maximum → caller should formative-only.
    return [], "none", ["No defensible maximum score; scored policy cannot be formed."]


def _criteria_from_requirements(
    reqs: list[Requirement],
    points: list[float],
    weighting_mode: str,
) -> list[PolicyCriterion]:
    criteria: list[PolicyCriterion] = []
    total = sum(points) or 1.0
    for req, mx in zip(reqs, points):
        if req.unsupported_flags:
            # Surface as disclosed non-scoring note via assumption; do not auto-penalize.
            continue
        provenance = "explicit_requirement" if req.explicit_points is not None else "inferred_interpretation"
        assumptions = []
        if provenance == "inferred_interpretation":
            assumptions.append(
                "Criterion text was derived from assignment instructions; not an instructor-authored rubric row."
            )
        w = float(mx) / float(total)
        criteria.append(
            PolicyCriterion(
                criterion_id=f"pol_{req.requirement_id}",
                title=(req.text[:80] + "…") if len(req.text) > 80 else req.text,
                description=req.text,
                source_requirement_ids=[req.requirement_id],
                source_excerpts=[
                    SourceExcerpt(
                        requirement_id=req.requirement_id,
                        excerpt=req.excerpt[:500],
                        location="unavailable",
                        content_hash=None,
                    )
                ],
                provenance=provenance,  # type: ignore[arg-type]
                max_points=float(mx),
                weight=w,
                performance_descriptors=list(_DEFAULT_DESCRIPTORS),
                evidence_policy="submission_sufficient",
                disclosed_assumptions=assumptions,
                dimension="content",
            )
        )
    return criteria


def build_inferred_policy(
    *,
    course_id: str,
    assignment_id: str,
    assignment_name: str = "",
    assignment_description: str = "",
    explicit_outcomes: list[str] | None = None,
    points_possible: float | None = None,
    creation_model: str | None = None,
    creation_config: dict[str, Any] | None = None,
    created_by: str | None = None,
    organization_id: str | None = None,
    lms_host: str | None = None,
) -> AssessmentPolicy | None:
    """
    Returns a draft inferred policy, or None if context is insufficient /
    no defensible scoring scale exists.
    """
    reqs, diag = extract_requirements(assignment_name, assignment_description, explicit_outcomes)
    # Drop unsupported mandatory style rules from scored set; keep diagnostic.
    scored = [r for r in reqs if not r.unsupported_flags]
    unsupported = [r for r in reqs if r.unsupported_flags]
    if unsupported:
        diag.append(
            "Unsupported mandatory formatting/citation requirements were flagged and excluded "
            "from automatic scoring."
        )
    if not context_is_sufficient(scored, assignment_description):
        return None

    points, wmode, wassumptions = _allocate_points(scored, points_possible)
    if wmode == "none" or not points:
        return None

    criteria = _criteria_from_requirements(scored, points, wmode)
    if not criteria:
        return None

    ctx_hash = assignment_context_hash(
        assignment_name=assignment_name,
        assignment_description=assignment_description,
        explicit_outcomes=explicit_outcomes,
        points_possible=points_possible,
    )
    cfg = dict(creation_config or {})
    cfg["generation_config_key"] = generation_config_key(cfg)
    body = {
        "criteria": [c.model_dump() for c in criteria],
        "maximum_score": float(sum(c.max_points for c in criteria)),
        "weighting_mode": wmode,
        "weighting_assumptions": wassumptions,
        "origin": "inferred",
        "assignment_context_hash": ctx_hash,
        "generation_protocol_version": POLICY_GENERATION_PROTOCOL_VERSION,
        "creation_config": cfg,
        "formative_only": False,
        "disclosed_assumptions": list(diag) + [
            "Policy was inferred from assignment instructions; it is not instructor-authored.",
        ],
        "source_document_versions": [f"assignment_description:{ctx_hash[:12]}"],
    }
    ch = policy_content_hash(body)
    policy = AssessmentPolicy(
        policy_id=f"ap_{uuid.uuid4().hex[:12]}",
        version=1,
        content_hash=ch,
        organization_id=organization_id,
        lms_host=lms_host,
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        origin="inferred",
        lifecycle="draft",
        assignment_context_hash=ctx_hash,
        assignment_context_version=ctx_hash[:16],
        source_document_versions=body["source_document_versions"],
        criteria=criteria,
        maximum_score=body["maximum_score"],
        weighting_mode=wmode,  # type: ignore[arg-type]
        weighting_assumptions=wassumptions,
        creation_model=creation_model or "deterministic-extractor",
        creation_config=cfg,
        created_by=created_by,
        created_at=_now(),
        formative_only=False,
        diagnostic="; ".join(diag) if diag else None,
        disclosed_assumptions=body["disclosed_assumptions"],
    )
    errs = validate_policy(policy)
    if errs:
        return None
    return policy


def build_points_anchored_policy(
    *,
    course_id: str,
    assignment_id: str,
    assignment_name: str = "",
    assignment_description: str = "",
    points_possible: float | None = None,
    creation_config: dict[str, Any] | None = None,
    created_by: str | None = None,
    organization_id: str | None = None,
    lms_host: str | None = None,
) -> AssessmentPolicy | None:
    """
    No-rubric fallback when structured requirements cannot be extracted, but the
    assignment has a defensible maximum score and a usable prompt/title.

    Builds a disclosed, equal-weight short-response style policy scaled to points.
    Never invents a total without points_possible.
    """
    if points_possible is None or float(points_possible) <= 0:
        return None
    if not prompt_context_usable(assignment_name, assignment_description):
        return None

    total = float(points_possible)
    name = (assignment_name or "").strip() or "Assignment prompt"
    plain = assignment_text_to_plain(assignment_description or "")
    prompt_excerpt = plain[:400] if plain else name

    # Two content criteria (understanding + support), equal split of assignment points.
    weights = (0.55, 0.45)
    pts = [round(total * w, 4) for w in weights]
    pts[-1] = round(total - sum(pts[:-1]), 4)

    specs = [
        (
            "pol_prompt_understanding",
            "Addresses the assignment prompt",
            f"Responds to the assignment prompt ({name}) with relevant concepts and coverage.",
            weights[0],
            pts[0],
        ),
        (
            "pol_prompt_support",
            "Support, clarity, and completeness",
            "Provides reasoning, examples, or detail sufficient for the points available.",
            weights[1],
            pts[1],
        ),
    ]

    assumptions = [
        "No instructor rubric was attached; structured requirements could not be extracted.",
        f"Scored criteria were synthesized from the assignment prompt and equal-weight split of {total:g} points.",
        "This policy is provisional and disclosed — not instructor-authored.",
    ]
    criteria: list[PolicyCriterion] = []
    for cid, title, desc, weight, mx in specs:
        # Unique source ids — validate_policy forbids one requirement scored by two criteria.
        src_id = f"prompt:{cid}"
        criteria.append(
            PolicyCriterion(
                criterion_id=cid,
                title=title,
                description=desc,
                source_requirement_ids=[src_id],
                source_excerpts=[
                    SourceExcerpt(
                        requirement_id=src_id,
                        excerpt=prompt_excerpt,
                        location="assignment_description" if plain else "assignment_name",
                    )
                ],
                provenance="inferred_interpretation",
                max_points=float(mx),
                weight=float(weight),
                performance_descriptors=list(_DEFAULT_DESCRIPTORS),
                evidence_policy="submission_sufficient",
                disclosed_assumptions=list(assumptions),
                dimension="content",
            )
        )

    ctx_hash = assignment_context_hash(
        assignment_name=assignment_name,
        assignment_description=assignment_description,
        points_possible=points_possible,
    )
    cfg = dict(creation_config or {})
    cfg["generation_config_key"] = generation_config_key(cfg)
    cfg["fallback"] = "points_anchored_short_response"
    body = {
        "criteria": [c.model_dump() for c in criteria],
        "maximum_score": total,
        "weighting_mode": "inferred_equal",
        "weighting_assumptions": assumptions,
        "origin": "inferred",
        "assignment_context_hash": ctx_hash,
        "generation_protocol_version": POLICY_GENERATION_PROTOCOL_VERSION,
        "creation_config": cfg,
        "formative_only": False,
        "disclosed_assumptions": assumptions,
        "source_document_versions": [f"assignment_prompt:{ctx_hash[:12]}"],
    }
    policy = AssessmentPolicy(
        policy_id=f"ap_{uuid.uuid4().hex[:12]}",
        version=1,
        content_hash=policy_content_hash(body),
        organization_id=organization_id,
        lms_host=lms_host,
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        origin="inferred",
        lifecycle="draft",
        assignment_context_hash=ctx_hash,
        assignment_context_version=ctx_hash[:16],
        source_document_versions=body["source_document_versions"],
        criteria=criteria,
        maximum_score=total,
        weighting_mode="inferred_equal",
        weighting_assumptions=assumptions,
        creation_model="points-anchored-fallback",
        creation_config=cfg,
        created_by=created_by,
        created_at=_now(),
        formative_only=False,
        diagnostic=(
            "Structured requirement extraction was insufficient; "
            "used points-anchored prompt policy."
        ),
        disclosed_assumptions=assumptions,
    )
    if validate_policy(policy):
        return None
    return policy


def build_template_policy(
    *,
    template_id: str,
    course_id: str,
    assignment_id: str,
    assignment_name: str = "",
    assignment_description: str = "",
    points_possible: float | None = None,
    created_by: str | None = None,
    organization_id: str | None = None,
    lms_host: str | None = None,
) -> AssessmentPolicy | None:
    tpl = get_approved_template(template_id)
    if not tpl:
        return None
    ctx_hash = assignment_context_hash(
        assignment_name=assignment_name,
        assignment_description=assignment_description,
        explicit_outcomes=[f"template:{template_id}"],
        points_possible=points_possible,
    )
    raw_pts = [float(c["max_points"]) for c in tpl["criteria"]]
    raw_total = sum(raw_pts) or 1.0
    if points_possible is not None and float(points_possible) > 0:
        scale = float(points_possible) / raw_total
        pts = [round(p * scale, 4) for p in raw_pts]
        pts[-1] = round(float(points_possible) - sum(pts[:-1]), 4)
        scale_note = f"Template weights scaled to assignment points_possible={float(points_possible):g}."
    else:
        pts = raw_pts
        scale_note = None
    assumptions = list(tpl["assumptions"])
    if scale_note:
        assumptions.append(scale_note)

    criteria: list[PolicyCriterion] = []
    maximum = float(sum(pts))
    for c, mx in zip(tpl["criteria"], pts):
        w = float(mx) / maximum if maximum else float(c["weight"])
        criteria.append(
            PolicyCriterion(
                criterion_id=c["criterion_id"],
                title=c["title"],
                description=c["description"],
                source_requirement_ids=[f"template:{template_id}"],
                source_excerpts=[
                    SourceExcerpt(
                        requirement_id=f"template:{template_id}",
                        excerpt=f"Approved template '{tpl['title']}' criterion: {c['title']}",
                        location="unavailable",
                    )
                ],
                provenance="template_assumption",
                max_points=float(mx),
                weight=w,
                performance_descriptors=list(_DEFAULT_DESCRIPTORS),
                evidence_policy="submission_sufficient",
                disclosed_assumptions=assumptions,
                dimension=c.get("dimension") or "content",
            )
        )
    body = {
        "criteria": [c.model_dump() for c in criteria],
        "maximum_score": maximum,
        "weighting_mode": "template",
        "weighting_assumptions": assumptions,
        "origin": "approved_template",
        "assignment_context_hash": ctx_hash,
        "generation_protocol_version": POLICY_GENERATION_PROTOCOL_VERSION,
        "creation_config": {"template_id": template_id},
        "formative_only": False,
        "disclosed_assumptions": assumptions,
        "source_document_versions": [f"approved_template:{template_id}"],
    }
    policy = AssessmentPolicy(
        policy_id=f"ap_{uuid.uuid4().hex[:12]}",
        version=1,
        content_hash=policy_content_hash(body),
        organization_id=organization_id,
        lms_host=lms_host,
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        origin="approved_template",
        lifecycle="draft",
        assignment_context_hash=ctx_hash,
        assignment_context_version=ctx_hash[:16],
        source_document_versions=body["source_document_versions"],
        criteria=criteria,
        maximum_score=maximum,
        weighting_mode="template",
        weighting_assumptions=assumptions,
        creation_model="approved_template",
        creation_config={"template_id": template_id},
        created_by=created_by,
        created_at=_now(),
        formative_only=False,
        disclosed_assumptions=assumptions,
    )
    if validate_policy(policy):
        return None
    return policy


def build_formative_policy(
    *,
    course_id: str,
    assignment_id: str,
    assignment_name: str = "",
    assignment_description: str = "",
    diagnostic: str | None = None,
    created_by: str | None = None,
) -> AssessmentPolicy:
    ctx_hash = assignment_context_hash(
        assignment_name=assignment_name,
        assignment_description=assignment_description,
    )
    assumptions = [
        "No defensible scored assessment policy could be formed from available assignment context.",
        "Feedback is formative only and does not invent an official assignment total.",
        "Provide clearer instructions, outcomes, points, or choose an approved template to enable scoring.",
    ]
    body = {
        "criteria": [],
        "maximum_score": None,
        "weighting_mode": "none",
        "weighting_assumptions": [],
        "origin": "formative",
        "assignment_context_hash": ctx_hash,
        "generation_protocol_version": POLICY_GENERATION_PROTOCOL_VERSION,
        "creation_config": {},
        "formative_only": True,
        "disclosed_assumptions": assumptions,
        "source_document_versions": [],
    }
    return AssessmentPolicy(
        policy_id=f"ap_{uuid.uuid4().hex[:12]}",
        version=1,
        content_hash=policy_content_hash(body),
        course_id=str(course_id),
        assignment_id=str(assignment_id),
        origin="formative",
        lifecycle="frozen_provisional",
        assignment_context_hash=ctx_hash,
        assignment_context_version=ctx_hash[:16],
        criteria=[],
        maximum_score=None,
        weighting_mode="none",
        creation_model="formative-framework",
        created_by=created_by,
        created_at=_now(),
        formative_only=True,
        diagnostic=diagnostic
        or "Assignment instructions were missing or too ambiguous for scored evaluation.",
        disclosed_assumptions=assumptions,
    )


def generate_with_bounds(
    builder: Callable[[], AssessmentPolicy | None],
    *,
    max_attempts: int = MAX_GENERATION_ATTEMPTS,
) -> tuple[AssessmentPolicy | None, str | None]:
    last_diag = None
    for _ in range(max(1, max_attempts)):
        try:
            policy = builder()
            if policy is not None:
                return policy, None
            last_diag = "Policy generation produced no defensible scored policy."
        except Exception as e:
            last_diag = f"Policy generation failed: {e}"
    return None, last_diag
