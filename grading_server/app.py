import sys
import os
import math
import re
import tempfile
import asyncio
import threading
import time
import traceback
from typing import TypedDict, Literal
from pydantic import BaseModel

class QualityCriterion(BaseModel):
    criterion_id: str
    title: str
    description: str
    max_score: int = 10
    dimension: Literal["content", "structure"] = "structure"

class DynamicCriteria(BaseModel):
    criteria: list[QualityCriterion]
app_dir = os.path.dirname(os.path.abspath(__file__))
workspace_dir = os.path.dirname(app_dir)
workspace_tmp = os.path.join(workspace_dir, "tmp")
os.makedirs(workspace_tmp, exist_ok=True)
os.environ["TEMP"] = workspace_tmp
os.environ["TMP"] = workspace_tmp
tempfile.tempdir = workspace_tmp

# Ensure repo root is importable when this file is launched as a script
# (Streamlit Cloud, `python grading_server/app.py`, etc.)
if workspace_dir not in sys.path:
    sys.path.insert(0, workspace_dir)

from flask import Flask, g, request, jsonify
from flask_cors import CORS
from langgraph.graph import StateGraph, END

# Use verified local utils
from grading_server.utils.supabase_client import get_supabase
from grading_server.utils.llm_client import chat_json, chat_text, embed_texts
from grading_server.utils.byok import resolve_llm_credentials, byok_required_response
from grading_server.utils.llm_registry import list_providers, get_provider
from grading_server.utils.file_parsers import parse_submission, _parse_pdf, _parse_docx, _parse_pptx
from grading_server.config import GEMINI_LITE_MODEL, GEMINI_GRADING_MODEL, FLASK_PORT, CANVAS_BASE_URL, CORS_ORIGINS
from grading_server.utils.authz import require_access, trusted_lms_host
from grading_server.models import (
    CriterionVerdict,
    CritiqueResult,
    GradingOutput,
    _coerce_str_list,
    is_legacy_result,
)
from grading_server.retrieval_guards import coerce_retrieval, top_chunk_similarity
from grading_server.utils.embedding_space import (
    INDEX_VERSION,
    EmbeddingError,
    EmbeddingProvenanceError,
    EmbeddingSpaceUnsupported,
    space_for_provider,
)

# Legacy aliases used in a few call sites
def call_gemini(prompt, model=GEMINI_GRADING_MODEL, temperature=0.2, max_tokens=8192,
                response_schema=None, api_key=None, provider=None):
    if not api_key or not provider:
        raise ValueError("BYOK required: provider and api_key must be set")
    # Only pass explicit Gemini model ids to Gemini; other providers use registry defaults.
    model_arg = model if provider == "gemini" else None
    return chat_json(
        prompt,
        provider=provider,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
        response_schema=response_schema,
        model=model_arg,
    )


def call_gemini_text(prompt, model=GEMINI_LITE_MODEL, temperature=0.3, api_key=None, provider=None):
    if not api_key or not provider:
        raise ValueError("BYOK required: provider and api_key must be set")
    model_arg = model if provider == "gemini" else None
    return chat_text(
        prompt,
        provider=provider,
        api_key=api_key,
        temperature=temperature,
        model=model_arg,
    )

# Windows event loop policy fix
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

app = Flask(__name__)
# Browser origin allowlist only; every data route is separately guarded by require_access.
CORS(app, origins=CORS_ORIGINS, allow_headers=[
    "Authorization", "Content-Type", "X-Canvas-Token", "X-LLM-Provider", "X-LLM-Api-Key", "X-Gemini-Api-Key",
])

from grading_server.copilot.routes import copilot_bp

app.register_blueprint(copilot_bp)

# Windows consoles default to cp1252; avoid UnicodeEncodeError on emoji/math symbols in logs
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
except Exception:
    pass

class GradingState(TypedDict):
    assignment_id: str
    course_id: str | None
    student_id: str
    submission_text: str
    assignment_context: str
    assignment_name: str
    assignment_description: str
    points_possible: float | None
    approved_template_id: str | None
    explicit_outcomes: list[str]
    submission_genre: str
    submission_filenames: list[str]
    genre_signals: dict
    chunks: list[str]
    chunk_embeddings: list[list[float]]
    submission_concepts: list[str]
    rubric_criteria: list[dict]
    relevant_chunks: list[dict]
    exemplars: dict  # criterion_id -> list of exemplar dicts
    verdicts: list[dict]
    critiques: list[dict]
    final_output: dict
    loop_count: int
    force_flag_for_human: bool
    deep_retrieve: bool
    moe: bool
    grade_started_at: float
    custom_gemini_key: str | None
    llm_provider: str | None
    llm_api_key: str | None
    experiment_mode: str
    evidence_block: dict
    extraction_failed: bool
    extraction_limitations: list[str]
    evidence_adapters: object
    recovery_overrides: dict
    is_proposal: bool
    evidence_chat_json: object
    assessment_policy: dict | None
    policy_lookup_status: str | None
    rag_degraded: bool
    materials_status: str
    wrong_deliverable: bool
    wrong_deliverable_note: str


def _llm_creds(state: dict) -> tuple[str | None, str | None]:
    provider = state.get("llm_provider")
    api_key = state.get("llm_api_key") or state.get("custom_gemini_key")
    if api_key and not provider:
        provider = "gemini"
    return provider, api_key


def _embed_sync(texts: list[str], provider: str, api_key: str, task: str):
    return embed_texts(texts, provider=provider, api_key=api_key, task=task)

# Common assignment section labels used for placement checks
_SECTION_HINTS = [
    "executive summary",
    "problem statement",
    "project overview",
    "future work",
    "data visuals",
    "data visual",
    "literature review",
    "related work",
    "introduction",
    "abstract",
    "background",
    "literature",
    "ai solution",
    "ai application",
    "proposed solution",
    "solution design",
    "methodology",
    "methods",
    "ethical considerations",
    "ethical consideration",
    "ethics",
    "outcomes and impact",
    "outcomes & impact",
    "impact",
    "outcomes",
    "challenges and solutions",
    "challenges & solutions",
    "challenges",
    "solutions",
    "results",
    "discussion",
    "conclusion",
    "conclusions",
    "references",
    "bibliography",
    "appendix",
    "visualization",
    "visuals",
    "analysis",
    "findings",
    "recommendations",
    "recommendation",
    "objectives",
    "limitations",
    "academic integrity",
]


def _detect_submission_genre(
    filenames: list[str] | None,
    text: str,
    assignment_context: str = "",
) -> str:
    """
    Detect deliverable genre for method-appropriate grading.
    Returns: research_paper | document | presentation | code | notebook | general
    """
    files = [str(f or "").lower() for f in (filenames or []) if f]
    ctx = (assignment_context or "").lower()
    sample = (text or "")[:25000].lower()

    def _has_ext(*exts: str) -> bool:
        return any(name.endswith(exts) for name in files)

    if _has_ext(".pptx", ".ppt"):
        return "presentation"
    if _has_ext(".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma") or sample.startswith("[audio transcript]"):
        return "audio"
    if _has_ext(".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi") or (
        "[video transcript]" in sample or "[video visual notes]" in sample
    ):
        return "video"
    if _has_ext(".ipynb"):
        return "notebook"
    if _has_ext(".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".tsx", ".jsx", ".r", ".sql", ".cs", ".go", ".rb", ".swift", ".kt"):
        return "code"

    paper_ctx = (
        "research paper", "research report", "journal", "conference paper",
        "literature review", "scholarly", "manuscript", "term paper",
        "academic paper", "apa style", "ieee", "acm format",
    )
    slide_ctx = ("powerpoint", "presentation", "slides", "pitch deck", "oral presentation")
    code_ctx = ("programming", "source code", "implement a", "write a program", "coding assignment", "software")
    notebook_ctx = ("jupyter", "notebook", "colab", "ipynb")

    if any(k in ctx for k in notebook_ctx):
        return "notebook"
    if any(k in ctx for k in slide_ctx) and not any(k in ctx for k in paper_ctx):
        return "presentation"
    if any(k in ctx for k in paper_ctx):
        return "research_paper"
    if any(k in ctx for k in code_ctx) and not any(k in ctx for k in paper_ctx):
        return "code"

    section_keys = (
        "abstract", "introduction", "methodology", "methods",
        "results", "discussion", "conclusion", "references", "bibliography",
    )
    section_hits = sum(1 for s in section_keys if re.search(rf"(?im)^\s*#*\s*\d*\.?\s*{re.escape(s)}\b", text or "") or f"\n{s}\n" in sample)
    apa_cites = len(re.findall(r"\([A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?\)", text or ""))
    num_cites = len(re.findall(r"\[[0-9]{1,3}\]", text or ""))
    has_refs = bool(re.search(r"(?im)^\s*#*\s*(references|bibliography|works cited)\b", text or ""))
    if section_hits >= 3 or (section_hits >= 2 and (apa_cites + num_cites >= 2 or has_refs)):
        return "research_paper"

    if "```" in (text or "") or "def " in sample or "import " in sample[:3000]:
        if _has_ext(".pdf", ".docx", ".doc") is False and section_hits < 2:
            return "code"

    if _has_ext(".docx", ".doc", ".pdf"):
        return "document"
    return "general"


def _analyze_genre_signals(genre: str, text: str, sections: list[dict] | None = None) -> dict:
    """Concrete structural/citation/code signals passed into the grader prompt."""
    sections = sections or []
    titles = [str(s.get("title", "")).lower() for s in sections]
    sample = text or ""
    low = sample.lower()

    # Parenthetical APA: (Smith, 2020) / (Smith et al., 2020)
    apa_paren = len(re.findall(r"\([A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?\)", sample))
    # Narrative APA: Smith (2020) / Smith et al. (2020) / Tang and Hew (2022)
    apa_narrative = len(
        re.findall(
            r"\b[A-Z][A-Za-z\-]+(?:\s+et\s+al\.|\s+and\s+[A-Z][A-Za-z\-]+)?\s*\(\d{4}[a-z]?\)",
            sample,
        )
    )
    apa_cites = apa_paren + apa_narrative
    num_cites = len(re.findall(r"\[[0-9]{1,3}\]", sample))
    has_refs = any(
        any(k in t for k in ("reference", "bibliography", "works cited", "works cited"))
        for t in titles
    ) or bool(
        re.search(
            r"(?im)^\s*#*\s*(references|bibliography|works\s+cited|reference\s+list)\b",
            sample,
        )
    )

    canonical = (
        "abstract", "introduction", "method", "result", "discussion",
        "conclusion", "reference", "literature", "background",
    )
    canonical_section_count = sum(1 for t in titles if any(k in t for k in canonical))

    figure_count = low.count("[figure / visual")
    table_count = low.count("[table")
    code_fence_count = sample.count("```")
    has_slide_markers = bool(re.search(r"(?im)^\s*slide\s+\d+", sample)) or "[slide" in low

    return {
        "genre": genre,
        "section_count": len(sections),
        "canonical_section_count": canonical_section_count,
        "section_titles": [s.get("title", "") for s in sections[:20]],
        "in_text_citation_count": apa_cites + num_cites,
        "apa_citation_count": apa_cites,
        "numeric_citation_count": num_cites,
        "has_references": has_refs,
        "figure_count": figure_count,
        "table_count": table_count,
        "code_fence_count": code_fence_count,
        "has_slide_markers": has_slide_markers,
        "char_count": len(sample),
    }


def _genre_grading_guide(
    genre: str, signals: dict, dimension: str, *, is_proposal: bool = False
) -> str:
    """Method-appropriate standards by deliverable type (still subordinate to rubric)."""
    sig_lines = (
        f"Observed signals: sections={signals.get('section_count', 0)} "
        f"(canonical≈{signals.get('canonical_section_count', 0)}), "
        f"in-text citations≈{signals.get('in_text_citation_count', 0)}, "
        f"references_section={signals.get('has_references')}, "
        f"figures≈{signals.get('figure_count', 0)}, tables≈{signals.get('table_count', 0)}, "
        f"code_fences≈{signals.get('code_fence_count', 0)}.\n"
        f"Detected headings: {', '.join(signals.get('section_titles') or []) or '(none)'}\n"
    )

    common = (
        "=== GENRE / DELIVERABLE STANDARDS ===\n"
        f"Detected genre: {genre}\n"
        f"{sig_lines}"
        "- Always prioritize the ASSIGNMENT CONTEXT instructions and THIS rubric criterion.\n"
        "- Do not invent formatting rules absent from assignment/rubric, but DO apply the normal "
        "professional conventions for this deliverable type when judging quality/completeness.\n"
    )

    if genre == "audio":
        return common + (
            "Audio / oral submission expectations:\n"
            "- Grade from the transcript (and any timestamped claims). Spoken clarity and coverage of rubric points matter.\n"
            "- Do not require written section headings unless the rubric asks for a script/outline.\n"
            "- Mark gaps when the transcript lacks required concepts; treat [inaudible] as missing evidence for that span.\n\n"
        )
    if genre == "video":
        return common + (
            "Video / presentation recording expectations:\n"
            "- Use both [VIDEO TRANSCRIPT] (spoken) and [VIDEO VISUAL NOTES] (slides/demo on screen) when present.\n"
            "- Credit on-screen evidence (slides, UI demos) as real student content.\n"
            "- Nonverbal delivery (eye contact, gesture) is soft context only — do not hard-zero on delivery alone "
            "unless the rubric explicitly requires it; flag for human review when uncertain.\n\n"
        )

    if is_proposal:
        return common + (
            "PROPOSAL / PLANNED-SYSTEM expectations (overrides completed-study Methods/Results norms):\n"
            "- Methods-like criteria: credit a clear planned approach, named algorithms/tools, and "
            "how the student would execute steps (e.g. 'I would begin…', 'I would use…').\n"
            "- Results / pipeline / evaluation criteria: credit a concrete evaluation plan "
            "(metrics, validation approach, what outputs would mean) — do NOT require completed runs, "
            "observed metrics, trained-model outputs, or finished pipeline execution.\n"
            "- Discussion/insights: credit reasoned expected outcomes and decision logic for the plan.\n"
            "- Do not set status=missing solely because empirical results were not yet produced.\n"
            "- Placement: planning prose under a Methods/Approach heading is correctly placed for a proposal.\n\n"
        )

    if genre == "research_paper":
        return common + (
            "Research paper / journal-style expectations:\n"
            "- Expect a scholarly structure when the assignment asks for a paper: typically Abstract/"
            "Introduction, related work or background, Methods, Results, Discussion/Conclusion, References.\n"
            "- Citations: in-text citations should correspond to a References/Bibliography section. "
            "Uncited strong claims, missing reference list, or orphan references → reduce structure/format "
            "and scholarship criteria; do not award full marks for 'mentioned sources' without usable citations.\n"
            "- Methods section should describe what was done with enough detail to understand the approach; "
            "Results should report findings; Discussion should interpret — do not credit Methods text dumped "
            "only under Discussion (placement_ok=false).\n"
            "- Figures/tables should be referenced in the prose when the criterion expects research reporting.\n"
            "- Academic tone and coherent argument matter more than decorative wording.\n"
            f"{'NOTE: Few/no in-text citations and/or no References section detected — be strict on citation/format criteria.' if (not signals.get('has_references') or int(signals.get('in_text_citation_count') or 0) < 2) else ''}\n\n"
        )

    if genre == "document":
        return common + (
            "Document (DOCX/PDF report) expectations:\n"
            "- Clear headings, readable flow, and completeness against assignment instructions.\n"
            "- If the assignment specifies a report template/sections, check those headings exist and content "
            "sits under the right heading.\n"
            "- Lists, tables, and figures count when present ([TABLE]/[FIGURE / VISUAL]).\n"
            "- Professional writing: purpose stated, recommendations/conclusion when required by rubric.\n\n"
        )

    if genre == "presentation":
        return common + (
            "Presentation / slide deck expectations:\n"
            "- Slide-appropriate brevity: clear slide titles, scannable bullets, logical sequence.\n"
            "- Visual evidence ([FIGURE / VISUAL]/ charts) should support the narrative, not replace it with walls of text.\n"
            "- Cover required topics from assignment/rubric; speaker-note-like dumps without structure are partial.\n"
            "- Citations/sources on slides when the assignment requires sourced claims.\n\n"
        )

    if genre == "notebook":
        return common + (
            "Jupyter notebook expectations:\n"
            "- Narrative markdown + executable reasoning: explain approach, show code, show outputs.\n"
            "- Credit [FIGURE / VISUAL] plot outputs; missing interpretation of plots is partial for analysis criteria.\n"
            "- Code should be relevant and readable; broken/empty cells that the rubric requires → deduct.\n"
            "- Reproducibility cues (imports, data load, clear steps) matter for methods-like criteria.\n\n"
        )

    if genre == "code":
        return common + (
            "Code / programming deliverable expectations:\n"
            "- Correctness and completeness vs assignment requirements beat stylistic preferences.\n"
            "- Structure: functions/modules, clear naming, comments where non-obvious.\n"
            "- Handle edge cases if the rubric/assignment asks; placeholder/stub code is not full credit.\n"
            "- If README/docs are required by assignment context, absence is a real deduction on that criterion.\n\n"
        )

    return common + (
        "General submission: grade against rubric + assignment instructions; use professional judgment "
        "for organization, evidence, and completeness.\n\n"
    )


def _normalize_quote_text(s: str) -> str:
    """Normalize quotes/dashes/whitespace for evidence matching."""
    if not s:
        return ""
    out = str(s)
    for a, b in (
        ("\u201c", '"'), ("\u201d", '"'), ("\u2018", "'"), ("\u2019", "'"),
        ("\u00ab", '"'), ("\u00bb", '"'), ("\u2013", "-"), ("\u2014", "-"),
        ("\u2026", "..."),
    ):
        out = out.replace(a, b)
    return " ".join(out.lower().split())


def _token_overlap_ratio(a: str, b: str) -> float:
    ta = [t for t in re.findall(r"[a-z0-9]+", a.lower()) if len(t) > 2]
    tb = [t for t in re.findall(r"[a-z0-9]+", b.lower()) if len(t) > 2]
    if not ta:
        return 0.0
    sb = set(tb)
    hit = sum(1 for t in ta if t in sb)
    return hit / max(1, len(ta))


def _light_stem(tok: str) -> str:
    t = tok.lower()
    if len(t) <= 3:
        return t
    if t.endswith("ies") and len(t) > 5:
        return t[:-3] + "y"
    if t.endswith("ing") and len(t) > 5:
        return t[:-3]
    if t.endswith("ed") and len(t) > 4:
        return t[:-2]
    if t.endswith("es") and len(t) > 4:
        return t[:-2]
    if t.endswith("s") and len(t) > 4 and not t.endswith("ss"):
        return t[:-1]
    return t


_EVIDENCE_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "were", "was", "are", "is",
    "into", "onto", "about", "their", "there", "have", "has", "had", "been", "being",
    "which", "while", "where", "when", "what", "also", "than", "then", "them", "they",
    "using", "used", "use", "via", "per", "within", "across", "among", "such", "based",
}


def _content_tokens(text: str) -> list[str]:
    return [
        _light_stem(t)
        for t in re.findall(r"[a-z0-9]+", (text or "").lower())
        if len(t) > 3 and t not in _EVIDENCE_STOPWORDS
    ]


def _ordered_token_coverage(needle: list[str], hay: list[str]) -> float:
    if not needle:
        return 0.0
    i = 0
    for t in hay:
        if i < len(needle) and t == needle[i]:
            i += 1
    return i / max(1, len(needle))


def _evidence_anchor_in_submission(anchor: str, submission: str) -> bool:
    """True when anchor is verbatim or near-verbatim in the student text."""
    if not anchor or not submission:
        return False
    a = str(anchor).strip()
    if a.lower() in ("", "not found", "n/a", "none"):
        return False
    norm_sub = _normalize_quote_text(submission)
    norm_anchor = _normalize_quote_text(a)
    if not norm_anchor:
        return False
    # Exact / prefix probe (handles long quotes)
    probe = norm_anchor if len(norm_anchor) <= 180 else " ".join(norm_anchor.split()[:14])
    if probe and probe in norm_sub:
        return True
    # LLM often appends a short clause ("in results.", "as discussed.") — try shorter prefixes
    words = norm_anchor.split()
    for n in (len(words) - 1, len(words) - 2, min(14, len(words)), min(10, len(words)), min(8, len(words))):
        if n < 6:
            break
        prefix = " ".join(words[:n])
        if prefix in norm_sub:
            return True
    # Near-verbatim: high token overlap + a contiguous content-token span
    if len(words) >= 6 and _token_overlap_ratio(norm_anchor, norm_sub) >= 0.80:
        toks = [t for t in re.findall(r"[a-z0-9]+", norm_anchor) if len(t) > 2]
        for n in (12, 10, 8, 6):
            if len(toks) < n:
                continue
            chunk = " ".join(toks[:n])
            if chunk in norm_sub:
                return True
            if n > 6 and " ".join(toks[: n - 1]) in norm_sub:
                return True
            if n > 7 and " ".join(toks[: n - 2]) in norm_sub:
                return True
    # Paraphrase-tolerant: stemmed content tokens in order + citation fingerprint when present
    a_toks = _content_tokens(norm_anchor)
    s_toks = _content_tokens(norm_sub)
    if len(a_toks) >= 4 and _ordered_token_coverage(a_toks, s_toks) >= 0.65:
        return True
    cite = re.search(r"\b([a-z]+)\s+et\s+al\b", norm_anchor)
    if cite and cite.group(0) in norm_sub:
        # Author et al. present; require most distinctive remaining content tokens
        rest = [t for t in a_toks if t != _light_stem(cite.group(1)) and t not in {"etal", "al"}]
        if rest:
            hit = sum(1 for t in rest if t in set(s_toks))
            if hit / max(1, len(rest)) >= 0.5:
                return True
        elif cite.group(0) in norm_sub:
            return True
    return False


# Common rubric jargon → student phrasing. Used only to credit demonstrated work,
# never to invent new mandatory requirements.
_CONCEPT_ALIASES: dict[str, tuple[str, ...]] = {
    "gap analysis": ("research gap", "identify the gap", "gap for", "literature gap"),
    "theoretical framing": ("theoretical framework", "theoretical", "theory grounded", "self-determination"),
    "prior interventions": ("prior work", "prior studies", "prior tutoring", "previous studies", "existing interventions"),
    "synthesis": ("synthesize", "synthesizes", "synthesis of", "we synthesize"),
    "expected outcomes": ("we expect", "anticipated", "expected to", "projected"),
    "methodology": ("methods", "we used", "we fine-tune", "procedure"),
}


def _concept_alias_hit(req_lower: str, hay: str) -> bool:
    for key, aliases in _CONCEPT_ALIASES.items():
        if key in req_lower or req_lower in key:
            if any(a in hay for a in aliases):
                return True
    # Generic: majority of stemmed content tokens from the requirement appear in text.
    toks = [_light_stem(t) for t in re.findall(r"[a-z0-9]+", req_lower) if len(t) > 2]
    if len(toks) >= 2:
        hay_toks = set(_content_tokens(hay))
        hit = sum(1 for t in toks if t in hay_toks)
        if hit / len(toks) >= 0.5:
            return True
    return False


def _local_evidence_haystack(anchor: str, submission_text: str, *, radius: int = 450) -> str:
    """Criterion-local concept haystack: evidence_anchor plus nearby submission excerpt."""
    a = (anchor or "").strip()
    if not a or a.lower() in ("not found", "n/a", "none"):
        return a
    sub = submission_text or ""
    if not sub:
        return a
    sub_l = sub.lower()
    raw_idx = -1
    # Prefer a distinctive mid-quote span so minor LLM paraphrase at the ends still locates.
    toks = re.findall(r"[A-Za-z0-9%]{2,}", a)
    candidates: list[str] = []
    if len(a) >= 12:
        candidates.append(a[: min(64, len(a))].lower())
    if len(toks) >= 4:
        mid = toks[1:7] if len(toks) > 6 else toks[:6]
        candidates.append(" ".join(mid).lower())
        candidates.append(" ".join(toks[:6]).lower())
    for cand in candidates:
        if len(cand) < 10:
            continue
        raw_idx = sub_l.find(cand[:72])
        if raw_idx >= 0:
            break
    if raw_idx < 0 and len(toks) >= 3:
        # Fallback: locate by first 3 content tokens in order.
        pattern = r".{0,40}".join(re.escape(t.lower()) for t in toks[:4])
        m = re.search(pattern, sub_l)
        if m:
            raw_idx = m.start()
    if raw_idx < 0:
        return a
    start = max(0, raw_idx - radius)
    end = min(len(sub), raw_idx + max(len(a), 80) + radius)
    excerpt = sub[start:end].strip()
    if not excerpt or excerpt.lower() == a.lower():
        return a
    return f"{a}\n{excerpt}"


def _infer_covered_concepts(required: list, covered: list, haystack: str) -> list[str]:
    """Fill covered_concepts from submission/evidence text when the LLM left them empty/sparse."""
    req_list = [str(r).strip() for r in (required or []) if str(r).strip()]
    if not req_list:
        return list(covered or [])
    covered_out = [str(x).strip() for x in (covered or []) if str(x).strip()]
    covered_set = {c.lower() for c in covered_out}
    hay = _normalize_quote_text(haystack or "")
    if not hay:
        return covered_out
    for req in req_list:
        rl = req.lower().strip()
        if not rl or rl in covered_set or any(rl in c or c in rl for c in covered_set):
            continue
        toks = [t for t in re.findall(r"[a-z0-9]+", rl) if len(t) > 2]
        # Prefer word/phrase boundaries — avoid matching "a" inside "accuracy"
        if len(rl) >= 4 and re.search(rf"(?:^|[^a-z0-9]){re.escape(rl)}(?:[^a-z0-9]|$)", hay):
            covered_out.append(req)
            covered_set.add(rl)
            continue
        if toks and all(
            re.search(rf"(?:^|[^a-z0-9]){re.escape(t)}(?:[^a-z0-9]|$)", hay) for t in toks
        ):
            covered_out.append(req)
            covered_set.add(rl)
            continue
        if _concept_alias_hit(rl, hay):
            covered_out.append(req)
            covered_set.add(rl)
    return covered_out


