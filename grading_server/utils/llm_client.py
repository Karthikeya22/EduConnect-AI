"""
Unified BYOK LLM client: chat (JSON/text), embeddings @ 768, and vision describe.
"""

from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

from grading_server.utils.llm_registry import (
    EMBEDDING_DIM,
    ProviderConfig,
    get_provider,
    normalize_embedding,
)

# Tiny 1x1 PNG for vision smoke tests
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _parse_json_loose(raw_text: str) -> dict:
    clean = re.sub(r"^```(?:json)?\s*", "", raw_text or "", flags=re.MULTILINE)
    clean = re.sub(r"```\s*$", "", clean, flags=re.MULTILINE).strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"JSON Parse Error: {(raw_text or '')[:200]}")


def _http_json(
    method: str,
    url: str,
    *,
    api_key: str,
    body: dict | None = None,
    extra_headers: dict | None = None,
    timeout: float = 90.0,
) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"LLM HTTP {e.code} {url}: {err_body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"LLM connection failed: {e.reason}") from e


def _compat_headers(cfg: ProviderConfig) -> dict:
    if not cfg.openrouter_headers:
        return {}
    return {
        "HTTP-Referer": "https://educonnect.ai",
        "X-Title": "EduConnect AI",
    }


# ── Gemini adapter ────────────────────────────────────────────────────────────

def _gemini_client(api_key: str):
    from google import genai
    return genai.Client(api_key=api_key)


def _gemini_chat_json(
    cfg: ProviderConfig,
    api_key: str,
    prompt: str,
    *,
    temperature: float,
    max_tokens: int,
    response_schema: type | dict | None,
    model: str | None,
) -> dict:
    from google.genai import types

    client = _gemini_client(api_key)
    config_kwargs: dict[str, Any] = {
        "temperature": temperature,
        "max_output_tokens": max_tokens,
        "response_mime_type": "application/json",
    }
    if response_schema:
        config_kwargs["response_schema"] = response_schema
    response = client.models.generate_content(
        model=model or cfg.chat_model,
        contents=prompt,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    return _parse_json_loose(response.text or "")


def _gemini_chat_text(
    cfg: ProviderConfig,
    api_key: str,
    prompt: str,
    *,
    temperature: float,
    model: str | None,
) -> str:
    from google.genai import types

    client = _gemini_client(api_key)
    response = client.models.generate_content(
        model=model or cfg.chat_model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=4096,
        ),
    )
    return response.text or ""


def _gemini_embed(cfg: ProviderConfig, api_key: str, texts: list[str]) -> list[list[float]]:
    from google.genai import types

    if not texts:
        return []
    client = _gemini_client(api_key)
    out: list[list[float]] = []
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        result = client.models.embed_content(
            model=cfg.embedding_model,
            contents=batch,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        out.extend([normalize_embedding(list(e.values)) for e in result.embeddings])
        if i + batch_size < len(texts):
            time.sleep(0.35)
    return out


def _gemini_describe_image(
    cfg: ProviderConfig,
    api_key: str,
    image_bytes: bytes,
    mime_type: str,
) -> str:
    from google.genai import types

    client = _gemini_client(api_key)
    response = client.models.generate_content(
        model=cfg.vision_model,
        contents=[
            types.Content(
                parts=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    types.Part.from_text(
                        text="Describe this image briefly for academic grading context."
                    ),
                ]
            )
        ],
    )
    return (response.text or "").strip() or "[image]"


# ── OpenAI-compatible adapter ─────────────────────────────────────────────────

