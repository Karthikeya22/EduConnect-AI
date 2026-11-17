from __future__ import annotations
import re
import unicodedata
from typing import Any

from grading_server.evidence.types import CriterionClaim, EvidenceCheckStatus, SourceUnit


def normalize_quote(text: str) -> str:
    """Documented normalization for quotation matching (deterministic)."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = t.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    t = t.replace("\u2013", "-").replace("\u2014", "-")
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def quote_in_corpus(quote: str, units: list[SourceUnit]) -> bool:
    nq = normalize_quote(quote)
    if not nq or nq in ("not found", "n/a", "none"):
        return False
    corpus = normalize_quote("\n".join(u.text for u in units if u.text))
    return nq in corpus


def verify_evidence_ids(
    evidence_ids: list[str],
    units: list[SourceUnit],
    *,
    artifact_id: str | None = None,
    submission_version: str | None = None,
) -> EvidenceCheckStatus:
    by_id = {u.source_unit_id: u for u in units}
    if not evidence_ids:
        return "unchecked"
    for eid in evidence_ids:
        u = by_id.get(eid)
        if u is None:
            return "invalid_id"
        if artifact_id and u.artifact_id != artifact_id:
            return "foreign_scope"
        if submission_version and u.submission_version != submission_version:
            return "foreign_scope"
        loc = u.source_location
        if loc.start_offset is not None and loc.end_offset is not None:
            if loc.start_offset < 0 or loc.end_offset < loc.start_offset:
                return "quote_mismatch"
            if loc.offset_encoding != "unicode_codepoint":
                return "quote_mismatch"
    return "valid"


def verify_score_bounds(verdict: dict[str, Any]) -> bool:
    score = verdict.get("score")
    max_score = verdict.get("max_score")
    if score is None:
        return True
    if not isinstance(score, int) or not isinstance(max_score, int):
        return False
    return 0 <= score <= max_score


def apply_deterministic_checks(
    claim: CriterionClaim,
    verdict: dict[str, Any],
    units: list[SourceUnit],
    *,
    artifact_id: str = "submission",
    submission_version: str = "v1",
) -> CriterionClaim:
    ids = list(claim.submission_evidence_ids)
    # If no ids but an anchor exists, try to bind matching units
    anchor = str(verdict.get("evidence_anchor") or "").strip()
    if not ids and anchor and anchor.lower() not in ("not found", "n/a", "none"):
        for u in units:
            if u.text and normalize_quote(anchor) in normalize_quote(u.text):
                ids.append(u.source_unit_id)
        claim = claim.model_copy(update={"submission_evidence_ids": ids})

    status = verify_evidence_ids(
        claim.submission_evidence_ids,
        units,
        artifact_id=artifact_id,
        submission_version=submission_version,
    )
    if not verify_score_bounds(verdict):
        status = "needs_review"
        reasons = list(claim.review_reasons) + ["score_out_of_bounds"]
        claim = claim.model_copy(update={"review_reasons": reasons})

    if anchor and anchor.lower() not in ("not found", "n/a", "none", ""):
        if not quote_in_corpus(anchor, units):
            status = "quote_mismatch"

    return claim.model_copy(update={"evidence_check_status": status})
