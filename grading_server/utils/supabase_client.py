"""
supabase_client.py
Singleton Supabase client for the grading server.
"""

from supabase import create_client, Client
from grading_server.config import SUPABASE_URL, SUPABASE_KEY

_client: Client | None = None


def get_supabase() -> Client:
    """Return the shared Supabase client instance."""
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client