def _reconcile_covered_concepts(
    covered: list,
    missing: list,
    *,
    has_evidence: bool,
) -> list[str]:
    """Drop 'demonstrated' claims that contradict missing keywords or lack of evidence."""
    if not has_evidence:
        return []
    miss = {str(m).strip().lower() for m in (missing or []) if str(m).strip()}
    out: list[str] = []
    seen: set[str] = set()
    for c in covered or []:
        cl = str(c).strip()
        if not cl:
            continue
        low = cl.lower()
        if low in seen:
            continue
        if low in miss or any(low in m or m in low for m in miss if len(m) >= 4):
            continue
        out.append(cl)
        seen.add(low)
    return out


def _is_academic_integrity_criterion(title: str = "", desc: str = "", criterion_id: str = "") -> bool:
    blob = f"{title} {desc} {criterion_id}".lower()
    return any(
        k in blob
        for k in (
            "academic integrity",
            "plagiarism",
            "ai disclosure",
            "ai use disclosure",
            "integrity (ai",
            "citation integrity",
        )
    ) or (
        "integrity" in blob
        and any(k in blob for k in ("ai", "academic", "plagiarism", "honesty", "originality"))
    )


def _justification_denies_credit(just: str) -> bool:
    """True when the write-up argues the criterion is NOT met (critical verdict)."""
    j = (just or "").lower()
    return any(
        m in j
        for m in (
            "does not fulfill",
            "does not meet",
            "does not satisfy",
            "fails to meet",
            "fails to fulfill",
            "fails to address",
            "completely omits",
            "omits any",
            "does not fulfill the requirement",
            "does not address this criterion",
            "does not address the criterion",
            "not fulfill the requirement",
            "missing the required",
            "should be forward-looking",
            "distinct from the reported actual",
        )
    )


def _justification_hard_fail(just: str) -> bool:
    j = (just or "").lower()
    if "no evidence of plagiarism" in j or "no plagiarism" in j:
        return False
    return any(
        m in j
        for m in (
            "blatant plagiarism",
            "copied verbatim from",
            "academic misconduct",
            "entirely missing",
            "does not address the criterion",
            "fails to address",
            "absent from the submission",
        )
    )


def _justification_strongly_positive(just: str) -> bool:
    j = (just or "").lower()
    if _justification_denies_credit(j):
        return False
    markers = (
        "comprehensive", "well-articulated", "fully address", "fully addresses",
        "thoroughly", "excellent", "strong rationale", "clearly articulated",
        "clearly presents", "effectively", "fulfills", "meets the criterion",
        "meets all requirements", "aligns with the rubric", "no evidence of plagiarism",
        "benefit of the doubt", "leniency", "disclosed ai", "highly sound",
        "exceptionally well-structured", "all aspects of the rubric",
    )
    return sum(1 for m in markers if m in j) >= 1


def _justification_claims_full_credit(just: str) -> bool:
    """Narrative asserts the criterion is fully satisfied (no caveats that deny credit)."""
    j = (just or "").lower()
    if _justification_denies_credit(j) or _justification_hard_fail(j):
        return False
    return any(
        m in j
        for m in (
            "meets all requirements",
            "fully meeting the requirements",
            "fully meets",
            "fully address",
            "fully addresses",
            "fully meeting",
            "all aspects of the rubric criterion",
            "all aspects of the criterion",
            "directly addresses all aspects",
            "fully meeting the criterion",
            "highly sound and clear",
            "exceptionally well-structured",
            "thoroughly addressed",
            "fully meeting the criterion's requirements",
            "as required by the assignment",
            "based on research and preliminary work",
            "well-articulated",
        )
    )


def _is_proposal_style_submission(text: str, assignment_context: str = "") -> bool:
    """Heuristic: conceptual/proposed system vs completed empirical ML study.

    Student proposals often use "I would…" / "I will…" planning voice rather than
    "we propose". Count that voice so they are not graded as unfinished lab runs.
    """
    blob = f"{(assignment_context or '')[:4000]}\n{(text or '')[:12000]}".lower()
    proposal_hits = sum(
        1
        for s in (
            "we propose",
            "proposed system",
            "proposed approach",
            "conceptual framework",
            "conceptual design",
            "pilot study",
            "pilot evaluation",
            "planned evaluation",
            "future implementation",
            "as a proposal",
            "proposal-stage",
            "to be implemented",
            "i would",
            "i will",
            "i plan to",
            "would begin",
            "would use",
            "how i would",
        )
        if s in blob
    )
    empirical_hits = sum(
        1
        for s in (
            "we trained",
            "training set",
            "test set",
            "held-out",
            "accuracy of",
            "f1-score",
            "f1 score",
            "confusion matrix",
            "we implemented",
            "hyperparameter",
            "cross-validation",
            "ran the pipeline",
            "pipeline output",
            "after running",
        )
        if s in blob
    )
    # Planning voice is enough even with one explicit proposal phrase.
    if proposal_hits >= 3 and empirical_hits <= 2:
        return True
    return proposal_hits >= 2 and empirical_hits <= 1


def _filter_proposal_missing_keywords(keywords, is_proposal: bool) -> list:
    from grading_server.proposal_filters import filter_proposal_empirical_checklist

    return filter_proposal_empirical_checklist(keywords, is_proposal)


def _criterion_theme(name: str) -> str | None:
    n = (name or "").lower()
    themes = (
        ("methodolog", "methodology"),
        ("methods", "methodology"),
        ("ethic", "ethics"),
        ("challenge", "challenges"),
        ("literature", "literature"),
        ("introduction", "introduction"),
        ("conclusion", "conclusion"),
        ("outcome", "outcomes"),
        ("result", "outcomes"),
        ("integrity", "integrity"),
        ("citation", "integrity"),
    )
    for needle, theme in themes:
        if needle in n:
            return theme
    return None


def _cap_duplicate_evidence_anchors(verdicts: list[dict]) -> list[dict]:
    """First instructor use of an evidence_anchor keeps score; later duplicates ≤50%."""
    seen: set[str] = set()
    out: list[dict] = []
    for v in verdicts:
        row = dict(v)
        if row.get("ai_generated") or row.get("score") is None:
            out.append(row)
            continue
        anchor = str(row.get("evidence_anchor") or "").strip().lower()
        if not anchor or anchor in ("not found", "n/a", "none"):
            out.append(row)
            continue
        key = " ".join(anchor.split())
        if key in seen:
            max_score = _as_points(row.get("max_score"), 0.0)
            cap = max(0.0, math.ceil(max_score * 0.50))
            score = _as_points(row.get("score"), 0.0)
            if score > cap:
                row["score"] = cap
                just = str(row.get("justification") or "")
                note = "Score capped: reused evidence_anchor already credited on another criterion."
                if note not in just:
                    row["justification"] = (just + "\n\n" + note).strip()
                if str(row.get("status") or "").lower() == "full":
                    row["status"] = "partial"
            row["duplicate_evidence_anchor"] = True
        else:
            seen.add(key)
        out.append(row)
    return out


def _dedupe_overlapping_ai_penalties(verdicts: list[dict]) -> list[dict]:
    """Prevent AI-generated criteria from re-docking gaps already scored on the rubric."""
    if not verdicts:
        return verdicts
    rubric = [v for v in verdicts if not v.get("ai_generated")]
    for v in verdicts:
        if not v.get("ai_generated") or v.get("score") is None:
            continue
        theme = _criterion_theme(str(v.get("criterion_name") or ""))
        if not theme:
            continue
        peers = [r for r in rubric if _criterion_theme(str(r.get("criterion_name") or "")) == theme]
        if not peers:
            continue
        a_max = int(v.get("max_score") or 0)
        a_score = int(v.get("score") or 0)
        if a_max <= 0 or a_score >= a_max:
            continue
        # Methodology/ethics-style AI mirrors: do not double-charge the same gap.
        if theme in ("methodology", "ethics", "literature", "outcomes"):
            v["score"] = a_max
            v["status"] = "full"
            note = (
                f"Overlap note: this AI-generated check overlaps the rubric "
                f"'{peers[0].get('criterion_name')}' criterion; the same gap is not deducted twice."
            )
            just = (v.get("justification") or "").strip()
            if "Overlap note:" not in just:
                v["justification"] = (just + "\n\n" + note).strip()
    return verdicts


def _soften_challenges_ethics_double_count(verdicts: list[dict]) -> list[dict]:
    """If Ethical Considerations already scored well, don't harshly dock Challenges for missing ethics labels."""
    ethical = next(
        (
            v
            for v in verdicts
            if _criterion_theme(str(v.get("criterion_name") or "")) == "ethics"
            and not v.get("ai_generated")
        ),
        None,
    )
    challenges = next(
        (
            v
            for v in verdicts
            if _criterion_theme(str(v.get("criterion_name") or "")) == "challenges"
        ),
        None,
    )
    if not ethical or not challenges or ethical.get("score") is None or challenges.get("score") is None:
        return verdicts
    e_max = int(ethical.get("max_score") or 0)
    e_score = int(ethical.get("score") or 0)
    if e_max <= 0 or (e_score / e_max) < 0.75:
        return verdicts
    just = (challenges.get("justification") or "").lower()
    if not any(k in just for k in ("ethical dilemma", "ethical dilemmas", "ethics", "ethical")):
        return verdicts
    c_max = int(challenges.get("max_score") or 0)
    c_score = int(challenges.get("score") or 0)
    if c_max <= 0 or c_score >= c_max:
        return verdicts
    # Lift halfway toward full — ethics already paid for in its own bucket.
    lifted = max(c_score, math.ceil((c_score + c_max) / 2))
    if lifted > c_score:
        challenges["score"] = min(c_max, lifted)
        if challenges["score"] >= c_max:
            challenges["status"] = "full"
        note = (
            "Overlap note: ethical dilemmas are primarily scored under Ethical Considerations; "
            "Challenges credit was adjusted to avoid double-counting."
        )
        cj = (challenges.get("justification") or "").strip()
        if "Overlap note:" not in cj:
            challenges["justification"] = (cj + "\n\n" + note).strip()
    return verdicts


def _apply_genre_criterion_caps(
    v: dict,
    genre: str,
    signals: dict,
    criterion_title: str,
    criterion_desc: str,
) -> dict:
    """Extra numeric pressure when genre signals contradict format/citation/structure criteria."""
    max_score = _as_points(v.get("max_score"))
    if max_score <= 0 or v.get("score") is None:
        return v
    blob = f"{criterion_title} {criterion_desc}".lower()
    score = _as_points(v.get("score"))
    notes: list[str] = []
    integrity_crit = _is_academic_integrity_criterion(criterion_title, criterion_desc, str(v.get("criterion_id") or ""))

    if genre == "research_paper":
        cite_related = any(
            k in blob
            for k in (
                "citation", "citations", "reference", "references", "bibliography",
                "apa", "mla", "ieee", "scholarly source", "works cited", "sourcing",
            )
        )
        # Academic Integrity often mentions "citation" in the description but is NOT a
        # bibliography/APA criterion — do not crush it with reference-list genre caps.
        if integrity_crit:
            cite_related = False
        section_related = any(
            k in blob
            for k in (
                "structure", "organization", "formatting", "format", "section",
                "paper organization", "document structure",
            )
        )
        if cite_related and (not signals.get("has_references") and int(signals.get("in_text_citation_count") or 0) < 2):
            cap = max(0, math.ceil(max_score * 0.40))
            if score > cap:
                score = cap
                notes.append("Genre cap: research-paper citation/reference signals are weak or missing.")
            if v.get("status") == "full":
                v["status"] = "partial"
        if section_related and int(signals.get("canonical_section_count") or 0) < 3 and int(signals.get("section_count") or 0) < 3:
            cap = max(0, math.ceil(max_score * 0.70))
            if max_score > 0:
                cap = min(cap, max_score - 1)
            if score > cap:
                score = cap
                notes.append("Genre cap: paper lacks clear scholarly section structure.")
            if v.get("status") == "full":
                v["status"] = "partial"

    elif genre == "presentation":
        slide_related = any(k in blob for k in ("slide", "presentation", "visual", "deck", "organization", "structure"))
        if slide_related and int(signals.get("section_count") or 0) < 2 and not signals.get("has_slide_markers"):
            # Weak structure signal only — light cap
            cap = max(0, math.ceil(max_score * 0.80))
            if score > cap and max_score > 1:
                score = min(score, cap)
                notes.append("Genre note: limited slide/section structure detected.")

    elif genre in ("code", "notebook"):
        code_related = any(
            k in blob
            for k in ("code", "implementation", "program", "function", "correctness", "notebook", "reproduc")
        )
        if code_related and genre == "code" and int(signals.get("code_fence_count") or 0) == 0 and int(signals.get("char_count") or 0) < 200:
            cap = max(0, math.ceil(max_score * 0.40))
            if score > cap:
                score = cap
                notes.append("Genre cap: little executable/code content detected for a code criterion.")
            if v.get("status") == "full":
                v["status"] = "partial"

    if notes:
        v["score"] = score
        v["justification"] = ((v.get("justification") or "") + "\n\n" + " ".join(notes)).strip()
        v = _apply_verdict_score_guards(v, max_score)
    else:
        v["score"] = score
    return v


def _looks_like_section_heading(raw: str) -> str | None:
    """Return normalized title if this line is a section heading, else None."""
    if not raw or len(raw) > 120:
        return None
    # Strip markdown / numbering wrappers
    candidate = raw.strip()
    md = re.match(r"^(#{1,6})\s+(.+)$", candidate)
    if md:
        candidate = md.group(2).strip()
    numbered = re.match(r"^\d{1,2}[\.\)]\s+(.+)$", candidate)
    if numbered and len(candidate.split()) <= 12:
        candidate = numbered.group(1).strip()
    candidate = candidate.strip().strip(":").strip()
    if not candidate:
        return None
    words = candidate.split()
    if not (1 <= len(words) <= 10):
        return None
    if candidate.endswith((".", ",", ";", "?", "!")):
        return None

    low = candidate.lower()
    if any(h == low or h in low for h in _SECTION_HINTS):
        return candidate

    # ALL CAPS short titles
    if candidate.isupper() and 2 <= len(words) <= 8:
        return candidate.title()

    # Title Case / near-title-case short lines (Word List Paragraph titles)
    alpha_words = [w for w in words if re.search(r"[A-Za-z]", w)]
    if alpha_words and all(re.match(r"^[A-Z0-9][\w\-/'&]*$", w) for w in alpha_words):
        # Avoid treating normal sentences as headings: require section-ish vocabulary
        # or very short (1–4 word) title-case labels.
        if len(alpha_words) <= 4 or any(
            w.lower() in {
                "introduction", "abstract", "background", "literature", "review",
                "methodology", "methods", "results", "discussion", "conclusion",
                "conclusions", "references", "ethics", "ethical", "challenges",
                "solutions", "analysis", "findings", "recommendations", "overview",
                "impact", "outcomes", "appendix", "solution", "application",
            }
            for w in alpha_words
        ):
            return candidate
    return None


def _extract_submission_sections(text: str) -> list[dict]:
    """Lightweight heading parse → [{title, start, end, body}]."""
    if not text:
        return []
    lines = text.splitlines()
    offsets: list[int] = []
    pos = 0
    for line in lines:
        offsets.append(pos)
        pos += len(line) + 1

    heading_idxs: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        title = _looks_like_section_heading(line.strip())
        if title:
            # Deduplicate consecutive identical headings
            if heading_idxs and heading_idxs[-1][1].lower() == title.lower():
                continue
            heading_idxs.append((offsets[i], title))

    if not heading_idxs:
        return []

    sections: list[dict] = []
    for j, (start, title) in enumerate(heading_idxs):
        end = heading_idxs[j + 1][0] if j + 1 < len(heading_idxs) else len(text)
        sections.append({
            "title": title,
            "start": start,
            "end": end,
            "body": text[start:end].strip(),
        })
    return sections


