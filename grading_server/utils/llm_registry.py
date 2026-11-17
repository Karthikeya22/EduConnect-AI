"""
Provider registry for BYOK multi-provider LLM support.

Every offered provider must support chat + embeddings + vision.
Optional audio_model / video_model enable BYOK transcription of A/V submissions
(see utils/media_extract.py). Embeddings must natively be EMBEDDING_DIM (768)
for pgvector; they are validated, never resized (see utils/embedding_space.py).
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
    # Optional media models (empty = that modality not supported for BYOK extract).
    audio_model: str = ""
    video_model: str = ""
    supports_embedding_dimensions: bool = True
    requires_embed_input_type: bool = False
    key_hint: str = ""
    openrouter_headers: bool = False

    def resolve_audio_model(self) -> str:
        return (self.audio_model or self.vision_model or self.chat_model).strip()

    def resolve_video_model(self) -> str:
        return (self.video_model or self.vision_model or self.chat_model).strip()

    @property
    def supports_audio(self) -> bool:
        return bool(self.audio_model) or self.id == "gemini"

    @property
    def supports_video(self) -> bool:
        return bool(self.video_model) or self.id == "gemini"


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
        audio_model="models/gemini-2.5-flash",
        video_model="models/gemini-2.5-flash",
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
        # Text grading / critique (fast instruct NIM).
        chat_model="nvidia/nemotron-3.5-lightning-30b-a3b",
        # Hosted Matryoshka embeddings @ 768-d.
        embedding_model="nvidia/nemotron-3.5-embed-1b",
        # Omni NIM: image + audio + video + text (replaces retired llama-3.2-*-vision endpoints).
        vision_model="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        audio_model="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        video_model="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        supports_embedding_dimensions=True,
        requires_embed_input_type=True,
        key_hint=(
            "Paste a build.nvidia.com API key with Public API Endpoints. "
            "Enable Nemotron 3.5 Lightning (chat), Nemotron 3.5 Embed, and "
            "Nemotron 3 Nano Omni (vision/audio/video) for this account."
        ),
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
            "audio_model": p.audio_model or None,
            "video_model": p.video_model or None,
            "supports_audio": p.supports_audio,
            "supports_video": p.supports_video,
        }
        for p in PROVIDERS.values()
    ]

