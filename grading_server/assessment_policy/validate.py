"""Deterministic validation for instructor rubrics and generated policies."""

from __future__ import annotations

import re
from typing import Any

from grading_server.assessment_policy.types import AssessmentPolicy, PolicyCriterion

# Speculative style/citation rules we refuse to treat as mandatory without explicit text.
_UNSUPPORTED_MANDATORY = re.compile(
    r"\b(must\s+use\s+apa|exactly\s+\d+\s+citations?|minimum\s+of\s+\d+\s+citations?|"
    r"times\s+new\s+roman|double[\s-]?spaced|word\s+count\s+must)\b",
    re.I,
)


def _finite_number(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return v


def validate_instructor_rubric(rows: list[dict[str, Any]]) -> list[str]:
    """Return validation errors; empty list means usable."""
    errors: list[str] = []
    if not rows:
        return ["empty"]
    ids: set[str] = set()
    titles: set[str] = set()
    usable = 0
    for i, row in enumerate(rows):
        cid = str(row.get("criterion_id") or row.get("id") or "").strip()
        title = str(row.get("title") or row.get("description") or "").strip()
        mx = _finite_number(row.get("max_score", row.get("points")))
        if not cid:
            errors.append(f"row[{i}]: missing criterion_id")
        elif cid in ids:
            errors.append(f"row[{i}]: duplicate criterion_id {cid}")
        else:
            ids.add(cid)
        if not title:
            errors.append(f"row[{i}]: missing title/description")
        else:
            key = title.lower()
            if key in titles:
                errors.append(f"row[{i}]: duplicate title {title!r}")
            titles.add(key)
        if mx is None or mx <= 0:
            errors.append(f"row[{i}]: unusable max_score")
        else:
            usable += 1
        blob = f"{title} {row.get('description') or ''}"
        if _UNSUPPORTED_MANDATORY.search(blob):
            errors.append(
                f"row[{i}]: unsupported mandatory formatting/citation-style requirement "
                "(explicit instructor confirmation required)"
            )
    if usable == 0:
        errors.append("no usable scored criteria")
    return errors


def validate_policy(policy: AssessmentPolicy) -> list[str]:
    errors: list[str] = []
    if policy.formative_only:
        if policy.criteria:
            errors.append("formative_only policy must not include scored criteria")
        if policy.maximum_score is not None:
            errors.append("formative_only policy must not invent maximum_score")
        return errors

    if not policy.criteria:
        errors.append("policy has no criteria")
        return errors

    ids: set[str] = set()
    req_scored: dict[str, str] = {}
    weight_sum = 0.0
    points_sum = 0.0
    for c in policy.criteria:
        if c.criterion_id in ids:
            errors.append(f"duplicate criterion_id {c.criterion_id}")
        ids.add(c.criterion_id)
        if not c.title.strip() or not c.description.strip():
            errors.append(f"{c.criterion_id}: title/description required")
        if c.max_points <= 0:
            errors.append(f"{c.criterion_id}: max_points must be > 0")
        if not c.performance_descriptors:
            errors.append(f"{c.criterion_id}: performance descriptors required")
        points_sum += float(c.max_points)
        weight_sum += float(c.weight)
        for rid in c.source_requirement_ids:
            prev = req_scored.get(rid)
            if prev and prev != c.criterion_id:
                errors.append(
                    f"requirement {rid} scored by both {prev} and {c.criterion_id} without justification"
                )
            req_scored[rid] = c.criterion_id
        for ex in c.source_excerpts:
            if not ex.excerpt.strip():
                errors.append(f"{c.criterion_id}: empty source excerpt")
            if ex.location and ex.location not in ("unavailable",) and not str(ex.location).strip():
                errors.append(f"{c.criterion_id}: fabricated empty location")
        blob = f"{c.title} {c.description}"
        if c.provenance != "explicit_requirement" and _UNSUPPORTED_MANDATORY.search(blob):
            errors.append(f"{c.criterion_id}: unsupported speculative mandatory style/citation rule")
        if c.provenance != "explicit_requirement" and not c.disclosed_assumptions:
            errors.append(f"{c.criterion_id}: inferred criterion missing disclosed_assumptions")

    if policy.maximum_score is not None:
        # Allow tiny float tolerance; never silently rewrite maxima.
        if abs(float(policy.maximum_score) - points_sum) > 1e-9:
            errors.append(
                f"maximum_score {policy.maximum_score} != criteria sum {points_sum}"
            )
    if policy.weighting_mode != "none" and abs(weight_sum - 1.0) > 1e-6:
        errors.append(f"weights must sum to 1.0, got {weight_sum}")
    return errors


def flag_unsupported_requirements(text: str) -> list[str]:
    hits: list[str] = []
    for m in _UNSUPPORTED_MANDATORY.finditer(text or ""):
        hits.append(m.group(0))
    return hits
