"""NVIDIA Omni targets for text / image / audio / video grading extract."""
from __future__ import annotations

from unittest.mock import patch

from grading_server.utils import media_extract
from grading_server.utils.llm_registry import get_provider


def test_nvidia_registry_uses_omni_for_media_and_lightning_for_chat():
    cfg = get_provider("nvidia")
    assert cfg.chat_model == "nvidia/nemotron-3.5-lightning-30b-a3b"
    assert cfg.embedding_model == "nvidia/nemotron-3.5-embed-1b"
    assert cfg.vision_model == "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    assert cfg.audio_model == cfg.vision_model
    assert cfg.video_model == cfg.vision_model
    assert cfg.supports_audio is True
    assert cfg.supports_video is True


def test_audio_extract_nvidia_calls_compat_not_gemini_gate():
    with patch(
        "grading_server.utils.llm_client.compat_describe_audio",
        return_value="Hello from student",
    ) as mock_audio:
        out = media_extract.extract_audio_for_grading(
            b"fake-wav-bytes",
            filename="oral.wav",
            provider="nvidia",
            api_key="nvapi-test",
        )
    mock_audio.assert_called_once()
    assert "NOT ASSESSED" not in out
    assert "Hello from student" in out
    assert "[AUDIO TRANSCRIPT]" in out


def test_video_extract_nvidia_calls_compat():
    with patch(
        "grading_server.utils.llm_client.compat_describe_video",
        return_value="[VIDEO TRANSCRIPT]\nHi\n[VIDEO VISUAL NOTES]\nSlide",
    ) as mock_video:
        out = media_extract.extract_video_for_grading(
            b"fake-mp4-bytes",
            filename="demo.mp4",
            provider="nvidia",
            api_key="nvapi-test",
        )
    mock_video.assert_called_once()
    assert "NOT ASSESSED" not in out
    assert "[VIDEO TRANSCRIPT]" in out


def test_openai_still_blocks_audio_without_audio_model():
    out = media_extract.extract_audio_for_grading(
        b"x",
        filename="a.mp3",
        provider="openai",
        api_key="sk-test",
    )
    assert "NOT ASSESSED" in out
    assert "not enabled" in out.lower() or "Gemini or NVIDIA" in out
