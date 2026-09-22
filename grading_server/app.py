import sys
import os
import math
import re
import tempfile
import asyncio
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

from flask import Flask, request, jsonify
from flask_cors import CORS
from langgraph.graph import StateGraph, END

# Use verified local utils
from grading_server.utils.supabase_client import get_supabase
from grading_server.utils.llm_client import chat_json, chat_text, embed_texts
from grading_server.utils.byok import resolve_llm_credentials, byok_required_response
from grading_server.utils.llm_registry import list_providers, get_provider
from grading_server.utils.file_parsers import parse_submission, _parse_pdf, _parse_docx, _parse_pptx
from grading_server.config import GEMINI_LITE_MODEL, GEMINI_GRADING_MODEL, FLASK_PORT, CANVAS_BASE_URL
from grading_server.models import CriterionVerdict, CritiqueResult, GradingOutput

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
CORS(app)

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
    custom_gemini_key: str | None
    llm_provider: str | None
    llm_api_key: str | None


def _llm_creds(state: dict) -> tuple[str | None, str | None]:
    provider = state.get("llm_provider")
    api_key = state.get("llm_api_key") or state.get("custom_gemini_key")
    if api_key and not provider:
        provider = "gemini"
    return provider, api_key


def _embed_sync(texts: list[str], provider: str, api_key: str):
    return embed_texts(texts, provider=provider, api_key=api_key)

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

    apa_cites = len(re.findall(r"\([A-Z][A-Za-z\-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?\)", sample))
    num_cites = len(re.findall(r"\[[0-9]{1,3}\]", sample))
    has_refs = any(
        any(k in t for k in ("reference", "bibliography", "works cited"))
        for t in titles
    ) or bool(re.search(r"(?im)^\s*#*\s*(references|bibliography|works cited)\b", sample))

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


def _genre_grading_guide(genre: str, signals: dict, dimension: str) -> str:
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
    return covered_out


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
    """Heuristic: conceptual/proposed system vs completed empirical ML study."""
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
        )
        if s in blob
    )
    return proposal_hits >= 2 and empirical_hits <= 1


_EMPIRICAL_ML_KEYWORDS = {
    "data pre-processing",
    "data preprocessing",
    "data splitting",
    "train-test split",
    "supervised technique",
    "unsupervised technique",
    "hyperparameter tuning",
    "labeled dataset",
    "feature engineering",
    "model training",
    "cross-validation",
}


def _filter_proposal_missing_keywords(keywords: list, is_proposal: bool) -> list:
    if not is_proposal or not keywords:
        return list(keywords or [])
    out = []
    for kw in keywords:
        low = str(kw).strip().lower()
        if low in _EMPIRICAL_ML_KEYWORDS:
            continue
        if any(e in low for e in ("pre-process", "preprocess", "data split", "supervised", "unsupervised", "hyperparameter")):
            continue
        out.append(kw)
    return out


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


def _dedupe_overlapping_ai_penalties(verdicts: list[dict]) -> list[dict]:
    """Prevent AI-generated criteria from re-docking gaps already scored on the rubric."""
    if not verdicts:
        return verdicts
    rubric = [v for v in verdicts if not v.get("ai_generated")]
    for v in verdicts:
        if not v.get("ai_generated"):
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
    if not ethical or not challenges:
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
    max_score = int(v.get("max_score") or 0)
    if max_score <= 0:
        return v
    blob = f"{criterion_title} {criterion_desc}".lower()
    score = int(v.get("score") or 0)
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


def _apply_verdict_score_guards(v: dict, max_score: int) -> dict:
    """Enforce status/score sync, evidence/placement/material/concept caps."""
    raw_score = max(0, min(int(v.get("score", 0) or 0), max_score))
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

    if anchor_missing and not (integrity_crit and positive_just and not hard_fail):
        cap = max(0, math.ceil(max_score * 0.50))
        if score > cap:
            score = cap
            teacher_notes.append("Score capped: no verifiable student evidence_anchor.")
        if status == "full":
            status = "partial"
            v["ungrounded_full"] = True
    # else: integrity soft-check is silent — no teacher-facing diagnostic spam

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
    if alignment == "contradicts":
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
    if isinstance(required, list) and len(required) > 0 and not integrity_crit:
        haystack = " ".join(
            [
                submission_text,
                "" if anchor_missing else anchor,
            ]
        )
        covered = _infer_covered_concepts(required, covered, haystack)
        v["covered_concepts"] = covered
        covered_set = {str(x).strip().lower() for x in covered if str(x).strip()}
        req_list = [str(r).strip() for r in required if str(r).strip()]
        hit = 0
        for req in req_list:
            rl = req.lower()
            if rl in covered_set or any(rl in c or c in rl for c in covered_set):
                hit += 1
        coverage = hit / max(1, len(req_list))
        has_evidence = not anchor_missing
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

    # Academic Integrity leniency: reasoning that argues for credit must not land near zero.
    if integrity_crit and not hard_fail and positive_just:
        floor_pts = max(1, math.ceil(max_score * 0.75)) if max_score > 1 else max_score
        restore = max(floor_pts, min(raw_score, max_score))
        if score < restore:
            score = restore
        if status == "missing":
            status = "partial" if score < max_score else "full"

    # Full-credit narrative + evidence → award full points (concept graph cannot veto).
    if (
        claims_full
        and not hard_fail
        and not denies_credit
        and alignment != "contradicts"
        and (not anchor_missing or integrity_crit)
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
        and (not anchor_missing or integrity_crit)
    ):
        floor_ratio = 0.75 if integrity_crit else 0.70
        floor_pts = max(1, math.ceil(max_score * floor_ratio)) if max_score > 0 else 0
        if score < floor_pts:
            score = floor_pts
        if status == "missing" and score > 0:
            status = "partial"

    if status == "missing":
        score = 0
    elif status == "full":
        if score < max_score:
            status = "partial"
        else:
            score = max_score
    elif status == "partial":
        if max_score > 0 and score >= max_score:
            score = max_score - 1
            teacher_notes.append("Partial status cannot receive full points.")
        if score <= 0:
            if anchor_missing and not (integrity_crit and positive_just):
                status = "missing"
                score = 0
            elif max_score > 1:
                score = 1

    if teacher_notes:
        just = (v.get("justification") or "").strip()
        appended = " ".join(teacher_notes)
        if appended not in just:
            v["justification"] = (just + "\n\n" + appended).strip()

    v["score"] = score
    v["status"] = status
    v["evidence_anchor"] = "not found" if anchor_missing else anchor
    v["max_score"] = max_score
    return v


