#!/usr/bin/env python3
"""Probe whether the linked Supabase project has the memberships schema.

Does not print secrets. Exit 0 = ready, 2 = AUTHZ_SETUP_REQUIRED, 1 = other error.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from grading_server.utils.authz import probe_authz_ready  # noqa: E402


def main() -> int:
    host = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").split("//")[-1].split("/")[0]
    print(f"project_host={host or 'MISSING'}")
    result = probe_authz_ready()
    print(f"ready={result['ready']} code={result['code']}")
    if result["message"]:
        print(result["message"])
    return 0 if result["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
