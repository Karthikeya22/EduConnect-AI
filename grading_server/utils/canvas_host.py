# grading_server/utils/canvas_host.py
from __future__ import annotations
from urllib.parse import urlparse
import ipaddress

_ALLOWED_SUFFIXES = (".instructure.com",)
# Also allow exact institutional vanity hosts only if they end with known Canvas patterns;
# v1: require hostname == "canvas.<something>" OR suffix .instructure.com OR hostname startswith "canvas."
# Spec A: practical rule — allow *.instructure.com and hosts that equal the server CANVAS_BASE_URL host.
# Keep validation strict: https, public DNS hostname, no credentials in URL, no userinfo.

def normalize_canvas_base_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("Canvas base URL is required")
    if "://" not in raw:
        raw = "https://" + raw
    p = urlparse(raw)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("Canvas base URL must be https with a hostname")
    host = p.hostname.lower().rstrip(".")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Canvas host cannot be a private or link-local address")
        raise ValueError("Canvas host must be a DNS name, not an IP")
    except ValueError as e:
        if "DNS name" in str(e) or "private" in str(e):
            raise
        # not an IP — ok
        pass
    if not (host.endswith(".instructure.com") or host == "instructure.com"):
        # Allow the single configured default host (single-tenant) even if vanity domain
        from grading_server.config import CANVAS_BASE_URL
        from urllib.parse import urlparse as _u
        allowed = (_u(CANVAS_BASE_URL or "").hostname or "").lower()
        if host != allowed or not allowed:
            raise ValueError("Canvas host must be an *.instructure.com host (or match CANVAS_BASE_URL)")
    return f"https://{host}"

def canvas_hostname(url: str) -> str:
    return urlparse(normalize_canvas_base_url(url)).hostname or ""