def _holistic_consistency_nudge(verdicts: list[dict]) -> tuple[list[dict], bool]:
    """Nudge near-full scores down when many criteria look thinly evidenced."""
    if not verdicts:
        return verdicts, False
    real = [v for v in verdicts if not v.get("ai_generated")]
    if len(real) < 2:
        return verdicts, False

    near_full = 0
    thin = 0
    for v in real:
        max_s = int(v.get("max_score") or 0)
        score = int(v.get("score") or 0)
        if max_s <= 0:
            continue
        ratio = score / max_s
        anchor = (v.get("evidence_anchor") or "").strip().lower()
        just = v.get("justification") or ""
        weak = anchor in ("", "not found", "n/a", "none") or len(anchor) < 25
        vague = len(just) < 80
        if ratio >= 0.9:
            near_full += 1
            if weak or vague or v.get("ungrounded_full") or v.get("placement_issue"):
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
    e_res = await asyncio.to_thread(_embed_sync, chunks, provider, api_key)
    
    concepts = []
    if isinstance(c_res, list):
        concepts = c_res
    elif isinstance(c_res, dict):
        concepts = c_res.get("concepts", [])
        
    return {"chunks": chunks, "chunk_embeddings": e_res, "submission_concepts": concepts}

# Node 2: Retrieve — Semantic Vector Search + Exemplars
async def run_retrieve(state: GradingState) -> dict:
    import numpy as np

    def _db():
        sb = get_supabase()
        aid = state["assignment_id"]
        embeddings = state.get("chunk_embeddings", [])

        try:
            # 1. Fetch rubric criteria for this assignment
            rubric = sb.table("rubric_criteria").select("*").eq("assignment_id", aid).execute().data or []

            # 3. Fetch exemplars for few-shot grading context
            exemplars_raw = sb.table("exemplars").select("*").eq("assignment_id", aid).execute().data or []
            # Group exemplars by criterion_id
            exemplars_by_criterion = {}
            for ex in exemplars_raw:
                cid = ex.get("criterion_id", "")
                if cid not in exemplars_by_criterion:
                    exemplars_by_criterion[cid] = []
                exemplars_by_criterion[cid].append(ex)

            # 4. Generate Adaptive Quality Evaluation Criteria
            if rubric:
                try:
                    from grading_server.utils.gemini_client import call_gemini
                    
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
                    for nc in new_criteria:
                        nc_dict = dict(nc)
                        nc_dict["assignment_id"] = aid
                        nc_dict["title"] = f"{nc_dict.get('title', 'Criterion')} (AI-Generated)"
                        nc_dict["ai_generated"] = True
                        rubric.append(nc_dict)
                    print(f"[RAG] Injected {len(new_criteria)} adaptive quality criteria.")
                except Exception as e:
                    print(f"[RAG] Failed to inject dynamic quality criteria: {e}")

            print(f"[RAG] Retrieved: {len(rubric)} criteria, {len(exemplars_raw)} exemplars")
            return rubric, exemplars_by_criterion
        except Exception as e:
            print(f"[RAG] Retrieve error: {e}")
            return [], [], {}

    r, ex = await asyncio.to_thread(_db)
    return {"rubric_criteria": r, "exemplars": ex, "relevant_chunks": []}

from pydantic import BaseModel
from typing import Literal

class LLMGradingPayload(BaseModel):
    score: int
    justification: str
    evidence_anchor: str
    status: Literal['full', 'partial', 'missing']
    missing_keywords: list[str] = []
    supporting_materials: list[str] = []
    covered_concepts: list[str] = []
    required_concepts: list[str] = []
    material_alignment: Literal['supports', 'neutral', 'contradicts'] = 'neutral'
    placement_ok: bool = True