def _section_map_is_reliable(sections: list[dict], text: str) -> bool:
    """True when extracted sections look usable for placement penalties."""
    if not sections or not text:
        return False
    if len(sections) < 3:
        return False
    # Bodies should cover a meaningful fraction of the document
    covered = sum(max(0, s["end"] - s["start"]) for s in sections)
    if covered < max(400, int(len(text) * 0.35)):
        return False
    substantial = sum(1 for s in sections if len((s.get("body") or "")) >= 120)
    return substantial >= max(2, len(sections) // 2)


def _criterion_section_hint(title: str, desc: str) -> str | None:
    blob = f"{title} {desc}".lower()
    for hint in sorted(_SECTION_HINTS, key=len, reverse=True):
        if hint in blob:
            return hint
    return None


# Explicit placement only — casual "discuss X in the introduction" is content guidance, not a section gate.
_SECTION_REQUIRE_RE = re.compile(
    r"(?:"
    r"(?:must|should|required|require|needs?\s+to)\b.{0,80}\b"
    r"(?:(?:be\s+)?(?:placed|located|included|appear|written|put)\b.{0,40})?"
    r"(?:under|within|inside|in)\b.{0,40}\b(?:the\s+)?(?:labeled\s+)?"
    r"(?:section|heading|titled)\b"
    r"|(?:must|should|required|require|needs?\s+to)\b.{0,60}\b(?:labeled\s+)?(?:section|heading)\b"
    r"|\blabeled\s+section\b"
    r"|\bthis\s+section\s+(?:must|should|requires?)\b"
    r"|\b(?:place|put|include)\b.{0,40}\b(?:under|in)\b.{0,30}\b(?:the\s+)?(?:section|heading)\b"
    r")",
    re.I,
)


def _instructor_requires_named_section(
    title: str, desc: str, assignment_context: str = ""
) -> bool:
    """True only when instructor text explicitly requires labeled-section placement."""
    blob = f"{title}\n{desc}\n{assignment_context or ''}"
    return bool(_SECTION_REQUIRE_RE.search(blob))


def _resolve_section_for_criterion(sections: list[dict], hint: str | None) -> dict | None:
    if not hint or not sections:
        return None
    for sec in sections:
        if hint in sec["title"].lower():
            return sec
    hint_words = set(hint.split())
    for sec in sections:
        if hint_words & set(sec["title"].lower().split()):
            return sec
    return None


def _as_points(value, default: float = 0.0) -> float:
    """Numeric points without silent int truncation of fractional maxima."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return float(default)
    if v != v or v in (float("inf"), float("-inf")):
        return float(default)
    return v


def _normalize_criterion(c: dict | None, *, index: int = 0) -> dict | None:
    """Ensure criterion_id / max_score exist so grading never KeyErrors on shape drift.

    Accepts Canvas-native `points` and LLM quality rows that omit defaults.
    Returns None when the row is unusable (not a dict / no identity).
    """
    if not isinstance(c, dict):
        return None
    out = dict(c)
    cid = str(out.get("criterion_id") or out.get("id") or "").strip()
    if not cid:
        title = str(out.get("title") or "").strip()
        cid = f"crit_{index}" if not title else f"crit_{index}_{title[:24]}"
    out["criterion_id"] = cid
    raw_max = out.get("max_score", out.get("points", out.get("max_points", 10)))
    max_score = _as_points(raw_max, 10.0)
    if max_score <= 0:
        max_score = 10.0
    out["max_score"] = max_score
    if not out.get("title"):
        out["title"] = cid
    if "description" not in out or out.get("description") is None:
        out["description"] = ""
    if not out.get("dimension"):
        out["dimension"] = "content"
    return out


def _normalize_rubric(criteria: list | None) -> list[dict]:
    """Normalize a rubric list; drop malformed rows."""
    out: list[dict] = []
    for i, c in enumerate(criteria or []):
        row = _normalize_criterion(c if isinstance(c, dict) else None, index=i)
        if row:
            out.append(row)
    return out


def _faculty_friendly_guard_note(note: str) -> str:
    """Translate internal guard jargon into lecturer-facing language."""
    n = (note or "").strip()
    if not n:
        return ""
    mapping = {
        "Score capped: no verifiable student evidence_anchor.": (
            "No verifiable quote from the student submission was linked to this criterion, so credit was limited."
        ),
        "Score capped: content for this criterion is misplaced / outside the expected section.": (
            "Relevant content appears outside the expected section, so credit was limited."
        ),
        "Score capped: student claims contradict retrieved course materials.": (
            "Parts of the response conflict with course materials, so credit was limited."
        ),
        "Partial status cannot receive full points.": (
            "Marked partial, so full points were not awarded."
        ),
        "Score capped: reused evidence_anchor already credited on another criterion.": (
            "The same evidence quote was already credited on another criterion, so credit was limited here."
        ),
    }
    if n in mapping:
        return mapping[n]
    if n.startswith("Score capped:"):
        return n.replace("Score capped:", "Credit limited:", 1).replace("evidence_anchor", "evidence quote")
    if n.startswith("Score adjusted for concept match rate"):
        return n.replace("Score adjusted for concept match rate", "Score adjusted for concept coverage")
    return n


def _text_claims_full_or_glowing(text: str) -> bool:
    t = (text or "").lower()
    cues = (
        "comprehensive",
        "meets the assignment",
        "meets requirements",
        "full credit",
        "fully meets",
        "excellent overview",
        "well-organized and meets",
        "all requirements",
        "complete and accurate",
        "no points were withheld",
        "no points withheld",
        "nothing withheld",
        "met all requirements",
    )
    return any(c in t for c in cues)


def _is_process_only_explanation(text: str) -> bool:
    """True when copy only cites missing quotes / internal caps, not content gaps."""
    t = (text or "").strip().lower()
    if not t:
        return True
    process_cues = (
        "verifiable quote",
        "verifiable student quote",
        "evidence quote",
        "evidence_anchor",
        "no clear student passage",
        "score capped",
        "credit limited",
        "linked as evidence",
        "linked to this criterion",
    )
    has_process = any(c in t for c in process_cues)
    if not has_process:
        return False
    # Still treat as process-only unless it also names a content gap.
    content_cues = (
        "missing",
        "underdeveloped",
        "incomplete",
        "does not",
        "fails to",
        "lacks",
        "thin",
        "shallow",
        "unclear",
        "without enough",
        "not enough depth",
        "specificity",
        "compare",
        "definition",
        "example",
    )
    return not any(c in t for c in content_cues)


def _content_gap_phrases(v: dict) -> list[str]:
    covered = {
        str(c).strip().lower()
        for c in (v.get("covered_concepts") or [])
        if str(c).strip()
    }
    gaps: list[str] = []
    for c in (v.get("missing_keywords") or []):
        s = str(c).strip()
        if s and s.lower() not in {g.lower() for g in gaps}:
            gaps.append(s)
    for c in (v.get("required_concepts") or []):
        s = str(c).strip()
        if s and s.lower() not in covered and s.lower() not in {g.lower() for g in gaps}:
            gaps.append(s)
    return gaps[:6]


def _reconcile_verdict_explanation(
    v: dict,
    *,
    score: float,
    max_score: float,
    anchor_missing: bool,
    teacher_notes: list[str],
) -> dict:
    """Align faculty-facing copy with the final score — never invent a different grade."""
    credit = str(v.get("credit_awarded_for") or "").strip()
    withheld = str(v.get("points_withheld_because") or "").strip()
    just = str(v.get("justification") or "").strip()
    gaps = _content_gap_phrases(v)
    covered = [str(c).strip() for c in (v.get("covered_concepts") or []) if str(c).strip()][:4]
    criterion = str(v.get("criterion_name") or v.get("title") or "this criterion").strip()

    # Translate leftover internal jargon; do not use process notes as the deduction reason.
    for raw in list(
        {
            *(teacher_notes or []),
            "Score capped: no verifiable student evidence_anchor.",
        }
    ):
        friendly = _faculty_friendly_guard_note(str(raw))
        raw_s = str(raw or "").strip()
        if raw_s and raw_s in withheld:
            withheld = withheld.replace(raw_s, "").strip()
        if raw_s and raw_s in just:
            just = just.replace(raw_s, "").strip()
        if friendly and friendly in withheld and _is_process_only_explanation(friendly):
            withheld = withheld.replace(friendly, "").strip()
        if friendly and friendly in just and _is_process_only_explanation(friendly):
            just = just.replace(friendly, "").strip()

    # Drop process-only withheld / credit so we can rebuild content reasons.
    if _is_process_only_explanation(withheld):
        withheld = ""
    if _is_process_only_explanation(credit) and score < max_score:
        credit = ""

    was_glowing = (
        _text_claims_full_or_glowing(credit)
        or _text_claims_full_or_glowing(just)
        or _text_claims_full_or_glowing(withheld)
    )
    inconsistent = score < max_score and was_glowing

    if inconsistent:
        # Glowing full-credit prose is not a usable deduction reason after a partial score.
        credit = ""
        just = ""
        withheld = ""
        if covered:
            credit = (
                f"Partial credit ({score:g}/{max_score:g}) for covering: "
                + ", ".join(covered)
                + "."
            )
        else:
            credit = (
                f"Partial credit ({score:g}/{max_score:g}) for relevant discussion of {criterion}."
            )

    if score >= max_score:
        withheld = ""
    else:
        if gaps and (_is_process_only_explanation(withheld) or not withheld or _text_claims_full_or_glowing(withheld)):
            withheld = (
                f"Not full credit ({score:g}/{max_score:g}): missing or underdeveloped — "
                + ", ".join(gaps)
                + "."
            )
        elif not withheld or _is_process_only_explanation(withheld) or _text_claims_full_or_glowing(withheld):
            # Content reason required — never deduct with only “no quote linked”.
            usable_just = (
                just
                and not was_glowing
                and not _is_process_only_explanation(just)
                and not _text_claims_full_or_glowing(just)
            )
            if usable_just:
                withheld = f"Awarded {score:g}/{max_score:g}. {just}"
                just = ""
            else:
                withheld = (
                    f"Awarded {score:g}/{max_score:g}. The response does not demonstrate "
                    f"{criterion} with enough depth or specificity for full marks."
                )
        if not credit:
            if covered:
                credit = (
                    f"Partial credit ({score:g}/{max_score:g}) for covering: "
                    + ", ".join(covered)
                    + "."
                )
            else:
                credit = f"Partial credit ({score:g}/{max_score:g}) for relevant work on {criterion}."

        # If justification still glows or only repeats process/credit+withheld, collapse it.
        if just and (
            _text_claims_full_or_glowing(just)
            or _is_process_only_explanation(just)
            or was_glowing
            or just.lower() in f"{credit} {withheld}".lower()
            or f"{credit} {withheld}".lower() in just.lower()
        ):
            just = ""

    # Optional soft evidence note — never as the primary withheld reason.
    if (
        score < max_score
        and anchor_missing
        and withheld
        and "student passage" not in withheld.lower()
        and "evidence quote" not in withheld.lower()
    ):
        # Keep withheld content-first; evidence weakness stays out of the headline reason.
        pass

    v["credit_awarded_for"] = credit.strip()
    v["points_withheld_because"] = withheld.strip()
    v["justification"] = just.strip()
    return v


def _apply_verdict_score_guards(v: dict, max_score) -> dict:
    """Enforce status/score sync, evidence/placement/material/concept caps."""
    # Wrong-deliverable zeros must survive post-verify / narrative restores.
    if v.get("wrong_deliverable") and not v.get("ai_generated"):
        max_score = _as_points(max_score, _as_points(v.get("max_score"), 0.0))
        v["max_score"] = max_score
        v["score"] = 0.0
        v["status"] = "missing"
        return v

    max_score = _as_points(max_score)
    if v.get("score") is None:
        # Not assessed: no score exists to cap, and it must never become 0.
        v["status"] = "not_assessable"
        v["max_score"] = max_score
        return v
    raw_score = max(0.0, min(_as_points(v.get("score", 0)), max_score))
    score = raw_score
    status = str(v.get("status", "partial") or "partial").lower()
    if status not in ("full", "partial", "missing"):
        status = "partial"

    anchor = str(v.get("evidence_anchor") or "").strip()
    submission_text = str(v.get("submission_text") or "")
    # Re-validate anchors when submission text is available (fuzzy / near-verbatim)
    if (
        submission_text
        and anchor
        and anchor.lower() not in ("", "not found", "n/a", "none")
        and not _evidence_anchor_in_submission(anchor, submission_text)
    ):
        anchor = "not found"
    anchor_missing = anchor.lower() in ("", "not found", "n/a", "none")
    notes: list[str] = []

    integrity_crit = _is_academic_integrity_criterion(
        str(v.get("criterion_name") or v.get("title") or ""),
        str(v.get("criterion_desc") or ""),
        str(v.get("criterion_id") or ""),
    )
    just_text = str(v.get("justification") or "")
    hard_fail = _justification_hard_fail(just_text)
    denies_credit = _justification_denies_credit(just_text)
    positive_just = _justification_strongly_positive(just_text) and not denies_credit
    claims_full = _justification_claims_full_credit(just_text)
    teacher_notes: list[str] = []  # only real scoring explanations shown to teachers

    # Missing verifiable quote: cap instructor criteria at ≤25% (no restore later).
    if anchor_missing and not integrity_crit:
        cap = max(0, math.ceil(max_score * 0.25))
        if score > cap:
            score = cap
            teacher_notes.append("Score capped: no verifiable student evidence_anchor.")
        if status == "full":
            status = "partial"
            v["ungrounded_full"] = True
    elif anchor_missing and integrity_crit:
        # Integrity without a quote: keep a soft advisory score but never restore to full below.
        cap = max(0, math.ceil(max_score * 0.25))
        if score > cap:
            score = cap
            teacher_notes.append("Score capped: no verifiable student evidence_anchor.")
        if status == "full":
            status = "partial"

    section_map_reliable = v.get("section_map_reliable")
    if section_map_reliable is None:
        section_map_reliable = True
    placement_flagged = v.get("placement_ok") is False or v.get("placement_issue")
    if placement_flagged and section_map_reliable:
        cap = max(0, math.ceil(max_score * 0.70))
        if max_score > 0:
            cap = min(cap, max_score - 1)
        if score > cap:
            score = cap
            teacher_notes.append("Score capped: content for this criterion is misplaced / outside the expected section.")
        if status == "full":
            status = "partial"
        v["placement_issue"] = True
    elif placement_flagged and not section_map_reliable:
        # Parsing failed (e.g. Word List Paragraph titles) — keep model's qualitative score
        v["placement_ok"] = True
        v["placement_issue"] = False
        # Silent: do not expose internal section-map diagnostics in teacher feedback

    alignment = str(v.get("material_alignment", "neutral") or "neutral").lower()
    if alignment not in ("supports", "neutral", "contradicts"):
        alignment = "neutral"
    v["material_alignment"] = alignment
    # Soft RAG conflict: if the student quote supports a positive/full narrative,
    # do not demolish the mark — retrieval mismatches are fallible.
    if (
        alignment == "contradicts"
        and not anchor_missing
        and not hard_fail
        and not denies_credit
        and (claims_full or positive_just)
        and "contradict" not in just_text.lower()
        and "conflict" not in just_text.lower()
    ):
        alignment = "neutral"
        v["material_alignment"] = "neutral"
        teacher_notes.append(
            "Retrieved-material conflict was not applied as a hard cap; student evidence supports the awarded credit."
        )
    elif alignment == "contradicts":
        cap = max(0, math.ceil(max_score * 0.60))
        if max_score > 0:
            cap = min(cap, max_score - 1)
        if score > cap:
            score = cap
            teacher_notes.append("Score capped: student claims contradict retrieved course materials.")
        if status == "full":
            status = "partial"

    required = v.get("required_concepts") or []
    covered = v.get("covered_concepts") or []
    has_evidence = not anchor_missing
    # Never invent "demonstrated" coverage when there is no verifiable student quote,
    # and never keep a concept that the same verdict also lists as missing.
    # Concept matching is criterion-local (anchor + nearby excerpt), not whole-submission.
    if isinstance(required, list) and len(required) > 0 and not integrity_crit and has_evidence:
        haystack = _local_evidence_haystack(anchor, submission_text)
        covered = _infer_covered_concepts(required, covered, haystack)
    covered = _reconcile_covered_concepts(
        covered, v.get("missing_keywords") or [], has_evidence=has_evidence
    )
    # Demonstrated list must match what concept scoring counts — drop LLM fluff
    # that is not a required rubric concept (was confusing teachers).
    covered = _covered_matching_required(covered, required if isinstance(required, list) else [])
    v["covered_concepts"] = covered
    if isinstance(required, list) and len(required) > 0 and not integrity_crit:
        covered_set = {str(x).strip().lower() for x in covered if str(x).strip()}
        req_list = [str(r).strip() for r in required if str(r).strip()]
        hit = 0
        for req in req_list:
            rl = req.lower()
            if rl in covered_set or any(rl in c or c in rl for c in covered_set):
                hit += 1
        coverage = hit / max(1, len(req_list))
        # Strong praise (or explicit full-credit language) must not be demoted by an
        # auto concept-match rate — that produced false 14/20-style caps on glowing write-ups.
        if (
            has_evidence
            and not hard_fail
            and not denies_credit
            and (claims_full or positive_just)
        ):
            pass
        else:
            floor = 0.50 if has_evidence else 0.25
            cap = max(0, math.ceil(max_score * max(coverage, floor)))
            if score > cap:
                score = cap
                teacher_notes.append(
                    f"Score adjusted for concept match rate ({hit}/{len(req_list)} auto-matched in text)."
                )

    # Academic Integrity leniency only when a verifiable quote exists.
    if integrity_crit and not hard_fail and positive_just and not anchor_missing:
        floor_pts = max(1, math.ceil(max_score * 0.75)) if max_score > 1 else max_score
        restore = max(floor_pts, min(raw_score, max_score))
        if score < restore:
            score = restore
        if status == "missing":
            status = "partial" if score < max_score else "full"

    # Full-credit narrative + evidence → award full points (concept graph cannot veto).
    # Never restore full credit when the evidence anchor is missing.
    if (
        claims_full
        and not hard_fail
        and not denies_credit
        and alignment != "contradicts"
        and not anchor_missing
    ):
        if score < max_score:
            score = max_score
        status = "full"

    # Narrative↔score reconcile for strong praise that isn't quite "full credit" language:
    # lift contradictory near-zeros only (never override an explicit critical verdict).
    elif (
        positive_just
        and not hard_fail
        and not denies_credit
        and alignment != "contradicts"
        and not anchor_missing
    ):
        floor_ratio = 0.75 if integrity_crit else 0.70
        floor_pts = max(1, math.ceil(max_score * floor_ratio)) if max_score > 0 else 0
        if score < floor_pts:
            score = floor_pts
        if status == "missing" and score > 0:
            status = "partial"

    # Score-safe missing rule: never wipe awarded points because status lagged behind.
    # Recovery / reassess can raise score while leaving status=missing; run_output re-guards.
    if status == "missing" and score > 0:
        status = "full" if max_score and score >= max_score else "partial"

    if status == "missing":
        score = 0
    elif status == "full":
        # Fractional maxima (inferred equal-split policies): an integer near the max
        # with status=full is full credit — do not force perpetual partial.
        if max_score > 0 and score + 1e-9 >= max_score:
            score = max_score
        elif (
            max_score > 0
            and not anchor_missing
            and score >= math.floor(max_score)
            and (max_score - score) < 1.0 + 1e-9
        ):
            score = max_score
        elif score < max_score:
            status = "partial"
        else:
            score = max_score
    elif status == "partial":
        if max_score > 0 and score >= max_score:
            # On 1-pt criteria, max-1 would hard-zero a credited answer.
            if max_score > 1:
                score = max_score - 1
                teacher_notes.append("Partial status cannot receive full points.")
            else:
                score = max_score
        if score <= 0:
            if anchor_missing and not (integrity_crit and positive_just):
                status = "missing"
                score = 0
            elif max_score > 1:
                score = 1
            elif max_score > 0 and not anchor_missing:
                score = max_score  # preserve the only available credit point when evidenced

    v["score"] = score
    v["status"] = status
    v["evidence_anchor"] = "not found" if anchor_missing else anchor
    v["max_score"] = max_score
    # Explain the final score to faculty — do not invent a different grade narrative.
    _reconcile_verdict_explanation(
        v,
        score=score,
        max_score=max_score,
        anchor_missing=anchor_missing,
        teacher_notes=teacher_notes,
    )
    return v


def _holistic_consistency_nudge(verdicts: list[dict]) -> tuple[list[dict], bool]:
    """Nudge near-full scores down when many criteria lack verifiable evidence.

    Short justifications alone are not "thin" — only missing/short anchors,
    ungrounded full marks, or placement failures count. Otherwise solid quotes
    get flagged for human review and docked for no good reason.
    """
    if not verdicts:
        return verdicts, False
    real = [v for v in verdicts if not v.get("ai_generated") and v.get("score") is not None]
    if len(real) < 2:
        return verdicts, False

    near_full = 0
    thin = 0
    for v in real:
        max_s = _as_points(v.get("max_score"))
        score = _as_points(v.get("score"))
        if max_s <= 0:
            continue
        ratio = score / max_s
        anchor = (v.get("evidence_anchor") or "").strip().lower()
        weak = anchor in ("", "not found", "n/a", "none") or len(anchor) < 25
        if ratio >= 0.9:
            near_full += 1
            if weak or v.get("ungrounded_full") or v.get("placement_issue"):
                thin += 1

    force_flag = False
    if near_full >= max(2, (len(real) + 1) // 2) and thin >= max(2, (near_full + 1) // 2):
        force_flag = True
        for v in real:
            max_s = int(v.get("max_score") or 0)
            score = int(v.get("score") or 0)
            if max_s > 0 and score >= max_s:
                v["score"] = max_s - 1
                v["status"] = "partial"
                v["justification"] = (
                    (v.get("justification") or "")
                    + "\n\nHolistic review: reduced from full marks due to thin evidence across multiple criteria."
                ).strip()
    return verdicts, force_flag


def _covered_matching_required(covered: list, required: list) -> list[str]:
    """Keep only demonstrated concepts that correspond to a required rubric concept."""
    req_list = [str(r).strip() for r in (required or []) if str(r).strip()]
    if not req_list:
        return [str(c).strip() for c in (covered or []) if str(c).strip()]
    out: list[str] = []
    seen: set[str] = set()
    for c in covered or []:
        cl = str(c).strip()
        if not cl:
            continue
        low = cl.lower()
        if low in seen:
            continue
        if any(low == r.lower() or low in r.lower() or r.lower() in low for r in req_list):
            out.append(cl)
            seen.add(low)
    return out

# Node 1: Ingest (Sync)
async def run_ingest(state: GradingState) -> dict:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    txt = state["submission_text"]
    chunks = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50).split_text(txt) or [txt[:1000]]
    provider, api_key = _llm_creds(state)
    c_res = await asyncio.to_thread(
        call_gemini,
        f"Extract concepts as a JSON object with a 'concepts' key (array of strings): {txt[:2000]}",
        GEMINI_LITE_MODEL,
        0.2,
        8192,
        None,
        api_key,
        provider,
    )
    e_res = await asyncio.to_thread(_embed_sync, chunks, provider, api_key, "document")
    
    concepts = []
    if isinstance(c_res, list):
        concepts = c_res
    elif isinstance(c_res, dict):
        concepts = c_res.get("concepts", [])
        
    return {"chunks": chunks, "chunk_embeddings": e_res, "submission_concepts": concepts}

class RubricStoreUnavailable(RuntimeError):
    """Rubric/exemplar tables could not be read; /api/grade returns 503 with no draft."""


class RubricInvalid(RuntimeError):
    """Instructor rubric exists but is unusable; requires explicit instructor decision (no silent fallback)."""

    def __init__(self, message: str, validation_errors: list | None = None):
        super().__init__(message)
        self.validation_errors = list(validation_errors or [])


def _policy_store_for_client(sb):
    """Prefer persisted assessment_policies when migrated; otherwise process-local freeze store."""
    from grading_server.assessment_policy.store import SupabasePolicyStore, get_default_store

    try:
        sb.table("assessment_policies").select("policy_id").limit(0).execute()
        return SupabasePolicyStore(sb)
    except Exception:
        # shortcut: table may be unmigrated; in-memory freeze still serializes concurrent requests in-process.
        return get_default_store()


# Node 2: Retrieve — Semantic Vector Search + Exemplars (+ assignment-level policy resolve)
async def run_retrieve(state: GradingState) -> dict:
    import numpy as np

    def _db():
        from grading_server.assessment_policy import resolve_assessment_policy

        sb = get_supabase()
        aid = state["assignment_id"]
        cid = str(state.get("course_id") or "")

        def fetch_rows():
            return (
                sb.table("rubric_criteria")
                .select("*")
                .eq("assignment_id", aid)
                .eq("course_id", cid)
                .execute()
                .data
                or []
            )

        try:
            exemplars_raw = (
                sb.table("exemplars")
                .select("*")
                .eq("assignment_id", aid)
                .eq("course_id", cid)
                .execute()
                .data
                or []
            )
        except Exception as e:
            print(f"[RAG] Exemplar retrieve error: {e}")
            raise RubricStoreUnavailable(str(e)) from e

        store = _policy_store_for_client(sb)
        resolution = resolve_assessment_policy(
            course_id=cid,
            assignment_id=str(aid),
            fetch_instructor_rubric=fetch_rows,
            assignment_name=str(state.get("assignment_name") or ""),
            assignment_description=str(state.get("assignment_description") or ""),
            explicit_outcomes=list(state.get("explicit_outcomes") or []),
            points_possible=state.get("points_possible"),
            approved_template_id=state.get("approved_template_id"),
            created_by=None,
            store=store,
            submission_text=None,  # never feed student work into policy generation
        )
        if resolution.error_code == "RUBRIC_STORE_UNAVAILABLE":
            raise RubricStoreUnavailable(resolution.error_message or "rubric store unavailable")
        if resolution.error_code == "RUBRIC_INVALID":
            raise RubricInvalid(
                resolution.error_message or "invalid rubric",
                resolution.lookup.validation_errors,
            )

        rubric = _normalize_rubric(list(resolution.rubric_criteria))
        policy = resolution.policy.model_dump() if resolution.policy else None
        lookup_status = resolution.lookup.status

        exemplars_by_criterion = {}
        for ex in exemplars_raw:
            ecid = ex.get("criterion_id", "")
            exemplars_by_criterion.setdefault(ecid, []).append(ex)

        # Adaptive quality criteria only supplement a real instructor rubric — never invent a fallback.
        if lookup_status == "instructor_rubric_found" and rubric:
            try:
                quality_prompt = (
                    "Based on the following assignment rubric, generate exactly 2 core Quality & Academic Integrity evaluation criteria tailored to this specific assignment type. "
                    "IMPORTANT: The Academic Integrity criterion MUST be highly lenient and give the student the benefit of the doubt by default. It should ONLY flag genuine, obvious integrity concerns (e.g., direct blatant plagiarism) and must NOT penalize stylistic or structural similarities. "
                    "CRITICAL: Do NOT create criteria that duplicate existing rubric titles or scopes. "
                    "If the rubric already has Methodology/Methods, Literature Review, Ethical Considerations, Challenges, Results/Outcomes, etc., "
                    "do NOT invent another Methodology Soundness / Methods Rigor / Ethics Quality criterion that would re-score the same gap. "
                    "Prefer complementary axes such as Overall Coherence/Writing Quality and Academic Integrity / Citation Honesty. "
                    "For programming assignments, prefer Code Quality and Best Practices only when those are not already in the rubric.\n\n"
                    f"Existing Rubric Titles: {[r.get('title') for r in rubric]}\n"
                )
                provider, api_key = _llm_creds(state)
                quality_res = call_gemini(
                    quality_prompt,
                    model=GEMINI_LITE_MODEL,
                    response_schema=DynamicCriteria,
                    api_key=api_key,
                    provider=provider,
                )
                new_criteria = quality_res.get("criteria", [])
                injected = 0
                for i, nc in enumerate(new_criteria):
                    if hasattr(nc, "model_dump"):
                        nc_dict = nc.model_dump()
                    elif isinstance(nc, dict):
                        nc_dict = dict(nc)
                    else:
                        continue
                    nc_dict["assignment_id"] = aid
                    nc_dict["title"] = f"{nc_dict.get('title', 'Criterion')} (AI-Generated)"
                    nc_dict["ai_generated"] = True
                    if not nc_dict.get("criterion_id"):
                        nc_dict["criterion_id"] = f"ai_quality_{i}"
                    if nc_dict.get("max_score") is None and nc_dict.get("points") is None:
                        nc_dict["max_score"] = 10
                    normalized = _normalize_criterion(nc_dict, index=len(rubric) + i)
                    if not normalized:
                        continue
                    rubric.append(normalized)
                    injected += 1
                print(f"[RAG] Injected {injected} adaptive quality criteria.")
            except Exception as e:
                print(f"[RAG] Failed to inject dynamic quality criteria: {e}")

        rubric = _normalize_rubric(rubric)
        print(
            f"[RAG] Retrieved: {len(rubric)} criteria, {len(exemplars_raw)} exemplars, "
            f"policy_lookup={lookup_status}, policy_origin={(policy or {}).get('origin')}"
        )
        return rubric, exemplars_by_criterion, policy, lookup_status

    r, ex, policy, lookup_status = await asyncio.to_thread(_db)
    return {
        "rubric_criteria": r,
        "exemplars": ex,
        "relevant_chunks": [],
        "assessment_policy": policy,
        "policy_lookup_status": lookup_status,
    }

from pydantic import BaseModel, field_validator
from typing import Literal

class LLMGradingPayload(BaseModel):
    # float so fractional policy maxima are not silently int-truncated at parse time
    score: float
    justification: str
    evidence_anchor: str
    status: Literal['full', 'partial', 'missing']
    credit_awarded_for: str = ""
    points_withheld_because: str = ""
    missing_keywords: list[str] = []
    supporting_materials: list[str] = []
    covered_concepts: list[str] = []
    required_concepts: list[str] = []
    material_alignment: Literal['supports', 'neutral', 'contradicts'] = 'neutral'
    placement_ok: bool = True

    @field_validator(
        "missing_keywords",
        "supporting_materials",
        "covered_concepts",
        "required_concepts",
        mode="before",
    )
    @classmethod
    def _coerce_lists(cls, value):
        return _coerce_str_list(value)

class DecomposedCriterion(BaseModel):
    sub_queries: list[str]

async def _decompose_criterion(
    criterion_title: str,
    criterion_desc: str,
    api_key: str | None = None,
    provider: str | None = None,
    deep: bool = False,
) -> list[str]:
    if not deep:
        return [f"{criterion_title}: {criterion_desc}"]
    prompt = f"""
You are an expert grading assistant. Your task is to decompose the following grading rubric criterion into 2 to 4 specific, verifiable sub-questions. These sub-questions will be used as search queries to retrieve relevant course materials.
Focus on the core factual, conceptual, or structural requirements of the criterion.

Rubric Criterion Title: {criterion_title}
Rubric Criterion Description: {criterion_desc}

Decompose this into 2-4 sub-queries. Return them as a JSON list of strings.
"""
    try:
        res = await asyncio.to_thread(
            call_gemini,
            prompt,
            GEMINI_LITE_MODEL,
            0.2,
            8192,
            DecomposedCriterion,
            api_key,
            provider,
        )
        return res.get("sub_queries", [])
    except Exception as e:
        print(f"[Decompose Error] {e}")
        return [f"{criterion_title}: {criterion_desc}"]

RAG_USABLE_SIMILARITY = 0.28
RAG_STRONG_SIMILARITY = 0.45
# Cap concurrent provider embeds / grade LLMs. Use threading.Semaphore — Flask
# async views create a fresh event loop per request, so asyncio.Semaphore bound
# at import/"first use" raises "bound to a different event loop" and drops scores.
_EMBED_CONCURRENCY = threading.Semaphore(2)
# Cap concurrent criterion grading LLM calls. Unbounded gather + no Gemini HTTP
# timeout starved the default to_thread pool and left /api/grade hung for minutes.
_GRADE_LLM_CONCURRENCY = 3
_GRADE_LLM_SEM = threading.Semaphore(_GRADE_LLM_CONCURRENCY)
# Cap concurrent /api/grade requests. Continuous grading of large DOCX/PDF
# submissions stacked in threaded Flask and OOM'd the 2GB Render instance.
_GRADE_MAX_CONCURRENT = max(1, int(os.getenv("GRADE_MAX_CONCURRENT", "1")))
_GRADE_INFLIGHT = threading.Semaphore(_GRADE_MAX_CONCURRENT)


def _with_grade_slot(fn):
    """One heavy grade at a time (override with GRADE_MAX_CONCURRENT)."""
    async def wrapper(*args, **kwargs):
        if not _GRADE_INFLIGHT.acquire(blocking=True, timeout=180):
            return jsonify({
                "error": "GRADE_BUSY",
                "message": (
                    "Another grade is still running on this server. "
                    "Wait a moment and retry — this limit prevents memory crashes."
                ),
            }), 503
        try:
            return await fn(*args, **kwargs)
        finally:
            _GRADE_INFLIGHT.release()
    wrapper.__name__ = getattr(fn, "__name__", "grade_submission")
    return wrapper

_RETRIEVAL_UNAVAILABLE_CTX = {
    "infrastructure_error": (
        "(Course material retrieval FAILED due to a system error. This is NOT evidence about the student. "
        "Grade from the rubric, assignment context, and submission only. Set material_alignment='neutral'.)"
    ),
    "no_corpus": (
        "(No course material is indexed for this assignment. Grade from the rubric, assignment context, "
        "and submission only. Set material_alignment='neutral'.)"
    ),
    "no_useful_matches": (
        "(No sufficiently relevant course material was found for this criterion. Grade from the rubric, "
        "assignment context, and submission only. Set material_alignment='neutral'.)"
    ),
}

async def _multihop_retrieve(
    sub_queries: list[str],
    assignment_id: str,
    api_key: str | None = None,
    course_id: str | None = None,
    provider: str | None = None,
) -> tuple[list[dict], str]:
    """Return (chunks, retrieval_status). Chunks are non-empty only when status is "ok".

    Status: ok | no_useful_matches (top similarity < 0.28) | no_corpus (search
    succeeded with 0 rows) | infrastructure_error (embedding or search failed).
    There is no unranked fallback: unrelated chunks must not be presented as
    semantic retrieval.
    """
    if not sub_queries:
        return [], "no_useful_matches"
    try:
        space = space_for_provider(provider)

        def _embed_capped():
            with _EMBED_CONCURRENCY:
                return _embed_sync(sub_queries, provider, api_key, "query")

        embeddings = await asyncio.to_thread(_embed_capped)
    except Exception as e:
        print(f"[Embed Error] {e}")
        return [], "infrastructure_error"
    
    def _search(vec):
        if not vec:
            raise ValueError("empty query embedding")
        # v2 only returns active-batch chunks whose space/index match; legacy rows stay quarantined.
        # No fallback to the unfiltered v1 RPC: a missing v2 is an infrastructure error.
        params = {
            "query_embedding": vec,
            "match_count": 5,
            "filter_assignment_id": assignment_id,
            "filter_course_id": course_id,
            "filter_space_id": space.space_id,
            "filter_index_version": INDEX_VERSION,
        }
        return get_supabase().rpc("match_course_material_chunks_v2", params).execute().data or []

    try:
        results = await asyncio.gather(*(asyncio.to_thread(_search, v) for v in embeddings))
        chunks = [row for rows in results for row in rows]
    except Exception as e:
        print(f"[Vector Search Error] {e}")
        return [], "infrastructure_error"
    if not chunks:
        return [], "no_corpus"
    seen = set()
    unique_chunks = []
    for c in chunks:
        cid = c.get("id")
        if cid not in seen:
            seen.add(cid)
            unique_chunks.append(c)
    if not unique_chunks:
        return [], "no_corpus"
    if top_chunk_similarity(unique_chunks) < RAG_USABLE_SIMILARITY:
        return [], "no_useful_matches"
    return unique_chunks, "ok"

# Parallel Grade Helper — Context-Aware with Semantic RAG + Exemplars
async def _gp(
    c,
    ctx,
    txt,
    exemplar_context,
    previous_critique=None,
    api_key=None,
    provider=None,
    assignment_context: str = "",
    section_guide: str = "",
    expected_section_title: str | None = None,
    enforce_placement: bool = False,
    submission_genre: str = "general",
    genre_signals: dict | None = None,
    section_map_reliable: bool = True,
    is_proposal: bool = False,
    peer_rubric_titles: list[str] | None = None,
    retrieval_status: str = "ok",
):
    c = _normalize_criterion(c if isinstance(c, dict) else None) or {
        "criterion_id": "unknown",
        "title": "Unknown",
        "description": "",
        "max_score": 10.0,
        "dimension": "content",
    }
    criterion_title = c.get('title', c.get('criterion_id', 'Unknown'))
    criterion_desc = c.get('description', '')
    max_score = _as_points(c.get('max_score'), 10.0)
    genre_signals = genre_signals or {"genre": submission_genre}
    peer_rubric_titles = peer_rubric_titles or []
    title_lower = str(criterion_title).lower()

    # Heuristic for dimension if defaulted to 'content'
    dimension = c.get('dimension', 'content')
    if any(kw in title_lower for kw in ['structure', 'format', 'grammar', 'organization', 'presentation', 'style', 'mechanic', 'writing', 'citation', 'reference', 'formatting']):
        dimension = 'structure'

    def _not_assessable(failure_kind: str, justification: str) -> dict:
        return {
            "criterion_id": c.get('criterion_id', 'unknown'),
            "criterion_name": c.get('title', c.get('criterion_id', 'unknown')),
            "dimension": dimension,
            "score": None,
            "max_score": max_score,
            "status": "not_assessable",
            "failure_kind": failure_kind,
            "retrieval_status": retrieval_status,
            "justification": justification,
            "evidence_anchor": "not found",
            "ai_generated": c.get("ai_generated", False),
            "material_alignment": "neutral",
        }

    # Opt-in per criterion; the default (submission_sufficient) grades from the submission alone.
    # requires_reference needs usable evidence ("ok"), not merely a successful search. The
    # usable cut-off (RAG_USABLE_SIMILARITY) is a heuristic, not calibrated per corpus/model.
    if c.get("evidence_policy") == "requires_reference" and retrieval_status != "ok":
        reason = {
            "no_corpus": "no course reference material is indexed",
            "no_useful_matches": "no sufficiently relevant course reference material was found",
            "infrastructure_error": "course reference retrieval failed (system error)",
        }.get(retrieval_status, retrieval_status)
        return _not_assessable(
            "reference_unavailable",
            f"Not assessed: this criterion requires course reference material, and {reason}. "
            "This is a system limitation, not a judgement of the student.",
        )

    # Build exemplar section if available
    exemplar_section = ""
    if exemplar_context:
        exemplar_section = "\n--- EXEMPLAR EXAMPLES (for calibration) ---\n"
        for ex in exemplar_context[:3]:  # limit to top 3 exemplars
            exemplar_section += (
                f"  Score: {ex.get('score', '?')}/{ex.get('max_score', '?')} — "
                f"Excerpt: {str(ex.get('submission_text', ''))[:300]}\n"
            )
        exemplar_section += "--- END EXEMPLARS ---\n\n"

    if previous_critique:
        exemplar_section += (
            "=== PREVIOUS CRITIQUE (Self-Correction Needed) ===\n"
            "The previous grading attempt was flagged as TOO GENEROUS or poorly evidenced.\n"
            f"Critique: {previous_critique.get('reasoning', previous_critique.get('justification', 'Unknown'))}\n"
            "Revise with STRICTER TA standards: lower the score unless the submission clearly earns it "
            "with criterion-relevant depth, correct placement when sections apply, and a strong evidence_anchor.\n\n"
        )

    credit_bands = (
        f"=== PARTIAL CREDIT BANDS (max={max_score}) ===\n"
        f"- Mention-only / keyword presence without substance: score ≤ {max(0, math.ceil(max_score * 0.40))}.\n"
        f"- Thin / incomplete / partially misplaced / poorly formatted for genre: score ≤ {max(0, math.ceil(max_score * 0.70))}.\n"
        f"- Full credit ONLY if the criterion is substantially complete for the points, "
        f"follows assignment instructions, meets genre-appropriate method standards, "
        f"and has a criterion-relevant student quote (content may appear anywhere in the submission "
        f"unless the rubric/assignment explicitly requires a named section).\n"
        f"- status must match score: full ⇒ score=={max_score}; missing ⇒ 0; partial ⇒ between.\n\n"
        f"=== FACULTY EXPLANATION (explain the score — do NOT change scoring standards) ===\n"
        f"- First decide score/status using the scoring philosophy and bands above. Then explain that decision.\n"
        f"- credit_awarded_for: brief note on what earned the points you awarded (must match the score).\n"
        f"- points_withheld_because: when score < {max_score}, briefly why full marks were not given "
        f"(must match the score; do not praise as complete/meets-requirements if you scored partial).\n"
        f"- justification: one coherent faculty paragraph consistent with the numeric score.\n"
        f"- Never invent missing content. Never write full-credit praise for a partial/missing score.\n"
        f"- Tone: neutral professional faculty language only. No empathy scripts, emotional inference, "
        f"praise fluff, encouragement slogans, or first-person feelings.\n\n"
    )

    genre_block = _genre_grading_guide(
        submission_genre, genre_signals, dimension, is_proposal=is_proposal
    )

    scope_notes = ""
    if is_proposal:
        scope_notes += (
            "=== DELIVERABLE STAGE: CONCEPTUAL / PROPOSAL ===\n"
            "This submission reads as a proposed/planned system (pilot or future evaluation), not a completed "
            "trained-model empirical study. Grade methodology for clarity of the planned approach, algorithms/"
            "software named at a design level, and evaluation plan — do NOT require completed train/test splits, "
            "trained-model metrics, preprocessing pipelines, or labeled-dataset results the paper never claimed "
            "to have finished. missing_keywords / required_concepts must not invent empirical-implementation "
            "checklist items (running the pipeline, pipeline execution, pre-built ML pipeline, hyperparameter "
            "tuning, supervised/unsupervised technique) absent from a proposal deliverable.\n"
            "For criteria titled like Running the Pipeline / Result Interpretation / Model Evaluation: award "
            "partial-to-full credit when the student clearly explains what they would run, which metrics they "
            "would use, and how they would interpret outputs — status must NOT be missing solely for lacking "
            "completed empirical results.\n\n"
        )
    if "challenge" in title_lower and any("ethic" in t for t in peer_rubric_titles):
        scope_notes += (
            "=== CROSS-CRITERION SCOPE ===\n"
            "A separate Ethical Considerations criterion exists. Do NOT deduct on Challenges merely because "
            "ethical dilemmas are not re-labeled inside Challenges — ethics belong primarily in the ethics section. "
            "Score Challenges on technical/practical obstacles and solutions presented there.\n\n"
        )
    if c.get("ai_generated") and any(
        _criterion_theme(criterion_title) and _criterion_theme(criterion_title) == _criterion_theme(t)
        for t in peer_rubric_titles
    ):
        scope_notes += (
            "=== AI-GENERATED COMPLEMENTARY CHECK ===\n"
            "This criterion is supplementary. Do NOT re-penalize gaps already covered by an overlapping "
            f"rubric criterion among: {peer_rubric_titles}. Prefer coherence/writing/integrity angles.\n\n"
        )

    if dimension == 'structure':
        scoring_philosophy = (
            f"=== SCORING PHILOSOPHY (STRUCTURE) — experienced TA ===\n"
            f"- Require ADEQUACY for the points, not a single topical mention.\n"
            f"- PRIMARY EVIDENCE: Grade from the STUDENT SUBMISSION. evidence_anchor MUST be a verbatim quote "
            f"from the student text that actually demonstrates this structural requirement.\n"
            f"- VISUALS/TABLES: [FIGURE / VISUAL ...] and [TABLE ...] blocks are real student content — credit them.\n"
            f"- If no valid student quote exists, set evidence_anchor to 'not found' (this will reduce score).\n"
            f"- Course materials: soft accuracy check for terminology when present. Do NOT invent slide-only requirements "
            f"absent from the rubric. If the student clearly CONTRADICTS retrieved materials, set material_alignment='contradicts'. "
            f"If materials are silent/thin, use material_alignment='neutral' and grade from rubric + assignment context.\n"
            f"- Organization must match the deliverable type (paper sections, slide flow, code/notebook structure).\n"
            f"- Citations/references/formatting: when the rubric or assignment requires them, grade as a human reviewer "
            f"would for that genre (see GENRE standards).\n"
            f"- CONCEPT GRAPH: required_concepts from the RUBRIC; covered_concepts only from student text.\n"
            f"- placement_ok: false ONLY if the rubric/assignment explicitly requires a named section and supporting "
            f"content is absent from that section (misplaced then earns at most partial). Otherwise credit relevant "
            f"content anywhere in the submission and set placement_ok=true.\n\n"
        )
    else:
        scoring_philosophy = (
            f"=== SCORING PHILOSOPHY (CONTENT) — experienced TA ===\n"
            f"- Require ADEQUACY for the points: depth, accuracy, and relevance to THIS criterion — not mere topical mention.\n"
            f"- PRIMARY EVIDENCE: Grade against the RUBRIC using the STUDENT SUBMISSION. evidence_anchor MUST be a "
            f"verbatim student quote that is clearly relevant to this criterion.\n"
            f"- Paraphrase is fine when it shows real understanding; keyword stuffing is not full credit.\n"
            f"- VISUALS/TABLES: [FIGURE / VISUAL ...] / [TABLE ...] markers are real evidence when present.\n"
            f"- If no valid student quote exists, set evidence_anchor to 'not found'.\n"
            f"- Course materials: soft accuracy check. Penalize clear contradictions (material_alignment='contradicts'). "
            f"Do NOT zero a criterion because slides omit the topic or use a different example domain. "
            f"Prefer the rubric over unrelated retrieved chunks. Silent materials ⇒ material_alignment='neutral'.\n"
            f"- ASSIGNMENT CONTEXT instructions (required methods, sections, citation style, deliverable type) are BINDING "
            f"unless they conflict with the rubric's point rules — then follow the rubric for points and note the conflict.\n"
            f"- For research methods/results/analysis criteria, demand the correct scholarly method for the claim type.\n"
            f"- missing_keywords: rubric concepts the student missed (not slide-only topics).\n"
            f"- CONCEPT GRAPH: required_concepts from RUBRIC; covered_concepts from student text only.\n"
            f"- placement_ok: false ONLY when the instructor explicitly requires a named section and the content "
            f"satisfying this criterion is absent from it. Criterion-relevant content elsewhere still counts when "
            f"placement is not explicitly required.\n\n"
        )

    assign_block = ""
    if (assignment_context or "").strip():
        assign_block = (
            "=== ASSIGNMENT CONTEXT (binding instructions) ===\n"
            f"{assignment_context.strip()}\n"
            "Treat explicit instructions here (format, required sections, citation style, length, methods, "
            "deliverable type) as requirements when scoring this criterion. Rubric allocates points; "
            "assignment instructions define how the work should be done.\n\n"
        )
    section_block = f"{section_guide}\n" if section_guide else ""

    prompt = (
        f"You are an experienced academic grader / TA. Grade ONE rubric criterion rigorously and fairly, "
        f"using the correct professional standards for a {submission_genre.replace('_', ' ')} submission.\n\n"
        f"=== RUBRIC CRITERION ===\n"
        f"Title: {criterion_title}\n"
        f"Description: {criterion_desc}\n"
        f"Max Score: {max_score}\n"
        f"{f'Expected section (if present in submission): {expected_section_title}' if expected_section_title else ''}\n\n"
        f"{assign_block}"
        f"{genre_block}"
        f"{scope_notes}"
        f"{scoring_philosophy}"
        f"{credit_bands}"
        f"=== COURSE MATERIALS (soft accuracy reference — not mandatory ground truth) ===\n{ctx}\n\n"
        f"{exemplar_section}"
        f"{section_block}"
        f"=== STUDENT SUBMISSION ===\n{txt[:150000]}\n"
    )
    try:
        def _grade_llm_capped():
            with _GRADE_LLM_SEM:
                return call_gemini(
                    prompt,
                    GEMINI_GRADING_MODEL,
                    0.2,
                    8192,
                    LLMGradingPayload,
                    api_key,
                    provider,
                )

        r = await asyncio.to_thread(_grade_llm_capped)
    except Exception as e:
        print(f"[GRADE] Error grading criterion {c.get('criterion_id')}: {e}")
        # A processing failure is not evidence about the student: no score, no guards/caps.
        return _not_assessable(
            "processing_failed",
            f"Not assessed: processing failed ({type(e).__name__}). Requires regrade or human review.",
        )

    evidence_anchor = str(r.get('evidence_anchor', '') or '').strip()

    # Reject anchors that are not actually present in the student submission
    # (allow near-verbatim quotes — LLMs often tweak punctuation/spacing)
    if evidence_anchor and evidence_anchor.lower() not in ("not found", "n/a", "none"):
        if not _evidence_anchor_in_submission(evidence_anchor, txt):
            evidence_anchor = "not found"

    # Force placement fail only when the instructor explicitly requires a named section.
    placement_ok = bool(r.get("placement_ok", True))
    if (
        enforce_placement
        and section_map_reliable
        and expected_section_title
        and evidence_anchor.lower() not in ("", "not found", "n/a", "none")
    ):
        # section_guide embeds EXPECTED SECTION BODY — check anchor against that body when provided
        sec_marker = "=== EXPECTED SECTION BODY"
        if sec_marker in section_guide:
            try:
                body_part = section_guide.split(sec_marker, 1)[1]
                body_part = body_part.split("===", 1)[0] if "===" in body_part else body_part
                # Ignore thin/empty section bodies — likely a parse failure, not real misplacement
                if len(body_part.strip()) >= 120:
                    if (
                        not _evidence_anchor_in_submission(evidence_anchor, body_part)
                        and _evidence_anchor_in_submission(evidence_anchor, txt)
                    ):
                        placement_ok = False
            except Exception:
                pass
    elif not enforce_placement:
        placement_ok = True

    credit_awarded = str(r.get("credit_awarded_for") or "").strip()
    withheld = str(r.get("points_withheld_because") or "").strip()
    raw_score = _as_points(r.get("score", 0))
    if raw_score < _as_points(max_score) and not withheld:
        withheld = (
            f"Awarded {raw_score}/{_as_points(max_score)} (partial). "
            "Full rubric expectations were not fully met for this criterion."
        )

    v = {
        "criterion_id": c.get('criterion_id', 'unknown'),
        "criterion_name": c.get('title', c.get('criterion_id', 'unknown')),
        "dimension": dimension,
        "score": raw_score,
        "max_score": _as_points(max_score),
        "status": str(r.get('status', 'partial')),
        "justification": str(r.get('justification', '')),
        "credit_awarded_for": credit_awarded,
        "points_withheld_because": withheld,
        "missing_keywords": _filter_proposal_missing_keywords(
            r.get('missing_keywords', []) or [],
            is_proposal,
        ),
        "evidence_anchor": evidence_anchor or "not found",
        "supporting_materials": _coerce_str_list(r.get('supporting_materials', []) or []),
        "covered_concepts": _coerce_str_list(r.get('covered_concepts', []) or []),
        "required_concepts": _filter_proposal_missing_keywords(
            r.get('required_concepts', []) or [],
            is_proposal,
        ),
        "ai_generated": c.get("ai_generated", False),
        # Without usable retrieval there is nothing to align against; never penalize for it.
        "material_alignment": (r.get("material_alignment", "neutral") or "neutral") if retrieval_status == "ok" else "neutral",
        "retrieval_status": retrieval_status,
        "placement_ok": placement_ok,
        "placement_issue": not placement_ok,
        "section_map_reliable": section_map_reliable,
        "submission_text": txt,
        "ungrounded_full": False,
    }
    # Proposal plans often name a valid alternate method vs slides — do not treat as contradict.
    if is_proposal and str(v.get("material_alignment") or "").lower() == "contradicts":
        v["material_alignment"] = "neutral"
    v = _apply_verdict_score_guards(v, max_score)
    return _apply_genre_criterion_caps(
        v,
        submission_genre,
        genre_signals,
        criterion_title,
        criterion_desc,
    )

# Node 3: Grade (Concurrent) — Semantic RAG + Exemplar-Aware
async def run_grade(state: GradingState) -> dict:
    from grading_server.assessment_policy.resolve import formative_observation_verdicts
    from grading_server.assessment_policy.types import AssessmentPolicy

    rubric = _normalize_rubric(state.get("rubric_criteria", []))
    exemplars = state.get("exemplars", {})
    txt = state["submission_text"]
    aid = state["assignment_id"]
    assignment_context = state.get("assignment_context") or ""
    filenames = list(state.get("submission_filenames") or [])
    sections = _extract_submission_sections(txt)
    section_map_reliable = _section_map_is_reliable(sections, txt)
    genre = state.get("submission_genre") or _detect_submission_genre(filenames, txt, assignment_context)
    signals = state.get("genre_signals") or _analyze_genre_signals(genre, txt, sections)
    signals["genre"] = genre
    signals["section_map_reliable"] = section_map_reliable
    is_proposal = _is_proposal_style_submission(txt, assignment_context)
    peer_rubric_titles = [str(c.get("title") or c.get("criterion_id") or "") for c in rubric]
    if is_proposal:
        print(f"[GRADE] proposal-style submission detected for {aid}")

    policy_raw = state.get("assessment_policy")
    if isinstance(policy_raw, dict) and policy_raw.get("formative_only"):
        policy = AssessmentPolicy.model_validate(policy_raw)
        return {
            "verdicts": formative_observation_verdicts(txt, policy),
            "relevant_chunks": [],
            "force_flag_for_human": True,
        }

    if not rubric:
        # Genuine empty path without formative policy (should be rare after resolve).
        return {"verdicts": [], "relevant_chunks": []}

    # Map previous critiques by criterion_id if this is a retry loop
    prev_critiques = {
        c["criterion_id"]: c
        for c in state.get("critiques", [])
        if isinstance(c, dict) and c.get("flag_for_human") and c.get("criterion_id")
    }

    async def _process_criterion(c):
        c = _normalize_criterion(c if isinstance(c, dict) else None) or {
            "criterion_id": "unknown",
            "title": "Unknown",
            "description": "",
            "max_score": 10.0,
            "dimension": "content",
        }
        cid = c.get("criterion_id", "")
        criterion_title = c.get('title', cid)
        criterion_desc = c.get('description', '')
        try:
            return await _process_criterion_inner(c, cid, criterion_title, criterion_desc)
        except Exception as e:
            print(f"[GRADE] Criterion {cid} failed without crashing grade: {type(e).__name__}: {e}")
            return ({
                "criterion_id": cid or "unknown",
                "criterion_name": criterion_title or cid or "Unknown",
                "dimension": c.get("dimension", "content"),
                "score": None,
                "max_score": _as_points(c.get("max_score"), 10.0),
                "status": "not_assessable",
                "failure_kind": "processing_failed",
                "retrieval_status": "infrastructure_error",
                "justification": (
                    f"Not assessed: processing failed ({type(e).__name__}). "
                    "Requires regrade or human review."
                ),
                "evidence_anchor": "not found",
                "ai_generated": bool(c.get("ai_generated", False)),
                "material_alignment": "neutral",
            }, [])

    async def _process_criterion_inner(c, cid, criterion_title, criterion_desc):
        provider, api_key = _llm_creds(state)
        # 1. Decompose
        sub_queries = await _decompose_criterion(
            criterion_title, criterion_desc, api_key=api_key, provider=provider,
            deep=bool(state.get("deep_retrieve")),
        )
        # 2. Multi-Hop Retrieve (skipped when provenance forces degrade-and-grade)
        if state.get("rag_degraded"):
            retrieved_chunks, retrieval_status = [], "no_corpus"
        else:
            retrieved_chunks, retrieval_status = await _multihop_retrieve(
                sub_queries,
                aid,
                api_key=api_key,
                course_id=state.get("course_id"),
                provider=provider,
            )
        retrieved_chunks, retrieval_status = coerce_retrieval(retrieved_chunks, retrieval_status)

        # Build context from semantically retrieved course material
        if retrieval_status == "ok":
            ctx = "\n---\n".join([
                f"[Source: {ch.get('source_title', 'Unknown Source').split(' (chunk')[0].strip()}] (Chunk {ch.get('chunk_index', '?')}) (similarity: {round(ch.get('similarity', 0), 2)})\n{ch.get('chunk_text', '')}"
                for ch in retrieved_chunks[:10]
            ])
            top_sim = top_chunk_similarity(retrieved_chunks)
            ctx += (
                "\n\n=== MATERIAL ALIGNMENT (retrieved course materials are available) ===\n"
                "Set material_alignment='supports' when the student's claims are consistent with these materials. "
                "Set 'contradicts' only for a clear factual conflict. "
                "Set 'neutral' only when these materials do not meaningfully address THIS criterion "
                f"(top similarity was {round(top_sim, 2)}; treat ≥0.45 as clearly on-topic).\n"
            )
        else:
            ctx = _RETRIEVAL_UNAVAILABLE_CTX.get(
                retrieval_status, _RETRIEVAL_UNAVAILABLE_CTX["no_corpus"]
            )

        hint = _criterion_section_hint(criterion_title, criterion_desc)
        matched = _resolve_section_for_criterion(sections, hint) if section_map_reliable else None
        enforce_placement = _instructor_requires_named_section(
            criterion_title, criterion_desc, assignment_context or ""
        )
        section_guide = ""
        expected_title = None
        if not section_map_reliable:
            section_guide = (
                "=== PLACEMENT GUIDANCE ===\n"
                "Section headings could not be parsed reliably from this document (common with Word "
                "'List Paragraph' titles). Grade the WHOLE submission for this criterion. "
                "Set placement_ok=true unless the rubric explicitly requires a labeled section that "
                "is entirely absent from the document text.\n"
            )
        elif hint and sections:
            if matched and len((matched.get("body") or "")) >= 120:
                expected_title = matched["title"]
                body_preview = matched["body"][:12000]
                if enforce_placement:
                    section_guide = (
                        f"=== PLACEMENT GUIDANCE ===\n"
                        f"The instructor explicitly requires section placement (hint '{hint}'). "
                        f"Matching heading found: '{matched['title']}'.\n"
                        f"Prefer evidence from that section. If supporting content is only outside it, "
                        f"set placement_ok=false and award at most partial credit.\n"
                        f"=== EXPECTED SECTION BODY ({matched['title']}) ===\n{body_preview}\n"
                    )
                else:
                    section_guide = (
                        f"=== PLACEMENT GUIDANCE ===\n"
                        f"Related heading '{matched['title']}' found (hint '{hint}'). Use as a hint only.\n"
                        f"Grade the WHOLE submission — credit criterion-relevant content wherever it appears. "
                        f"Set placement_ok=true (do not invent a section-placement penalty).\n"
                        f"=== RELATED SECTION BODY ({matched['title']}) — optional focus ===\n{body_preview}\n"
                    )
            else:
                section_guide = (
                    f"=== PLACEMENT GUIDANCE ===\n"
                    f"This criterion suggests section '{hint}', but no usable matching heading/body was found. "
                    f"Grade the whole document; do not invent a missing section penalty unless the rubric "
                    f"explicitly requires that labeled section.\n"
                )

        criterion_exemplars = exemplars.get(cid, []) if isinstance(exemplars, dict) else []
        pc = prev_critiques.get(cid)

        verdict = await _gp(
            c,
            ctx,
            txt,
            criterion_exemplars,
            previous_critique=pc,
            api_key=api_key,
            provider=provider,
            assignment_context=assignment_context,
            section_guide=section_guide,
            expected_section_title=expected_title if enforce_placement else None,
            enforce_placement=enforce_placement,
            submission_genre=genre,
            genre_signals=signals,
            section_map_reliable=section_map_reliable,
            is_proposal=is_proposal,
            peer_rubric_titles=peer_rubric_titles,
            retrieval_status=retrieval_status,
        )
        return verdict, retrieved_chunks

    tasks = [_process_criterion(c) for c in rubric]
    results = list(await asyncio.gather(*tasks))

    # A failed retry must not overwrite an earlier assessed verdict for the same criterion.
    prev_assessed = {
        v.get("criterion_id"): v for v in state.get("verdicts", []) or [] if v.get("score") is not None
    }
    verdicts = [
        prev_assessed.get(res[0].get("criterion_id"), res[0]) if res[0].get("score") is None else res[0]
        for res in results
    ]
    verdicts = _dedupe_overlapping_ai_penalties(verdicts)
    verdicts = _soften_challenges_ethics_double_count(verdicts)
    all_chunks = []
    seen_chunks = set()
    for res in results:
        for ch in res[1]:
            cid = ch.get("id")
            if cid not in seen_chunks:
                seen_chunks.add(cid)
                all_chunks.append(ch)

    verdicts = _cap_duplicate_evidence_anchors(verdicts)

    from grading_server.assessment_policy.deliverable_match import (
        apply_wrong_deliverable_to_verdicts,
        detect_wrong_deliverable,
    )

    deliverable = detect_wrong_deliverable(
        submission_text=str(state.get("submission_text") or ""),
        filenames=list(state.get("submission_filenames") or []),
        assignment_name=str(state.get("assignment_name") or ""),
        assignment_description=str(state.get("assignment_description") or ""),
        is_proposal=bool(state.get("is_proposal")),
    )
    if deliverable.wrong_deliverable:
        verdicts = apply_wrong_deliverable_to_verdicts(verdicts, wrong=True)

    force_flag_for_human = False
    for v in verdicts:
        # AI-injected advisory criteria never force human review.
        if v.get("ai_generated"):
            continue
        if (
            v.get("score") is None
            or v.get("ungrounded_full")
            or v.get("placement_issue")
            or v.get("material_alignment") == "contradicts"
            or v.get("retrieval_status") == "infrastructure_error"
        ):
            force_flag_for_human = True

    verdicts, holistic_flag = _holistic_consistency_nudge(verdicts)
    if holistic_flag:
        force_flag_for_human = True

    # #region agent log
    try:
        import json as _json, time as _time
        from pathlib import Path as _Path
        _p = _Path(r"d:\EduConnect AI\.cursor\debug-9ae70f.log")
        _rows = [{
            "cid": v.get("criterion_id"),
            "name": (v.get("criterion_name") or v.get("title") or "")[:60],
            "score": v.get("score"),
            "max": v.get("max_score"),
            "status": v.get("status"),
            "anchor": (str(v.get("evidence_anchor") or "")[:80]),
            "missing_kw": (v.get("missing_keywords") or [])[:6],
            "ungrounded_full": bool(v.get("ungrounded_full")),
            "placement_issue": bool(v.get("placement_issue")),
            "material_alignment": v.get("material_alignment"),
            "retrieval_status": v.get("retrieval_status"),
        } for v in verdicts]
        _p.open("a", encoding="utf-8").write(_json.dumps({
            "sessionId": "9ae70f", "runId": "post-fix", "hypothesisId": "A,B",
            "location": "app.py:run_grade", "message": "scores after grade+guards+holistic",
            "data": {"n": len(_rows), "sum": sum((r["score"] or 0) for r in _rows if isinstance(r["score"], int)),
                     "holistic_flag": holistic_flag, "rows": _rows},
            "timestamp": int(_time.time() * 1000),
        }) + "\n")
    except Exception:
        pass
    # #endregion

    return {
        "verdicts": verdicts,
        "loop_count": state.get("loop_count", 0) + 1,
        "force_flag_for_human": force_flag_for_human,
        "wrong_deliverable": bool(deliverable.wrong_deliverable),
        "wrong_deliverable_note": deliverable.teacher_note if deliverable.wrong_deliverable else "",
        "relevant_chunks": all_chunks,
        "is_proposal": is_proposal,
    }

# Critique model for structured LLM output
class LLMCritiquePayload(BaseModel):
    is_supported: bool
    is_justified: bool
    confidence: float
    reasoning: str

# Parallel Critique Helper — Actually calls the LLM
async def _cp(v, api_key=None, provider=None):
    # AI-injected advisory criteria never force human review via critique aggregation.
    if v.get("ai_generated"):
        return CritiqueResult(
            criterion_id=v["criterion_id"],
            is_supported=True,
            is_justified=True,
            confidence=0.95,
            flag_for_human=False,
            reasoning="AI advisory criterion — scored for display only; excluded from human-flag aggregation.",
        ).model_dump()
    if v.get("score") is None:
        return CritiqueResult(
            criterion_id=v["criterion_id"],
            is_supported=False,
            is_justified=False,
            confidence=0.0,
            flag_for_human=True,
            reasoning=f"Not assessed ({v.get('failure_kind') or 'unknown'}); no score to critique.",
        ).model_dump()
    criterion_title = v.get("criterion_name", v.get("criterion_id", "Unknown"))
    max_score = _as_points(v.get("max_score"))
    score = _as_points(v.get("score"))
    anchor = str(v.get("evidence_anchor") or "")
    ratio = (score / max_score) if max_score > 0 else 0.0
    prompt = (
        f"You are a strict QA reviewer for AI grades. Fail generous or poorly evidenced verdicts.\n\n"
        f"Criterion: {criterion_title}\n"
        f"Score Given: {score}/{max_score} (ratio={round(ratio, 2)})\n"
        f"Status: {v.get('status', 'unknown')}\n"
        f"Justification: {v.get('justification', '')[:700]}\n"
        f"Evidence Anchor: {anchor[:400]}\n"
        f"material_alignment: {v.get('material_alignment', 'neutral')}\n"
        f"placement_issue: {bool(v.get('placement_issue'))}\n"
        f"ungrounded_full: {bool(v.get('ungrounded_full'))}\n\n"
        f"Set is_supported=false if the evidence_anchor is missing/irrelevant to the criterion, "
        f"or justification does not clearly rest on that quote.\n"
        f"Set is_justified=false if the score is too high for the depth shown, status mismatches score, "
        f"placement_issue is true with near-full score, or material_alignment is contradicts with high score.\n"
        f"High scores (≥80% of max) require strong, criterion-relevant evidence and a specific justification.\n"
        f"confidence: 0.0–1.0. reasoning: brief.\n"
    )
    try:
        r = await asyncio.to_thread(
            call_gemini,
            prompt,
            GEMINI_LITE_MODEL,
            0.2,
            8192,
            LLMCritiquePayload,
            api_key,
            provider,
        )
        is_supported = bool(r.get("is_supported", False))
        is_justified = bool(r.get("is_justified", False))
        confidence = float(r.get("confidence", 0.5))

        # Hard fails that force regrade / human flag
        hard_fail = False
        if ratio >= 0.8 and anchor.strip().lower() in ("", "not found", "n/a", "none"):
            hard_fail = True
            is_supported = False
            is_justified = False
        if v.get("placement_issue") and ratio >= 0.7:
            hard_fail = True
            is_justified = False
        if v.get("material_alignment") == "contradicts" and ratio >= 0.6:
            hard_fail = True
            is_justified = False
        if not is_supported or not is_justified:
            hard_fail = True

        confidence = max(0.0, min(1.0, confidence))
        if hard_fail:
            confidence = min(confidence, 0.55)

        return CritiqueResult(
            criterion_id=v["criterion_id"],
            is_supported=is_supported,
            is_justified=is_justified,
            confidence=confidence,
            flag_for_human=hard_fail or confidence < 0.65,
            reasoning=str(r.get("reasoning", "") or ""),
        ).model_dump()
    except Exception as e:
        print(f"[CRITIQUE] Error critiquing {v.get('criterion_id')}: {e}")
        # Do NOT silently approve — flag for human / regrade pressure
        return CritiqueResult(
            criterion_id=v["criterion_id"],
            is_supported=False,
            is_justified=False,
            confidence=0.4,
            flag_for_human=True,
            reasoning=f"Critique error: {e}",
        ).model_dump()

# Node 4: Critique (Concurrent) — Real LLM Critique
async def run_critique(state: GradingState) -> dict:
    v = state.get("verdicts", [])
    provider, api_key = _llm_creds(state)
    if not v: return {"critiques": []}
    return {"critiques": list(await asyncio.gather(*[_cp(item, api_key=api_key, provider=provider) for item in v]))}

def _restore_evidence_lock_if_violated(v: dict) -> dict:
    """If post-verify guards mutated a locked omission/score/anchor, restore the pinned values.

    Bounded once: does not re-enter the full recovery controller here.
    """
    from grading_server.evidence.integrity import lock_violated
    from grading_server.evidence.types import EvidenceLock

    lock_raw = v.get("evidence_lock")
    if not lock_raw or not v.get("evidence_verified"):
        return v
    try:
        lock = EvidenceLock.model_validate(lock_raw) if isinstance(lock_raw, dict) else lock_raw
    except Exception:
        return v
    if not lock_violated(v, lock):
        return v
    # Invalidate silent mutation of verified omission judgments.
    restored = dict(v)
    restored["score"] = lock.score
    restored["evidence_anchor"] = lock.evidence_anchor
    claim = dict(restored.get("criterion_claim") or {})
    claim["claim_type"] = lock.claim_type
    claim["review_reasons"] = list(
        dict.fromkeys(
            list(claim.get("review_reasons") or [])
            + ["Post-verify mutation reversed; evidence lock rechecked once"]
        )
    )
    restored["criterion_claim"] = claim
    if lock.score is None:
        restored["status"] = "not_assessable"
        restored["failure_kind"] = restored.get("failure_kind") or "processing_failed"
    elif float(lock.score) == 0:
        restored["status"] = "missing"
    restored["evidence_lock_restored"] = True
    return restored


# Node 5: Output — with topic radar, misconception hint, and concepts for Knowledge Graph
async def run_output(state: GradingState) -> dict:
    raw_verdicts = list(state.get("verdicts", []) or [])
    raw_verdicts = _dedupe_overlapping_ai_penalties(raw_verdicts)
    raw_verdicts = _soften_challenges_ethics_double_count(raw_verdicts)
    raw_verdicts = _cap_duplicate_evidence_anchors(raw_verdicts)
    if state.get("wrong_deliverable"):
        from grading_server.assessment_policy.deliverable_match import apply_wrong_deliverable_to_verdicts

        raw_verdicts = apply_wrong_deliverable_to_verdicts(raw_verdicts, wrong=True)
    # Final deterministic consistency pass before aggregation
    raw_verdicts, holistic_flag = _holistic_consistency_nudge(raw_verdicts)

    verts = []
    for v in raw_verdicts:
        # Ensure guards applied once more with clean status/score
        guarded = _apply_verdict_score_guards(dict(v), _as_points(v.get("max_score")))
        # Merge guard outputs back onto the full verdict (keeps evidence_lock / claim).
        merged = {**dict(v), **{k: guarded.get(k, v.get(k)) for k in guarded}}
        if not merged.get("wrong_deliverable"):
            merged = _restore_evidence_lock_if_violated(merged)
        payload = {k: merged[k] for k in merged if k in CriterionVerdict.model_fields}
        # Absent optional fields take model defaults; score stays explicit (None = not assessed).
        payload = {k: val for k, val in payload.items() if val is not None or k == "score"}
        verts.append(CriterionVerdict(**payload))
        # Keep restored claim/lock on state-facing list for evidence block consistency
        v.clear()
        v.update(merged)
    critiques = [CritiqueResult(**{k: c[k] for k in c if k in CritiqueResult.model_fields}) for c in state.get("critiques", [])]

    policy_raw = state.get("assessment_policy") if isinstance(state.get("assessment_policy"), dict) else None
    formative_only = bool(policy_raw and policy_raw.get("formative_only"))

    # Separate content vs structure scores, excluding AI-generated criteria
    content_verts = [v for v in verts if v.dimension == "content" and not v.ai_generated]
    structure_verts = [v for v in verts if v.dimension == "structure" and not v.ai_generated]

    content_max = sum(_as_points(v.max_score) for v in content_verts)
    structure_max = sum(_as_points(v.max_score) for v in structure_verts)
    total_max = content_max + structure_max

    # A total exists only when every required criterion was assessed. Otherwise
    # report a labelled subtotal over assessed criteria, never rescaled to total_max.
    # Formative-only: observations can be fully processed without inventing a total.
    required = content_verts + structure_verts
    failed = [v for v in required if v.score is None]
    assessed = [v for v in required if v.score is not None]
    if formative_only:
        assessment_status = "complete"
        content_score = structure_score = total = None
        total_max = 0.0
        content_max = structure_max = 0.0
        partial_subtotal = None
    elif not failed and required:
        assessment_status = "complete"
        content_score = sum(_as_points(v.score) for v in content_verts)
        structure_score = sum(_as_points(v.score) for v in structure_verts)
        total = content_score + structure_score
        partial_subtotal = None
    else:
        assessment_status = "processing_failed" if not assessed else "partial"
        content_score = structure_score = total = None
        partial_subtotal = {
            "earned": sum(_as_points(v.score) for v in assessed),
            "assessed_max": sum(_as_points(v.max_score) for v in assessed),
            "failed_criteria": [v.criterion_name or v.criterion_id for v in failed],
        }

    # #region agent log
    try:
        import json as _json, time as _time
        from pathlib import Path as _Path
        _p = _Path(r"d:\EduConnect AI\.cursor\debug-9ae70f.log")
        _pre = [{
            "cid": v.get("criterion_id"),
            "score_in": v.get("score"),
            "name": (v.get("criterion_name") or "")[:50],
        } for v in raw_verdicts]
        _post = [{
            "cid": v.criterion_id,
            "score_out": v.score,
            "max": v.max_score,
            "status": v.status,
            "name": (v.criterion_name or "")[:50],
        } for v in verts]
        _p.open("a", encoding="utf-8").write(_json.dumps({
            "sessionId": "9ae70f", "runId": "post-fix", "hypothesisId": "D,B",
            "location": "app.py:run_output", "message": "final aggregation after second guards",
            "data": {
                "assessment_status": assessment_status,
                "total": total,
                "total_max": total_max,
                "holistic_flag": holistic_flag,
                "pre": _pre,
                "post": _post,
                "score_deltas": [
                    {"cid": a["cid"], "in": a["score_in"], "out": b["score_out"]}
                    for a, b in zip(_pre, _post)
                    if a.get("score_in") != b.get("score_out")
                ],
            },
            "timestamp": int(_time.time() * 1000),
        }) + "\n")
    except Exception:
        pass
    # #endregion

    _status_rank = ["ok", "no_useful_matches", "no_corpus", "infrastructure_error"]
    retrieval_status = max(
        (v.retrieval_status for v in verts if v.retrieval_status),
        key=_status_rank.index,
        default="ok",
    )

    # Build topic mastery radar (percentage per criterion)
    topic_mastery_radar = {}
    for v in verts:
        if v.max_score > 0 and v.score is not None:
            if getattr(v, "required_concepts", None):
                depth_score = len(v.covered_concepts) / len(v.required_concepts)
            else:
                depth_score = v.score / v.max_score
            topic_mastery_radar[v.criterion_name or v.criterion_id] = round(depth_score, 2)

    # Aggregate missing keywords for misconception hint
    all_missing = []
    for v in verts:
        all_missing.extend(v.missing_keywords)
    misconception_hint = ""
    if all_missing:
        unique_missing = list(dict.fromkeys(all_missing))[:10]  # deduplicate, limit to 10
        misconception_hint = f"The submission may be missing key concepts: {', '.join(unique_missing)}."

    # Instructor rubric absent is handled via fallback policy; only flag when no policy/criteria.
    rubric_missing = (
        len(state.get("rubric_criteria", [])) == 0
        and not (policy_raw and policy_raw.get("origin") in ("inferred", "approved_template", "formative"))
    )
    if formative_only:
        misconception_hint = (
            (policy_raw or {}).get("diagnostic")
            or "Formative only: supply clearer assignment expectations or an approved template to enable scoring."
        )
    elif rubric_missing:
        misconception_hint = "No rubric criteria found for this assignment. Please run Ingest Materials."

    # Extract referenced materials
    relevant_chunks = state.get("relevant_chunks", [])
    referenced_materials = []
    for ch in relevant_chunks:
        src = ch.get("source_title")
        if src:
            # Strip chunk suffix if present e.g. " (chunk 1/11)"
            base_src = src.split(" (chunk")[0].strip()
            if base_src not in referenced_materials:
                referenced_materials.append(base_src)
    referenced_materials = referenced_materials[:5]

    # Calculate RAG coverage from retrieved course-material chunks.
    # Prior threshold (0.65 + needing 5 hits) was unrealistically strict for
    # embedding cosine scores, so nearly every paper showed LOW.
    sims = sorted(
        (float(ch.get("similarity") or 0) for ch in relevant_chunks),
        reverse=True,
    )
    strong_match_count = sum(1 for s in sims if s >= RAG_STRONG_SIMILARITY)
    usable_count = sum(1 for s in sims if s >= RAG_USABLE_SIMILARITY)
    top_avg = (sum(sims[:5]) / min(5, len(sims))) if sims else 0.0

    if state.get("rag_degraded"):
        rag_coverage_level = "NONE"
    elif not sims or usable_count == 0:
        rag_coverage_level = "NONE"
    elif strong_match_count >= 3 or top_avg >= 0.50:
        rag_coverage_level = "HIGH"
    elif strong_match_count >= 1 or usable_count >= 3 or top_avg >= 0.35:
        rag_coverage_level = "MEDIUM"
    else:
        rag_coverage_level = "LOW"

    # Human review: require real uncertainty — not a single noisy critique flag.
    # Critiques for AI advisory criteria are already non-flagging stubs from _cp.
    overall_confidence = sum(c.confidence for c in critiques) / len(critiques) if critiques else 0.9
    flagged_count = sum(1 for c in critiques if c.flag_for_human)
    majority_flagged = flagged_count >= max(1, (len(critiques) + 1) // 2) if critiques else False
    any_flagged = (
        assessment_status != "complete"
        or state.get("force_flag_for_human", False)
        or holistic_flag
        or overall_confidence < 0.65
        or majority_flagged
        or any(not c.is_supported or not c.is_justified for c in critiques)
    )

    from grading_server.evidence.types import EVIDENCE_PROTOCOL_VERSION
    from grading_server.evidence.mode import validate_experiment_mode

    experiment_mode = validate_experiment_mode(
        state.get("experiment_mode"), fallback="coverage_recovery"
    )
    evidence_block = state.get("evidence_block") or {}
    policy_meta = {}
    if policy_raw:
        from grading_server.assessment_policy.types import AssessmentPolicy

        try:
            policy_meta = AssessmentPolicy.model_validate(policy_raw).result_metadata()
        except Exception:
            policy_meta = {
                "assessment_policy": policy_raw,
                "policy_id": policy_raw.get("policy_id"),
                "policy_version": policy_raw.get("version"),
                "policy_content_hash": policy_raw.get("content_hash"),
                "policy_origin": policy_raw.get("origin"),
                "policy_lifecycle": policy_raw.get("lifecycle"),
                "policy_provisional": policy_raw.get("lifecycle") == "frozen_provisional",
                "policy_formative_only": bool(policy_raw.get("formative_only")),
                "policy_label": None,
            }

    # Coverage recovery may revise judgments under a frozen policy; never mutate the policy snapshot.
    if policy_raw and state.get("assessment_policy") is not policy_raw:
        pass  # policy remains the retrieve-time freeze

    out = GradingOutput(
        assignment_id=state["assignment_id"],
        student_id=state["student_id"],
        assessment_status=assessment_status,
        content_score=content_score,
        content_max=content_max,
        structure_score=structure_score,
        structure_max=structure_max,
        total=total,
        total_max=total_max,
        partial_subtotal=partial_subtotal,
        retrieval_status=retrieval_status,
        criteria_verdicts=[v.model_dump() for v in verts],
        topic_mastery_radar=topic_mastery_radar,
        misconception_hint=misconception_hint,
        flag_for_human=any_flagged or bool(policy_meta.get("policy_provisional")) or formative_only,
        overall_confidence=round(overall_confidence, 2),
        critiques=state.get("critiques", []),
        referenced_materials=referenced_materials,
        rag_coverage_level=rag_coverage_level,
        strong_match_count=strong_match_count,
        materials_status=(
            "reingesting" if state.get("rag_degraded") or str(state.get("materials_status") or "") == "reingesting"
            else "ready"
        ),
        rag_degraded=bool(state.get("rag_degraded")),
        wrong_deliverable=bool(state.get("wrong_deliverable")),
        wrong_deliverable_note=str(state.get("wrong_deliverable_note") or ""),
        experiment_mode=experiment_mode,
        evidence_protocol_version=EVIDENCE_PROTOCOL_VERSION,
        evidence=evidence_block if isinstance(evidence_block, dict) else None,
        policy_id=policy_meta.get("policy_id"),
        policy_version=policy_meta.get("policy_version"),
        policy_content_hash=policy_meta.get("policy_content_hash"),
        policy_origin=policy_meta.get("policy_origin"),
        policy_lifecycle=policy_meta.get("policy_lifecycle"),
        policy_provisional=bool(policy_meta.get("policy_provisional")),
        policy_formative_only=bool(policy_meta.get("policy_formative_only")),
        policy_label=policy_meta.get("policy_label"),
        assessment_policy=policy_meta.get("assessment_policy"),
    )
    res = out.model_dump()
    res["rubric_missing"] = rubric_missing
    res["policy_lookup_status"] = state.get("policy_lookup_status")
    # Include submission concepts for Knowledge Graph updates on the frontend
    res["submission_concepts"] = state.get("submission_concepts", [])
    materials_status = str(state.get("materials_status") or ("reingesting" if state.get("rag_degraded") else "ready"))
    res["materials_status"] = materials_status
    res["rag_degraded"] = bool(state.get("rag_degraded"))
    res["wrong_deliverable"] = bool(state.get("wrong_deliverable"))
    res["wrong_deliverable_note"] = str(state.get("wrong_deliverable_note") or "")
    started = state.get("grade_started_at")
    if isinstance(started, (int, float)) and started > 0:
        res["_pipeline_duration_seconds"] = round(time.time() - float(started), 2)

    # Save to grading_results table
    try:
        def _save():
            sb = get_supabase()
            aid = state["assignment_id"]
            sid = state["student_id"]
            cid = str(state.get("course_id") or "")
            existing = (
                sb.table("grading_results").select("id,result_json")
                .eq("assignment_id", aid).eq("student_id", sid).eq("course_id", cid).execute().data
            )
            if existing:
                row_id = existing[0]["id"]
                stored = dict(res)
                prev = existing[0].get("result_json")
                if is_legacy_result(prev):
                    stored["superseded_legacy_result"] = prev
                elif isinstance(prev, dict) and prev.get("superseded_legacy_result"):
                    stored["superseded_legacy_result"] = prev["superseded_legacy_result"]
                sb.table("grading_results").update({
                    "result_json": stored
                }).eq("id", row_id).execute()
            else:
                sb.table("grading_results").insert({
                    "assignment_id": aid,
                    "course_id": cid,
                    "student_id": sid,
                    "result_json": res
                }).execute()
        await asyncio.to_thread(_save)
    except Exception as e:
        print(f"[OUTPUT] Failed to save grading result: {e}")

    return {"final_output": res}

def should_continue(state: GradingState):
    loop_count = state.get("loop_count", 0)
    critiques = state.get("critiques", [])
    if loop_count < 2 and any(c.get("flag_for_human", False) for c in critiques):
        print(f"[RAG] Critique flagged issues. Self-correcting (Loop {loop_count})...")
        return "grade"
    return "output"

def _truthy(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)

def after_grade(state: GradingState):
    # Always run evidence_verify (baseline is a cheap no-op for recovery/semantic).
    return "evidence_verify"

def after_evidence_verify(state: GradingState):
    return "critique" if state.get("moe") else "output"

def get_graph():
    from grading_server.evidence.node import run_evidence_verify

    g = StateGraph(GradingState)
    g.add_node("ingest", run_ingest)
    g.add_node("retrieve", run_retrieve)
    g.add_node("grade", run_grade)
    g.add_node("evidence_verify", run_evidence_verify)
    g.add_node("critique", run_critique)
    g.add_node("output", run_output)
    g.set_entry_point("ingest")
    g.add_edge("ingest", "retrieve")
    g.add_edge("retrieve", "grade")
    g.add_conditional_edges("grade", after_grade, {"evidence_verify": "evidence_verify"})
    g.add_conditional_edges(
        "evidence_verify", after_evidence_verify, {"critique": "critique", "output": "output"}
    )
    g.add_conditional_edges("critique", should_continue, {"grade": "grade", "output": "output"})
    g.add_edge("output", END)
    return g.compile()

@app.route("/api/grade", methods=["POST"])
@require_access("assignment")
@_with_grade_slot
async def grade_submission():
    s = time.time()
    try:
        if request.is_json:
            data = request.get_json(force=True)
        else:
            data = request.form.to_dict()
            
        # Extract submission text (priority: text field > uploaded file)
        submission_text = data.get("submission_text", "").strip()
        llm_provider, llm_api_key = resolve_llm_credentials(request)
        if not llm_provider or not llm_api_key:
            return byok_required_response()
        custom_gemini_key = llm_api_key  # legacy var name used below for extractors
        submission_filenames: list[str] = []

        # Canvas often stores Harmonize/LTI launch URLs as the body — resolve via Canvas LTI launch.
        # Other bare https URLs (Power BI, docs, etc.) use SSRF-safe public fetch.
        client_external = str(data.get("external_url") or "").strip()
        lti_url = _detect_external_submission_url(submission_text) or (
            _detect_external_submission_url(client_external) if client_external else None
        )
        public_link_url = None if lti_url else (
            _detect_any_https_submission_url(submission_text)
            or _detect_any_https_submission_url(client_external)
        )
        if lti_url:
            course_id_for_lti = str(data.get("course_id") or "").strip()
            assignment_id_for_lti = str(data.get("assignment_id") or "").strip()
            canvas_token_for_lti = (
                data.get("canvas_token")
                or request.headers.get("X-Canvas-Token")
                or ""
            )
            try:
                student_id_for_lti = str(data.get("student_id") or "").strip() or None
                resolved = await asyncio.to_thread(
                    _resolve_external_submission_via_canvas,
                    course_id_for_lti,
                    canvas_token_for_lti,
                    lti_url,
                    assignment_id_for_lti or None,
                    True,
                    student_id_for_lti,
                )
                fetched = (resolved.get("text") or "").strip()
                if fetched and len(fetched) >= 20 and "unknown version" not in fetched.lower():
                    submission_text = fetched
                    print(f"[DEBUG] Resolved external tool submission via Canvas LTI to {len(submission_text)} chars")
                else:
                    return jsonify({
                        "error": "EXTERNAL_SUBMISSION_EMPTY",
                        "details": (
                            "Harmonize content could not be extracted for AI grading. "
                            "Open the submission in Canvas, copy the student post, and paste it into "
                            "EduConnect (Paste student post for AI grading), then retry. "
                            + (resolved.get("error") or "")
                        ),
                        "speedgrader_url": resolved.get("speedgrader_url"),
                        "canvas_open_url": resolved.get("canvas_open_url") or resolved.get("speedgrader_url"),
                        "launch_url": resolved.get("launch_url"),
                        "embed_blocked": resolved.get("embed_blocked", True),
                    }), 400
            except Exception as ext_err:
                traceback.print_exc()
                return jsonify({
                    "error": "EXTERNAL_SUBMISSION_FETCH_FAILED",
                    "details": str(ext_err),
                }), 400
        elif public_link_url and not submission_text.startswith("[LINK"):
            from grading_server.utils.safe_url_fetch import fetch_public_link_text

            link_result = await asyncio.to_thread(fetch_public_link_text, public_link_url)
            if link_result.get("extractable") and (link_result.get("text") or "").strip():
                submission_text = str(link_result["text"]).strip()
                print(f"[DEBUG] Public link extract → {len(submission_text)} chars via {link_result.get('method')}")
            else:
                submission_text = (
                    "[LINK SUBMISSION — CONTENT NOT EXTRACTABLE]\n"
                    f"URL: {public_link_url}\n"
                    f"Reason: {link_result.get('reason') or 'Remote content unavailable'}\n"
                    "Interactive dashboards often require sign-in. Grade only pasted student/teacher "
                    "descriptions if provided; otherwise flag criteria for human review. "
                    "Do not invent dashboard contents."
                )

        extracted_parts = []
        if request.files:
            for uploaded_file in request.files.values():
                filename = (uploaded_file.filename or "").lower()
                file_bytes = uploaded_file.read()
                
                if file_bytes:
                    if filename:
                        submission_filenames.append(filename)
                    part = ""
                    if filename.endswith(".pdf"):
                        part = _extract_pdf(file_bytes, api_key=llm_api_key, provider=llm_provider)
                    elif filename.endswith(".docx"):
                        part = _extract_docx(file_bytes, api_key=llm_api_key, provider=llm_provider)
                    elif filename.endswith(".pptx"):
                        part = _extract_pptx(file_bytes)
                    elif filename.endswith(".ppt"):
                        part = "This is a legacy .ppt file; content could not be extracted for AI grading. Please review manually."
                    elif filename.endswith((".txt", ".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".tsx", ".jsx", ".r", ".sql", ".cs", ".go", ".rb", ".swift", ".kt", ".md")):
                        part = file_bytes.decode("utf-8", errors="ignore")
                    elif filename.endswith(".ipynb"):
                        part = _extract_ipynb(file_bytes)
                    elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
                        mime_type = "image/png"
                        if filename.endswith((".jpg", ".jpeg")): mime_type = "image/jpeg"
                        elif filename.endswith(".webp"): mime_type = "image/webp"
                        part = _extract_image(file_bytes, mime_type, api_key=llm_api_key, provider=llm_provider)
                    elif filename.endswith((
                        ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma",
                        ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi",
                    )):
                        from grading_server.utils.media_extract import extract_media_for_grading
                        part = extract_media_for_grading(
                            file_bytes,
                            filename=filename,
                            provider=llm_provider,
                            api_key=llm_api_key,
                        ).get("text") or ""
                    if part and part.strip():
                        extracted_parts.append(part.strip())
        
        # Download from file_urls if provided (authenticated Canvas download)
        file_urls = data.get("file_urls", [])
        canvas_token = (
            data.get("canvas_token")
            or request.headers.get("X-Canvas-Token")
            or request.form.get("canvas_token")
        )

        def _is_placeholder_body(text: str) -> bool:
            t = (text or "").strip()
            if not t:
                return True
            lower = t.lower()
            return (
                lower.startswith("submission type:")
                or lower == "no submission content."
                or lower.startswith("no submission content")
            )

        # Ignore Canvas placeholder bodies when real files are attached
        if file_urls and _is_placeholder_body(submission_text):
            submission_text = ""

        download_errors: list[str] = []
        if file_urls:
            for file_info in file_urls:
                filename = ""
                try:
                    url = file_info.get("url") if isinstance(file_info, dict) else None
                    filename = (file_info.get("filename") or "").lower() if isinstance(file_info, dict) else ""
                    if not url:
                        continue
                    # Fall back to URL path for extension when filename is odd/missing
                    if not any(filename.endswith(ext) for ext in (
                        ".pdf", ".docx", ".pptx", ".ppt", ".txt", ".ipynb",
                        ".png", ".jpg", ".jpeg", ".webp",
                        ".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".tsx", ".jsx",
                        ".r", ".sql", ".cs", ".go", ".rb", ".swift", ".kt", ".md",
                    )):
                        from urllib.parse import urlparse, unquote
                        path_name = unquote(urlparse(url).path).lower()
                        filename = path_name.split("/")[-1] or filename

                    if filename:
                        submission_filenames.append(filename)

                    file_bytes = await asyncio.to_thread(_download_canvas_bytes, url, canvas_token)

                    if file_bytes:
                        # OOXML magic: zip header — prefer content sniff when extension ambiguous
                        is_ooxml = file_bytes[:2] == b"PK"

                        def _extract_one() -> str:
                            if filename.endswith(".pdf") or file_bytes[:4] == b"%PDF":
                                return _extract_pdf(file_bytes, api_key=llm_api_key, provider=llm_provider)
                            if filename.endswith(".docx") or (is_ooxml and "word" in filename):
                                return _extract_docx(file_bytes, api_key=llm_api_key, provider=llm_provider)
                            if filename.endswith(".pptx") or (is_ooxml and "ppt" in filename):
                                return _extract_pptx(file_bytes)
                            if filename.endswith(".ppt"):
                                return "This is a legacy .ppt file; content could not be extracted for AI grading. Please review manually."
                            if filename.endswith((
                                ".txt", ".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".tsx", ".jsx",
                                ".r", ".sql", ".cs", ".go", ".rb", ".swift", ".kt", ".md",
                            )):
                                return file_bytes.decode("utf-8", errors="ignore")
                            if filename.endswith(".ipynb"):
                                return _extract_ipynb(file_bytes)
                            if filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
                                mime_type = "image/png"
                                if filename.endswith((".jpg", ".jpeg")): mime_type = "image/jpeg"
                                elif filename.endswith(".webp"): mime_type = "image/webp"
                                return _extract_image(file_bytes, mime_type, api_key=llm_api_key, provider=llm_provider)
                            if filename.endswith((
                                ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma",
                                ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi",
                            )):
                                from grading_server.utils.media_extract import extract_media_for_grading
                                return extract_media_for_grading(
                                    file_bytes,
                                    filename=filename,
                                    provider=llm_provider,
                                    api_key=llm_api_key,
                                ).get("text") or ""
                            if is_ooxml:
                                try:
                                    return _extract_docx(file_bytes, api_key=llm_api_key, provider=llm_provider)
                                except Exception:
                                    return _extract_pptx(file_bytes)
                            return ""

                        extracted = await asyncio.to_thread(_extract_one)
                        _code_exts = (
                            ".pdf", ".docx", ".pptx", ".ppt", ".txt", ".ipynb",
                            ".png", ".jpg", ".jpeg", ".webp",
                            ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma",
                            ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi",
                            ".py", ".java", ".cpp", ".c", ".h", ".js", ".ts", ".tsx", ".jsx",
                            ".r", ".sql", ".cs", ".go", ".rb", ".swift", ".kt", ".md",
                        )
                        if not extracted and not (
                            filename.endswith(_code_exts)
                            or is_ooxml
                            or file_bytes[:4] == b"%PDF"
                        ):
                            download_errors.append(f"Unsupported file type: {filename or url}")
                            continue

                        if extracted and len(extracted.strip()) >= 40:
                            extracted_parts.append(extracted.strip())
                        elif extracted and extracted.strip():
                            # Keep short extracts but warn — better than discarding
                            extracted_parts.append(extracted.strip())
                            print(f"[WARN] Short extract ({len(extracted.strip())} chars) from {filename}")
                        else:
                            download_errors.append(f"{filename or 'attachment'}: extracted empty text")
                except Exception as e:
                    print(f"Failed to download or extract {filename} from URL: {e}")
                    download_errors.append(f"{filename or 'attachment'}: {e}")

        if extracted_parts:
            submission_text = (submission_text + "\n\n" + "\n\n".join(extracted_parts)).strip()

        # Placeholder bodies like "Submission type: online_upload" are not real content
        placeholder_only = _is_placeholder_body(submission_text)
        if file_urls and not extracted_parts:
            detail = "; ".join(download_errors) if download_errors else "Could not extract text from attached files"
            return jsonify({
                "error": f"Could not read submission file(s). {detail}",
                "details": detail,
            }), 400
        if file_urls and extracted_parts and len(submission_text) < 40:
            return jsonify({
                "error": "Submission file was downloaded but almost no text was extracted. The document may be image-only or corrupted.",
                "details": f"chars={len(submission_text)}; errors={download_errors}",
            }), 400
        
        if not submission_text or placeholder_only:
            return jsonify({"error": "No submission text or valid file provided"}), 400

        print(f"[DEBUG] Extracted submission text length for {data.get('student_id')}: {len(submission_text)} characters")
        if "[FIGURE" in submission_text or "[TABLE" in submission_text:
            print(f"[DEBUG] Visual/table markers present for {data.get('student_id')}")

        assign_name = (data.get("assignment_name") or data.get("assignment_title") or "").strip()
        assign_desc = (data.get("assignment_description") or data.get("assignment_desc") or "").strip()
        assignment_context = "\n".join(
            p for p in (
                f"Assignment: {assign_name}" if assign_name else "",
                assign_desc[:4000] if assign_desc else "",
            ) if p
        )
        points_possible = data.get("points_possible")
        try:
            points_possible = float(points_possible) if points_possible is not None else None
        except (TypeError, ValueError):
            points_possible = None
        explicit_outcomes = data.get("explicit_outcomes") or data.get("learning_outcomes") or []
        if isinstance(explicit_outcomes, str):
            explicit_outcomes = [explicit_outcomes]
        explicit_outcomes = [str(x).strip() for x in explicit_outcomes if str(x).strip()]
        approved_template_id = (data.get("approved_template_id") or data.get("assessment_template_id") or None)
        if approved_template_id:
            approved_template_id = str(approved_template_id).strip() or None

        # Deduplicate filenames while preserving order
        seen_names: set[str] = set()
        uniq_filenames: list[str] = []
        for name in submission_filenames:
            if name and name not in seen_names:
                seen_names.add(name)
                uniq_filenames.append(name)

        sections_preview = _extract_submission_sections(submission_text)
        submission_genre = _detect_submission_genre(uniq_filenames, submission_text, assignment_context)
        genre_signals = _analyze_genre_signals(submission_genre, submission_text, sections_preview)
        print(
            f"[GRADE] genre={submission_genre} files={uniq_filenames} "
            f"sections={genre_signals.get('section_count')} "
            f"cites~={genre_signals.get('in_text_citation_count')} "
            f"refs={genre_signals.get('has_references')}"
        )

        from grading_server.ingest_service import (
            evaluate_embedding_space,
            mark_course_files_pending_reingest,
        )
        rag_degraded = False
        materials_status = "ready"
        try:
            space_eval = await evaluate_embedding_space(
                assignment_id=str(data.get("assignment_id") or ""),
                course_id=str(data.get("course_id") or ""),
                space=space_for_provider(llm_provider),
            )
        except EmbeddingError as emb_err:
            return _embedding_error_response(emb_err)

        space_status = str(space_eval.get("status") or "")
        if space_status == "migration_required":
            return _embedding_error_response(
                EmbeddingProvenanceError(
                    space_eval.get("message")
                    or "Provenance columns are missing; apply the embedding provenance migration.",
                    code="EMBEDDING_MIGRATION_REQUIRED",
                )
            )
        if space_status in ("reingest_required", "unknown_provenance"):
            materials_status = "reingesting"
            # Keep RAG when some chunks still match this space; only blank retrieve if none usable.
            usable = int(space_eval.get("usable_count") or 0)
            rag_degraded = usable <= 0
            course_for_reingest = str(data.get("course_id") or request.form.get("course_id") or "")
            try:
                await mark_course_files_pending_reingest(
                    course_for_reingest,
                    reason=space_status.upper(),
                    mismatched_scope_keys=list(space_eval.get("mismatched") or []),
                )
            except Exception as mark_err:
                print(f"[GRADE] mark pending reingest failed: {mark_err}", flush=True)
            print(
                f"[GRADE] materials_status=reingesting reason={space_status} "
                f"usable_count={usable} rag_degraded={rag_degraded}",
                flush=True,
            )

        from grading_server.evidence.mode import resolve_experiment_mode

        # Automatic evidence path (coverage_recovery). Client mode ignored unless
        # EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE=1. Budgets stay server-side only.
        experiment_mode = resolve_experiment_mode(data.get("experiment_mode"))
        t_graph = time.time()
        print(
            f"[GRADE] start student={data.get('student_id')} assignment={data.get('assignment_id')} "
            f"chars={len(submission_text)} extract_s={round(t_graph - s, 2)} "
            f"rag_degraded={rag_degraded}",
            flush=True,
        )
        final = await get_graph().ainvoke({
            "assignment_id": data.get("assignment_id"),
            "course_id": data.get("course_id") or request.form.get("course_id"),
            "student_id": data.get("student_id"),
            "submission_text": submission_text,
            "assignment_context": assignment_context,
            "assignment_name": assign_name,
            "assignment_description": assign_desc[:8000],
            "points_possible": points_possible,
            "approved_template_id": approved_template_id,
            "explicit_outcomes": explicit_outcomes,
            "submission_genre": submission_genre,
            "submission_filenames": uniq_filenames,
            "genre_signals": genre_signals,
            "moe": _truthy(data.get("moe")),
            "deep_retrieve": _truthy(data.get("deep_retrieve")),
            "grade_started_at": s,
            "custom_gemini_key": llm_api_key,
            "llm_provider": llm_provider,
            "llm_api_key": llm_api_key,
            "experiment_mode": experiment_mode,
            "extraction_failed": False,
            "extraction_limitations": [],
            "rag_degraded": rag_degraded,
            "materials_status": materials_status,
            "evidence_chat_json": (
                (lambda prompt, provider=None, api_key=None: chat_json(
                    prompt, provider=provider or llm_provider, api_key=api_key or llm_api_key
                ))
                if experiment_mode != "baseline"
                else None
            ),
        })
        
        res = final["final_output"]
        # Prefer duration stamped inside the graph (persisted to DB); refresh as fallback.
        res["_pipeline_duration_seconds"] = res.get("_pipeline_duration_seconds") or round(time.time() - s, 2)
        res["extracted_submission_text"] = submission_text
        res["submission_genre"] = submission_genre
        res["genre_signals"] = genre_signals
        res["materials_status"] = res.get("materials_status") or materials_status
        if rag_degraded and res.get("rag_coverage_level") not in ("LOW", "NONE"):
            res["rag_coverage_level"] = "NONE"
        print(
            f"[GRADE] done student={data.get('student_id')} "
            f"graph_s={round(time.time() - t_graph, 2)} total_s={res['_pipeline_duration_seconds']}",
            flush=True,
        )
        # #region agent log
        try:
            import json as _json
            from pathlib import Path as _Path
            _Path(r"d:\EduConnect AI\.cursor\debug-9ae70f.log").open("a", encoding="utf-8").write(_json.dumps({
                "sessionId": "9ae70f", "runId": "latency-fix", "hypothesisId": "H1",
                "location": "app.py:grade_submission",
                "message": "grade finished with concurrency+timeout fix",
                "data": {
                    "student_id": data.get("student_id"),
                    "assignment_id": data.get("assignment_id"),
                    "extract_s": round(t_graph - s, 2),
                    "graph_s": round(time.time() - t_graph, 2),
                    "total_s": res["_pipeline_duration_seconds"],
                    "grade_llm_cap": _GRADE_LLM_CONCURRENCY,
                },
                "timestamp": int(time.time() * 1000),
            }) + "\n")
        except Exception:
            pass
        # #endregion
        return jsonify(res), 200
    except EmbeddingError as e:
        traceback.print_exc()
        return _embedding_error_response(e)
    except RubricStoreUnavailable:
        traceback.print_exc()
        return jsonify({
            "error": "RUBRIC_STORE_UNAVAILABLE",
            "message": "The rubric store could not be read. No draft was produced; retry later.",
        }), 503
    except RubricInvalid as e:
        traceback.print_exc()
        return jsonify({
            "error": "RUBRIC_INVALID",
            "message": str(e) or (
                "An instructor rubric exists but is unusable. "
                "It was not replaced with a fallback. Fix or replace the rubric explicitly."
            ),
            "validation_errors": list(getattr(e, "validation_errors", []) or []),
            "require_instructor_decision": True,
        }), 422
    except Exception as e:
        traceback.print_exc()
        err_msg = str(e)
        if "expected 768 dimensions" in err_msg or "expected 3072 dimensions" in err_msg:
             return jsonify({
                 "error": "DATABASE_DIMENSION_MISMATCH",
                 "message": "Vector dimensions in the database do not match this grading server. Ask the owner to apply the ingestion SQL.",
             }), 500
        if "REINGEST_REQUIRED" in err_msg:
             return jsonify({
                 "error": "REINGEST_REQUIRED",
                 "message": err_msg.split(":", 1)[-1].strip() or "Re-ingest course materials with your current LLM provider, then grade again.",
             }), 409
        if "PERMISSION_DENIED" in err_msg or "API key not valid" in err_msg or "API key was reported as leaked" in err_msg or "LLM HTTP 401" in err_msg or "BYOK required" in err_msg:
             return jsonify({
                 "error": "BYOK_REQUIRED",
                 "message": "Invalid LLM API key. Re-verify your provider key in settings.",
             }), 401
        if "RESOURCE_EXHAUSTED" in err_msg or "exceeded your current quota" in err_msg or "429" in err_msg:
             return jsonify({
                 "error": "LLM_QUOTA",
                 "message": "LLM API quota exceeded. Wait a moment and retry one student.",
             }), 429
        if "cannot schedule new futures after shutdown" in err_msg:
             return jsonify({
                 "error": "SERVER_RESTARTED",
                 "message": "Grading server restarted mid-request. Please click Grade again.",
             }), 503
        # Rubric shape bugs (missing max_score/criterion_id) must not blame the LLM key or materials.
        missing_field = None
        if isinstance(e, KeyError):
            missing_field = str(e).strip("'\"")
        if missing_field in ("max_score", "criterion_id") or (
            type(e).__name__ == "KeyError" and "max_score" in err_msg
        ):
             field = missing_field or "max_score"
             return jsonify({
                 "error": "RUBRIC_INVALID",
                 "message": (
                     "The rubric used for grading is missing required fields "
                     f"({field}). Re-send the Canvas rubric (Refresh / open the assignment), "
                     "then grade again."
                 ),
                 "validation_errors": [f"missing field: {field}"],
                 "require_instructor_decision": True,
             }), 422
        # Never echo raw ValidationError / provider dumps to the browser.
        return jsonify({
            "error": "GRADING_FAILED",
            "message": "Grading could not finish. Retry once; if it keeps failing, re-verify your LLM key or re-ingest materials.",
        }), 500

@app.route("/api/assessment-policy/templates", methods=["GET"])
@require_access("course")
def list_assessment_policy_templates():
    from grading_server.assessment_policy.templates import list_approved_templates

    return jsonify({"templates": list_approved_templates()}), 200


@app.route("/api/assessment-policy/<policy_id>/v/<int:version>", methods=["GET"])
@require_access("assignment")
def get_assessment_policy(policy_id: str, version: int):
    sb = get_supabase()
    store = _policy_store_for_client(sb)
    policy = store.get_by_id_version(policy_id, version)
    if policy is None:
        # Also search memory default when supabase miss
        from grading_server.assessment_policy.store import get_default_store

        policy = get_default_store().get_by_id_version(policy_id, version)
    if policy is None:
        return jsonify({"error": "POLICY_NOT_FOUND", "message": "Assessment policy version not found."}), 404
    # Scope check against authorized assignment/course
    course_id = str(request.args.get("course_id") or getattr(g, "course_id", "") or "")
    assignment_id = str(request.args.get("assignment_id") or getattr(g, "assignment_id", "") or "")
    if course_id and policy.course_id != course_id:
        return jsonify({"error": "FORBIDDEN", "message": "Policy is outside this course."}), 403
    if assignment_id and policy.assignment_id != assignment_id:
        return jsonify({"error": "FORBIDDEN", "message": "Policy is outside this assignment."}), 403
    return jsonify(policy.model_dump()), 200


@app.route("/api/assessment-policy/<policy_id>/v/<int:version>/approve", methods=["POST"])
@require_access("assignment")
def approve_assessment_policy(policy_id: str, version: int):
    sb = get_supabase()
    store = _policy_store_for_client(sb)
    from grading_server.assessment_policy.store import get_default_store

    data = request.get_json(silent=True) or {}
    approved_by = str(data.get("approved_by") or getattr(getattr(g, "principal", None), "user_id", None) or "instructor")
    try:
        try:
            policy = store.approve(policy_id, version, approved_by=approved_by)
        except KeyError:
            policy = get_default_store().approve(policy_id, version, approved_by=approved_by)
    except KeyError:
        return jsonify({"error": "POLICY_NOT_FOUND", "message": "Exact policy version not found."}), 404
    except ValueError as e:
        return jsonify({"error": "POLICY_NOT_APPROVABLE", "message": str(e)}), 409
    return jsonify(policy.model_dump()), 200


@app.route("/api/assessment-policy/<policy_id>/v/<int:version>/edit", methods=["POST"])
@require_access("assignment")
def edit_assessment_policy(policy_id: str, version: int):
    """Instructor edit creates a new frozen version; does not mutate the approved/frozen snapshot in place."""
    from grading_server.assessment_policy.hashing import policy_content_hash
    from grading_server.assessment_policy.store import get_default_store
    from grading_server.assessment_policy.types import AssessmentPolicy
    from grading_server.assessment_policy.validate import validate_policy

    sb = get_supabase()
    store = _policy_store_for_client(sb)
    data = request.get_json(silent=True) or {}
    edited_by = str(data.get("edited_by") or getattr(getattr(g, "principal", None), "user_id", None) or "instructor")
    base = store.get_by_id_version(policy_id, version) or get_default_store().get_by_id_version(policy_id, version)
    if base is None:
        return jsonify({"error": "POLICY_NOT_FOUND", "message": "Exact policy version not found."}), 404
    patch = data.get("policy") or data
    updated = AssessmentPolicy.model_validate({**base.model_dump(), **patch, "policy_id": base.policy_id})
    # Keep weights aligned to edited maxima so validation does not invent a second scale.
    pts = sum(float(c.max_points) for c in updated.criteria) or 1.0
    recomputed = [
        c.model_copy(update={"weight": float(c.max_points) / pts})
        for c in updated.criteria
    ]
    updated = updated.model_copy(
        update={
            "criteria": recomputed,
            "maximum_score": float(sum(c.max_points for c in recomputed)) if recomputed else None,
        }
    )
    body = updated.model_dump()
    updated = updated.model_copy(update={"content_hash": policy_content_hash(body)})
    errs = validate_policy(updated)
    if errs:
        return jsonify({"error": "POLICY_INVALID", "message": "Edited policy failed validation.", "validation_errors": errs}), 422
    try:
        new_p = store.save_new_version(base, updated, edited_by=edited_by)
    except Exception:
        new_p = get_default_store().save_new_version(base, updated, edited_by=edited_by)
    return jsonify(new_p.model_dump()), 200


@app.route("/api/health")
def health():
    from grading_server.utils.authz import local_mock_grade_enabled, probe_authz_ready
    authz = probe_authz_ready()
    return jsonify({
        "status": "ok" if authz["ready"] else "degraded",
        "authz": authz,
        "local_mock_grade": local_mock_grade_enabled(),
    }), 200


@app.route("/api/llm/providers", methods=["GET"])
def llm_providers():
    return jsonify({"providers": list_providers()}), 200


@app.route("/api/authz/sync-canvas-memberships", methods=["POST"])
@require_access("identity")
def sync_canvas_memberships_endpoint():
    """Synchronize the caller's teacher and TA memberships from Canvas."""
    from grading_server.utils.membership_sync import MembershipSyncError, sync_canvas_memberships

    data = request.get_json(silent=True) or {}
    token = request.headers.get("X-Canvas-Token") or data.get("canvas_token") or ""
    try:
        result = sync_canvas_memberships(
            user_id=g.authz_principal.user_id,
            canvas_base_url=str(data.get("canvas_base_url") or ""),
            canvas_token=str(token),
        )
    except MembershipSyncError as error:
        return jsonify({"error": error.code, "message": error.message}), error.status
    except Exception:
        return jsonify({
            "error": "AUTH_UNAVAILABLE",
            "message": "Membership synchronization is temporarily unavailable.",
        }), 503
    return jsonify(result), 200


@app.route("/api/verify-llm", methods=["POST"])
@require_access("identity")
def verify_llm_endpoint():
    """
    POST /api/verify-llm
    Body: { "provider": "openai", "api_key": "..." }
    Smoke-tests chat + embeddings(768) + vision.
    """
    try:
        data = request.get_json(force=True) or {}
        provider = (data.get("provider") or request.headers.get("X-LLM-Provider") or "").strip()
        api_key = (data.get("api_key") or request.headers.get("X-LLM-Api-Key") or "").strip()
        if not provider or not api_key:
            return jsonify({"ok": False, "error": "provider and api_key are required"}), 400
        # Validate known provider early
        get_provider(provider)
        from grading_server.utils.llm_client import verify_llm
        result = verify_llm(provider, api_key)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Ingestion Endpoints (Professor-triggered)
# ══════════════════════════════════════════════════════════════════════════════

from grading_server.ingest_service import ingest_course_material, delete_assignment_data


def _embedding_error_response(e: EmbeddingError):
    """Typed embedding/provenance failure. Never falls through to grading or a partial write."""
    if isinstance(e, EmbeddingProvenanceError):
        status = 503 if e.code == "EMBEDDING_MIGRATION_REQUIRED" else 409
    elif isinstance(e, EmbeddingSpaceUnsupported):
        status = 400
    else:
        status = 502
    return jsonify({"error": e.code, "message": str(e).split(": ", 1)[-1]}), status

@app.route("/api/ingest", methods=["POST"])
@require_access("assignment")
async def ingest_json():
    """
    POST /api/ingest
    Accepts JSON body with course_material_text, rubric_criteria, and exemplars.
    Chunks, embeds, and upserts everything into Supabase.
    """
    try:
        data = request.get_json(force=True)
        assignment_id = data.get("assignment_id")
        if not assignment_id:
            return jsonify({"error": "assignment_id is required"}), 400

        course_material_text = data.get("course_material_text", "")
        rubric_criteria = data.get("rubric_criteria", [])
        exemplars = data.get("exemplars", [])

        if not course_material_text and not rubric_criteria:
            return jsonify({"error": "At least course_material_text or rubric_criteria must be provided"}), 400

        llm_provider, llm_api_key = resolve_llm_credentials(request)
        if not llm_provider or not llm_api_key:
            return byok_required_response()

        result = await ingest_course_material(
            assignment_id=assignment_id,
            course_material_text=course_material_text,
            rubric_criteria=rubric_criteria,
            exemplars=exemplars if exemplars else None,
            api_key=llm_api_key,
            provider=llm_provider,
            course_id=str(data.get("course_id")),
        )
        return jsonify(result), 200

    except EmbeddingError as e:
        traceback.print_exc()
        return _embedding_error_response(e)
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Ingestion failed"}), 500


@app.route("/api/ingest/file", methods=["POST"])
@require_access("assignment")
async def ingest_file():
    """
    POST /api/ingest/file
    Accepts multipart form upload with: file (PDF/DOCX), assignment_id,
    rubric_criteria (JSON string), exemplars (JSON string, optional).
    Extracts text from the file, then runs the same ingestion pipeline.
    """
    import json as _json
    try:
        assignment_id = request.form.get("assignment_id")
        if not assignment_id:
            return jsonify({"error": "assignment_id is required"}), 400

        # Parse rubric_criteria from JSON string
        rubric_criteria_raw = request.form.get("rubric_criteria", "[]")
        try:
            rubric_criteria = _json.loads(rubric_criteria_raw)
        except _json.JSONDecodeError:
            return jsonify({"error": "rubric_criteria must be a valid JSON string"}), 400

        # Parse exemplars from JSON string (optional)
        exemplars_raw = request.form.get("exemplars", "[]")
        try:
            exemplars = _json.loads(exemplars_raw)
        except _json.JSONDecodeError:
            exemplars = []

        # Extract file
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded. Send a PDF or DOCX file in the 'file' field."}), 400

        uploaded_file = request.files["file"]
        filename = (uploaded_file.filename or "").lower()
        file_bytes = uploaded_file.read()

        if not file_bytes:
            return jsonify({"error": "Uploaded file is empty"}), 400

        llm_provider, llm_api_key = resolve_llm_credentials(request)
        if not llm_provider or not llm_api_key:
            return byok_required_response()

        from grading_server.utils.media_extract import extract_media_for_grading, media_kind_from_filename

        # Determine file type and extract text
        if filename.endswith(".pdf"):
            course_material_text = _extract_pdf(file_bytes, api_key=llm_api_key, provider=llm_provider)
        elif filename.endswith(".docx"):
            course_material_text = _extract_docx(file_bytes, api_key=llm_api_key, provider=llm_provider)
        elif filename.endswith(".pptx"):
            course_material_text = _extract_pptx(file_bytes)
        elif filename.endswith(".ppt"):
            course_material_text = "This is a legacy .ppt file; content could not be extracted for AI grading. Please review manually."
        elif filename.endswith(".txt"):
            course_material_text = file_bytes.decode("utf-8", errors="ignore")
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
            mime_type = "image/png"
            if filename.endswith((".jpg", ".jpeg")):
                mime_type = "image/jpeg"
            elif filename.endswith(".webp"):
                mime_type = "image/webp"
            elif filename.endswith(".gif"):
                mime_type = "image/gif"
            course_material_text = _extract_image(
                file_bytes,
                mime_type,
                api_key=llm_api_key,
                provider=llm_provider,
                purpose="course_material",
                source_name=uploaded_file.filename or filename,
            )
        elif media_kind_from_filename(filename):
            media = extract_media_for_grading(
                file_bytes,
                filename=uploaded_file.filename or filename,
                provider=llm_provider,
                api_key=llm_api_key,
            )
            if not media.get("ok"):
                return jsonify({"error": media.get("text") or "Could not read this media file"}), 400
            course_material_text = f"[COURSE MEDIA MATERIAL]\n{media['text']}"
        else:
            return jsonify({
                "error": f"Unsupported file type: '{filename}'."
            }), 400

        if not course_material_text.strip():
            return jsonify({"error": "Could not extract any text from the uploaded file"}), 400

        result = await ingest_course_material(
            assignment_id=assignment_id,
            course_material_text=course_material_text,
            rubric_criteria=rubric_criteria,
            exemplars=exemplars if exemplars else None,
            source_name=filename,
            api_key=llm_api_key,
            provider=llm_provider,
            course_id=str(request.form.get("course_id")),
        )
        return jsonify(result), 200

    except EmbeddingError as e:
        traceback.print_exc()
        return _embedding_error_response(e)
    except Exception:
        traceback.print_exc()
        return jsonify({"error": "File ingestion failed"}), 500

import ipaddress
import requests
from urllib.parse import urlparse
from html.parser import HTMLParser

# Only Canvas-hosted files may be fetched server-side; the download is
# authenticated with the caller's Canvas token, so an arbitrary URL would let a
# client turn this route into an SSRF proxy.
MAX_CANVAS_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_EXTERNAL_SUBMISSION_BYTES = 5 * 1024 * 1024
EXTERNAL_SUBMISSION_HOSTS = {"42lines.net", "harmonizelearning.com"}


class _HTMLTextExtractor(HTMLParser):
    """Strip scripts/styles and keep readable text from HTML pages."""

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self._skip += 1
        elif tag in ("br", "hr"):
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self._skip:
            self._skip -= 1
        elif tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"):
            self._parts.append("\n")

    def handle_data(self, data):
        if not self._skip and data:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        lines = [" ".join(line.split()) for line in raw.splitlines()]
        return "\n".join(line for line in lines if line).strip()


def _html_to_text(html: str) -> str:
    parser = _HTMLTextExtractor()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        return re.sub(r"<[^>]+>", " ", html or "")
    return parser.get_text()


def _detect_any_https_submission_url(text: str) -> str | None:
    """If submission_text is only a bare http(s) URL, return that URL."""
    if not text:
        return None
    plain = _html_to_text(text) if "<" in text else text
    collapsed = re.sub(r"\s+", "", plain or "").strip()
    match = re.fullmatch(r"https?://\S+", collapsed, flags=re.IGNORECASE)
    return match.group(0) if match else None


def _detect_external_submission_url(text: str) -> str | None:
    """If submission_text is only an LTI/Harmonize launch URL, return that URL."""
    url = _detect_any_https_submission_url(text)
    if not url:
        return None
    lower = url.lower()
    if "/lti/" in lower or "harmonize" in lower or "42lines.net" in lower:
        return url
    return None


def _external_submission_url_rejection(file_url: str) -> str | None:
    """Allow only known external-tool submission hosts (Harmonize / 42lines)."""
    parsed = urlparse(file_url)
    if parsed.scheme not in ("http", "https"):
        return "Only http(s) URLs can be fetched"
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return "URL has no host"
    if host in ("localhost", "localhost.localdomain", "metadata.google.internal"):
        return "Refusing to fetch a local address"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
    ):
        return "Refusing to fetch a private or link-local address"
    for allowed in EXTERNAL_SUBMISSION_HOSTS:
        if host == allowed or host.endswith(f".{allowed}"):
            return None
    return f"Host '{host}' is not a recognized external submission host"


