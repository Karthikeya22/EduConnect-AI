"""
Robust Gemini Client (Threaded-Async Strategy)
Provides async wrappers around verified sync functions.
Enables safe and reliable parallelism in Windows environments.
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

# Single global sync client
_genai_client = genai.Client(api_key=GEMINI_API_KEY)


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
        
    client = genai.Client(api_key=api_key) if api_key else _genai_client

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
    client = genai.Client(api_key=api_key) if api_key else _genai_client

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


def embed_text(text: str) -> list[float]:
    """Sync single embedding. Requested as 768 for database compatibility."""
    if not text: return []

    def _call():
        return _genai_client.models.embed_content(
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
    client = genai.Client(api_key=api_key) if api_key else _genai_client
    # Smaller batches + pacing to stay under Gemini embed rate limits
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


# ── Async Wrappers (Threaded) ───────────────────────────────────────────────────

async def async_call_gemini(prompt: str, **kwargs) -> dict:
    """Non-blocking call via thread pool executor."""
    return await asyncio.to_thread(call_gemini, prompt, **kwargs)


async def async_call_gemini_text(prompt: str, **kwargs) -> str:
    """Non-blocking text call via thread."""
    return await asyncio.to_thread(call_gemini_text, prompt, **kwargs)


async def async_embed_texts(texts: list[str]) -> list[list[float]]:
    """Non-blocking batch embedding."""
    return await asyncio.to_thread(embed_texts, texts)
