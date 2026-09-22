"""Helpers to resolve BYOK LLM credentials from Flask requests."""

from __future__ import annotations

from flask import Request, jsonify


def resolve_llm_credentials(req: Request) -> tuple[str, str] | tuple[None, None]:
    """
    Returns (provider, api_key) or (None, None) if missing.
    Accepts X-LLM-Provider + X-LLM-Api-Key.
    Migration alias: X-Gemini-Api-Key alone => provider=gemini.
    """
    provider = (req.headers.get("X-LLM-Provider") or "").strip().lower()
    api_key = (req.headers.get("X-LLM-Api-Key") or "").strip()
    legacy = (req.headers.get("X-Gemini-Api-Key") or "").strip()

    if not api_key and legacy:
        api_key = legacy
        if not provider:
            provider = "gemini"

    if not provider or not api_key:
        return None, None
    return provider, api_key


def byok_required_response():
    return jsonify({
        "error": "BYOK_REQUIRED",
        "message": (
            "Select an LLM provider and paste your API key, then use Verify & Save Keys "
            "before grading. Server-side Gemini fallback is disabled."
        ),
    }), 401
