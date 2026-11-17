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
# Server-only key for narrowly scoped trusted operations such as Canvas
# membership sync. Never expose this through a VITE_* variable.
SUPABASE_SERVICE_ROLE_KEY: str | None = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None
# Only for projects still on the legacy HS256 shared secret; asymmetric keys use the project JWKS.
SUPABASE_JWT_SECRET: str | None = os.getenv("SUPABASE_JWT_SECRET") or None

# ── Canvas ────────────────────────────────────────────────────────────────────
CANVAS_BASE_URL: str = os.getenv(
    "CANVAS_BASE_URL", os.getenv("VITE_CANVAS_BASE_URL", "https://usflearn.instructure.com")
)

# ── Server ────────────────────────────────────────────────────────────────────
FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5557"))
# Werkzeug debugger allows code execution; opt-in only, never implied by environment.
FLASK_DEBUG: bool = os.getenv("FLASK_DEBUG", "false").lower() == "true"
# `python -m grading_server.app` is what Render runs. Render scans 0.0.0.0, so a
# loopback bind makes the deploy time out with "no open ports". Local runs stay
# on loopback. Gunicorn in the Procfile binds 0.0.0.0 itself and ignores this.
def _default_flask_host() -> str:
    if os.getenv("RENDER") or os.getenv("RAILWAY_ENVIRONMENT"):
        return "0.0.0.0"
    return "127.0.0.1"


FLASK_HOST: str = os.getenv("FLASK_HOST") or _default_flask_host()
# Browser origins allowed by CORS. CORS is not authentication.
CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,https://edu-connect-ai-three.vercel.app",
    ).split(",")
    if o.strip()
]

# ── Model Config ──────────────────────────────────────────────────────────────
GEMINI_GRADING_MODEL: str = os.getenv("GEMINI_GRADING_MODEL", "models/gemini-2.5-flash")
GEMINI_EMBEDDING_MODEL: str = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
GEMINI_LITE_MODEL: str = os.getenv("GEMINI_LITE_MODEL", "models/gemini-2.5-flash")

# ── Evidence protocol (Teacher Hub is automatic; no instructor mode picker) ───
# coverage_recovery = verify + bounded recovery when an omission penalty is proposed.
# Set EDUCONNECT_EVIDENCE_MODE=baseline|verification_only for operator ablations.
# Client override only if EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE=1 (local research).
EDUCONNECT_EVIDENCE_MODE: str = os.getenv("EDUCONNECT_EVIDENCE_MODE", "coverage_recovery")
EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE: bool = (
    os.getenv("EDUCONNECT_ALLOW_CLIENT_EVIDENCE_MODE", "false").lower()
    in ("1", "true", "yes", "on")
)
