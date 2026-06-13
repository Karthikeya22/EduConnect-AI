"""
LangGraph Grading Pipeline (Consolidated Async)
"""

from __future__ import annotations
from typing import TypedDict, Annotated, Literal
from langgraph.graph import StateGraph, END

# Import from the consolidated file
from grading_server.all_nodes_async import (
    run_ingest, run_retrieve, run_grade, run_critique, run_output
)


class GradingState(TypedDict):
    """LangGraph state schema."""
    assignment_id: str
    student_id: str
    submission_text: str
    chunks: list[str]
    chunk_embeddings: list[list[float]]
    submission_concepts: list[str]
    rubric_criteria: list[dict]
    relevant_chunks: list[dict]
    exemplars: dict[str, dict]
    verdicts: list[dict]
    critiques: list[dict]
    final_output: dict


def build_grading_graph() -> StateGraph:
    """Async parallelized grading graph."""
    graph = StateGraph(GradingState)

    graph.add_node("ingest", run_ingest)
    graph.add_node("retrieve", run_retrieve)
    graph.add_node("grade", run_grade)
    graph.add_node("critique", run_critique)
    graph.add_node("output", run_output)

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "retrieve")
    graph.add_edge("retrieve", "grade")
    graph.add_edge("grade", "critique")
    graph.add_edge("critique", "output")
    graph.add_edge("output", END)

    return graph


def get_compiled_graph():
    """Memoized compilation."""
    return build_grading_graph().compile()
