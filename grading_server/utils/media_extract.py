"""Audio/video → text for rubric grading via BYOK (Gemini native or NVIDIA Omni)."""
from __future__ import annotations

from typing import Any

MAX_MEDIA_BYTES = 100 * 1024 * 1024  # 100 MB soft-cap
# Omni hosted endpoints are stricter than Gemini on long clips / huge uploads.
_NVIDIA_MAX_MEDIA_BYTES = 40 * 1024 * 1024

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}

_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".webm": "audio/webm",
}
_VIDEO_MIME = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}


def media_kind_from_filename(filename: str) -> str | None:
    name = (filename or "").lower().strip()
    for ext in VIDEO_EXTS:
        if name.endswith(ext):
            return "video"
    for ext in AUDIO_EXTS:
        if name.endswith(ext):
            return "audio"
    return None


def mime_for_media(filename: str, kind: str | None = None) -> str:
    name = (filename or "").lower()
    kind = kind or media_kind_from_filename(name)
    for ext, mime in (_VIDEO_MIME if kind == "video" else _AUDIO_MIME).items():
        if name.endswith(ext):
            return mime
    return "video/mp4" if kind == "video" else "audio/mpeg"


def _max_bytes_for_provider(provider: str) -> int:
    return _NVIDIA_MAX_MEDIA_BYTES if (provider or "").lower() == "nvidia" else MAX_MEDIA_BYTES


def _gemini_media_text(
    *,
    file_bytes: bytes,
    mime_type: str,
    prompt: str,
    api_key: str,
    model: str | None = None,
) -> str:
    from grading_server.utils.llm_client import _gemini_client
    from grading_server.utils.llm_registry import get_provider
    from google.genai import types

    cfg = get_provider("gemini")
    client = _gemini_client(api_key)
    use_model = model or getattr(cfg, "vision_model", None) or cfg.chat_model
    response = client.models.generate_content(
        model=use_model,
        contents=[
            types.Content(
                parts=[
                    types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                    types.Part.from_text(text=prompt),
                ]
            )
        ],
    )
    return (response.text or "").strip()


def _provider_media_text(
    *,
    kind: str,
    file_bytes: bytes,
    mime_type: str,
    prompt: str,
    provider: str,
    api_key: str,
) -> str:
    from grading_server.utils import llm_client
    from grading_server.utils.llm_registry import get_provider

    cfg = get_provider(provider)
    if cfg.kind == "gemini" or provider == "gemini":
        model = (
            cfg.resolve_audio_model()
            if kind == "audio"
            else cfg.resolve_video_model()
        )
        return _gemini_media_text(
            file_bytes=file_bytes,
            mime_type=mime_type,
            prompt=prompt,
            api_key=api_key,
            model=model,
        )
    if provider == "nvidia" or (cfg.audio_model if kind == "audio" else cfg.video_model):
        if kind == "audio":
            return llm_client.compat_describe_audio(
                file_bytes,
                mime_type,
                provider=provider,
                api_key=api_key,
                prompt=prompt,
            )
        return llm_client.compat_describe_video(
            file_bytes,
            mime_type,
            provider=provider,
            api_key=api_key,
            prompt=prompt,
        )
    raise RuntimeError(
        f"{kind.title()} analysis is not configured for provider '{provider}'. "
        "Use Gemini or NVIDIA (Nemotron Omni), or paste a transcript."
    )