def _compat_chat_json(
    cfg: ProviderConfig,
    api_key: str,
    prompt: str,
    *,
    temperature: float,
    max_tokens: int,
    response_schema: type | dict | None,
    model: str | None,
) -> dict:
    schema_hint = ""
    if response_schema is not None:
        schema_hint = (
            "\n\nRespond with a single JSON object only, matching the required schema fields."
        )
    body = {
        "model": model or cfg.chat_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {
                "role": "system",
                "content": "You are a precise academic grading assistant. Always reply with valid JSON only."
                + schema_hint,
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    # Some providers (older DeepSeek/Kimi) reject response_format — retry without it.
    url = f"{cfg.api_base.rstrip('/')}/chat/completions"
    try:
        data = _http_json(
            "POST", url, api_key=api_key, body=body, extra_headers=_compat_headers(cfg)
        )
    except RuntimeError as e:
        if "response_format" in str(e).lower() or "400" in str(e):
            body.pop("response_format", None)
            data = _http_json(
                "POST", url, api_key=api_key, body=body, extra_headers=_compat_headers(cfg)
            )
        else:
            raise
    text = data["choices"][0]["message"]["content"]
    return _parse_json_loose(text)


def _compat_chat_text(
    cfg: ProviderConfig,
    api_key: str,
    prompt: str,
    *,
    temperature: float,
    model: str | None,
) -> str:
    body = {
        "model": model or cfg.chat_model,
        "temperature": temperature,
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    url = f"{cfg.api_base.rstrip('/')}/chat/completions"
    data = _http_json(
        "POST", url, api_key=api_key, body=body, extra_headers=_compat_headers(cfg)
    )
    return data["choices"][0]["message"]["content"] or ""


def _compat_embed(cfg: ProviderConfig, api_key: str, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    url = f"{cfg.api_base.rstrip('/')}/embeddings"
    out: list[list[float]] = []
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        body: dict[str, Any] = {"model": cfg.embedding_model, "input": batch}
        if cfg.supports_embedding_dimensions:
            body["dimensions"] = EMBEDDING_DIM
        data = _http_json(
            "POST", url, api_key=api_key, body=body, extra_headers=_compat_headers(cfg)
        )
        # OpenAI returns data sorted by index
        items = sorted(data.get("data", []), key=lambda x: x.get("index", 0))
        for item in items:
            out.append(normalize_embedding(list(item["embedding"])))
    return out


def _compat_describe_image(
    cfg: ProviderConfig,
    api_key: str,
    image_bytes: bytes,
    mime_type: str,
) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"
    body = {
        "model": cfg.vision_model,
        "max_tokens": 512,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Describe this image briefly for academic grading context.",
                    },
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    url = f"{cfg.api_base.rstrip('/')}/chat/completions"
    data = _http_json(
        "POST", url, api_key=api_key, body=body, extra_headers=_compat_headers(cfg)
    )
    return (data["choices"][0]["message"]["content"] or "").strip() or "[image]"


# ── Public API ────────────────────────────────────────────────────────────────

def chat_json(
    prompt: str,
    *,
    provider: str,
    api_key: str,
    temperature: float = 0.2,
    max_tokens: int = 8192,
    response_schema: type | dict | None = None,
    model: str | None = None,
) -> dict:
    if not api_key or not api_key.strip():
        raise ValueError("LLM API key is required")
    cfg = get_provider(provider)
    key = api_key.strip()
    if cfg.kind == "gemini":
        return _gemini_chat_json(
            cfg, key, prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            response_schema=response_schema,
            model=model,
        )
    return _compat_chat_json(
        cfg, key, prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        response_schema=response_schema,
        model=model,
    )


def chat_text(
    prompt: str,
    *,
    provider: str,
    api_key: str,
    temperature: float = 0.3,
    model: str | None = None,
) -> str:
    if not api_key or not api_key.strip():
        raise ValueError("LLM API key is required")
    cfg = get_provider(provider)
    key = api_key.strip()
    if cfg.kind == "gemini":
        return _gemini_chat_text(cfg, key, prompt, temperature=temperature, model=model)
    return _compat_chat_text(cfg, key, prompt, temperature=temperature, model=model)


def embed_texts(
    texts: list[str],
    *,
    provider: str,
    api_key: str,
) -> list[list[float]]:
    if not api_key or not api_key.strip():
        raise ValueError("LLM API key is required")
    cfg = get_provider(provider)
    key = api_key.strip()
    if cfg.kind == "gemini":
        return _gemini_embed(cfg, key, texts)
    return _compat_embed(cfg, key, texts)


def describe_image(
    image_bytes: bytes,
    mime_type: str = "image/png",
    *,
    provider: str,
    api_key: str,
) -> str:
    if not api_key or not api_key.strip():
        raise ValueError("LLM API key is required")
    cfg = get_provider(provider)
    key = api_key.strip()
    if cfg.kind == "gemini":
        return _gemini_describe_image(cfg, key, image_bytes, mime_type)
    return _compat_describe_image(cfg, key, image_bytes, mime_type)


def verify_llm(provider: str, api_key: str) -> dict:
    """
    Smoke-test chat + embeddings(768) + vision.
    Returns {ok, provider, models} or raises RuntimeError with step context.
    """
    cfg = get_provider(provider)
    key = (api_key or "").strip()
    if not key:
        raise ValueError("API key is required")

    # 1) Chat
    try:
        chat_text("Reply with exactly: OK", provider=provider, api_key=key, temperature=0)
    except Exception as e:
        raise RuntimeError(f"Chat verification failed: {e}") from e

    # 2) Embeddings
    try:
        vecs = embed_texts(["educonnect verify"], provider=provider, api_key=key)
        if not vecs or len(vecs[0]) != EMBEDDING_DIM:
            raise RuntimeError(
                f"Expected embedding dim {EMBEDDING_DIM}, got {len(vecs[0]) if vecs else 0}"
            )
    except Exception as e:
        raise RuntimeError(f"Embedding verification failed: {e}") from e

    # 3) Vision
    try:
        png = base64.b64decode(_TINY_PNG_B64)
        describe_image(png, "image/png", provider=provider, api_key=key)
    except Exception as e:
        raise RuntimeError(f"Vision verification failed: {e}") from e

    return {
        "ok": True,
        "provider": cfg.id,
        "models": {
            "chat": cfg.chat_model,
            "embedding": cfg.embedding_model,
            "vision": cfg.vision_model,
        },
    }


# Backward-compatible aliases used by grading graph (provider-aware wrappers)
def call_gemini(
    prompt: str,
    model: str = "models/gemini-2.5-flash",
    temperature: float = 0.2,
    max_tokens: int = 8192,
    response_schema: type | dict | None = None,
    api_key: str | None = None,
    *,
    provider: str | None = None,
) -> dict:
    """
    Legacy name kept for call sites. Prefer chat_json.
    Requires api_key; provider defaults to gemini.
    """
    if not api_key:
        raise ValueError("BYOK required: pass api_key / X-LLM-Api-Key")
    return chat_json(
        prompt,
        provider=provider or "gemini",
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
        response_schema=response_schema,
        model=model if provider in (None, "gemini") else None,
    )
