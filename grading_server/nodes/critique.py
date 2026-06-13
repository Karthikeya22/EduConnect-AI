"""
Node 4 — Critique
Quality-check each CriterionVerdict in parallel using asyncio.gather().
"""

from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING

from grading_server.models import CritiqueResult
from grading_server.utils.gemini_client import async_call_gemini
from grading_server.config import GEMINI_LITE_MODEL

if TYPE_CHECKING:
    from grading_server.graph import GradingState


_CRITIQUE_PROMPT = """You are a strict quality assurance reviewer for an AI grading system.
Review the following grading verdict for a single rubric criterion.

CRITERION VERDICT:
  Criterion ID: {criterion_id}
  Dimension: {dimension}
  Score Assigned: {score} / {max_score}
  Status: {status}
  Justification: {justification}
  Evidence Anchor: {evidence_anchor}
  Missing Keywords: {missing_keywords}

EVALUATION CHECKLIST:
1. is_supported: Is the justification actually grounded in the evidence anchor?
   If the evidence anchor says "not found" but the justification claims specific evidence, 
   this is NOT supported.
2. is_justified: Is the score consistent with the stated justification?
   A "full" status should mean a perfect or near-perfect score.
   A "missing" status should mean a very low score.
3. confidence: How confident are you (0.0 to 1.0) that this verdict is accurate
   and fair for a professor to use?
4. flag_for_human: Set to true if confidence < 0.65.

Return a JSON object with EXACTLY these fields:
{{
  "criterion_id": "{criterion_id}",
  "is_supported": <bool>,
  "is_justified": <bool>,
  "confidence": <float 0.0-1.0>,
  "flag_for_human": <bool>
}}
"""


async def _critique_single_verdict(verdict: dict) -> dict:
    """Helper to critique a single verdict asynchronously."""
    cid = verdict["criterion_id"]
    try:
        prompt = _CRITIQUE_PROMPT.format(
            criterion_id=cid,
            dimension=verdict.get("dimension", "content"),
            score=verdict.get("score", 0),
            max_score=verdict.get("max_score", 0),
            status=verdict.get("status", "partial"),
            justification=verdict.get("justification", ""),
            evidence_anchor=verdict.get("evidence_anchor", "not found"),
            missing_keywords=", ".join(verdict.get("missing_keywords", [])),
        )

        result = await async_call_gemini(prompt, model=GEMINI_LITE_MODEL, temperature=0.1)
        critique = CritiqueResult(
            criterion_id=cid,
            is_supported=result.get("is_supported", True),
            is_justified=result.get("is_justified", True),
            confidence=max(0.0, min(1.0, float(result.get("confidence", 0.5)))),
            flag_for_human=result.get("flag_for_human", False),
        )
        if critique.confidence < 0.65:
            critique.flag_for_human = True
        return critique.model_dump()
    except Exception as e:
        print(f"[Critique] Failed for {cid}: {e}")
        return CritiqueResult(
            criterion_id=cid, is_supported=True, is_justified=True, confidence=0.4, flag_for_human=True
        ).model_dump()


async def run_critique(state: "GradingState") -> dict:
    """Node 4 — Critique each verdict in parallel."""
    verdicts = state.get("verdicts", [])
    regrade_attempted = state.get("regrade_attempted", False)

    tasks = [_critique_single_verdict(v) for v in verdicts]
    if tasks:
        critiques = await asyncio.gather(*tasks)
    else:
        critiques = []

    needs_regrade = [c["criterion_id"] for c in critiques if not c["is_supported"] and not regrade_attempted]
    return {
        "critiques": list(critiques),
        "needs_regrade": needs_regrade,
        "regrade_attempted": True if needs_regrade else regrade_attempted,
    }