def _fetch_external_submission_text(url: str) -> str:
    """Download an external-tool submission page and extract readable text (no LTI)."""
    rejection = _external_submission_url_rejection(url)
    if rejection:
        raise ValueError(rejection)

    headers = {
        "User-Agent": "EduConnect-AI/1.0 (submission grader)",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    }
    with requests.get(url, headers=headers, timeout=30, stream=True, allow_redirects=True) as r:
        if r.status_code != 200:
            raise ValueError(f"External tool returned HTTP {r.status_code}")
        declared_length = r.headers.get("Content-Length")
        if declared_length and declared_length.isdigit() and int(declared_length) > MAX_EXTERNAL_SUBMISSION_BYTES:
            raise ValueError("External submission is too large")
        parts: list[bytes] = []
        total = 0
        for part in r.iter_content(chunk_size=65536):
            if not part:
                continue
            total += len(part)
            if total > MAX_EXTERNAL_SUBMISSION_BYTES:
                raise ValueError("External submission is too large")
            parts.append(part)
        raw = b"".join(parts)
        content_type = (r.headers.get("Content-Type") or "").lower()

    decoded = raw.decode("utf-8", errors="replace")
    if "application/json" in content_type or decoded.lstrip().startswith(("{", "[")):
        try:
            import json as _json
            payload = _json.loads(decoded)
            if isinstance(payload, str):
                return payload.strip()
            if isinstance(payload, dict):
                for key in ("text", "body", "content", "submission", "message", "html"):
                    val = payload.get(key)
                    if isinstance(val, str) and val.strip():
                        return _html_to_text(val) if "<" in val else val.strip()
                return _html_to_text(_json.dumps(payload, ensure_ascii=False))
        except Exception:
            pass
    return _html_to_text(decoded)


