"""Unit tests for BYOK multi-provider LLM registry and client helpers."""
from __future__ import annotations

import base64
from unittest.mock import patch, MagicMock

import pytest

from grading_server.utils.llm_registry import (
    EMBEDDING_DIM,
    get_provider,
    list_providers,
    PROVIDERS,
)
from grading_server.utils import llm_client
from grading_server.utils.byok import resolve_llm_credentials
from grading_server.utils.embedding_space import (
    EmbeddingDimensionError,
    space_for_provider,
    validate_embeddings,
)


def test_all_providers_listed():
    ids = {p["id"] for p in list_providers()}
    assert "openai" in ids
    assert "gemini" in ids
    assert "openrouter" in ids
    assert "openrouter_claude" in ids
    assert "nvidia" in ids
    assert "deepseek" in ids
    assert "kimi" in ids


def test_claude_via_openrouter_uses_openrouter_base():
    cfg = get_provider("openrouter_claude")
    assert "openrouter" in (cfg.api_base or "")
    assert "claude" in cfg.chat_model.lower() or "anthropic" in cfg.chat_model.lower()
    assert cfg.openrouter_headers is True


def test_embeddings_are_validated_not_padded_or_truncated():
    space = space_for_provider("openai")
    for wrong in ([1.0, 2.0], [0.1] * 1000):
        with pytest.raises(EmbeddingDimensionError):
            validate_embeddings([wrong], 1, space)
    assert len(validate_embeddings([[0.1] * EMBEDDING_DIM], 1, space)[0]) == EMBEDDING_DIM


def test_unknown_provider_raises():
    with pytest.raises(ValueError):
        get_provider("not-a-real-provider")


def test_resolve_llm_credentials_headers():
    class FakeReq:
        def __init__(self, headers):
            self.headers = headers

    p, k = resolve_llm_credentials(FakeReq({"X-LLM-Provider": "openai", "X-LLM-Api-Key": "sk-test"}))
    assert p == "openai" and k == "sk-test"

    p2, k2 = resolve_llm_credentials(FakeReq({"X-Gemini-Api-Key": "gem-legacy"}))
    assert p2 == "gemini" and k2 == "gem-legacy"

    p3, k3 = resolve_llm_credentials(FakeReq({}))
    assert p3 is None and k3 is None


def test_verify_llm_happy_path_mocked():
    tiny = base64.b64decode(llm_client._TINY_PNG_B64)

    with patch.object(llm_client, "chat_text", return_value="OK") as chat, \
         patch.object(llm_client, "embed_texts", return_value=[[0.1] * EMBEDDING_DIM]) as emb, \
         patch.object(llm_client, "describe_image", return_value="dot") as vis:
        result = llm_client.verify_llm("openai", "sk-test")
        assert result["ok"] is True
        assert result["provider"] == "openai"
        chat.assert_called_once()
        emb.assert_called_once()
        vis.assert_called_once()
        # vision got real PNG bytes
        assert vis.call_args[0][0] == tiny


def test_verify_llm_reports_step_on_embed_fail():
    with patch.object(llm_client, "chat_text", return_value="OK"), \
         patch.object(llm_client, "embed_texts", side_effect=RuntimeError("no embeds")):
        with pytest.raises(RuntimeError) as ei:
            llm_client.verify_llm("openai", "sk-test")
        assert "Embedding verification failed" in str(ei.value)


def test_verify_llm_nvidia_403_explains_build_key():
    with patch.object(
        llm_client,
        "chat_text",
        side_effect=RuntimeError(
            'LLM HTTP 403 https://integrate.api.nvidia.com/v1/chat/completions: '
            '{"status":403,"title":"Forbidden","detail":"Authorization failed"}'
        ),
    ):
        with pytest.raises(RuntimeError) as ei:
            llm_client.verify_llm("nvidia", '  "nvapi-test"  ')
        msg = str(ei.value)
        assert "Chat verification failed" in msg
        assert "build.nvidia.com" in msg
        assert "Public API Endpoints" in msg


def test_compat_embed_requests_dimensions_and_rejects_wrong_size():
    captured = {}
    returned = {"dim": 1536}

    def fake_http(method, url, *, api_key, body=None, extra_headers=None, timeout=90.0):
        captured["body"] = body
        return {"data": [{"index": 0, "embedding": [0.5] * returned["dim"]}]}

    with patch.object(llm_client, "_http_json", side_effect=fake_http):
        with pytest.raises(EmbeddingDimensionError):
            llm_client.embed_texts(["hi"], provider="openai", api_key="sk", task="document")
        assert captured["body"]["dimensions"] == EMBEDDING_DIM
        returned["dim"] = EMBEDDING_DIM
        vecs = llm_client.embed_texts(["hi"], provider="openai", api_key="sk", task="document")
    assert len(vecs[0]) == EMBEDDING_DIM


def test_providers_have_chat_embed_vision_models():
    for pid, cfg in PROVIDERS.items():
        assert cfg.chat_model, pid
        assert cfg.embedding_model, pid
        assert cfg.vision_model, pid


def test_gemini_client_sets_http_timeout():
    """Hung Gemini SDK calls without timeout wedge asyncio.to_thread workers."""
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    with patch("google.genai.Client", FakeClient):
        llm_client._gemini_client("test-key")

    assert "http_options" in captured
    opts = captured["http_options"]
    timeout_ms = getattr(opts, "timeout", None)
    if timeout_ms is None and isinstance(opts, dict):
        timeout_ms = opts.get("timeout")
    assert timeout_ms is not None
    assert float(timeout_ms) >= 30_000  # at least 30s (SDK uses milliseconds)
