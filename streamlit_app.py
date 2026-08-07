"""
Streamlit Cloud entrypoint for EduConnect AI.

Streamlit Community Cloud is not a full Flask host — it only exposes the
Streamlit UI port. This page validates that grading_server imports cleanly
and shows setup notes.

For production API traffic from the React frontend, deploy `grading_server`
on Render / Railway / Fly.io (or similar).

Main file for Streamlit Cloud: streamlit_app.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st

st.set_page_config(page_title="EduConnect AI", page_icon="🎓", layout="centered")
st.title("EduConnect AI")
st.caption("Grading API status (Streamlit Cloud entrypoint)")

try:
    from grading_server.app import app as flask_app
    from grading_server.config import FLASK_PORT, CANVAS_BASE_URL
except Exception as exc:
    st.error("Failed to import the grading server.")
    st.code(str(exc))
    st.stop()

st.success("grading_server imported successfully.")

col1, col2 = st.columns(2)
with col1:
    st.metric("Configured Flask port", FLASK_PORT)
with col2:
    st.write("**Canvas base URL**")
    st.code(CANVAS_BASE_URL or "(not set)", language=None)

routes = sorted(
    {rule.rule for rule in flask_app.url_map.iter_rules() if rule.rule.startswith("/api")}
)
st.subheader("API routes loaded")
st.write(routes[:40] if routes else "No /api routes found")

st.info(
    "Set Streamlit Cloud **Main file path** to `streamlit_app.py` "
    "(not `grading_server/app.py`). "
    "The React grading UI needs a publicly reachable Flask URL "
    "(set `VITE_API_BASE_URL` to that host)."
)

checks = [
    ("GEMINI_API_KEY", ("GEMINI_API_KEY", "VITE_GEMINI_API_KEY")),
    ("SUPABASE_URL", ("SUPABASE_URL", "VITE_SUPABASE_URL")),
    ("SUPABASE_KEY", ("SUPABASE_KEY", "VITE_SUPABASE_ANON_KEY")),
]
missing = [label for label, keys in checks if not any(os.getenv(k) for k in keys)]
if missing:
    st.warning("Add these in Streamlit Cloud → Settings → Secrets:")
    for key in missing:
        st.code(key)
else:
    st.success("Core environment variables look present.")