def _canvas_sessionless_launch(
    course_id: str,
    canvas_token: str,
    url: str | None = None,
    assignment_id: str | None = None,
    launch_type: str | None = None,
) -> dict:
    """Ask Canvas for a signed sessionless LTI launch URL (required for Harmonize)."""
    if not course_id:
        raise ValueError("course_id is required for Canvas LTI launch")
    if not canvas_token:
        raise ValueError("Canvas API token is required for LTI launch")

    params: dict[str, str] = {}
    if url:
        params["url"] = url
    if assignment_id:
        params["assignment_id"] = str(assignment_id)
    if launch_type:
        params["launch_type"] = launch_type

    if not params.get("url") and not (launch_type == "assessment" and assignment_id):
        raise ValueError("Provide submission url, or assignment_id with launch_type=assessment")

    endpoint = f"{CANVAS_BASE_URL.rstrip('/')}/api/v1/courses/{course_id}/external_tools/sessionless_launch"
    r = requests.get(
        endpoint,
        headers={
            "Authorization": f"Bearer {canvas_token}",
            "User-Agent": "EduConnect-AI/1.0",
        },
        params=params,
        timeout=30,
    )
    if r.status_code != 200:
        detail = r.text[:300] if r.text else r.reason
        raise ValueError(f"Canvas sessionless_launch failed ({r.status_code}): {detail}")
    payload = r.json()
    if not isinstance(payload, dict) or not payload.get("url"):
        raise ValueError(f"Canvas sessionless_launch returned no launch url: {payload}")
    return payload