class DecomposedCriterion(BaseModel):
    sub_queries: list[str]

async def _decompose_criterion(
    criterion_title: str,
    criterion_desc: str,
    api_key: str | None = None,
    provider: str | None = None,
) -> list[str]:
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

async def _multihop_retrieve(
    sub_queries: list[str],
    assignment_id: str,
    api_key: str | None = None,
    course_id: str | None = None,
    provider: str | None = None,
) -> list[dict]:
    if not sub_queries:
        return []
    try:
        embeddings = await asyncio.to_thread(_embed_sync, sub_queries, provider, api_key)
    except Exception as e:
        print(f"[Embed Error] {e}")
        return []
    
    def _db():
        sb = get_supabase()
        all_chunks = []
        for vec in embeddings:
            if not vec: continue
            try:
                params = {
                    "query_embedding": vec,
                    "match_count": 5,
                    "filter_assignment_id": assignment_id,
                }
                if course_id:
                    params["filter_course_id"] = course_id
                try:
                    chunks = sb.rpc("match_course_material_chunks", params).execute().data or []
                except Exception as rpc_err:
                    # Live DB may still have the 3-arg RPC (migration not applied).
                    # Retry without filter_course_id so retrieval still works.
                    err_text = str(rpc_err)
                    if course_id and ("PGRST202" in err_text or "filter_course_id" in err_text or "Could not find the function" in err_text):
                        legacy = {
                            "query_embedding": vec,
                            "match_count": 5,
                            "filter_assignment_id": assignment_id,
                        }
                        chunks = sb.rpc("match_course_material_chunks", legacy).execute().data or []
                    else:
                        raise
                all_chunks.extend(chunks)
            except Exception as e:
                print(f"[Vector Search Error] {e}")
        if not all_chunks:
            # Last-resort: return any stored chunks for this assignment (no similarity)
            try:
                fallback = (
                    sb.table("course_material_chunks")
                    .select("id, chunk_text, source_title, chunk_index")
                    .eq("assignment_id", assignment_id)
                    .limit(8)
                    .execute()
                    .data
                    or []
                )
                for row in fallback:
                    row.setdefault("similarity", 0.0)
                all_chunks.extend(fallback)
            except Exception as e:
                print(f"[Vector Search Fallback Error] {e}")
        return all_chunks
    
    chunks = await asyncio.to_thread(_db)
    seen = set()
    unique_chunks = []
    for c in chunks:
        cid = c.get("id")
        if cid not in seen:
            seen.add(cid)
            unique_chunks.append(c)
    return unique_chunks

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
    submission_genre: str = "general",
    genre_signals: dict | None = None,
    section_map_reliable: bool = True,
    is_proposal: bool = False,
    peer_rubric_titles: list[str] | None = None,
):
    criterion_title = c.get('title', c.get('criterion_id', 'Unknown'))
    criterion_desc = c.get('description', '')
    max_score = c['max_score']
    genre_signals = genre_signals or {"genre": submission_genre}
    peer_rubric_titles = peer_rubric_titles or []
    title_lower = criterion_title.lower()

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

    # Heuristic for dimension if defaulted to 'content'
    dimension = c.get('dimension', 'content')
    if any(kw in title_lower for kw in ['structure', 'format', 'grammar', 'organization', 'presentation', 'style', 'mechanic', 'writing', 'citation', 'reference', 'formatting']):
        dimension = 'structure'

    credit_bands = (
        f"=== PARTIAL CREDIT BANDS (max={max_score}) ===\n"
        f"- Mention-only / keyword presence without substance: score ≤ {max(0, math.ceil(max_score * 0.40))}.\n"
        f"- Thin / incomplete / partially misplaced / poorly formatted for genre: score ≤ {max(0, math.ceil(max_score * 0.70))}.\n"
        f"- Full credit ONLY if the criterion is substantially complete for the points, "
        f"correctly placed when a section is expected, follows assignment instructions, "
        f"meets genre-appropriate method standards, and has a criterion-relevant student quote.\n"
        f"- status must match score: full ⇒ score=={max_score}; missing ⇒ 0; partial ⇒ between.\n\n"
    )

    genre_block = _genre_grading_guide(submission_genre, genre_signals, dimension)

    scope_notes = ""
    if is_proposal:
        scope_notes += (
            "=== DELIVERABLE STAGE: CONCEPTUAL / PROPOSAL ===\n"
            "This submission reads as a proposed/planned system (pilot or future evaluation), not a completed "
            "trained-model empirical study. Grade methodology for clarity of the planned approach, algorithms/"
            "software named at a design level, and evaluation plan — do NOT require completed train/test splits, "
            "trained-model metrics, preprocessing pipelines, or labeled-dataset results the paper never claimed "
            "to have finished. missing_keywords must not invent empirical-implementation checklist items "
            "absent from the rubric for a proposal.\n\n"
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
            f"- placement_ok: false if the rubric/assignment expects this in a named section but supporting content "
            f"is only found elsewhere (misplaced content earns at most partial credit).\n\n"
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
            f"- placement_ok: false when content satisfying this criterion appears only in the wrong section.\n\n"
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
        r = await asyncio.to_thread(
            call_gemini,
            prompt,
            GEMINI_GRADING_MODEL,
            0.2,
            8192,
            LLMGradingPayload,
            api_key,
            provider,
        )
    except Exception as e:
        print(f"[GRADE] Error grading criterion {c.get('criterion_id')}: {e}")
        r = {
            "score": 0,
            "status": "missing",
            "justification": f"Grading error: {str(e)}",
            "evidence_anchor": "not found",
            "missing_keywords": [],
            "material_alignment": "neutral",
            "placement_ok": True,
        }

    evidence_anchor = str(r.get('evidence_anchor', '') or '').strip()

    # Reject anchors that are not actually present in the student submission
    # (allow near-verbatim quotes — LLMs often tweak punctuation/spacing)
    if evidence_anchor and evidence_anchor.lower() not in ("not found", "n/a", "none"):
        if not _evidence_anchor_in_submission(evidence_anchor, txt):
            evidence_anchor = "not found"

    # If a section was expected and the anchor only lives outside it, force placement fail
    placement_ok = bool(r.get("placement_ok", True))
    if (
        section_map_reliable
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

    v = {
        "criterion_id": c['criterion_id'],
        "criterion_name": c.get('title', c['criterion_id']),
        "dimension": dimension,
        "score": int(r.get('score', 0) or 0),
        "max_score": max_score,
        "status": str(r.get('status', 'partial')),
        "justification": str(r.get('justification', '')),
        "missing_keywords": _filter_proposal_missing_keywords(
            r.get('missing_keywords', []) or [],
            is_proposal,
        ),
        "evidence_anchor": evidence_anchor or "not found",
        "supporting_materials": r.get('supporting_materials', []) or [],
        "covered_concepts": r.get('covered_concepts', []) or [],
        "required_concepts": r.get('required_concepts', []) or [],
        "ai_generated": c.get("ai_generated", False),
        "material_alignment": r.get("material_alignment", "neutral") or "neutral",
        "placement_ok": placement_ok,
        "placement_issue": not placement_ok,
        "section_map_reliable": section_map_reliable,
        "submission_text": txt,
        "ungrounded_full": False,
    }
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
    rubric = state.get("rubric_criteria", [])
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

    if not rubric:
        return {"verdicts": [], "relevant_chunks": []}

    # Map previous critiques by criterion_id if this is a retry loop
    prev_critiques = {c["criterion_id"]: c for c in state.get("critiques", []) if c.get("flag_for_human")}

    async def _process_criterion(c):
        cid = c.get("criterion_id", "")
        criterion_title = c.get('title', cid)
        criterion_desc = c.get('description', '')

        provider, api_key = _llm_creds(state)
        # 1. Decompose
        sub_queries = await _decompose_criterion(
            criterion_title, criterion_desc, api_key=api_key, provider=provider
        )
        # 2. Multi-Hop Retrieve
        retrieved_chunks = await _multihop_retrieve(
            sub_queries,
            aid,
            api_key=api_key,
            course_id=state.get("course_id"),
            provider=provider,
        )

        # Build context from semantically retrieved course material
        ctx = "\n---\n".join([
            f"[Source: {ch.get('source_title', 'Unknown Source').split(' (chunk')[0].strip()}] (Chunk {ch.get('chunk_index', '?')}) (similarity: {round(ch.get('similarity', 0), 2)})\n{ch.get('chunk_text', '')}"
            for ch in retrieved_chunks[:10]
        ])
        if not ctx:
            ctx = "(No course material retrieved. Grade using the rubric, assignment context, and student submission.)"

        hint = _criterion_section_hint(criterion_title, criterion_desc)
        matched = _resolve_section_for_criterion(sections, hint) if section_map_reliable else None
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
                section_guide = (
                    f"=== PLACEMENT GUIDANCE ===\n"
                    f"This criterion maps to section hint '{hint}'. A matching heading was found: '{matched['title']}'.\n"
                    f"Prefer evidence from that section. If the only supporting content is outside it, set placement_ok=false "
                    f"and award at most partial credit.\n"
                    f"=== EXPECTED SECTION BODY ({matched['title']}) ===\n{body_preview}\n"
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
            expected_section_title=expected_title,
            submission_genre=genre,
            genre_signals=signals,
            section_map_reliable=section_map_reliable,
            is_proposal=is_proposal,
            peer_rubric_titles=peer_rubric_titles,
        )
        return verdict, retrieved_chunks

    tasks = [_process_criterion(c) for c in rubric]
    results = list(await asyncio.gather(*tasks))

    verdicts = [res[0] for res in results]
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

    force_flag_for_human = False
    for v in verdicts:
        if v.get("ungrounded_full") or v.get("placement_issue") or v.get("material_alignment") == "contradicts":
            force_flag_for_human = True

    verdicts, holistic_flag = _holistic_consistency_nudge(verdicts)
    if holistic_flag:
        force_flag_for_human = True

    return {
        "verdicts": verdicts,
        "loop_count": state.get("loop_count", 0) + 1,
        "force_flag_for_human": force_flag_for_human,
        "relevant_chunks": all_chunks,
    }

# Critique model for structured LLM output
class LLMCritiquePayload(BaseModel):
    is_supported: bool
    is_justified: bool
    confidence: float
    reasoning: str

# Parallel Critique Helper — Actually calls the LLM
async def _cp(v, api_key=None, provider=None):
    criterion_title = v.get("criterion_name", v.get("criterion_id", "Unknown"))
    max_score = int(v.get("max_score") or 0)
    score = int(v.get("score") or 0)
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

# Node 5: Output — with topic radar, misconception hint, and concepts for Knowledge Graph
async def run_output(state: GradingState) -> dict:
    raw_verdicts = list(state.get("verdicts", []) or [])
    raw_verdicts = _dedupe_overlapping_ai_penalties(raw_verdicts)
    raw_verdicts = _soften_challenges_ethics_double_count(raw_verdicts)
    # Final deterministic consistency pass before aggregation
    raw_verdicts, holistic_flag = _holistic_consistency_nudge(raw_verdicts)

    verts = []
    for v in raw_verdicts:
        payload = {k: v[k] for k in v if k in CriterionVerdict.model_fields}
        # Ensure guards applied once more with clean status/score
        guarded = _apply_verdict_score_guards(dict(v), int(v.get("max_score") or 0))
        payload = {k: guarded.get(k, payload.get(k)) for k in CriterionVerdict.model_fields}
        verts.append(CriterionVerdict(**payload))
    critiques = [CritiqueResult(**{k: c[k] for k in c if k in CritiqueResult.model_fields}) for c in state.get("critiques", [])]

    # Separate content vs structure scores, excluding AI-generated criteria
    content_verts = [v for v in verts if v.dimension == "content" and not v.ai_generated]
    structure_verts = [v for v in verts if v.dimension == "structure" and not v.ai_generated]

    content_score = sum(v.score for v in content_verts)
    content_max = sum(v.max_score for v in content_verts)
    structure_score = sum(v.score for v in structure_verts)
    structure_max = sum(v.max_score for v in structure_verts)
    total = content_score + structure_score
    total_max = content_max + structure_max

    # Build topic mastery radar (percentage per criterion)
    topic_mastery_radar = {}
    for v in verts:
        if v.max_score > 0:
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

    # Check if rubric was available
    rubric_missing = len(state.get("rubric_criteria", [])) == 0
    if rubric_missing:
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
    strong_match_count = sum(1 for s in sims if s >= 0.45)
    usable_count = sum(1 for s in sims if s >= 0.28)
    top_avg = (sum(sims[:5]) / min(5, len(sims))) if sims else 0.0

    if not sims or usable_count == 0:
        rag_coverage_level = "NONE"
    elif strong_match_count >= 3 or top_avg >= 0.50:
        rag_coverage_level = "HIGH"
    elif strong_match_count >= 1 or usable_count >= 3 or top_avg >= 0.35:
        rag_coverage_level = "MEDIUM"
    else:
        rag_coverage_level = "LOW"

    # Human review: require real uncertainty — not a single noisy critique flag.
    overall_confidence = sum(c.confidence for c in critiques) / len(critiques) if critiques else 0.9
    flagged_count = sum(1 for c in critiques if c.flag_for_human)
    majority_flagged = flagged_count >= max(1, (len(critiques) + 1) // 2) if critiques else False
    any_flagged = (
        state.get("force_flag_for_human", False)
        or holistic_flag
        or overall_confidence < 0.65
        or majority_flagged
        or any(not c.is_supported or not c.is_justified for c in critiques)
    )

    out = GradingOutput(
        assignment_id=state["assignment_id"],
        student_id=state["student_id"],
        content_score=content_score,
        content_max=content_max,
        structure_score=structure_score,
        structure_max=structure_max,
        total=total,
        total_max=total_max,
        criteria_verdicts=[v.model_dump() for v in verts],
        topic_mastery_radar=topic_mastery_radar,
        misconception_hint=misconception_hint,
        flag_for_human=any_flagged,
        overall_confidence=round(overall_confidence, 2),
        critiques=state.get("critiques", []),
        referenced_materials=referenced_materials,
        rag_coverage_level=rag_coverage_level,
        strong_match_count=strong_match_count,
    )
    res = out.model_dump()
    res["rubric_missing"] = rubric_missing
    # Include submission concepts for Knowledge Graph updates on the frontend
    res["submission_concepts"] = state.get("submission_concepts", [])

    # Save to grading_results table
    try:
        def _save():
            sb = get_supabase()
            aid = state["assignment_id"]
            sid = state["student_id"]
            existing = sb.table("grading_results").select("id").eq("assignment_id", aid).eq("student_id", sid).execute().data
            if existing:
                row_id = existing[0]["id"]
                sb.table("grading_results").update({
                    "result_json": res
                }).eq("id", row_id).execute()
            else:
                sb.table("grading_results").insert({
                    "assignment_id": aid,
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

def get_graph():
    g = StateGraph(GradingState)
    g.add_node("ingest", run_ingest)
    g.add_node("retrieve", run_retrieve)
    g.add_node("grade", run_grade)
    g.add_node("critique", run_critique)
    g.add_node("output", run_output)
    g.set_entry_point("ingest")
    g.add_edge("ingest", "retrieve")
    g.add_edge("retrieve", "grade")
    g.add_edge("grade", "critique")
    g.add_conditional_edges("critique", should_continue, {"grade": "grade", "output": "output"})
    g.add_edge("output", END)
    return g.compile()

@app.route("/api/grade", methods=["POST"])
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

        # Canvas often stores Harmonize/LTI launch URLs as the body — resolve via Canvas LTI launch
        external_url = _detect_external_submission_url(submission_text)
        if external_url:
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
                    external_url,
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
                            "Open the submission in Canvas SpeedGrader to review, or ask the student "
                            "for a file/text copy. "
                            + (resolved.get("error") or "")
                        ),
                        "speedgrader_url": resolved.get("speedgrader_url"),
                        "launch_url": resolved.get("launch_url"),
                    }), 400
            except Exception as ext_err:
                traceback.print_exc()
                return jsonify({
                    "error": "EXTERNAL_SUBMISSION_FETCH_FAILED",
                    "details": str(ext_err),
                }), 400

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

        from grading_server.ingest_service import assert_embedding_provider_compatible
        try:
            await assert_embedding_provider_compatible(
                assignment_id=str(data.get("assignment_id") or ""),
                course_id=str(data.get("course_id") or "") or None,
                provider=llm_provider,
            )
        except RuntimeError as reingest_err:
            msg = str(reingest_err)
            if msg.startswith("REINGEST_REQUIRED:"):
                return jsonify({
                    "error": "REINGEST_REQUIRED",
                    "message": msg.split(":", 1)[1].strip(),
                    "details": msg,
                }), 409
            raise

        final = await get_graph().ainvoke({
            "assignment_id": data.get("assignment_id"),
            "course_id": data.get("course_id") or request.form.get("course_id"),
            "student_id": data.get("student_id"),
            "submission_text": submission_text,
            "assignment_context": assignment_context,
            "submission_genre": submission_genre,
            "submission_filenames": uniq_filenames,
            "genre_signals": genre_signals,
            "custom_gemini_key": llm_api_key,
            "llm_provider": llm_provider,
            "llm_api_key": llm_api_key,
        })
        
        res = final["final_output"]
        res["_pipeline_duration_seconds"] = round(time.time() - s, 2)
        res["extracted_submission_text"] = submission_text
        res["submission_genre"] = submission_genre
        res["genre_signals"] = genre_signals
        return jsonify(res), 200
    except Exception as e:
        traceback.print_exc()
        err_msg = str(e)
        if "expected 768 dimensions" in err_msg or "expected 3072 dimensions" in err_msg:
             return jsonify({"error": "DATABASE_DIMENSION_MISMATCH", "details": "Please run the setup_ingestion_tables.sql in Supabase SQL Editor to update your vector dimensions to 3072."}), 500
        if "REINGEST_REQUIRED" in err_msg:
             return jsonify({"error": "REINGEST_REQUIRED", "message": err_msg.split(":", 1)[-1].strip(), "details": err_msg}), 409
        if "PERMISSION_DENIED" in err_msg or "API key not valid" in err_msg or "API key was reported as leaked" in err_msg or "LLM HTTP 401" in err_msg or "BYOK required" in err_msg:
             return jsonify({"error": "Invalid LLM API key. Re-verify your provider key in settings.", "details": err_msg}), 401
        if "RESOURCE_EXHAUSTED" in err_msg or "exceeded your current quota" in err_msg or "429" in err_msg:
             return jsonify({"error": "LLM API quota exceeded. Wait a moment and retry one student.", "details": err_msg}), 429
        if "cannot schedule new futures after shutdown" in err_msg:
             return jsonify({"error": "Grading server restarted mid-request. Please click Grade again.", "details": err_msg}), 503
        # Surface a short actionable message (not just a vague internal error)
        short = err_msg[:240] if err_msg else "Unknown error"
        return jsonify({"error": f"Grading failed: {short}", "details": err_msg}), 500

@app.route("/api/health")
def health(): return jsonify({"status":"ok"}), 200


@app.route("/api/llm/providers", methods=["GET"])
def llm_providers():
    return jsonify({"providers": list_providers()}), 200


@app.route("/api/verify-llm", methods=["POST"])
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

@app.route("/api/ingest", methods=["POST"])
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
        )
        return jsonify(result), 200

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Ingestion failed"}), 500


@app.route("/api/ingest/file", methods=["POST"])
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

        # Determine file type and extract text
        if filename.endswith(".pdf"):
            course_material_text = _extract_pdf(file_bytes)
        elif filename.endswith(".docx"):
            course_material_text = _extract_docx(file_bytes)
        elif filename.endswith(".pptx"):
            course_material_text = _extract_pptx(file_bytes)
        elif filename.endswith(".ppt"):
            course_material_text = "This is a legacy .ppt file; content could not be extracted for AI grading. Please review manually."
        elif filename.endswith(".txt"):
            course_material_text = file_bytes.decode("utf-8", errors="ignore")
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            mime_type = "image/png"
            if filename.endswith((".jpg", ".jpeg")): mime_type = "image/jpeg"
            elif filename.endswith(".webp"): mime_type = "image/webp"
            course_material_text = _extract_image(file_bytes, mime_type)
        else:
            return jsonify({
                "error": f"Unsupported file type: '{filename}'."
            }), 400

        if not course_material_text.strip():
            return jsonify({"error": "Could not extract any text from the uploaded file"}), 400

        llm_provider, llm_api_key = resolve_llm_credentials(request)
        if not llm_provider or not llm_api_key:
            return byok_required_response()

        result = await ingest_course_material(
            assignment_id=assignment_id,
            course_material_text=course_material_text,
            rubric_criteria=rubric_criteria,
            exemplars=exemplars if exemplars else None,
            source_name=filename,
            api_key=llm_api_key,
            provider=llm_provider,
        )
        return jsonify(result), 200

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
MAX_CANVAS_DOWNLOAD_BYTES = 25 * 1024 * 1024
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


def _detect_external_submission_url(text: str) -> str | None:
    """If submission_text is only an LTI/Harmonize launch URL, return that URL."""
    if not text:
        return None
    plain = _html_to_text(text) if "<" in text else text
    collapsed = re.sub(r"\s+", "", plain or "").strip()
    match = re.fullmatch(r"https?://\S+", collapsed, flags=re.IGNORECASE)
    if not match:
        return None
    url = match.group(0)
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


def _follow_lti_launch(sessionless_url: str) -> dict:
    """
    Open Canvas sessionless launch URL, auto-submit the LTI form if present,
    and return sanitized HTML + plain text from the tool response.
    """
    session = requests.Session()
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 EduConnect-AI/1.0"
        ),
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    }
    r = session.get(sessionless_url, headers=headers, timeout=45, allow_redirects=True)
    html = r.text or ""
    lower = html.lower()

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

    text = _html_to_text(html)
    if "launch message is of an unknown version" in lower or "unknown version" in (text or "").lower():
        raise ValueError(
            "LTI launch failed (unknown version). The raw Harmonize URL cannot be opened without Canvas signing."
        )
    safe_html = _sanitize_submission_html(html)
    return {"html": safe_html, "text": (text or "").strip()}


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

    speedgrader_url = None
    if course_id and assignment_id and student_id:
        speedgrader_url = (
            f"{CANVAS_BASE_URL.rstrip('/')}/courses/{course_id}/gradebook/speed_grader"
            f"?assignment_id={assignment_id}&student_id={student_id}"
        )

    # 1) Always pull the Canvas submission record first
    if course_id and assignment_id and student_id and canvas_token:
        try:
            canvas_submission = _fetch_canvas_submission_json(
                course_id, assignment_id, student_id, canvas_token
            )
            body = (canvas_submission.get("body") or "").strip()
            sub_url = (canvas_submission.get("url") or url or "").strip()
            if sub_url and not url:
                url = sub_url

            # If Canvas already has real HTML/text (not just an LTI URL), show that
            external_only = _detect_external_submission_url(body)
            if body and not external_only:
                html = _sanitize_submission_html(body)
                text = _html_to_text(body)
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
            html = followed.get("html") or html
            text = (followed.get("text") or text or "").strip()
        except Exception as e:
            warnings.append(f"lti follow: {e}")

    if not launch_url and not html and not text:
        return {
            "error": "; ".join(warnings) or "Could not load submission from Canvas",
            "speedgrader_url": speedgrader_url,
            "launch_url": None,
            "html": "",
            "text": "",
        }

    return {
        "launch_url": launch_url,
        "tool_name": tool_name,
        "html": html,
        "text": text,
        "chars": len(text or ""),
        "speedgrader_url": speedgrader_url,
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

    allowed_hosts = {"instructure.com", "inscloudgate.net", "instructuremedia.com"}
    configured = urlparse(CANVAS_BASE_URL).hostname
    if configured:
        allowed_hosts.add(configured.lower())

    if host.startswith("canvas."):
        return None
    for allowed in allowed_hosts:
        if host == allowed or host.endswith(f".{allowed}"):
            return None
    return f"Host '{host}' is not a recognized Canvas host"


def _download_canvas_bytes(file_url: str, canvas_token: str | None = None) -> bytes:
    """Download a Canvas-hosted file with auth, size limit, and SSRF checks."""
    rejection = _canvas_url_rejection(str(file_url))
    if rejection:
        raise ValueError(rejection)

    headers = {"User-Agent": "EduConnect-AI/1.0"}
    if canvas_token:
        headers["Authorization"] = f"Bearer {canvas_token}"

    with requests.get(file_url, headers=headers, timeout=30, stream=True, allow_redirects=True) as r:
        if r.status_code != 200:
            raise ValueError(f"Failed to download from Canvas: {r.status_code}")

        declared_length = r.headers.get("Content-Length")
        if declared_length and declared_length.isdigit() and int(declared_length) > MAX_CANVAS_DOWNLOAD_BYTES:
            raise ValueError("File is too large (limit 25MB)")

        parts: list[bytes] = []
        total = 0
        for part in r.iter_content(chunk_size=65536):
            if not part:
                continue
            total += len(part)
            if total > MAX_CANVAS_DOWNLOAD_BYTES:
                raise ValueError("File is too large (limit 25MB)")
            parts.append(part)
        return b"".join(parts)


@app.route("/api/resolve-external-submission", methods=["POST"])
@app.route("/api/fetch-external-submission", methods=["POST"])
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
def proxy_file():
    """
    Browser-safe proxy for Canvas file URLs (avoids CORS Failed to fetch in Local Reader).
    GET /api/proxy-file?url=...
    Header: X-Canvas-Token (optional)
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
        headers={
            "Cache-Control": "private, max-age=300",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.route("/api/ingest/canvas-url", methods=["POST"])
async def ingest_canvas_url():
    """
    Downloads a file from a given URL and ingests it.
    """
    try:
        data = request.get_json(force=True)
        assignment_id = data.get("assignment_id")
        file_url = data.get("url")
        filename = (data.get("filename") or "").lower()
        canvas_token = data.get("canvas_token")

        if not assignment_id or not file_url:
            return jsonify({"error": "assignment_id and url are required"}), 400

        rejection = _canvas_url_rejection(str(file_url))
        if rejection:
            return jsonify({"error": rejection}), 400

        headers = {}
        if canvas_token:
            headers["Authorization"] = f"Bearer {canvas_token}"

        with requests.get(file_url, headers=headers, timeout=30, stream=True) as r:
            if r.status_code != 200:
                return jsonify({"error": f"Failed to download from Canvas: {r.status_code} {r.text[:500]}"}), 400

            declared_length = r.headers.get("Content-Length")
            if declared_length and declared_length.isdigit() and int(declared_length) > MAX_CANVAS_DOWNLOAD_BYTES:
                return jsonify({"error": "File is too large to ingest (limit 25MB)"}), 400

            parts: list[bytes] = []
            total = 0
            for part in r.iter_content(chunk_size=65536):
                total += len(part)
                if total > MAX_CANVAS_DOWNLOAD_BYTES:
                    return jsonify({"error": "File is too large to ingest (limit 25MB)"}), 400
                parts.append(part)
            file_bytes = b"".join(parts)

        # Determine file type and extract text
        if filename.endswith(".pdf"):
            course_material_text = _parse_pdf(file_bytes)
        elif filename.endswith(".docx"):
            course_material_text = _parse_docx(file_bytes)
        elif filename.endswith(".pptx"):
            course_material_text = _parse_pptx(file_bytes)
        elif filename.endswith(".txt"):
            course_material_text = file_bytes.decode("utf-8", errors="ignore")
        elif filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            course_material_text = "[Image material submitted, skipping text extraction]"
        else:
            return jsonify({"error": f"Unsupported file type: '{filename}'."}), 400

        if not course_material_text.strip():
            return jsonify({"error": "Could not extract any text from the uploaded file"}), 400

        from grading_server.ingest_service import ingest_course_file, ingest_course_material

        course_id = data.get("course_id")
        canvas_file_id = data.get("canvas_file_id")
        updated_at = data.get("updated_at") or ""
        llm_provider, llm_api_key = resolve_llm_credentials(request)
        if not llm_provider or not llm_api_key:
            return byok_required_response()

        if course_id and canvas_file_id:
            result = await ingest_course_file(
                course_id=str(course_id),
                canvas_file_id=str(canvas_file_id),
                updated_at=str(updated_at),
                filename=data.get("filename") or filename,
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
            source_name=filename,
            api_key=llm_api_key,
            provider=llm_provider,
        )
        return jsonify(result), 200

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Canvas URL ingestion failed"}), 500


@app.route("/api/ingest/course-status", methods=["GET"])
async def course_ingest_status():
    course_id = request.args.get("course_id")
    if not course_id:
        return jsonify({"error": "course_id is required"}), 400
    from grading_server.ingest_service import list_course_file_status
    files = await list_course_file_status(course_id)
    return jsonify({"course_id": course_id, "files": files}), 200



@app.route("/api/ingest/<assignment_id>", methods=["DELETE"])
async def delete_ingested(assignment_id: str):
    """
    DELETE /api/ingest/<assignment_id>
    Clears all stored chunks, criteria, and exemplars for a given assignment.
    """
    try:
        if not assignment_id:
            return jsonify({"error": "assignment_id is required"}), 400

        result = await delete_assignment_data(assignment_id)
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
) -> str:
    """Extract text/visual info from a standalone image using provider vision."""
    from grading_server.utils.file_parsers import _describe_visual
    desc = _describe_visual(file_bytes, mime_type, api_key=api_key, provider=provider)
    if desc:
        return f"[FIGURE / VISUAL - treat as present in the submission]\n{desc}"
    return ""


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
    from grading_server.config import FLASK_DEBUG

    # Render / Railway inject PORT; fall back to local FLASK_PORT.
    port = int(os.environ.get("PORT", FLASK_PORT))
    print(f"Starting Flask server on port {port} (debug={FLASK_DEBUG})...")
    # use_reloader=False: Windows watchdog reloads kill in-flight grade/ingest
    # requests with "cannot schedule new futures after shutdown".
    app.run(host="0.0.0.0", port=port, debug=FLASK_DEBUG, use_reloader=False)
