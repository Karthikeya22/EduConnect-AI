"""Distinguish instructor-rubric absence from lookup failure / invalid rows."""

from __future__ import annotations

from typing import Any, Callable

from grading_server.assessment_policy.types import RubricLookupResult
from grading_server.assessment_policy.validate import validate_instructor_rubric


class RubricLookupError(RuntimeError):
    """Database/authorization failure while reading rubric_criteria — not absence."""


def classify_rubric_rows(rows: list[dict[str, Any]] | None) -> RubricLookupResult:
    rows = list(rows or [])
    if not rows:
        return RubricLookupResult(status="rubric_absent", criteria=[], diagnostic="No instructor rubric rows.")
    errors = validate_instructor_rubric(rows)
    # "empty" only from validate when rows falsy — not here.
    fatal = [e for e in errors if e != "empty"]
    if fatal:
        return RubricLookupResult(
            status="rubric_invalid",
            criteria=rows,
            diagnostic="Instructor rubric exists but is unusable.",
            validation_errors=fatal,
        )
    return RubricLookupResult(status="instructor_rubric_found", criteria=rows)


def load_instructor_rubric(
    *,
    fetch_rows: Callable[[], list[dict[str, Any]]],
) -> RubricLookupResult:
    """
    fetch_rows must raise on infrastructure/auth failure.
    Successful empty list => genuine absence.
    """
    try:
        rows = fetch_rows()
    except Exception as e:
        raise RubricLookupError(str(e)) from e
    if rows is None:
        raise RubricLookupError("rubric query returned None")
    return classify_rubric_rows(list(rows))