def _parse_html_form_fields(form_html: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for m in re.finditer(
        r"<input\b[^>]*>",
        form_html,
        flags=re.IGNORECASE,
    ):
        tag = m.group(0)
        name_m = re.search(r'\bname=["\']([^"\']+)["\']', tag, flags=re.IGNORECASE)
        if not name_m:
            continue
        value_m = re.search(r'\bvalue=["\']([^"\']*)["\']', tag, flags=re.IGNORECASE)
        fields[name_m.group(1)] = value_m.group(1) if value_m else ""
    return fields


def _sanitize_submission_html(html: str) -> str:
    """Keep readable markup; strip scripts/iframes/handlers for safe in-app display."""
    if not html:
        return ""
    cleaned = re.sub(r"(?is)<script\b[^>]*>.*?</script>", "", html)
    cleaned = re.sub(r"(?is)<style\b[^>]*>.*?</style>", "", cleaned)
    cleaned = re.sub(r"(?is)<(iframe|object|embed|link|meta|base)\b[^>]*>.*?</\1>", "", cleaned)
    cleaned = re.sub(r"(?is)<(iframe|object|embed|link|meta|base)\b[^>]*/?>", "", cleaned)
    cleaned = re.sub(r"\son\w+\s*=\s*([\"']).*?\1", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\son\w+\s*=\s*[^\s>]+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?is)javascript:", "", cleaned)
    # Prefer body inner HTML when a full document comes back
    body_m = re.search(r"(?is)<body\b[^>]*>(.*)</body>", cleaned)
    if body_m:
        cleaned = body_m.group(1)
    return cleaned.strip()


_LTI_EMBED_BLOCKED_MARKERS = (
    "needs to be loaded in a new browser window",
    "load in a new window",
    "open this tool in a new window",
    "cannot be displayed in an iframe",
    "refused to display in a frame",
)


def _is_lti_embed_blocked_page(html: str = "", text: str = "") -> bool:
    """Harmonize (and similar LTI tools) return an interstitial instead of student work when framed."""
    blob = f"{html or ''}\n{text or ''}".lower()
    return any(m in blob for m in _LTI_EMBED_BLOCKED_MARKERS)


def _extract_new_window_urls(html: str, base_url: str = "") -> list[str]:
    """Pull Harmonize 'open in a new window' targets (and similar) from an interstitial page."""
    urls: list[str] = []
    if not html:
        return urls

    def _abs(href: str) -> str:
        href = (href or "").strip()
        if not href:
            return ""
        if href.startswith("//"):
            return "https:" + href
        if href.startswith("/") and base_url:
            p = urlparse(base_url)
            return f"{p.scheme}://{p.netloc}{href}"
        return href

    for m in re.finditer(
        r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        href, inner = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
        low_inner = inner.lower()
        low_href = href.lower()
        if (
            "new window" in low_inner
            or "load " in low_inner
            or "harmonize" in low_href
            or "42lines" in low_href
            or "target=_blank" in m.group(0).lower()
            or 'target="_blank"' in m.group(0).lower()
        ):
            abs_url = _abs(href)
            if abs_url.startswith("http"):
                urls.append(abs_url)

    for m in re.finditer(r'window\.open\(\s*[\'"]([^\'"]+)[\'"]', html, flags=re.IGNORECASE):
        abs_url = _abs(m.group(1))
        if abs_url.startswith("http"):
            urls.append(abs_url)

    for m in re.finditer(
        r'<meta[^>]+http-equiv=["\']refresh["\'][^>]+content=["\'][^"\']*url=([^"\'>\s]+)',
        html,
        flags=re.IGNORECASE,
    ):
        abs_url = _abs(m.group(1).strip("'\""))
        if abs_url.startswith("http"):
            urls.append(abs_url)

    # Preserve order, drop dupes
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _lti_browser_headers() -> dict[str, str]:
    # Look like a top-level browser navigation (not an iframe) so tools that
    # gate on Sec-Fetch-* / UA still return the real student page.
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
    }


def _html_looks_like_student_work(html: str, text: str) -> bool:
    if _is_lti_embed_blocked_page(html, text):
        return False
    if "unknown version" in (text or "").lower():
        return False
    # Require some real prose — interstitial/chrome pages are short / templated.
    return len((text or "").strip()) >= 40


def _follow_lti_launch(sessionless_url: str) -> dict:
    """
    Open Canvas sessionless launch URL, auto-submit the LTI form if present,
    and return sanitized HTML + plain text from the tool response.

    Harmonize often returns an interstitial ("load in a new window"). When that
    happens we reuse the LTI session cookies and GET the new-window target so
    grading still receives the student post.
    """
    session = requests.Session()
    headers = _lti_browser_headers()
    r = session.get(sessionless_url, headers=headers, timeout=45, allow_redirects=True)
    html = r.text or ""
    lower = html.lower()
    final_url = str(getattr(r, "url", sessionless_url) or sessionless_url)

    # Canvas often returns an auto-post form to the tool
    form_match = re.search(
        r'<form\b[^>]*action=["\']([^"\']+)["\'][^>]*>(.*?)</form>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if form_match and any(
        marker in lower
        for marker in ('name="lti_message_type"', 'name="oauth_consumer_key"', 'name="id_token"', 'name="jwt"', "openid")
    ):
        action = form_match.group(1).strip()
        fields = _parse_html_form_fields(form_match.group(2))
        if action.startswith("/"):
            action = f"{CANVAS_BASE_URL.rstrip('/')}{action}"
        post = session.post(action, data=fields, headers=headers, timeout=45, allow_redirects=True)
        html = post.text or ""
        lower = html.lower()
        final_url = str(getattr(post, "url", action) or action)

    text = _html_to_text(html)
    if "launch message is of an unknown version" in lower or "unknown version" in (text or "").lower():
        raise ValueError(
            "LTI launch failed (unknown version). The raw Harmonize URL cannot be opened without Canvas signing."
        )

    if _is_lti_embed_blocked_page(html, text):
        for target in _extract_new_window_urls(html, base_url=final_url)[:3]:
            try:
                followed = session.get(target, headers=headers, timeout=45, allow_redirects=True)
                f_html = followed.text or ""
                f_text = _html_to_text(f_html)
                if _html_looks_like_student_work(f_html, f_text):
                    safe = _sanitize_submission_html(f_html)
                    return {
                        "html": safe,
                        "text": (f_text or "").strip(),
                        "embed_blocked": False,
                        "content_source": "lti_new_window_follow",
                    }
            except Exception as follow_err:
                print(f"[LTI] new-window follow failed for {target}: {follow_err}", flush=True)
        return {
            "html": "",
            "text": "",
            "embed_blocked": True,
            "error": (
                "This external tool (e.g. Harmonize) blocks in-app preview and no student text "
                "could be extracted for AI grading. Open in Canvas to read it, or paste the post text."
            ),
        }

    if not _html_looks_like_student_work(html, text):
        return {
            "html": "",
            "text": "",
            "embed_blocked": True,
            "error": "External tool returned no readable student submission text.",
        }

    safe_html = _sanitize_submission_html(html)
    return {"html": safe_html, "text": (text or "").strip(), "embed_blocked": False}


def _fetch_canvas_discussion_post_for_student(
    course_id: str,
    assignment_id: str,
    student_id: str,
    canvas_token: str,
) -> dict | None:
    """
    For discussion / Harmonize-backed assignments, pull the student's Canvas discussion
    entry (and recent replies) when the LTI tool won't embed.
    """
    if not (course_id and assignment_id and student_id and canvas_token):
        return None
    base = CANVAS_BASE_URL.rstrip("/")
    headers = {"Authorization": f"Bearer {canvas_token}", "User-Agent": "EduConnect-AI/1.0"}
    assign_resp = requests.get(
        f"{base}/api/v1/courses/{course_id}/assignments/{assignment_id}",
        headers=headers,
        timeout=30,
    )
    topic_id = None
    if assign_resp.status_code == 200:
        assign = assign_resp.json()
        assign = assign if isinstance(assign, dict) else {}
        topic = assign.get("discussion_topic") if isinstance(assign.get("discussion_topic"), dict) else {}
        topic_id = str(topic.get("id") or assign.get("discussion_topic_id") or "") or None
    if not topic_id:
        # Assignment id may already be a discussion topic id (some Canvas setups).
        probe = requests.get(
            f"{base}/api/v1/courses/{course_id}/discussion_topics/{assignment_id}",
            headers=headers,
            timeout=20,
        )
        if probe.status_code != 200:
            return None
        topic_id = str(assignment_id)

    entries_resp = requests.get(
        f"{base}/api/v1/courses/{course_id}/discussion_topics/{topic_id}/entries",
        headers=headers,
        params={"per_page": 100},
        timeout=30,
    )
    if entries_resp.status_code != 200:
        return None
    raw_entries = entries_resp.json()
    entries = raw_entries if isinstance(raw_entries, list) else []
    sid = str(student_id)
    match = next((e for e in entries if str(e.get("user_id") or "") == sid), None)
    if not match:
        return None

    parts: list[str] = []
    message = (match.get("message") or "").strip()
    if message:
        parts.append(message)
    for reply in match.get("recent_replies") or []:
        rmsg = (reply.get("message") or "").strip()
        if rmsg:
            parts.append(rmsg)
    if not parts:
        return None
    combined_html = "\n<hr/>\n".join(parts)
    return {
        "html": _sanitize_submission_html(combined_html),
        "text": _html_to_text(combined_html).strip(),
        "source": "canvas_discussion",
    }


def _follow_lti_launch_for_text(sessionless_url: str) -> str:
    return (_follow_lti_launch(sessionless_url).get("text") or "").strip()


def _fetch_canvas_submission_json(
    course_id: str,
    assignment_id: str,
    student_id: str,
    canvas_token: str,
) -> dict:
    """Fetch one submission from Canvas API (source of truth for body/url/attachments)."""
    endpoint = (
        f"{CANVAS_BASE_URL.rstrip('/')}/api/v1/courses/{course_id}"
        f"/assignments/{assignment_id}/submissions/{student_id}"
    )
    r = requests.get(
        endpoint,
        headers={
            "Authorization": f"Bearer {canvas_token}",
            "User-Agent": "EduConnect-AI/1.0",
        },
        params=[
            ("include[]", "submission_history"),
            ("include[]", "submission_comments"),
            ("include[]", "discussion_entries"),
            ("include[]", "user"),
            ("include[]", "rubric_assessment"),
        ],
        timeout=30,
    )
    if r.status_code != 200:
        raise ValueError(f"Canvas submission fetch failed ({r.status_code}): {r.text[:300]}")
    payload = r.json()
    if not isinstance(payload, dict):
        raise ValueError("Canvas submission response was not an object")
    return payload


def _text_from_canvas_submission_record(sub: dict) -> tuple[str, str]:
    """Prefer real discussion/body HTML over an LTI launch URL placeholder."""
    if not isinstance(sub, dict):
        return "", ""
    body = (sub.get("body") or "").strip()
    if body and not _detect_external_submission_url(body) and not _is_lti_embed_blocked_page(body):
        return _sanitize_submission_html(body), _html_to_text(body).strip()

    entries = sub.get("discussion_entries") or []
    if isinstance(entries, list) and entries:
        parts = [str(e.get("message") or "").strip() for e in entries if isinstance(e, dict)]
        parts = [p for p in parts if p]
        if parts:
            combined = "\n<hr/>\n".join(parts)
            return _sanitize_submission_html(combined), _html_to_text(combined).strip()

    for hist in reversed(sub.get("submission_history") or []):
        if not isinstance(hist, dict):
            continue
        h_html, h_text = _text_from_canvas_submission_record(
            {k: hist.get(k) for k in ("body", "discussion_entries") if k in hist}
        )
        if h_text and len(h_text) >= 20:
            return h_html, h_text
    return "", ""


def _resolve_external_submission_via_canvas(
    course_id: str,
    canvas_token: str,
    url: str | None = None,
    assignment_id: str | None = None,
    extract_text: bool = True,
    student_id: str | None = None,
) -> dict:
    """
    Get submission content from Canvas, then (for LTI) complete a Canvas-signed
    launch so we can display the real student work in EduConnect.
    """
    warnings: list[str] = []
    launch_url = None
    tool_name = None
    html = ""
    text = ""
    canvas_submission = None
    embed_blocked = False
    content_source = None

    # Escape hatch into Canvas (native grader) — not an EduConnect feature.
    canvas_open_url = None
    if course_id and assignment_id and student_id:
        canvas_open_url = (
            f"{CANVAS_BASE_URL.rstrip('/')}/courses/{course_id}/gradebook/speed_grader"
            f"?assignment_id={assignment_id}&student_id={student_id}"
        )
    speedgrader_url = canvas_open_url  # backward-compatible alias

    # 1) Always pull the Canvas submission record first
    if course_id and assignment_id and student_id and canvas_token:
        try:
            canvas_submission = _fetch_canvas_submission_json(
                course_id, assignment_id, student_id, canvas_token
            )
            sub_url = (canvas_submission.get("url") or url or "").strip()
            if sub_url and not url:
                url = sub_url

            html, text = _text_from_canvas_submission_record(canvas_submission)
            if text and len(text) >= 20:
                content_source = "canvas_submission"
            elif sub_url:
                url = sub_url
        except Exception as e:
            warnings.append(f"canvas submission: {e}")

    # 2) Canvas-signed LTI launch for Harmonize / external tool bodies
    if (not html or len(text) < 20) and url:
        try:
            result = _canvas_sessionless_launch(course_id, canvas_token, url=url)
            launch_url = result.get("url")
            tool_name = result.get("name")
        except Exception as e:
            warnings.append(f"url launch: {e}")

    if not launch_url and not html and assignment_id:
        try:
            result = _canvas_sessionless_launch(
                course_id,
                canvas_token,
                assignment_id=assignment_id,
                launch_type="assessment",
            )
            launch_url = result.get("url")
            tool_name = result.get("name")
        except Exception as e:
            warnings.append(f"assessment launch: {e}")

    if extract_text and launch_url and (not html or len(text) < 20):
        try:
            followed = _follow_lti_launch(launch_url)
            if followed.get("embed_blocked"):
                embed_blocked = True
                warnings.append(followed.get("error") or "external tool blocked embed")
            else:
                html = followed.get("html") or html
                text = (followed.get("text") or text or "").strip()
                if html or text:
                    content_source = "lti_follow"
        except Exception as e:
            warnings.append(f"lti follow: {e}")

    # 3) Discussion-topic fallback when Harmonize won't give us the post body
    if (not html or len(text) < 20) and course_id and assignment_id and student_id and canvas_token:
        try:
            disc = _fetch_canvas_discussion_post_for_student(
                course_id, assignment_id, student_id, canvas_token
            )
            if disc and (disc.get("html") or disc.get("text")):
                html = disc.get("html") or html
                text = (disc.get("text") or text or "").strip()
                content_source = disc.get("source") or "canvas_discussion"
                embed_blocked = False
        except Exception as e:
            warnings.append(f"discussion fallback: {e}")

    if not launch_url and not html and not text:
        return {
            "error": "; ".join(warnings) or "Could not load submission from Canvas",
            "speedgrader_url": speedgrader_url,
            "canvas_open_url": canvas_open_url,
            "launch_url": None,
            "html": "",
            "text": "",
            "embed_blocked": embed_blocked,
        }

    return {
        "launch_url": None if embed_blocked else launch_url,
        "tool_name": tool_name,
        "html": html,
        "text": text,
        "chars": len(text or ""),
        "speedgrader_url": speedgrader_url,
        "canvas_open_url": canvas_open_url,
        "embed_blocked": embed_blocked,
        "content_source": content_source,
        "warnings": warnings,
        "submission_type": (canvas_submission or {}).get("submission_type"),
        "canvas_body_present": bool((canvas_submission or {}).get("body")),
    }


def _canvas_url_rejection(file_url: str) -> str | None:
    """Return a rejection reason for non-Canvas URLs, or None when allowed."""
    parsed = urlparse(file_url)
    if parsed.scheme not in ("http", "https"):
        return "Only http(s) URLs can be ingested"

    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return "URL has no host"

    if host in ("localhost", "localhost.localdomain", "metadata.google.internal"):
        return "Refusing to fetch a local address"

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
    ):
        return "Refusing to fetch a private or link-local address"

    if host == trusted_lms_host():
        return None
    # Canvas file storage/CDN hosts that the configured instance redirects downloads to.
    for allowed in _CANVAS_FILE_HOSTS:
        if host == allowed or host.endswith(f".{allowed}"):
            return None
    return f"Host '{host}' is not the configured Canvas host or its file storage"


