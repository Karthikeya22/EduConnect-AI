"""Deterministic intent + clarification (no silent policy mutation).

Models may later propose tool args; server still validates. This module keeps
offline demos and tests free of paid LLM calls.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from grading_server.copilot.types import IntentType, ScopeKind

_LIBERAL = re.compile(r"\b(be\s+liberal|more\s+lenient|go\s+easy|grade\s+easier)\b", re.I)
_KINDER_A = re.compile(
    r"\b(make\s+(the\s+)?feedback\s+(kinder|gentler|softer|nicer|warmer)|"
    r"(kinder|gentler|softer|nicer|warmer)\s+feedback|"
    r"feedback\s+(tone\s+)?(kinder|gentler|softer|nicer|warmer)|"
    r"tone\s+down\s+(the\s+)?feedback)\b",
    re.I,
)
_REMEMBER = re.compile(r"\b(remember\s+(this|that)|save\s+(this\s+)?(preference|instruction)|persist)\b", re.I)
_REVOKE_A = re.compile(
    r"\b((revoke|forget|delete|remove)\b.*\b(instruction|preference|memory)|"
    r"(revoke|forget)\s+(it|this|that)|stop\s+remembering)\b",
    re.I,
)
_INSPECT = re.compile(r"\b(show|list|inspect|what)\b.*\b(remembered|instruction|preference|memory)\b", re.I)
_EXPLAIN = re.compile(r"\b(explain|why)\b.*\b(grade|score|criterion|points)\b", re.I)
_EXCEPTION = re.compile(
    r"\b(exception|excuse|allow\s+late|this\s+student\s+only|only\s+this\s+submission)\b", re.I
)
_OVERRIDE = re.compile(r"\b(override|set\s+score\s+to|give\s+(them|him|her|this\s+student)\s+\d+)\b", re.I)
_POLICY = re.compile(
    r"\b(change\s+(the\s+)?(rubric|policy|scoring|weights?)|reinterpret|interpretation|"
    r"criterion\s+\w+\s+should)\b",
    re.I,
)
_REGRADE = re.compile(r"\b(regrade|preview\s+regrade|run\s+draft|apply\s+to\s+(all|everyone))\b", re.I)
_EVERYONE = re.compile(r"\b(everyone|all\s+students|class[- ]?wide|whole\s+class|entire\s+assignment)\b", re.I)
_THIS_COURSE = re.compile(r"\b(this\s+course|course[- ]?wide|all\s+assignments)\b", re.I)
_CROSS_COURSE = re.compile(r"\b(all\s+courses|every\s+course|across\s+courses|other\s+courses)\b", re.I)
_GRAMMAR = re.compile(r"\b(grammar|mechanics|writing\s+quality|spelling)\b", re.I)
_INJECTION = re.compile(
    r"(ignore\s+(previous|all)\s+instructions|you\s+are\s+now|system\s+prompt|"
    r"as\s+the\s+teacher\s+I\s+command|create\s+a\s+teacher\s+instruction)",
    re.I,
)


@dataclass
class ParsedIntent:
    intent: IntentType
    needs_clarification: bool = False
    clarification: Optional[str] = None
    suggested_scope: Optional[ScopeKind] = None
    criterion_hint: Optional[str] = None
    scores_change: bool = False
    feedback_only: bool = False
    remember: bool = False
    want_regrade: bool = False
    cross_course: bool = False
    injection_suspected: bool = False
    notes: list[str] = field(default_factory=list)


def parse_teacher_text(text: str, *, scope_kind: ScopeKind, has_submission: bool) -> ParsedIntent:
    raw = (text or "").strip()
    if not raw:
        return ParsedIntent(
            intent="clarify",
            needs_clarification=True,
            clarification="What would you like to change or understand about grading?",
        )

    if _INJECTION.search(raw):
        return ParsedIntent(
            intent="unsupported",
            injection_suspected=True,
            clarification=(
                "That text looks like a command injection, not a grading request. "
                "Student submission text cannot create teacher instructions."
            ),
            notes=["prompt_injection_rejected"],
        )

    if _CROSS_COURSE.search(raw):
        return ParsedIntent(
            intent="unsupported",
            cross_course=True,
            clarification=(
                "Cross-course instructions are not allowed. Stay within the authorized course "
                "shown in the panel."
            ),
            notes=["cross_course_denied"],
        )

    if _REVOKE_A.search(raw):
        return ParsedIntent(intent="revoke_instruction", suggested_scope=scope_kind)

    if _INSPECT.search(raw):
        return ParsedIntent(intent="inspect_instructions", suggested_scope=scope_kind)

    if _KINDER_A.search(raw):
        # Default: feedback tone only — not more points.
        return ParsedIntent(
            intent="feedback_tone",
            feedback_only=True,
            scores_change=False,
            remember=_REMEMBER.search(raw) is not None,
            suggested_scope=scope_kind if scope_kind != "none" else "assignment",
            notes=["default_feedback_tone_not_scores"],
        )

    if _LIBERAL.search(raw):
        # Not executable without criterion + interpretation.
        crit = "grammar" if _GRAMMAR.search(raw) else None
        return ParsedIntent(
            intent="clarify",
            needs_clarification=True,
            criterion_hint=crit,
            clarification=(
                f"'Be liberal' is not executable by itself. "
                f"Which criterion should change"
                f"{' (grammar?)' if crit else ''}, and what interpretation should graders use? "
                f"Also confirm scope: this submission only, or the whole assignment?"
            ),
            suggested_scope=None,
            scores_change=False,
            notes=["ambiguous_leniency"],
        )

    if _OVERRIDE.search(raw):
        return ParsedIntent(
            intent="instructor_score_override",
            scores_change=True,
            suggested_scope="submission" if has_submission else None,
            needs_clarification=not has_submission,
            clarification=(
                None
                if has_submission
                else "Score overrides are submission-specific. Select a submission and provide the exact score plus rationale."
            ),
            notes=["explicit_override_not_evidence"],
        )

    if _EXCEPTION.search(raw):
        return ParsedIntent(
            intent="submission_exception",
            scores_change=True,
            suggested_scope="submission",
            needs_clarification=not has_submission,
            clarification=(
                None
                if has_submission
                else "Which submission should receive this exception? Exceptions never auto-apply to classmates."
            ),
            notes=["submission_scoped"],
        )

    if _EXPLAIN.search(raw):
        return ParsedIntent(intent="explain_grade", suggested_scope="submission" if has_submission else scope_kind)

    explicit_assignment = bool(
        re.search(r"\b(this\s+assignment|assignment[- ]?wide|all\s+submissions\s+for\s+this)\b", raw, re.I)
    )
    if _POLICY.search(raw):
        ambiguous = _EVERYONE.search(raw) is not None and not explicit_assignment
        return ParsedIntent(
            intent="criterion_interpretation" if "interpret" in raw.lower() else "scoring_policy",
            scores_change=True,
            needs_clarification=ambiguous,
            clarification=(
                "'Everyone' is ambiguous. Confirm assignment-wide for this assignment only "
                "(not every course), and name the criterion or scoring change."
                if ambiguous
                else None
            ),
            suggested_scope="assignment" if (_EVERYONE.search(raw) or explicit_assignment or scope_kind == "assignment") else scope_kind,
            remember=_REMEMBER.search(raw) is not None,
        )

    if _REGRADE.search(raw):
        ambiguous = _EVERYONE.search(raw) is not None and not explicit_assignment
        return ParsedIntent(
            intent="preview_regrade",
            want_regrade=True,
            suggested_scope="assignment" if (_EVERYONE.search(raw) or explicit_assignment) else scope_kind,
            needs_clarification=ambiguous,
            clarification=(
                "'Everyone' is ambiguous. Confirm: all submissions for this assignment only "
                "(not other courses)?"
                if ambiguous
                else None
            ),
        )

    if _REMEMBER.search(raw):
        return ParsedIntent(
            intent="save_preference",
            remember=True,
            needs_clarification=True,
            clarification=(
                "What should be remembered, at which scope (submission / assignment / course), "
                "and for how long (until revoked, or an expiry)?"
            ),
        )

    if _THIS_COURSE.search(raw) and _EVERYONE.search(raw):
        return ParsedIntent(
            intent="clarify",
            needs_clarification=True,
            clarification="Course-wide changes must be explicit. Confirm you mean every assignment in this course only.",
            suggested_scope="course",
        )

    return ParsedIntent(
        intent="clarify",
        needs_clarification=True,
        clarification=(
            "I can explain a grade, propose feedback-tone changes, criterion interpretations, "
            "scoring-policy edits, submission exceptions, or inspect/revoke remembered instructions. "
            "What should we do?"
        ),
    )


def apply_clarification_reply(
    pending: str,
    reply: str,
    *,
    has_submission: bool,
) -> ParsedIntent:
    """Map a short clarification answer onto a concrete intent."""
    low = reply.lower().strip()
    if pending == "liberal_scope":
        if "submission" in low or "this student" in low or "only this" in low:
            if not has_submission:
                return ParsedIntent(
                    intent="clarify",
                    needs_clarification=True,
                    clarification="Select a submission first for a submission-only change.",
                )
            return ParsedIntent(
                intent="criterion_interpretation",
                scores_change=True,
                suggested_scope="submission",
                criterion_hint="grammar",
            )
        if "assignment" in low or "all submissions" in low or "whole class" in low:
            return ParsedIntent(
                intent="criterion_interpretation",
                scores_change=True,
                suggested_scope="assignment",
                criterion_hint="grammar",
                notes=["assignment_wide_explicit"],
            )
        if "course" in low:
            return ParsedIntent(
                intent="clarify",
                needs_clarification=True,
                clarification="Course-wide grammar leniency must be stated explicitly. Reply 'course-wide for this course only'.",
            )
    if pending == "remember_meta":
        scope = "assignment"
        if "submission" in low:
            scope = "submission"
        elif "course" in low:
            scope = "course"
        dur = "until_revoked"
        if "hour" in low or "day" in low or "week" in low or "expir" in low:
            dur = "until_expiry"
        return ParsedIntent(
            intent="save_preference",
            remember=True,
            suggested_scope=scope,  # type: ignore[arg-type]
            notes=[f"persistence:{dur}"],
        )
    return parse_teacher_text(reply, scope_kind="assignment", has_submission=has_submission)
