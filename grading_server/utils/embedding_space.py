"""
Canonical embedding-space identity and strict vector validation.

Two vectors are comparable only if every field of their EmbeddingSpace matches.
Provider or model strings alone never certify stored data; the persisted
space_id does. There is no client-side pad/truncate/projection.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from typing import Literal

from grading_server.utils.llm_registry import EMBEDDING_DIM, get_provider

TRANSFORM_VERSION = "raw-v1"
# Bump when the splitter (RecursiveCharacterTextSplitter 500/50) or text parsers change.
INDEX_VERSION = "rcts-500-50/parse-v1"

EmbeddingTask = Literal["document", "query"]

_COMPAT_GROUP = {
    "openai": "openai-direct",
    "openrouter": "openrouter",
    "openrouter_claude": "openrouter",
    "gemini": "gemini-aistudio",
    "nvidia": "nvidia-nim",
    "deepseek": "deepseek",
    "kimi": "moonshot",
}
# Known native sizes for models that ignore a dimensions parameter.
# (Kept for fail-closed checks if a non-Matryoshka model is reintroduced.)
_NATIVE_DIMS = {"nvidia/nemotron-3-embed-1b": 1024}


class EmbeddingError(RuntimeError):
    code = "EMBEDDING_ERROR"

    def __init__(self, message: str, code: str | None = None):
        if code:
            self.code = code
        super().__init__(f"{self.code}: {message}")


class EmbeddingDimensionError(EmbeddingError):
    code = "EMBEDDING_DIMENSION_MISMATCH"


class InvalidEmbeddingVector(EmbeddingError):
    code = "INVALID_EMBEDDING_VECTOR"


class EmbeddingResponseShapeError(EmbeddingError):
    code = "EMBEDDING_RESPONSE_SHAPE"


class EmbeddingModelMismatch(EmbeddingError):
    code = "EMBEDDING_MODEL_MISMATCH"


class EmbeddingSpaceUnsupported(EmbeddingError):
    code = "EMBEDDING_SPACE_UNSUPPORTED"


class EmbeddingProvenanceError(EmbeddingError):
    """code: REINGEST_REQUIRED | UNKNOWN_PROVENANCE | EMBEDDING_MIGRATION_REQUIRED"""

    code = "UNKNOWN_PROVENANCE"


@dataclass(frozen=True)
class EmbeddingSpace:
    compat_group: str
    model: str
    model_revision: str
    dimensions: int
    dimensions_mode: Literal["provider_param", "native"]
    task_contract: Literal["none", "gemini_task_type", "nvidia_input_type"]
    transform_version: str = TRANSFORM_VERSION
    modality: str = "text"

    @property
    def space_id(self) -> str:
        blob = json.dumps(asdict(self), sort_keys=True)
        return "es1-" + hashlib.sha256(blob.encode()).hexdigest()[:24]

    def config(self) -> dict:
        return {**asdict(self), "space_id": self.space_id}


def space_for_provider(provider_id: str) -> EmbeddingSpace:
    """Effective embedding space for a provider preset. Raises before any network call."""
    cfg = get_provider(provider_id)
    if cfg.supports_embedding_dimensions:
        mode = "provider_param"
    else:
        mode = "native"
        native = _NATIVE_DIMS.get(cfg.embedding_model)
        if native is not None and native != EMBEDDING_DIM:
            raise EmbeddingSpaceUnsupported(
                f"{cfg.id} embeds with {cfg.embedding_model} ({native} dims); the index is {EMBEDDING_DIM}. "
                "Use a different provider for course materials."
            )
    if cfg.kind == "gemini":
        task = "gemini_task_type"
    elif cfg.requires_embed_input_type:
        task = "nvidia_input_type"
    else:
        task = "none"
    return EmbeddingSpace(
        compat_group=_COMPAT_GROUP[cfg.id],
        model=cfg.embedding_model,
        model_revision="provider-default",
        dimensions=EMBEDDING_DIM,
        dimensions_mode=mode,
        task_contract=task,
    )


def _bare_model(name: str) -> str:
    return (name or "").strip().split("/")[-1]


def validate_embeddings(
    items: object,
    n: int,
    space: EmbeddingSpace,
    returned_model: str | None = None,
) -> list[list[float]]:
    """Validate one provider response. `items` is a list of raw vectors (position = index)
    or of {"index", "embedding"} dicts. Returns vectors ordered by index."""
    if returned_model and returned_model != space.model and _bare_model(returned_model) != _bare_model(space.model):
        raise EmbeddingModelMismatch(f"expected {space.model}, provider returned {returned_model}")
    if not isinstance(items, list):
        raise EmbeddingResponseShapeError(f"expected a list, got {type(items).__name__}")
    if len(items) != n:
        raise EmbeddingResponseShapeError(f"expected {n} embeddings, got {len(items)}")

    if items and isinstance(items[0], dict):
        indexes = [it.get("index") if isinstance(it, dict) else None for it in items]
        if any(not isinstance(i, int) for i in indexes) or sorted(indexes) != list(range(n)):
            raise EmbeddingResponseShapeError(f"indexes must be unique 0..{n - 1}, got {indexes}")
        vectors = [it.get("embedding") for it in sorted(items, key=lambda it: it["index"])]
    else:
        vectors = items

    out: list[list[float]] = []
    for i, vec in enumerate(vectors):
        if not isinstance(vec, list):
            raise EmbeddingResponseShapeError(f"embedding {i} is not a list")
        if len(vec) != space.dimensions:
            raise EmbeddingDimensionError(f"embedding {i} has {len(vec)} dims, expected {space.dimensions}")
        try:
            floats = [float(x) for x in vec]
        except (TypeError, ValueError) as e:
            raise InvalidEmbeddingVector(f"embedding {i} has non-numeric values") from e
        if not all(math.isfinite(x) for x in floats):
            raise InvalidEmbeddingVector(f"embedding {i} has NaN/inf values")
        if not any(floats):
            raise InvalidEmbeddingVector(f"embedding {i} is a zero vector")
        out.append(floats)
    return out