_CANVAS_FILE_HOSTS = (
    "inscloudgate.net",
    "instructuremedia.com",
    "instructure-uploads.s3.amazonaws.com",
    # Current Canvas student-file CDN (e.g. a13-….cluster13.canvas-user-content.com)
    "canvas-user-content.com",
    # Canvas Studio / Kaltura delivery hosts that media_sources may redirect to.
    "kaltura.com",
    "kaltura.nordu.net",
)
_MAX_REDIRECTS = 5


def _normalize_canvas_file_url(file_url: str) -> str:
    """Turn browser proxy paths into absolute Canvas URLs for the grading server."""
    u = str(file_url or "").strip()
    if not u:
        return u
    host = trusted_lms_host()
    if u.startswith("/canvas-api/"):
        return f"https://{host}{u[len('/canvas-api'):]}"
    if u.startswith("/") and host:
        return f"https://{host}{u}"
    return u


def _canvas_api_headers(canvas_token: str) -> dict:
    return {"Authorization": f"Bearer {canvas_token}", "User-Agent": "EduConnect-AI/1.0"}


def _fetch_canvas_file_meta(canvas_file_id: str, canvas_token: str) -> dict:
    host = trusted_lms_host()
    if not host:
        raise ValueError("CANVAS_BASE_URL is not configured")
    r = requests.get(
        f"https://{host}/api/v1/files/{canvas_file_id}",
        headers=_canvas_api_headers(canvas_token),
        timeout=20,
        allow_redirects=False,
    )
    if r.status_code != 200:
        raise ValueError(f"Canvas file lookup failed: {r.status_code}")
    data = r.json() if r.content else {}
    if not isinstance(data, dict):
        raise ValueError("Canvas file lookup returned unexpected data")
    return data


