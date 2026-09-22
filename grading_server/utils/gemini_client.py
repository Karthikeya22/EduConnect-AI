"""
Robust Gemini Client (Threaded-Async Strategy)

Legacy Gemini helpers. New code should prefer grading_server.utils.llm_client.
Env GEMINI_API_KEY is optional; BYOK paths must pass api_key explicitly.
"""

from __future__ import annotations
import os
import re
import json
import time
import asyncio
from google import genai
from google.genai import types
from grading_server.config import GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL

# Lazy global sync client (only if env key present — for local scripts/tests)
_genai_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def _client(api_key: str | None = None):
    if api_key:
        return genai.Client(api_key=api_key)
    if _genai_client is not None:
        return _genai_client
    raise ValueError("BYOK required: no Gemini API key provided and GEMINI_API_KEY is unset")


def _is_quota_error(err: BaseException) -> bool:
    msg = str(err)
    return (
        "RESOURCE_EXHAUSTED" in msg
        or "exceeded your current quota" in msg
        or "429" in msg
    )


def _retry_delay_seconds(err: BaseException, attempt: int) -> float:
    """Prefer Gemini's RetryInfo delay; otherwise exponential backoff."""
    match = re.search(r"Please retry in ([\d.]+)s", str(err))
    if match:
        return float(match.group(1)) + 1.0
    return min(60.0, (2 ** attempt) * 5.0)


def _with_quota_retry(fn, *, max_attempts: int = 5):
    last_err: BaseException | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_err = e
            if not _is_quota_error(e) or attempt == max_attempts - 1:
                raise
            delay = _retry_delay_seconds(e, attempt)
            print(f"[Gemini] Quota hit; retrying in {delay:.1f}s (attempt {attempt + 1}/{max_attempts})")
            time.sleep(delay)
    raise last_err  # pragma: no cover


def call_gemini(
    prompt: str,
    model: str = "models/gemini-2.5-flash",
    temperature: float = 0.2,
    max_tokens: int = 8192,
    response_schema: type | dict | None = None,
    api_key: str | None = None,
) -> dict:
    """Synchronous Gemini call."""
    config_kwargs = {
        "temperature": temperature,
        "max_output_tokens": max_tokens,
        "response_mime_type": "application/json",
    }
    if response_schema:
        config_kwargs["response_schema"] = response_schema

    client = _client(api_key)

    def _call():
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs),
        )

    response = _with_quota_retry(_call)
    raw_text = response.text or ""
    clean = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
    clean = re.sub(r"```\s*$", "", clean, flags=re.MULTILINE).strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match: return json.loads(match.group())
        raise ValueError(f"JSON Parse Error: {raw_text[:200]}")


def call_gemini_text(
    prompt: str,
    model: str = "models/gemini-2.5-flash",
    temperature: float = 0.3,
    api_key: str | None = None,
) -> str:
    """Synchronous text-only Gemini call."""
    client = _client(api_key)

    def _call():
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=temperature,
                max_output_tokens=4096,
            ),
        )

    response = _with_quota_retry(_call)
    return response.text or ""


def embed_text(text: str, api_key: str | None = None) -> list[float]:
    """Sync single embedding. Requested as 768 for database compatibility."""
    if not text: return []
    client = _client(api_key)

    def _call():
        return client.models.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )

    result = _with_quota_retry(_call)
    return list(result.embeddings[0].values)


def embed_texts(texts: list[str], api_key: str | None = None) -> list[list[float]]:
    """Sync batch embedding. Requested as 768 for database compatibility."""
    if not texts: return []
    all_embeddings = []
    client = _client(api_key)
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        chunk = texts[i:i + batch_size]

        def _call(batch=chunk):
            return client.models.embed_content(
                model=GEMINI_EMBEDDING_MODEL,
                contents=batch,
                config=types.EmbedContentConfig(output_dimensionality=768)
            )

        result = _with_quota_retry(_call)
        all_embeddings.extend([list(e.values) for e in result.embeddings])
        if i + batch_size < len(texts):
            time.sleep(0.35)
    return all_embeddings


async def async_call_gemini(prompt: str, **kwargs) -> dict:
    return await asyncio.to_thread(call_gemini, prompt, **kwargs)


async def async_call_gemini_text(prompt: str, **kwargs) -> str:
    return await asyncio.to_thread(call_gemini_text, prompt, **kwargs)


async def async_embed_texts(texts: list[str], api_key: str | None = None) -> list[list[float]]:
    return await asyncio.to_thread(embed_texts, texts, api_key)
