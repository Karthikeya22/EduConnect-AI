"""
Node 1 — Ingest (Async)
Parse and chunk the submission, extract concept keywords, embed each chunk in parallel.
"""

from __future__ import annotations
from typing import TYPE_CHECKING
from langchain_text_splitters import RecursiveCharacterTextSplitter
from grading_server.utils.gemini_client import async_call_gemini, async_embed_texts
from grading_server.config import GEMINI_LITE_MODEL

if TYPE_CHECKING:
    from grading_server.graph import GradingState

_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)

_CONCEPT_PROMPT = """Extract a flat JSON list of academic concept keywords.
Submission: {submission_text}
Return JSON: {{"concepts": ["keyword1", "keyword2", ...]}}"""


async def run_ingest(state: "GradingState") -> dict:
    """Async ingest node."""
    submission_text = state["submission_text"]
    chunks = _splitter.split_text(submission_text) or [submission_text[:2000]]

    # Parallelize extraction and embedding
    try:
        concept_prompt = _CONCEPT_PROMPT.format(submission_text=submission_text[:4000])
        concepts_task = async_call_gemini(concept_prompt, model=GEMINI_LITE_MODEL)
        embed_task = async_embed_texts(chunks)
        
        from asyncio import gather
        result, embeddings = await gather(concepts_task, embed_task)
        concepts = [str(c).strip().lower() for c in result.get("concepts", [])]
    except Exception as e:
        print(f"[Ingest] Failed: {e}")
        concepts, embeddings = [], [[] for _ in chunks]

    return {
        "chunks": chunks,
        "chunk_embeddings": embeddings,
        "submission_concepts": concepts,
    }
