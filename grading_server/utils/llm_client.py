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

from grading_server.utils.embedding_space import (
    EmbeddingSpace,
    EmbeddingTask,
    space_for_provider,
    validate_embeddings,
)
from grading_server.utils.llm_registry import (
    EMBEDDING_DIM,
    ProviderConfig,
    get_provider,
)

# Tiny 1x1 PNG for vision smoke tests
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

# Hosted OpenAI-compat vision (esp. NVIDIA) often rejects multi-MB base64 payloads
# and large VLMs can exceed a default HTTP read timeout on dense infographics.
_VISION_MAX_EDGE = 1024
_VISION_MAX_BYTES = 120_000
_VISION_RETRY_EDGE = 768
_VISION_RETRY_BYTES = 80_000
_VISION_HTTP_TIMEOUT = 180.0
# google-genai HttpOptions.timeout is milliseconds. Without this, hung generate_content
# calls never return and permanently occupy asyncio.to_thread workers — wedging /api/grade.
_GEMINI_HTTP_TIMEOUT_MS = 90_000
_VISION_PROMPT = (
    "You are extracting content from a student submission image for academic grading. "
    "Transcribe ALL visible text verbatim (titles, labels, captions, timeline entries, legends). "
    "Then briefly describe layout, figures, colors, and visual design. Be thorough on the text."
)


def prepare_vision_image(
    image_bytes: bytes,
    mime_type: str = "image/png",
    *,
    max_edge: int = _VISION_MAX_EDGE,
    max_bytes: int = _VISION_MAX_BYTES,
) -> tuple[bytes, str]:
    """Downscale/compress images so vision APIs accept them as inline data URLs.

    Leave already-small images untouched — recompressing a 1x1 smoke-test PNG into
    JPEG makes Gemini return 400 INVALID_ARGUMENT ("Unable to process input image").
    """
    if not image_bytes:
        return image_bytes, mime_type
    # Under the provider payload budget: keep original bytes + mime (PNG/WebP/JPEG).
    if len(image_bytes) <= max_bytes:
        return image_bytes, mime_type or "image/png"
    try:
        import io
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")
        w, h = img.size
        longest = max(w, h) or 1
        if longest > max_edge:
            scale = max_edge / longest
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        edge = min(max(img.size), max_edge)
        while edge >= 512:
            if max(img.size) > edge:
                scale = edge / max(img.size)
                img = img.resize(
                    (max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale))),
                    Image.Resampling.LANCZOS,
                )
            for quality in (85, 75, 65, 55, 45):
                out.seek(0)
                out.truncate(0)
                img.save(out, format="JPEG", quality=quality, optimize=True)
                if out.tell() <= max_bytes:
                    return out.getvalue(), "image/jpeg"
            edge = int(edge * 0.75)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        print(f"[VISION] prepare_vision_image failed ({e}); using original bytes", flush=True)
        return image_bytes, mime_type


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
    except TimeoutError as e:
        raise RuntimeError(f"LLM request timed out after {timeout:.0f}s: {e}") from e


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
    from google.genai import types as genai_types

    return genai.Client(
        api_key=api_key,
        http_options=genai_types.HttpOptions(timeout=_GEMINI_HTTP_TIMEOUT_MS),
    )


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


_GEMINI_TASK = {"document": "RETRIEVAL_DOCUMENT", "query": "RETRIEVAL_QUERY"}
_NVIDIA_INPUT_TYPE = {"document": "passage", "query": "query"}


def _gemini_embed(
    cfg: ProviderConfig, api_key: str, texts: list[str], space: EmbeddingSpace, task: EmbeddingTask
) -> list[list[float]]:
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
            config=types.EmbedContentConfig(
                output_dimensionality=space.dimensions,
                task_type=_GEMINI_TASK[task],
            ),
        )
        raw = [list(e.values or []) for e in (result.embeddings or [])]
        out.extend(validate_embeddings(raw, len(batch), space))
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
                    types.Part.from_text(text=_VISION_PROMPT),
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


def _compat_embed_body(cfg: ProviderConfig, batch: list[str], task: EmbeddingTask) -> dict[str, Any]:
    body: dict[str, Any] = {"model": cfg.embedding_model, "input": batch}
    if cfg.supports_embedding_dimensions:
        body["dimensions"] = EMBEDDING_DIM
    if cfg.requires_embed_input_type:
        body["input_type"] = _NVIDIA_INPUT_TYPE[task]
    return body


def _compat_embed(
    cfg: ProviderConfig,
    api_key: str,
    texts: list[str],
    space: EmbeddingSpace,
    task: EmbeddingTask,
) -> list[list[float]]:
    if not texts:
        return []
    url = f"{cfg.api_base.rstrip('/')}/embeddings"
    out: list[list[float]] = []
    batch_size = 32
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        data = _http_json(
            "POST", url, api_key=api_key, body=_compat_embed_body(cfg, batch, task),
            extra_headers=_compat_headers(cfg),
        )
        if not isinstance(data, dict):
            data = {}
        out.extend(validate_embeddings(data.get("data"), len(batch), space, data.get("model")))
    return out


def _compat_multimodal_chat(
    cfg: ProviderConfig,
    api_key: str,
    *,
    model: str,
    prompt: str,
    media_part: dict[str, Any],
    max_tokens: int = 2048,
    timeout: float = _VISION_HTTP_TIMEOUT,
) -> str:
    """OpenAI-compat chat/completions with one media content part + text prompt."""
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    media_part,
                ],
            }
        ],
    }
    # Nemotron Omni reasoning NIMs: prefer instruct-style answers for extract/verify.
    if "omni" in (model or "").lower() or "reasoning" in (model or "").lower():
        body["chat_template_kwargs"] = {"enable_thinking": False}
    url = f"{cfg.api_base.rstrip('/')}/chat/completions"
    data = _http_json(
        "POST",
        url,
        api_key=api_key,
        body=body,
        extra_headers=_compat_headers(cfg),
        timeout=timeout,
    )
    return (data["choices"][0]["message"]["content"] or "").strip()