def extract_audio_for_grading(
    file_bytes: bytes,
    *,
    filename: str,
    provider: str | None,
    api_key: str | None,
) -> str:
    if not file_bytes:
        return ""
    prov = (provider or "gemini").lower()
    limit = _max_bytes_for_provider(prov)
    if len(file_bytes) > limit:
        return (
            "[AUDIO NOT ASSESSED]\n"
            f"File exceeds the {limit // (1024 * 1024)}MB grading limit for {prov}. "
            "Please review manually or submit a shorter clip."
        )
    if not api_key or not str(api_key).strip():
        return "[AUDIO NOT ASSESSED]\nAn LLM API key is required to transcribe audio for grading."
    from grading_server.utils.llm_registry import get_provider

    try:
        cfg = get_provider(prov)
    except ValueError:
        return f"[AUDIO NOT ASSESSED]\nUnknown LLM provider '{prov}'."
    if not cfg.supports_audio:
        return (
            "[AUDIO NOT ASSESSED]\n"
            f"Audio transcription is not enabled for provider '{prov}'. "
            "Switch to Gemini or NVIDIA, or paste a transcript to grade."
        )
    mime = mime_for_media(filename, "audio")
    prompt = (
        "Transcribe this student audio submission for academic grading.\n"
        "Return plain text only:\n"
        "1) A full transcript of spoken words (mark [inaudible] when needed).\n"
        "2) If useful, a short list of timestamped key claims like [mm:ss] claim.\n"
        "Do not invent content that was not spoken. Do not grade — only transcribe."
    )
    try:
        text = _provider_media_text(
            kind="audio",
            file_bytes=file_bytes,
            mime_type=mime,
            prompt=prompt,
            provider=prov,
            api_key=api_key.strip(),
        )
    except Exception as e:
        return f"[AUDIO NOT ASSESSED]\nTranscription failed: {e}"
    if not text:
        return "[AUDIO NOT ASSESSED]\nTranscription returned empty text."
    return f"[AUDIO TRANSCRIPT]\nSource file: {filename or 'audio'}\n\n{text}"


def extract_video_for_grading(
    file_bytes: bytes,
    *,
    filename: str,
    provider: str | None,
    api_key: str | None,
) -> str:
    if not file_bytes:
        return ""
    prov = (provider or "gemini").lower()
    limit = _max_bytes_for_provider(prov)
    if len(file_bytes) > limit:
        return (
            "[VIDEO NOT ASSESSED]\n"
            f"File exceeds the {limit // (1024 * 1024)}MB grading limit for {prov}. "
            "Please review manually or submit a shorter clip."
        )
    if not api_key or not str(api_key).strip():
        return "[VIDEO NOT ASSESSED]\nAn LLM API key is required to analyze video for grading."
    from grading_server.utils.llm_registry import get_provider

    try:
        cfg = get_provider(prov)
    except ValueError:
        return f"[VIDEO NOT ASSESSED]\nUnknown LLM provider '{prov}'."
    if not cfg.supports_video:
        return (
            "[VIDEO NOT ASSESSED]\n"
            f"Video analysis is not enabled for provider '{prov}'. "
            "Switch to Gemini or NVIDIA, or paste a transcript/notes to grade."
        )
    mime = mime_for_media(filename, "video")
    prompt = (
        "Analyze this student video submission for academic grading.\n"
        "Return plain text with these sections:\n"
        "[VIDEO TRANSCRIPT]\n"
        "- Full spoken transcript (use [inaudible] when needed).\n"
        "[VIDEO VISUAL NOTES]\n"
        "- What is shown on screen (slides, demos, diagrams, UI).\n"
        "- Timestamped evidence quotes when possible as [mm:ss] note.\n"
        "Do not invent unseen/unheard content. Do not assign scores — describe only."
    )
    try:
        text = _provider_media_text(
            kind="video",
            file_bytes=file_bytes,
            mime_type=mime,
            prompt=prompt,
            provider=prov,
            api_key=api_key.strip(),
        )
    except Exception as e:
        return f"[VIDEO NOT ASSESSED]\nVideo analysis failed: {e}"
    if not text:
        return "[VIDEO NOT ASSESSED]\nVideo analysis returned empty text."
    if "[VIDEO TRANSCRIPT]" not in text and "[VIDEO VISUAL NOTES]" not in text:
        text = f"[VIDEO TRANSCRIPT]\n{text}"
    return f"Source file: {filename or 'video'}\n\n{text}"


def extract_media_for_grading(
    file_bytes: bytes,
    *,
    filename: str,
    provider: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    kind = media_kind_from_filename(filename)
    if kind == "audio":
        text = extract_audio_for_grading(
            file_bytes, filename=filename, provider=provider, api_key=api_key
        )
        return {"kind": "audio", "text": text, "ok": "NOT ASSESSED" not in text[:80]}
    if kind == "video":
        text = extract_video_for_grading(
            file_bytes, filename=filename, provider=provider, api_key=api_key
        )
        return {"kind": "video", "text": text, "ok": "NOT ASSESSED" not in text[:80]}
    return {"kind": None, "text": "", "ok": False}
