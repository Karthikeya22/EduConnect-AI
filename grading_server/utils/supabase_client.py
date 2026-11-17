"""
supabase_client.py
Per-request, user-scoped Supabase client for the grading server.

Data access runs with the caller's verified Supabase JWT, so Postgres RLS
(course membership) is enforced on every query and RPC. There is no global
privileged client: outside an authorized request, get_supabase() fails closed.
"""

from contextvars import ContextVar

from supabase import ClientOptions, create_client, Client
from grading_server.config import SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

_request_client: ContextVar[Client | None] = ContextVar("request_supabase", default=None)


def user_scoped_client(access_token: str) -> Client:
    """Anon-key client whose PostgREST calls carry the user's JWT (RLS applies)."""
    options = ClientOptions(
        headers={"Authorization": f"Bearer {access_token}"},
        auto_refresh_token=False,
        persist_session=False,
    )
    return create_client(SUPABASE_URL, SUPABASE_KEY, options=options)


def service_role_client() -> Client:
    """Create a server-only client for a narrowly scoped trusted RPC."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is required for Canvas membership synchronization."
        )
    return create_client(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        options=ClientOptions(auto_refresh_token=False, persist_session=False),
    )


def bind_request_client(client: Client):
    """Bind for the current request; contextvars propagate into tasks and to_thread calls."""
    return _request_client.set(client)


def reset_request_client(token) -> None:
    _request_client.reset(token)


def get_supabase() -> Client:
    """Return the client bound to the current authorized request."""
    client = _request_client.get()
    if client is None:
        raise RuntimeError("No authorized database context: data access requires a verified user request.")
    return client
