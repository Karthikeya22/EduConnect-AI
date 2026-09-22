"""
config.py
Environment variable loader for the grading server.
Reads from OS environment first, then falls back to the project .env file.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (parent of grading_server/)
_project_root = Path(__file__).resolve().parent.parent
_env_path = _project_root / ".env"
load_dotenv(_env_path)


def _require(key: str, *fallback_keys: str) -> str:
    """Get an env var, trying fallback keys if the primary is missing."""
    val = os.getenv(key)
    if val:
        return val
    for fb in fallback_keys:
        val = os.getenv(fb)
        if val:
            return val
    raise EnvironmentError(
        f"Missing required environment variable: {key} "
        f"(also checked: {', '.join(fallback_keys)})"
    )


# ── API Keys ──────────────────────────────────────────────────────────────────
# Optional at process start — grading/ingest require BYOK via request headers.
GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = _require("SUPABASE_URL", "VITE_SUPABASE_URL")
SUPABASE_KEY: str = _require("SUPABASE_KEY", "VITE_SUPABASE_ANON_KEY")

# ── Canvas ────────────────────────────────────────────────────────────────────
CANVAS_BASE_URL: str = os.getenv(
    "CANVAS_BASE_URL", os.getenv("VITE_CANVAS_BASE_URL", "https://usflearn.instructure.com")
)

# ── Server ────────────────────────────────────────────────────────────────────
FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5557"))
# Default off on Render/Railway/Fly; on locally unless FLASK_DEBUG is set.
_default_debug = "false" if os.getenv("RENDER") or os.getenv("RAILWAY_ENVIRONMENT") else "true"
FLASK_DEBUG: bool = os.getenv("FLASK_DEBUG", _default_debug).lower() == "true"

# ── Model Config ──────────────────────────────────────────────────────────────
GEMINI_GRADING_MODEL: str = os.getenv("GEMINI_GRADING_MODEL", "models/gemini-2.5-flash")
GEMINI_EMBEDDING_MODEL: str = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
GEMINI_LITE_MODEL: str = os.getenv("GEMINI_LITE_MODEL", "models/gemini-2.5-flash")