def _compat_describe_image(
    cfg: ProviderConfig,
    api_key: str,
    image_bytes: bytes,
    mime_type: str,
    *,
    timeout: float = _VISION_HTTP_TIMEOUT,
) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"
    text = _compat_multimodal_chat(
        cfg,
        api_key,
        model=cfg.vision_model,
        prompt=_VISION_PROMPT,
        media_part={"type": "image_url", "image_url": {"url": data_url}},
        max_tokens=1024,
        timeout=timeout,
    )
    return text or "[image]"


def compat_describe_audio(
    file_bytes: bytes,
    mime_type: str,
    *,
    provider: str,
    api_key: str,
    prompt: str,
    timeout: float = _VISION_HTTP_TIMEOUT,
) -> str:
    cfg = get_provider(provider)
    if cfg.kind != "openai_compat" or not cfg.api_base:
        raise RuntimeError(f"Provider '{provider}' has no OpenAI-compat audio path")
    model = cfg.resolve_audio_model()
    if not model:
        raise RuntimeError(f"Provider '{provider}' has no audio model configured")
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"
    return _compat_multimodal_chat(
        cfg,
        api_key,
        model=model,
        prompt=prompt,
        media_part={"type": "audio_url", "audio_url": {"url": data_url}},
        max_tokens=4096,
        timeout=timeout,
    )


def compat_describe_video(
    file_bytes: bytes,
    mime_type: str,
    *,
    provider: str,
    api_key: str,
    prompt: str,
    timeout: float = _VISION_HTTP_TIMEOUT,
) -> str:
    cfg = get_provider(provider)
    if cfg.kind != "openai_compat" or not cfg.api_base:
        raise RuntimeError(f"Provider '{provider}' has no OpenAI-compat video path")
    model = cfg.resolve_video_model()
    if not model:
        raise RuntimeError(f"Provider '{provider}' has no video model configured")
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"
    return _compat_multimodal_chat(
        cfg,
        api_key,
        model=model,
        prompt=prompt,
        media_part={"type": "video_url", "video_url": {"url": data_url}},
        max_tokens=4096,
        timeout=timeout,
    )


def _is_timeout_error(err: BaseException) -> bool:
    text = str(err).lower()
    return isinstance(err, TimeoutError) or "timed out" in text or "timeout" in text


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
    task: EmbeddingTask,
) -> list[list[float]]:
    """Embed into the provider's canonical space. Vectors are validated, never resized."""
    if not api_key or not api_key.strip():
        raise ValueError("LLM API key is required")
    if task not in ("document", "query"):
        raise ValueError(f"task must be 'document' or 'query', got {task!r}")
    cfg = get_provider(provider)
    space = space_for_provider(cfg.id)
    key = api_key.strip()
    if cfg.kind == "gemini":
        return _gemini_embed(cfg, key, texts, space, task)
    return _compat_embed(cfg, key, texts, space, task)


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
    prepared, prep_mime = prepare_vision_image(image_bytes, mime_type)
    if cfg.kind == "gemini":
        return _gemini_describe_image(cfg, key, prepared, prep_mime)
    try:
        return _compat_describe_image(cfg, key, prepared, prep_mime)
    except Exception as err:
        if not _is_timeout_error(err):
            raise
        # One tighter retry: smaller payload is much more likely to finish under load.
        print(f"[VISION] describe timed out; retrying with smaller image ({err})", flush=True)
        smaller, small_mime = prepare_vision_image(
            image_bytes,
            mime_type,
            max_edge=_VISION_RETRY_EDGE,
            max_bytes=_VISION_RETRY_BYTES,
        )
        return _compat_describe_image(
            cfg, key, smaller, small_mime, timeout=_VISION_HTTP_TIMEOUT
        )


def _strip_api_key(api_key: str) -> str:
    key = (api_key or "").strip().strip('"').strip("'")
    if key.lower().startswith("bearer "):
        key = key[7:].strip()
    return key


def _nvidia_auth_hint(err: BaseException) -> str | None:
    text = str(err)
    if "403" not in text and "Authorization failed" not in text:
        return None
    return (
        "NVIDIA rejected this key for hosted inference (HTTP 403). "
        "Create a new key at https://build.nvidia.com → open any model → Get API Key "
        "(scope must include Public API Endpoints). "
        "NGC Catalog / Personal Keys without that scope can list models but fail on "
        "chat/completions. Do not use an ngc.nvidia.com-only key."
    )


def verify_llm(provider: str, api_key: str) -> dict:
    """
    Smoke-test chat + embeddings(768) + vision.
    Returns {ok, provider, models} or raises RuntimeError with step context.
    """
    cfg = get_provider(provider)
    key = _strip_api_key(api_key)
    if not key:
        raise ValueError("API key is required")

    # 1) Chat
    try:
        chat_text("Reply with exactly: OK", provider=provider, api_key=key, temperature=0)
    except Exception as e:
        hint = _nvidia_auth_hint(e) if cfg.id == "nvidia" else None
        detail = hint or str(e)
        raise RuntimeError(f"Chat verification failed: {detail}") from e

    # 2) Embeddings
    try:
        vecs = embed_texts(["educonnect verify"], provider=provider, api_key=key, task="query")
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
            "audio": cfg.audio_model or None,
            "video": cfg.video_model or None,
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
