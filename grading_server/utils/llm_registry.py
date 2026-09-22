"""
Provider registry for BYOK multi-provider LLM support.

Every offered provider must support chat + embeddings + vision.
Embeddings are normalized to EMBEDDING_DIM (768) for pgvector.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

EMBEDDING_DIM = 768

ProviderKind = Literal["gemini", "openai_compat"]


@dataclass(frozen=True)
class ProviderConfig:
    id: str
    label: str
    kind: ProviderKind
    api_base: str | None
    chat_model: str
    embedding_model: str
    vision_model: str
    """If True, OpenAI-compatible /embeddings accepts dimensions=768."""
    supports_embedding_dimensions: bool = True
    """Shown in UI when this preset needs a different vendor's key."""
    key_hint: str = ""
    """OpenRouter HTTP-Referer / X-Title optional branding."""
    openrouter_headers: bool = False


PROVIDERS: dict[str, ProviderConfig] = {
    "openai": ProviderConfig(
        id="openai",
        label="OpenAI",
        kind="openai_compat",
        api_base="https://api.openai.com/v1",
        chat_model="gpt-4o-mini",
        embedding_model="text-embedding-3-small",
        vision_model="gpt-4o-mini",
        supports_embedding_dimensions=True,
        key_hint="Paste your OpenAI API key (sk-...)",
    ),
    "gemini": ProviderConfig(
        id="gemini",
        label="Gemini",
        kind="gemini",
        api_base=None,
        chat_model="models/gemini-2.5-flash",
        embedding_model="models/gemini-embedding-001",
        vision_model="models/gemini-2.5-flash",
        supports_embedding_dimensions=True,
        key_hint="Paste your Google AI Studio / Gemini API key",
    ),
    "openrouter": ProviderConfig(
        id="openrouter",
        label="OpenRouter",
        kind="openai_compat",
        api_base="https://openrouter.ai/api/v1",
        chat_model="openai/gpt-4o-mini",
        embedding_model="openai/text-embedding-3-small",
        vision_model="openai/gpt-4o-mini",
        supports_embedding_dimensions=True,
        key_hint="Paste your OpenRouter API key",
        openrouter_headers=True,
    ),
    "openrouter_claude": ProviderConfig(
        id="openrouter_claude",
        label="Claude (via OpenRouter)",
        kind="openai_compat",
        api_base="https://openrouter.ai/api/v1",
        chat_model="anthropic/claude-3.5-sonnet",
        embedding_model="openai/text-embedding-3-small",
        vision_model="anthropic/claude-3.5-sonnet",
        supports_embedding_dimensions=True,
        key_hint="Requires an OpenRouter API key (Claude is routed through OpenRouter)",
        openrouter_headers=True,
    ),
    "nvidia": ProviderConfig(
        id="nvidia",
        label="NVIDIA",
        kind="openai_compat",
        api_base="https://integrate.api.nvidia.com/v1",
        chat_model="meta/llama-3.2-90b-vision-instruct",
        embedding_model="nvidia/nv-embedqa-e5-v5",
        vision_model="meta/llama-3.2-90b-vision-instruct",
        # NIM embed models often ignore dimensions=; we normalize to 768.
        supports_embedding_dimensions=False,
        key_hint="Paste your NVIDIA NGC / NIM API key",
    ),
    "deepseek": ProviderConfig(
        id="deepseek",
        label="DeepSeek",
        kind="openai_compat",
        api_base="https://api.deepseek.com/v1",
        chat_model="deepseek-chat",
        embedding_model="deepseek-embedding",
        # DeepSeek chat API has no native vision; use OpenRouter-hosted VL via same key only if
        # key is DeepSeek — verify will use a tiny image against chat and may fail.
        # Prefer deepseek-vl when exposed; otherwise vision verify fails clearly.
        vision_model="deepseek-chat",
        supports_embedding_dimensions=False,
        key_hint="Paste your DeepSeek API key (vision support varies by account)",
    ),
    "kimi": ProviderConfig(
        id="kimi",
        label="Kimi",
        kind="openai_compat",
        api_base="https://api.moonshot.ai/v1",
        chat_model="moonshot-v1-auto",
        embedding_model="moonshot-v1-embedding",
        vision_model="moonshot-v1-8k-vision-preview",
        supports_embedding_dimensions=False,
        key_hint="Paste your Moonshot / Kimi API key",
    ),
}


def get_provider(provider_id: str) -> ProviderConfig:
    key = (provider_id or "").strip().lower()
    if key not in PROVIDERS:
        known = ", ".join(sorted(PROVIDERS))
        raise ValueError(f"Unknown LLM provider '{provider_id}'. Known: {known}")
    return PROVIDERS[key]


def list_providers() -> list[dict]:
    return [
        {
            "id": p.id,
            "label": p.label,
            "key_hint": p.key_hint,
            "chat_model": p.chat_model,
            "embedding_model": p.embedding_model,
            "vision_model": p.vision_model,
        }
        for p in PROVIDERS.values()
    ]


def normalize_embedding(vec: list[float], dim: int = EMBEDDING_DIM) -> list[float]:
    """Truncate or zero-pad to exactly `dim` floats for pgvector compatibility."""
    if len(vec) == dim:
        return vec
    if len(vec) > dim:
        return vec[:dim]
    return vec + [0.0] * (dim - len(vec))
