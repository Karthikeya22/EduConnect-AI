"""
Node 3 — Grade
For each rubric criterion, call Gemini with full RAG context to produce
a CriterionVerdict. Gemini grades ONLY from retrieved context.
Parallelized using asyncio.gather().
"""

from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING

from grading_server.models import CriterionVerdict
from grading_server.utils.gemini_client import async_call_gemini
from grading_server.config import GEMINI_GRADING_MODEL

if TYPE_CHECKING:
    from grading_server.graph import GradingState


_GRADING_PROMPT = """You are a supportive yet rigorous academic evaluator. 
Your goal is to accurately assess student mastery for ONE specific rubric criterion.

SCORING PHILOSOPHY:
- Be fair and constructive. If a student demonstrates the core concept, they should receive major points even if their phrasing isn't identical to the course material.
- Only deduct marks for missing essential conceptual components or significant inaccuracies.
- Content is king: If the 'stuff is present', acknowledge it.

═══════════════════════════════════════════════════════════════════════════════
RUBRIC CRITERION:
  Title: {criterion_title}
  Description: {criterion_description}
  Max Score: {max_score}
  Dimension: {dimension}

═══════════════════════════════════════════════════════════════════════════════
RELEVANT COURSE MATERIAL (Authoritative Source):
{course_material_context}

═══════════════════════════════════════════════════════════════════════════════
EXEMPLAR GUIDANCE:
{exemplar_context}

═══════════════════════════════════════════════════════════════════════════════
STUDENT SUBMISSION TEXT:
{submission_text}

═══════════════════════════════════════════════════════════════════════════════
EVALUATION STEPS:
1. Scan the submission for the specific concepts defined in the rubric and course material.
2. Look for synonyms and paraphrases—do not penalize for different vocabulary if the meaning is correct.
3. Determine if the mastery is:
   - "full": All key components of the criterion are addressed accurately.
   - "partial": Some components are present, but others are missing or weak.
   - "missing": The concept is not addressed or is fundamentally misunderstood.
4. Select a short, direct quote from the submission as 'evidence_anchor'.

Return a JSON object:
{{
  "criterion_id": "{criterion_id}",
  "dimension": "{dimension}",
  "score": <int 0-{max_score}>,
  "max_score": {max_score},
  "status": "<full|partial|missing>",
  "justification": "<state what was found and exactly what (if anything) was missing to justify the score>",
  "missing_keywords": ["<only list major missing concepts>"],
  "evidence_anchor": "<quote from student text>"
}}
"""


def _build_course_material_context(relevant_chunks: list[dict]) -> str:
    """Format the retrieved course material chunks for the prompt."""
    relevant = [c for c in relevant_chunks if c.get("is_relevant", True)]
    if not relevant:
        relevant = relevant_chunks[:4]

    parts = []
    for i, chunk in enumerate(relevant[:6], 1):
        source = chunk.get("source_title", "Unknown Source")
        text = chunk.get("chunk_text", "")[:600]
        parts.append(f"[Source {i}: {source}]\n{text}")
    return "\n\n".join(parts) if parts else "(No course material retrieved)"


def _build_exemplar_context(exemplar_pair: dict | None) -> str:
    """Format the high/low exemplar pair for the prompt."""
    if not exemplar_pair:
        return "(No exemplars available for this criterion)"

    parts = []
    high = exemplar_pair.get("high")
    low = exemplar_pair.get("low")

    if high:
        parts.append(
            f"HIGH-SCORING EXEMPLAR (Score: {high['score']}/{high['max_score']}):\n"
            f"\"{high['submission_text'][:500]}\""
        )
    if low:
        parts.append(
            f"LOW-SCORING EXEMPLAR (Score: {low['score']}/{low['max_score']}):\n"
            f"\"{low['submission_text'][:500]}\""
        )
    return "\n\n".join(parts) if parts else "(No exemplars available)"


async def _grade_single_criterion(
    criterion: dict,
    course_material_ctx: str,
    exemplar_ctx: str,
    concepts_str: str,
    submission_text: str,
) -> dict:
    """Helper to grade a single criterion asynchronously."""
    cid = criterion["criterion_id"]
    prompt = _GRADING_PROMPT.format(
        criterion_title=criterion["title"],
        criterion_description=criterion["description"],
        max_score=criterion["max_score"],
        dimension=criterion["dimension"],
        criterion_id=cid,
        course_material_context=course_material_ctx,
        exemplar_context=exemplar_ctx,
        submission_concepts=concepts_str,
        submission_text=submission_text[:200000],
    )

    try:
        result = await async_call_gemini(prompt, model=GEMINI_GRADING_MODEL, temperature=0.15)
        verdict = CriterionVerdict(
            criterion_id=result.get("criterion_id", cid),
            dimension=result.get("dimension", criterion["dimension"]),
            score=min(int(result.get("score", 0)), criterion["max_score"]),
            max_score=criterion["max_score"],
            status=result.get("status", "partial"),
            justification=result.get("justification", "No justification provided."),
            missing_keywords=result.get("missing_keywords", []),
            evidence_anchor=result.get("evidence_anchor", "not found"),
        )
        return verdict.model_dump()
    except Exception as e:
        print(f"[Grade] Failed for {cid}: {e}")
        fallback = CriterionVerdict(
            criterion_id=cid,
            dimension=criterion["dimension"],
            score=int(criterion["max_score"] * 0.5),
            max_score=criterion["max_score"],
            status="partial",
            justification=f"Error: {str(e)[:100]}",
            missing_keywords=[],
            evidence_anchor="not found",
        )
        return fallback.model_dump()


async def run_grade(state: "GradingState") -> dict:
    """Node 3 — Grade each rubric criterion in parallel."""
    rubric_criteria = state.get("rubric_criteria", [])
    relevant_chunks = state.get("relevant_chunks", [])
    exemplars = state.get("exemplars", {})
    submission_text = state["submission_text"]
    submission_concepts = state.get("submission_concepts", [])
    needs_regrade = state.get("needs_regrade", [])

    if needs_regrade:
        criteria_to_grade = [c for c in rubric_criteria if c["criterion_id"] in needs_regrade]
        existing_verdicts = [v for v in state.get("verdicts", []) if v["criterion_id"] not in needs_regrade]
    else:
        criteria_to_grade = rubric_criteria
        existing_verdicts = []

    course_material_ctx = _build_course_material_context(relevant_chunks)
    concepts_str = ", ".join(submission_concepts[:30])

    tasks = []
    for criterion in criteria_to_grade:
        cid = criterion["criterion_id"]
        pair = exemplars.get(cid)
        ex_ctx = _build_exemplar_context(pair)
        tasks.append(_grade_single_criterion(criterion, course_material_ctx, ex_ctx, concepts_str, submission_text))

    if tasks:
        new_verdicts = await asyncio.gather(*tasks)
    else:
        new_verdicts = []

    return {
        "verdicts": existing_verdicts + list(new_verdicts),
        "needs_regrade": [],
    }
