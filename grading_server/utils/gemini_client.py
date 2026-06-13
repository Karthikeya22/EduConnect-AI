"""
Robust Gemini Client (Threaded-Async Strategy)
Provides async wrappers around verified sync functions.
Enables safe and reliable parallelism in Windows environments.
"""

from __future__ import annotations
import os
import re
import json
import asyncio
from google import genai
from google.genai import types
from grading_server.config import GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL

# Single global sync client
_genai_client = genai.Client(api_key=GEMINI_API_KEY)


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
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**config_kwargs),
    )
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
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=4096,
        ),
    )
    return response.text or ""


def embed_text(text: str) -> list[float]:
    """Sync single embedding. Truncated to 768 for database compatibility."""
    if not text: return []
    result = _genai_client.models.embed_content(
        model=GEMINI_EMBEDDING_MODEL,
        contents=text,
    )
    # Gemini models return 3072, but we slice to 768 for legacy DB support
    return list(result.embeddings[0].values)[:768]


def embed_texts(texts: list[str], api_key: str | None = None) -> list[list[float]]:
    """Sync batch embedding. Truncated to 768 for database compatibility."""
    if not texts: return []
    all_embeddings = []
    client = genai.Client(api_key=api_key) if api_key else _genai_client
    # Batch in chunks of 100
    for i in range(0, len(texts), 100):
        chunk = texts[i:i + 100]
        result = client.models.embed_content(
            model=GEMINI_EMBEDDING_MODEL,
            contents=chunk,
        )
        # Matryoshka-style truncation: first 768 dimensions are stable
        all_embeddings.extend([list(e.values)[:768] for e in result.embeddings])
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