def _pick_media_source_url(sources: list) -> str | None:
    """Prefer an MP4/WebM stream URL from Canvas media_sources."""
    ranked: list[tuple[int, str]] = []
    for src in sources:
        if not isinstance(src, dict):
            continue
        url = str(src.get("url") or "").strip()
        if not url:
            continue
        content_type = str(src.get("content_type") or src.get("contentType") or "").lower()
        container = str(src.get("container") or "").lower()
        score = int(src.get("bitrate") or src.get("width") or src.get("size") or 0)
        if "mp4" in content_type or container == "mp4" or url.lower().endswith(".mp4"):
            score += 1_000_000
        elif "webm" in content_type or container == "webm":
            score += 500_000
        ranked.append((score, url))
    if not ranked:
        return None
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1]


def _media_source_url(media_entry_id: str, canvas_token: str) -> str | None:
    host = trusted_lms_host()
    if not host or not media_entry_id:
        return None
    r = requests.get(
        f"https://{host}/api/v1/media_objects/{media_entry_id}/media_sources",
        headers=_canvas_api_headers(canvas_token),
        timeout=20,
        allow_redirects=False,
    )
    if r.status_code != 200:
        return None
    data = r.json() if r.content else None
    if isinstance(data, list):
        return _pick_media_source_url(data)
    if isinstance(data, dict):
        sources = data.get("media_sources") or data.get("sources") or []
        if isinstance(sources, list):
            return _pick_media_source_url(sources)
    return None


def _resolve_canvas_download_url(
    *,
    file_url: str | None,
    canvas_file_id: str | None,
    canvas_token: str | None,
) -> str:
    """Prefer a fresh Files API URL; fall back to Media Objects for Studio/video stubs."""
    meta: dict = {}
    if canvas_file_id and canvas_token:
        try:
            meta = _fetch_canvas_file_meta(str(canvas_file_id), str(canvas_token))
            fresh = meta.get("url") or meta.get("download_url")
            if fresh:
                return str(fresh)
            media_id = meta.get("media_entry_id")
            if media_id:
                media_url = _media_source_url(str(media_id), str(canvas_token))
                if media_url:
                    return media_url
        except Exception as e:
            print(f"[canvas-download] resolve via file id failed: {e}", flush=True)

    if file_url:
        return _normalize_canvas_file_url(str(file_url))
    raise ValueError("No Canvas download URL available for this file")


def _download_canvas_file_bytes(
    *,
    file_url: str | None,
    canvas_file_id: str | None,
    canvas_token: str | None,
) -> bytes:
    """Download course-file bytes, refreshing stale Canvas URLs and media stubs."""
    resolved = _resolve_canvas_download_url(
        file_url=file_url,
        canvas_file_id=canvas_file_id,
        canvas_token=canvas_token,
    )
    try:
        return _download_canvas_bytes(resolved, canvas_token)
    except ValueError as first_err:
        # Listed file URLs expire; media stubs 404 on /files/.../download.
        if "404" not in str(first_err) or not (canvas_file_id and canvas_token):
            raise
        meta = {}
        try:
            meta = _fetch_canvas_file_meta(str(canvas_file_id), str(canvas_token))
        except Exception:
            raise first_err
        media_id = meta.get("media_entry_id")
        if not media_id:
            raise first_err
        media_url = _media_source_url(str(media_id), str(canvas_token))
        if not media_url:
            raise ValueError(
                "This Canvas media file has no downloadable stream URL. "
                "Open it in Canvas Studio or upload a transcript/PDF of the lecture."
            ) from first_err
        return _download_canvas_bytes(media_url, canvas_token)


def _download_canvas_bytes(file_url: str, canvas_token: str | None = None) -> bytes:
    """Download a Canvas-hosted file with size limit and SSRF checks on every redirect hop.

    The Canvas token is sent only to the configured Canvas host, never to storage/CDN hosts.
    """
    url = str(file_url)
    for _ in range(_MAX_REDIRECTS + 1):
        rejection = _canvas_url_rejection(url)
        if rejection:
            raise ValueError(rejection)
        headers = {"User-Agent": "EduConnect-AI/1.0"}
        if canvas_token and (urlparse(url).hostname or "").lower() == trusted_lms_host():
            headers["Authorization"] = f"Bearer {canvas_token}"
        r = requests.get(url, headers=headers, timeout=30, stream=True, allow_redirects=False)
        if r.is_redirect:
            nxt = r.headers.get("Location") or ""
            r.close()
            url = requests.compat.urljoin(url, nxt)
            continue
        break
    else:
        raise ValueError("Too many redirects while downloading from Canvas")

    with r:
        if r.status_code != 200:
            raise ValueError(f"Failed to download from Canvas: {r.status_code}")

        declared_length = r.headers.get("Content-Length")
        if declared_length and declared_length.isdigit() and int(declared_length) > MAX_CANVAS_DOWNLOAD_BYTES:
            raise ValueError("File is too large (limit 100MB)")

        parts: list[bytes] = []
        total = 0
        for part in r.iter_content(chunk_size=65536):
            if not part:
                continue
            total += len(part)
            if total > MAX_CANVAS_DOWNLOAD_BYTES:
                raise ValueError("File is too large (limit 100MB)")
            parts.append(part)
        return b"".join(parts)


@app.route("/api/fetch-public-link", methods=["POST"])
@require_access("course")
def fetch_public_link():
    """SSRF-safe best-effort text extract from an arbitrary https student link."""
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url is required", "extractable": False}), 400
    from grading_server.utils.safe_url_fetch import fetch_public_link_text

    try:
        result = fetch_public_link_text(url)
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "extractable": False,
            "url": url,
            "text": "",
            "reason": str(e),
            "method": None,
        }), 502


@app.route("/api/resolve-external-submission", methods=["POST"])
@app.route("/api/fetch-external-submission", methods=["POST"])
@require_access("course")
def resolve_external_submission():
    """
    Resolve Harmonize / LTI submissions through Canvas sessionless launch
    (same mechanism SpeedGrader uses). Returns a launch_url for iframe embed
    and extracted text when available for RAG grading.
    """
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or request.args.get("url") or "").strip()
    course_id = str(data.get("course_id") or "").strip()
    assignment_id = str(data.get("assignment_id") or "").strip() or None
    student_id = str(data.get("student_id") or "").strip() or None
    extract_text = data.get("extract_text", True)
    canvas_token = (
        request.headers.get("X-Canvas-Token")
        or data.get("canvas_token")
        or ""
    )

    if not url and not assignment_id:
        return jsonify({"error": "url or assignment_id is required"}), 400

    # Prefer Canvas-signed LTI launch whenever we have course + token
    if course_id and canvas_token:
        try:
            resolved = _resolve_external_submission_via_canvas(
                course_id=course_id,
                canvas_token=canvas_token,
                url=url or None,
                assignment_id=assignment_id,
                extract_text=bool(extract_text),
                student_id=student_id,
            )
            if resolved.get("error") and not resolved.get("launch_url") and not resolved.get("text"):
                return jsonify(resolved), 400
            return jsonify(resolved)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": f"Canvas LTI resolve failed: {e}"}), 502

    # Fallback: direct GET (usually fails for Harmonize with "unknown version")
    if not url:
        return jsonify({
            "error": "course_id and Canvas token are required to launch Harmonize submissions",
        }), 400
    try:
        text = _fetch_external_submission_text(url)
        if text and "unknown version" in text.lower():
            return jsonify({
                "error": (
                    "Harmonize requires a Canvas-signed LTI launch. "
                    "Pass course_id + X-Canvas-Token so EduConnect can use sessionless_launch."
                ),
                "text": text,
            }), 400
        return jsonify({"url": url, "text": text, "chars": len(text or ""), "launch_url": None})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"External submission fetch failed: {e}"}), 502


@app.route("/api/proxy-file", methods=["GET"])
@require_access("course")
def proxy_file():
    """
    Browser-safe proxy for Canvas file URLs (avoids CORS Failed to fetch in Local Reader).
    GET /api/proxy-file?url=...&course_id=...
    Headers: Authorization (Supabase session), X-Canvas-Token (optional)
    """
    file_url = request.args.get("url")
    if not file_url:
        return jsonify({"error": "url is required"}), 400

    canvas_token = request.headers.get("X-Canvas-Token") or request.args.get("canvas_token")
    try:
        file_bytes = _download_canvas_bytes(file_url, canvas_token)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Proxy download failed: {e}"}), 502

    # Guess content type from URL / extension
    lower = file_url.lower().split("?")[0]
    content_type = "application/octet-stream"
    if lower.endswith(".pdf"):
        content_type = "application/pdf"
    elif lower.endswith(".docx"):
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif lower.endswith(".pptx"):
        content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    elif lower.endswith(".xlsx"):
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif lower.endswith(".txt"):
        content_type = "text/plain"
    elif lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        content_type = "image/" + lower.rsplit(".", 1)[-1].replace("jpg", "jpeg")

    from flask import Response
    return Response(
        file_bytes,
        status=200,
        mimetype=content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@app.route("/api/ingest/canvas-url", methods=["POST"])
@require_access("course")
async def ingest_canvas_url():
    """
    Downloads a file from a given URL and ingests it.
    """
    course_id = None
    canvas_file_id = None
    updated_at = ""
    display_name = ""
    try:
        data = request.get_json(force=True)
        assignment_id = data.get("assignment_id")
        file_url = data.get("url")
        filename = (data.get("filename") or "").lower()
        canvas_token = data.get("canvas_token") or request.headers.get("X-Canvas-Token")

        canvas_file_id = data.get("canvas_file_id")
        if not assignment_id or (not file_url and not canvas_file_id):
            return jsonify({"error": "assignment_id and url (or canvas_file_id) are required"}), 400

        course_id = data.get("course_id")
        updated_at = data.get("updated_at") or ""
        display_name = data.get("filename") or filename
        llm_provider, llm_api_key = resolve_llm_credentials(request)

        async def _fail_registry(err: str):
            if course_id and canvas_file_id:
                from grading_server.ingest_service import mark_course_file_failed
                await mark_course_file_failed(
                    str(course_id),
                    str(canvas_file_id),
                    filename=str(display_name or ""),
                    updated_at=str(updated_at or ""),
                    last_error=err,
                )

        if course_id and canvas_file_id and llm_provider:
            from grading_server.ingest_service import cached_course_file_hit
            hit = await cached_course_file_hit(
                str(course_id), str(canvas_file_id), str(updated_at), provider=llm_provider,
            )
            if hit:
                return jsonify(hit), 200

        try:
            file_bytes = await asyncio.to_thread(
                _download_canvas_file_bytes,
                file_url=str(file_url) if file_url else None,
                canvas_file_id=str(canvas_file_id) if canvas_file_id else None,
                canvas_token=canvas_token,
            )
        except ValueError as e:
            await _fail_registry(str(e)[:500])
            return jsonify({"error": str(e)}), 400

        if not llm_provider or not llm_api_key:
            return byok_required_response()

        from grading_server.utils.media_extract import extract_media_for_grading, media_kind_from_filename

        # Determine file type and extract text (documents + vision/media course materials)
        if filename.endswith(".pdf"):
            course_material_text = _parse_pdf(file_bytes)
        elif filename.endswith(".docx"):
            course_material_text = _parse_docx(file_bytes)
        elif filename.endswith(".pptx"):
            course_material_text = _parse_pptx(file_bytes)
        elif filename.endswith(".txt"):
            course_material_text = file_bytes.decode("utf-8", errors="ignore")
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
            mime_type = "image/png"
            if filename.endswith((".jpg", ".jpeg")):
                mime_type = "image/jpeg"
            elif filename.endswith(".webp"):
                mime_type = "image/webp"
            elif filename.endswith(".gif"):
                mime_type = "image/gif"
            course_material_text = _extract_image(
                file_bytes,
                mime_type,
                api_key=llm_api_key,
                provider=llm_provider,
                purpose="course_material",
                source_name=display_name,
            )
        elif media_kind_from_filename(filename):
            media = extract_media_for_grading(
                file_bytes,
                filename=display_name,
                provider=llm_provider,
                api_key=llm_api_key,
            )
            if not media.get("ok"):
                err = media.get("text") or "Could not read this media file"
                await _fail_registry(str(err)[:500])
                return jsonify({"error": err}), 400
            course_material_text = f"[COURSE MEDIA MATERIAL]\n{media['text']}"
        else:
            err = f"Unsupported file type: '{filename}'."
            await _fail_registry(err)
            return jsonify({"error": err}), 400

        if not course_material_text.strip():
            err = "Could not extract any text from the uploaded file"
            await _fail_registry(err)
            return jsonify({"error": err}), 400

        from grading_server.ingest_service import ingest_course_file, ingest_course_material

        if course_id and canvas_file_id:
            result = await ingest_course_file(
                course_id=str(course_id),
                canvas_file_id=str(canvas_file_id),
                updated_at=str(updated_at),
                filename=display_name,
                course_material_text=course_material_text,
                assignment_id=assignment_id,
                api_key=llm_api_key,
                provider=llm_provider,
            )
            return jsonify(result), 200

        # Legacy fallback (assignment-scoped)
        result = await ingest_course_material(
            assignment_id=assignment_id,
            course_material_text=course_material_text,
            rubric_criteria=[],
            source_name=display_name,
            api_key=llm_api_key,
            provider=llm_provider,
            course_id=str(course_id),
        )
        return jsonify(result), 200

    except EmbeddingError as e:
        traceback.print_exc()
        if course_id and canvas_file_id:
            from grading_server.ingest_service import mark_course_file_failed
            await mark_course_file_failed(
                str(course_id),
                str(canvas_file_id),
                filename=str(display_name or ""),
                updated_at=str(updated_at or ""),
                last_error=str(getattr(e, "code", None) or e)[:500],
            )
        return _embedding_error_response(e)
    except Exception as e:
        traceback.print_exc()
        if course_id and canvas_file_id:
            from grading_server.ingest_service import mark_course_file_failed
            await mark_course_file_failed(
                str(course_id),
                str(canvas_file_id),
                filename=str(display_name or ""),
                updated_at=str(updated_at or ""),
                last_error=str(e)[:500],
            )
        return jsonify({"error": "Canvas URL ingestion failed"}), 500


@app.route("/api/ingest/course-status", methods=["GET"])
@require_access("course")
async def course_ingest_status():
    course_id = request.args.get("course_id")
    if not course_id:
        return jsonify({"error": "course_id is required"}), 400
    from grading_server.ingest_service import list_course_file_status
    files = await list_course_file_status(course_id)
    return jsonify({"course_id": course_id, "files": files}), 200


@app.route("/api/ingest/course-verify", methods=["GET"])
@require_access("course")
async def course_ingest_verify():
    """Cross-check registry rows against stored course_material_chunks."""
    course_id = request.args.get("course_id")
    if not course_id:
        return jsonify({"error": "course_id is required"}), 400
    from grading_server.ingest_service import verify_course_file_index
    result = await verify_course_file_index(course_id)
    return jsonify(result), 200


@app.route("/api/ingest/<assignment_id>", methods=["DELETE"])
@require_access("assignment")
async def delete_ingested(assignment_id: str):
    """
    DELETE /api/ingest/<assignment_id>?course_id=...
    Clears this assignment's description chunks, criteria, and exemplars in that course.
    Course-file chunks are not affected.
    """
    try:
        if not assignment_id:
            return jsonify({"error": "assignment_id is required"}), 400

        result = await delete_assignment_data(assignment_id, str(request.args.get("course_id")))
        return jsonify(result), 200

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Deletion failed"}), 500


# ── File extraction helpers ───────────────────────────────────────────────────

def _extract_pdf(file_bytes: bytes, api_key: str | None = None, provider: str | None = None) -> str:
    """Extract PDF text, tables, and describe embedded charts/images via vision."""
    return _parse_pdf(file_bytes, api_key=api_key, provider=provider)


def _extract_docx(file_bytes: bytes, api_key: str | None = None, provider: str | None = None) -> str:
    """Extract DOCX text/tables and describe embedded figures via vision."""
    return _parse_docx(file_bytes, api_key=api_key, provider=provider)


def _extract_pptx(file_bytes: bytes) -> str:
    """Extract text from PPTX using python-pptx."""
    import io
    from pptx import Presentation
    prs = Presentation(io.BytesIO(file_bytes))
    lines = []
    for i, slide in enumerate(prs.slides, start=1):
        lines.append(f"=== Slide {i} ===")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = para.text.strip()
                    if text:
                        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def _extract_image(
    file_bytes: bytes,
    mime_type: str,
    api_key: str | None = None,
    provider: str | None = None,
    *,
    purpose: str = "submission",
    source_name: str = "",
) -> str:
    """Extract text/visual info from a standalone image using provider vision.

    For student submissions, empty extraction must raise so the teacher sees a
    real vision error. For course materials, the same vision path indexes the
    image into the class corpus grading searches.
    """
    from grading_server.utils.llm_client import describe_image

    if not file_bytes or len(file_bytes) < 200:
        raise ValueError("image file is empty or too small")
    if not api_key or not provider:
        raise ValueError("BYOK provider and api_key are required to read image materials")
    try:
        desc = describe_image(file_bytes, mime_type, provider=provider, api_key=api_key)
    except Exception as e:
        raise ValueError(f"vision describe failed: {e}") from e
    if not (desc or "").strip():
        raise ValueError("vision model returned empty description for image")
    body = desc.strip()
    if purpose == "course_material":
        label = source_name or "course image"
        return f"[COURSE IMAGE MATERIAL]\nSource file: {label}\n\n{body}"
    return f"[FIGURE / VISUAL - treat as present in the submission]\n{body}"


def _extract_ipynb(file_bytes: bytes) -> str:
    """Extract markdown, code, and text outputs from a Jupyter notebook."""
    import json

    try:
        nb = json.loads(file_bytes.decode("utf-8", errors="replace"))
    except Exception as e:
        raise ValueError(f"Invalid notebook JSON: {e}") from e

    parts: list[str] = ["=== Jupyter Notebook ==="]
    for i, cell in enumerate(nb.get("cells") or [], start=1):
        cell_type = cell.get("cell_type") or "code"
        source = cell.get("source") or ""
        if isinstance(source, list):
            source = "".join(source)
        source = str(source).strip()
        parts.append(f"\n--- Cell {i} ({cell_type}) ---")
        if source:
            parts.append(source)

        for out in cell.get("outputs") or []:
            if out.get("output_type") == "stream":
                text = out.get("text") or ""
                if isinstance(text, list):
                    text = "".join(text)
                if str(text).strip():
                    parts.append(f"[stdout]\n{text}")
            elif out.get("output_type") == "error":
                parts.append(
                    f"[error] {out.get('ename', '')}: {out.get('evalue', '')}"
                )
            else:
                data = out.get("data") or {}
                plain = data.get("text/plain") or ""
                if isinstance(plain, list):
                    plain = "".join(plain)
                if str(plain).strip():
                    parts.append(f"[output]\n{plain}")
                if data.get("image/png") or data.get("image/jpeg"):
                    parts.append("[FIGURE / VISUAL - notebook plot/image output present]")

    return "\n".join(parts).strip()


def _running_under_streamlit() -> bool:
    return "streamlit" in sys.modules or bool(os.environ.get("STREAMLIT_SERVER_PORT"))


if __name__ == "__main__" and not _running_under_streamlit():
    from grading_server.config import FLASK_DEBUG, FLASK_HOST

    # Render / Railway inject PORT; fall back to local FLASK_PORT.
    port = int(os.environ.get("PORT", FLASK_PORT))
    print(f"Starting Flask server on {FLASK_HOST}:{port} (debug={FLASK_DEBUG})...")
    try:
        from grading_server.utils.authz import probe_authz_ready
        ready = probe_authz_ready()
        if not ready["ready"]:
            print(f"[AUTHZ] NOT READY ({ready['code']}): {ready['message']}")
        else:
            print("[AUTHZ] memberships schema reachable")
    except Exception as e:
        print(f"[AUTHZ] readiness probe failed: {e}")
    # use_reloader=False: Windows watchdog reloads kill in-flight grade/ingest
    # requests with "cannot schedule new futures after shutdown".
    # threaded=True: long Gemini grades must not block health/auth on the same process.
    app.run(host=FLASK_HOST, port=port, debug=FLASK_DEBUG, use_reloader=False, threaded=True)
