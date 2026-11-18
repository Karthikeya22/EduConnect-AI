"""Vision image prep + standalone PNG extract errors (local mocks only)."""
from __future__ import annotations

import io
from unittest.mock import patch

import pytest
from PIL import Image

from grading_server.utils import llm_client
from grading_server import app as app_mod


def _big_png(edge: int = 2400) -> bytes:
    # Solid color compresses tiny; sprinkle noise so the PNG is multi-MB like real submissions.
    import random
    img = Image.new("RGB", (edge, edge), color=(30, 90, 180))
    pix = img.load()
    for i in range(0, edge, 2):
        for j in range(0, edge, 2):
            pix[i, j] = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_prepare_vision_image_shrinks_large_png_under_limit():
    raw = _big_png()
    assert len(raw) > llm_client._VISION_MAX_BYTES
    out, mime = llm_client.prepare_vision_image(raw, "image/png")
    assert mime == "image/jpeg"
    assert len(out) <= llm_client._VISION_MAX_BYTES
    assert len(out) < len(raw)


def test_prepare_vision_image_leaves_tiny_png_untouched():
    """Gemini rejects recompressed 1x1 JPEGs used by verify_llm."""
    import base64
    tiny = base64.b64decode(llm_client._TINY_PNG_B64)
    out, mime = llm_client.prepare_vision_image(tiny, "image/png")
    assert out == tiny
    assert mime == "image/png"


def test_describe_image_sends_prepared_bytes_to_compat():
    raw = _big_png()
    seen: dict = {}

    def fake_compat(cfg, api_key, image_bytes, mime_type):
        seen["nbytes"] = len(image_bytes)
        seen["mime"] = mime_type
        return "timeline text here"

    with patch.object(llm_client, "_compat_describe_image", side_effect=fake_compat):
        text = llm_client.describe_image(raw, "image/png", provider="nvidia", api_key="nvapi-test")
    assert text == "timeline text here"
    assert seen["mime"] == "image/jpeg"
    assert seen["nbytes"] <= llm_client._VISION_MAX_BYTES


def test_extract_image_raises_on_vision_failure_not_empty_string():
    with patch.object(llm_client, "describe_image", side_effect=RuntimeError("payload too large")):
        with pytest.raises(ValueError, match="vision describe failed"):
            app_mod._extract_image(b"x" * 500, "image/png", api_key="k", provider="nvidia")


def test_extract_image_wraps_successful_description():
    with patch.object(llm_client, "describe_image", return_value="AI in Education timeline"):
        out = app_mod._extract_image(b"x" * 500, "image/png", api_key="k", provider="nvidia")
    assert out.startswith("[FIGURE / VISUAL")
    assert "AI in Education timeline" in out


def test_extract_image_course_material_label():
    with patch.object(llm_client, "describe_image", return_value="lecture slide about feedback loops"):
        out = app_mod._extract_image(
            b"x" * 500,
            "image/jpeg",
            api_key="k",
            provider="openai",
            purpose="course_material",
            source_name="AI_Cartoon.jpg",
        )
    assert out.startswith("[COURSE IMAGE MATERIAL]")
    assert "AI_Cartoon.jpg" in out
    assert "feedback loops" in out


def test_describe_image_retries_smaller_on_timeout():
    raw = _big_png(1600)
    calls: list[int] = []

    def fake_compat(cfg, api_key, image_bytes, mime_type, timeout=180.0):
        calls.append(len(image_bytes))
        if len(calls) == 1:
            raise TimeoutError("The read operation timed out")
        return "ocr text after retry"

    with patch.object(llm_client, "_compat_describe_image", side_effect=fake_compat):
        text = llm_client.describe_image(raw, "image/png", provider="nvidia", api_key="nvapi-test")
    assert text == "ocr text after retry"
    assert len(calls) == 2
    assert calls[1] <= calls[0]
    assert calls[1] <= llm_client._VISION_RETRY_BYTES
