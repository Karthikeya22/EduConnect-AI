"""
Node 2 — Retrieve (Async Parallelized)
Fetch criteria, search materials, fetch exemplars, and Parallelize relevance check.
"""

from __future__ import annotations
import asyncio
import numpy as np
from typing import TYPE_CHECKING

from grading_server.utils.supabase_client import get_supabase
from grading_server.utils.gemini_client import async_call_gemini, embed_text
from grading_server.config import GEMINI_LITE_MODEL

if TYPE_CHECKING:
    from grading_server.graph import GradingState


_RELEVANCE_PROMPT = """Is this course material chunk relevant for grading this submission?
STUDENT SUBMISSION CONTEXT (keywords): {concepts}
COURSE MATERIAL CHUNK: \"\"\"{chunk_text}\"\"\"
Return JSON: {{"relevant": true}} or {{"relevant": false}}
"""

_QUERY_REWRITE_PROMPT = """You are a search query optimizer. 
Rewrite the following student submission concepts into a single improved semantic search query.
Submission concepts: {concepts}
Return JSON: {{"rewritten_query": "your improved query text"}}
"""


async def _score_relevance(chunk: dict, concepts_str: str) -> dict:
    """Async helper to judge relevance using Gemini."""
    try:
        prompt = _RELEVANCE_PROMPT.format(concepts=concepts_str, chunk_text=chunk.get("chunk_text", "")[:800])
        result = await async_call_gemini(prompt, model=GEMINI_LITE_MODEL, temperature=0.0)
        chunk["is_relevant"] = result.get("relevant", True)
    except Exception:
        chunk["is_relevant"] = True
    return chunk


async def run_retrieve(state: "GradingState") -> dict:
    """Async retrieve node — Parallelizes I/O and Relevance scoring."""
    assignment_id = state["assignment_id"]
    chunk_embeddings = state.get("chunk_embeddings", [])
    concepts = state.get("submission_concepts", [])
    rewrite_attempted = state.get("rewrite_attempted", False)
    sb = get_supabase()

    # 1. Fetch criteria and materials (Threaded since Supabase Python is sync)
    # ── Using thread pool to avoid blocking the main async loop ──────────────────────
    def _fetch_db_data():
        try:
            rubric_resp = sb.table("rubric_criteria").select("*").eq("assignment_id", assignment_id).execute()
            criterion_list = rubric_resp.data or []
        except Exception:
            criterion_list = []
            
        relevant_chunks_list = []
        try:
            if chunk_embeddings and any(len(e) > 0 for e in chunk_embeddings):
                query_vector = np.mean([e for e in chunk_embeddings if len(e) > 0], axis=0).tolist()
                vec_resp = sb.rpc("match_course_material_chunks", {"query_embedding": query_vector, "match_count": 8, "filter_assignment_id": assignment_id}).execute()
                relevant_chunks_list = vec_resp.data or []
            else:
                fallback_resp = sb.table("course_material_chunks").select("id, chunk_text, source_title").eq("assignment_id", assignment_id).limit(8).execute()
                relevant_chunks_list = fallback_resp.data or []
        except Exception:
            relevant_chunks_list = []

        exemplars_map = {}
        for crit in criterion_list:
            cid = crit["criterion_id"]
            try:
                h = sb.table("exemplars").select("*").eq("criterion_id", cid).order("score", desc=True).limit(1).execute()
                l = sb.table("exemplars").select("*").eq("criterion_id", cid).order("score", desc=False).limit(1).execute()
                exemplars_map[cid] = {"high": h.data[0] if h.data else None, "low": l.data[0] if l.data else None}
            except Exception:
                exemplars_map[cid] = {"high": None, "low": None}
                
        return criterion_list, relevant_chunks_list, exemplars_map

    # Run DB fetches in parallel background threads
    rubric_criteria, relevant_chunks, exemplars = await asyncio.to_thread(_fetch_db_data)

    # 2. Parallel Relevance Scoring via Gemini
    concepts_str = ", ".join(concepts[:20])
    tasks = [_score_relevance(c, concepts_str) for c in relevant_chunks]
    if tasks:
        scored_chunks = await asyncio.gather(*tasks)
        relevant_count = sum(1 for c in scored_chunks if c.get("is_relevant", True))
    else:
        scored_chunks, relevant_count = [], 0

    # 3. Handle Rewrite internally
    if relevant_count < 3 and not rewrite_attempted:
        print("[Retrieve] Low relevance detected. Attempting internal rewrite loop...")
        try:
            rw_prompt = _QUERY_REWRITE_PROMPT.format(concepts=concepts_str)
            rw_result = await async_call_gemini(rw_prompt, model=GEMINI_LITE_MODEL)
            rewritten_query = rw_result.get("rewritten_query", "")
            if rewritten_query:
                # Re-embed rewritten text synchronous then search in thread
                new_vec = embed_text(rewritten_query)
                def _fetch_rewritten():
                    vec_resp = sb.rpc("match_course_material_chunks", {"query_embedding": new_vec, "match_count": 8, "filter_assignment_id": assignment_id}).execute()
                    return vec_resp.data or []
                
                rewritten_chunks = await asyncio.to_thread(_fetch_rewritten)
                # Mark as relevant since we forced the rewrite
                for c in rewritten_chunks:
                    c["is_relevant"] = True
                return {
                    "rubric_criteria": rubric_criteria,
                    "relevant_chunks": rewritten_chunks,
                    "exemplars": exemplars,
                    "retrieval_passed": True,
                    "rewrite_attempted": True,
                }
        except Exception as e:
            print(f"[Retrieve] Rewrite failed: {e}")

    return {
        "rubric_criteria": rubric_criteria,
        "relevant_chunks": scored_chunks,
        "exemplars": exemplars,
        "retrieval_passed": True, # Hard pass to prevent graph cycles if we already tried
        "rewrite_attempted": True if relevant_count < 3 else rewrite_attempted,
    }
