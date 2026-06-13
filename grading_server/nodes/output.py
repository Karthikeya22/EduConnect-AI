"""
Node 5 — Output (Async Parallelized)
Final aggregation, compute radar scores, generate misconception hint, save to Supabase.
"""

from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING
from grading_server.models import GradingOutput, CriterionVerdict, CritiqueResult
from grading_server.utils.gemini_client import async_call_gemini_text
from grading_server.utils.supabase_client import get_supabase
from grading_server.config import GEMINI_LITE_MODEL

if TYPE_CHECKING:
    from grading_server.graph import GradingState


_MISCONCEPTION_PROMPT = """You are a master teacher in machine learning.
Analyze the following student submission feedback for a systematic misconception.

IDENTIFIED GAPS: {all_missing}
GRADING RATIONALES: {all_justifications}

If you see a common root cause (e.g. confusing correlation with causation, or confusing bias with variance), 
write a single supportive 1-2 sentence hint to guide the student.
If no clear misconception exists, just return an empty string.

Return 1-2 sentence hint or empty string."""


async def run_output(state: "GradingState") -> dict:
    """Async output node — handles final I/O and misconception check."""
    assignment_id = state["assignment_id"]
    student_id = state["student_id"]
    
    # ── 1. Parse and aggregate ────────────────────────────────────────────────
    verdicts = [v if isinstance(v, CriterionVerdict) else CriterionVerdict(**v) for v in state.get("verdicts", [])]
    critiques = [c if isinstance(c, CritiqueResult) else CritiqueResult(**c) for c in state.get("critiques", [])]

    titles = {c["criterion_id"]: c["title"] for c in state.get("rubric_criteria", [])}

    content_score = sum(v.score for v in verdicts if v.dimension == "content")
    content_max = sum(v.max_score for v in verdicts if v.dimension == "content")
    structure_score = sum(v.score for v in verdicts if v.dimension == "structure")
    structure_max = sum(v.max_score for v in verdicts if v.dimension == "structure")
    total, total_max = content_score + structure_score, content_max + structure_max

    radar = {}
    for v in verdicts:
        label = titles.get(v.criterion_id, v.criterion_id)
        pct = round((v.score / v.max_score) * 100, 1) if v.max_score > 0 else 0.0
        radar[label] = pct

    # ── 2. Misconception analysis (Async) ─────────────────────────────────────
    hint = ""
    all_missing = [k for v in verdicts for k in v.missing_keywords if k]
    if all_missing:
        try:
            all_just = [f"[{v.criterion_id}] {v.justification}" for v in verdicts]
            prompt = _MISCONCEPTION_PROMPT.format(all_missing=", ".join(all_missing[:20]), all_justifications="\n".join(all_just[:5]))
            hint = await async_call_gemini_text(prompt, model=GEMINI_LITE_MODEL)
        except Exception as e:
            print(f"[Output] Misconception tool failed: {e}")

    # ── 3. Build GradingOutput ────────────────────────────────────────────────
    flag_for_human = any(c.flag_for_human for c in critiques)
    avg_confidence = round(sum(c.confidence for c in critiques)/len(critiques), 2) if critiques else 0.5
    if len(verdicts) == 0:
        avg_confidence = 0.0

    output = GradingOutput(
        assignment_id=assignment_id, student_id=student_id,
        content_score=content_score, content_max=content_max,
        structure_score=structure_score, structure_max=structure_max,
        total=total, total_max=total_max,
        rubric_walkthrough=[v.model_dump() for v in verdicts],
        topic_mastery_radar=radar, misconception_hint=hint.strip(),
        flag_for_human=flag_for_human, overall_confidence=avg_confidence,
        critiques=[c.model_dump() for c in critiques],
    )

    # ── 4. Save to Supabase in Background Thread ──────────────────────────────
    def _save_data():
        try:
            get_supabase().table("grading_results").insert({
                "assignment_id": assignment_id,
                "student_id": student_id,
                "result_json": output.model_dump(),
            }).execute()
        except Exception as e:
            print(f"[Output] Could not save to DB: {e}")

    asyncio.create_task(asyncio.to_thread(_save_data)) # Fire and forget save

    return {"final_output": output.model_dump()}
