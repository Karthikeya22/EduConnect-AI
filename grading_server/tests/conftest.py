import os

# These scripts call real providers/Supabase/a running server at import time.
# They run only when explicitly requested, never as part of the mocked suite.
_LIVE_SCRIPTS = ["test_gemini.py", "test_supabase.py", "test_e2e.py", "test_async_diag.py"]

collect_ignore = [] if os.environ.get("EDUCONNECT_LIVE_TESTS") == "1" else _LIVE_SCRIPTS
