"""Unit tests for BYOK multi-provider LLM registry and client helpers."""
from __future__ import annotations

import base64
from unittest.mock import patch, MagicMock

import pytest

from grading_server.utils.llm_registry import (
    EMBEDDING_DIM,
    get_provider,
    list_providers,
    normalize_embedding,
    PROVIDERS,
)
from grading_server.utils import llm_client
from grading_server.utils.byok import resolve_llm_credentials


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


def test_normalize_embedding_pad_and_truncate():
    assert len(normalize_embedding([1.0, 2.0], 4)) == 4
    assert normalize_embedding([1.0, 2.0], 4)[2:] == [0.0, 0.0]
    assert len(normalize_embedding(list(range(1000)), EMBEDDING_DIM)) == EMBEDDING_DIM


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


def test_compat_embed_requests_dimensions_when_supported():
    captured = {}

    def fake_http(method, url, *, api_key, body=None, extra_headers=None, timeout=90.0):
        captured["body"] = body
        return {
            "data": [{"index": 0, "embedding": [0.5] * 1536}]
        }

    with patch.object(llm_client, "_http_json", side_effect=fake_http):
        vecs = llm_client.embed_texts(["hi"], provider="openai", api_key="sk")
    assert captured["body"]["dimensions"] == EMBEDDING_DIM
    assert len(vecs[0]) == EMBEDDING_DIM


def test_providers_have_chat_embed_vision_models():
    for pid, cfg in PROVIDERS.items():
        assert cfg.chat_model, pid
        assert cfg.embedding_model, pid
        assert cfg.vision_model, pid
