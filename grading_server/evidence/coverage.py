from __future__ import annotations
from typing import Iterable

from grading_server.evidence.types import CoverageSummary, SourceUnit, UnitPresentation


def summarize_coverage(
    units: list[SourceUnit],
    *,
    artifact_extent: str = "unknown",
) -> CoverageSummary:
    known = [u for u in units if u.extraction_status in ("ok", "partial")]
    presented_ids = {u.source_unit_id for u in units if u.presentation == "presented"}
    failed = sum(1 for u in units if u.presentation == "extraction_failed" or u.extraction_status == "failed")
    not_proc = sum(1 for u in units if u.presentation == "not_processed")
    omitted = sum(1 for u in units if u.presentation == "omitted_budget")
    return CoverageSummary(
        artifact_extent="known" if artifact_extent == "known" else "unknown",
        known_unit_count=len(known),
        presented_unit_count=len(presented_ids),
        extraction_failed_count=failed,
        not_processed_count=not_proc,
        omitted_budget_count=omitted,
    )


def mark_presented(units: list[SourceUnit], unit_ids: Iterable[str]) -> list[SourceUnit]:
    """Mark unique units presented; overlapping ids do not double-count later."""
    want = set(unit_ids)
    out: list[SourceUnit] = []
    for u in units:
        if u.source_unit_id in want and u.presentation in ("available", "not_processed"):
            out.append(u.model_copy(update={"presentation": "presented"}))
        else:
            out.append(u)
    return out


def mark_omitted_budget(units: list[SourceUnit], unit_ids: Iterable[str]) -> list[SourceUnit]:
    want = set(unit_ids)
    out: list[SourceUnit] = []
    for u in units:
        if u.source_unit_id in want and u.presentation != "presented":
            out.append(u.model_copy(update={"presentation": "omitted_budget"}))
        else:
            out.append(u)
    return out


def unique_presented_count(units: list[SourceUnit]) -> int:
    return len({u.source_unit_id for u in units if u.presentation == "presented"})


def map_chunk_to_units(chunk_text: str, units: list[SourceUnit]) -> list[str]:
    """Map a retrieval/presentation chunk back to overlapping source units (no fabrication)."""
    ids: list[str] = []
    if not chunk_text:
        return ids
    for u in units:
        if not u.text:
            continue
        if u.text in chunk_text or chunk_text in u.text:
            ids.append(u.source_unit_id)
    return ids
