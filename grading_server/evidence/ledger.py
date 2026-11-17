"""Build canonical source units from extracted submission text."""

from __future__ import annotations
import hashlib
import re
from typing import Iterable

from grading_server.evidence.offsets import OFFSET_ENCODING
from grading_server.evidence.types import SourceLocation, SourceUnit

EXTRACTION_VERSION = "extract-flat-v1"


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _split_blocks(text: str) -> list[tuple[int, int, str]]:
    """Split into paragraph/block units with code-point offsets into the full text."""
    if not text:
        return []
    blocks: list[tuple[int, int, str]] = []
    # Split on blank lines; keep non-empty
    parts = re.split(r"(\n\s*\n)", text)
    cursor = 0
    buf = ""
    buf_start = 0
    for part in parts:
        if re.fullmatch(r"\n\s*\n", part or ""):
            if buf.strip():
                start = buf_start
                end = buf_start + len(buf.rstrip())
                blocks.append((start, end, text[start:end]))
            cursor += len(part)
            buf = ""
            buf_start = cursor
            continue
        if not buf:
            buf_start = cursor
        buf += part
        cursor += len(part)
    if buf.strip():
        start = buf_start
        end = buf_start + len(buf.rstrip())
        blocks.append((start, end, text[start:end]))
    if not blocks and text.strip():
        blocks.append((0, len(text), text))
    return blocks


def build_source_ledger(
    submission_text: str,
    *,
    artifact_id: str = "submission",
    submission_version: str = "v1",
    extraction_failed: bool = False,
    extraction_limitations: Iterable[str] | None = None,
    artifact_extent_known: bool = False,
) -> list[SourceUnit]:
    """
    Build source units from flattened extracted text.
    Page/bbox are never fabricated; original_document_location stays unavailable
    unless callers pass real coordinates later.
    """
    limitations = list(extraction_limitations or [])
    if not artifact_extent_known:
        limitations = list(dict.fromkeys(limitations + ["artifact_extent_unknown"]))

    if extraction_failed or not (submission_text or "").strip():
        return [
            SourceUnit(
                source_unit_id=f"{artifact_id}:failed:0",
                artifact_id=artifact_id,
                submission_version=submission_version,
                extraction_version=EXTRACTION_VERSION,
                content_hash=_hash_text(""),
                source_location=SourceLocation(offset_encoding=OFFSET_ENCODING),
                text="",
                extraction_status="failed" if extraction_failed else "unavailable",
                extraction_limitations=limitations or ["extraction_empty_or_failed"],
                presentation="extraction_failed",
            )
        ]

    units: list[SourceUnit] = []
    for i, (start, end, block) in enumerate(_split_blocks(submission_text)):
        units.append(
            SourceUnit(
                source_unit_id=f"{artifact_id}:u{i}",
                artifact_id=artifact_id,
                submission_version=submission_version,
                extraction_version=EXTRACTION_VERSION,
                content_hash=_hash_text(block),
                source_location=SourceLocation(
                    offset_encoding=OFFSET_ENCODING,
                    start_offset=start,
                    end_offset=end,
                    block_id=f"block-{i}",
                    original_document_location="unavailable",
                ),
                text=block,
                extraction_status="ok",
                extraction_limitations=list(limitations),
                presentation="available",
            )
        )
    return units
