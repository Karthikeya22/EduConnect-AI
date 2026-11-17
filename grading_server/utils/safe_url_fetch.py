"""SSRF-safe HTTPS fetch for public link-only student submissions."""
from __future__ import annotations

import ipaddress
import json
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

MAX_FETCH_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 5
FETCH_TIMEOUT = 20

# Hosts where blind HTML scrape is useless; prefer oEmbed or mark not extractable.
OEMBED_ENDPOINTS = {
    "youtube.com": "https://www.youtube.com/oembed",
    "www.youtube.com": "https://www.youtube.com/oembed",
    "youtu.be": "https://www.youtube.com/oembed",
    "vimeo.com": "https://vimeo.com/api/oembed.json",
    "www.vimeo.com": "https://vimeo.com/api/oembed.json",
}

AUTH_WALLED_HINTS = (
    "powerbi.com",
    "app.powerbi.com",
    "lookerstudio.google.com",
    "datastudio.google.com",
    "tableau.com",
    "app.box.com",
    "drive.google.com",
    "docs.google.com",
    "notion.so",
    "www.notion.so",
)


class _HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"):
            self._skip += 1
        elif tag in ("br", "hr"):
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self._skip:
            self._skip -= 1
        elif tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"):
            self._parts.append("\n")

    def handle_data(self, data):
        if not self._skip and data:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        lines = [" ".join(line.split()) for line in raw.splitlines()]
        return "\n".join(line for line in lines if line).strip()


def html_to_text(html: str) -> str:
    parser = _HTMLTextExtractor()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        return (html or "")[:8000]
    return parser.get_text()


def _host_ips(hostname: str) -> list[str]:
    infos = socket.getaddrinfo(hostname, None)
    out: list[str] = []
    for info in infos:
        addr = info[4][0]
        if addr and addr not in out:
            out.append(addr)
    return out


def _ip_blocked(ip_str: str) -> bool:
    """Return True if this literal IP must not be contacted. Hostnames are not IPs."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_public_https_url(url: str) -> tuple[str | None, str | None]:
    """
    Returns (normalized_url, rejection_reason).
    Rejection reason is None when the URL is allowed to be fetched.
    """
    raw = (url or "").strip()
    if not raw:
        return None, "URL is required"
    parsed = urlparse(raw)
    if parsed.scheme != "https":
        return None, "Only https URLs can be fetched"
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return None, "URL has no host"
    if host in ("localhost", "localhost.localdomain", "metadata.google.internal"):
        return None, "Refusing to fetch a local address"
    if parsed.username or parsed.password:
        return None, "URLs with embedded credentials are not allowed"
    # Literal IP host (not a DNS name)
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if _ip_blocked(host):
            return None, "Refusing to fetch a private or link-local address"
        # Public literal IP — still allow (rare for student links)
        normalized = parsed._replace(fragment="").geturl()
        return normalized, None
    try:
        for ip in _host_ips(host):
            if _ip_blocked(ip):
                return None, "Refusing to fetch a host that resolves to a private address"
    except socket.gaierror:
        return None, "Could not resolve host"
    except OSError as e:
        return None, f"DNS lookup failed: {e}"
    # Rebuild without fragment
    normalized = parsed._replace(fragment="").geturl()
    return normalized, None


def _try_oembed(url: str, host: str) -> dict[str, Any] | None:
    endpoint = OEMBED_ENDPOINTS.get(host)
    if not endpoint:
        # subdomain match
        for allowed, ep in OEMBED_ENDPOINTS.items():
            if host == allowed or host.endswith(f".{allowed}"):
                endpoint = ep
                break
    if not endpoint:
        return None
    try:
        r = requests.get(
            endpoint,
            params={"url": url, "format": "json"},
            timeout=FETCH_TIMEOUT,
            headers={"User-Agent": "EduConnect-AI/1.0"},
        )
        if r.status_code != 200:
            return None
        data = r.json()
        title = str(data.get("title") or "").strip()
        author = str(data.get("author_name") or "").strip()
        provider = str(data.get("provider_name") or "").strip()
        bits = [b for b in (title, author, provider) if b]
        if not bits:
            return None
        text = "[LINK OEMBED]\n" + "\n".join(bits)
        return {
            "extractable": True,
            "url": url,
            "text": text,
            "content_type": "application/json+oembed",
            "reason": None,
            "method": "oembed",
        }
    except Exception:
        return None


def fetch_public_link_text(url: str) -> dict[str, Any]:
    """
    Best-effort extract of readable text from a public https URL.
    Never invents content for auth-walled apps (Power BI, etc.).
    """
    normalized, rejection = validate_public_https_url(url)
    if rejection or not normalized:
        return {
            "extractable": False,
            "url": url,
            "text": "",
            "content_type": None,
            "reason": rejection or "Invalid URL",
            "method": None,
        }

    host = (urlparse(normalized).hostname or "").lower()
    oembed = _try_oembed(normalized, host)
    if oembed:
        return oembed

    auth_walled = any(host == h or host.endswith(f".{h}") for h in AUTH_WALLED_HINTS)

    current = normalized
    last_ctype = ""
    raw = b""
    for _ in range(MAX_REDIRECTS + 1):
        _, hop_rej = validate_public_https_url(current)
        if hop_rej:
            return {
                "extractable": False,
                "url": url,
                "text": "",
                "content_type": None,
                "reason": hop_rej,
                "method": None,
            }
        try:
            with requests.get(
                current,
                headers={
                    "User-Agent": "EduConnect-AI/1.0 (submission grader)",
                    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                },
                timeout=FETCH_TIMEOUT,
                stream=True,
                allow_redirects=False,
            ) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    loc = r.headers.get("Location") or ""
                    if not loc:
                        break
                    current = urljoin(current, loc)
                    continue
                if r.status_code != 200:
                    return {
                        "extractable": False,
                        "url": url,
                        "text": "",
                        "content_type": r.headers.get("Content-Type"),
                        "reason": f"Remote host returned HTTP {r.status_code}",
                        "method": "http",
                    }
                declared = r.headers.get("Content-Length")
                if declared and declared.isdigit() and int(declared) > MAX_FETCH_BYTES:
                    return {
                        "extractable": False,
                        "url": url,
                        "text": "",
                        "content_type": r.headers.get("Content-Type"),
                        "reason": "Remote content is too large",
                        "method": "http",
                    }
                parts: list[bytes] = []
                total = 0
                for chunk in r.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_FETCH_BYTES:
                        return {
                            "extractable": False,
                            "url": url,
                            "text": "",
                            "content_type": r.headers.get("Content-Type"),
                            "reason": "Remote content is too large",
                            "method": "http",
                        }
                    parts.append(chunk)
                raw = b"".join(parts)
                last_ctype = (r.headers.get("Content-Type") or "").lower()
                break
        except requests.RequestException as e:
            return {
                "extractable": False,
                "url": url,
                "text": "",
                "content_type": None,
                "reason": f"Fetch failed: {e}",
                "method": "http",
            }
    else:
        return {
            "extractable": False,
            "url": url,
            "text": "",
            "content_type": None,
            "reason": "Too many redirects",
            "method": "http",
        }

    decoded = raw.decode("utf-8", errors="replace")
    if "application/json" in last_ctype or decoded.lstrip().startswith(("{", "[")):
        try:
            payload = json.loads(decoded)
            if isinstance(payload, str) and payload.strip():
                return {
                    "extractable": True,
                    "url": url,
                    "text": f"[LINK CONTENT]\n{payload.strip()}",
                    "content_type": last_ctype,
                    "reason": None,
                    "method": "json",
                }
            if isinstance(payload, dict):
                for key in ("text", "body", "content", "title", "description", "message", "html"):
                    val = payload.get(key)
                    if isinstance(val, str) and val.strip():
                        body = html_to_text(val) if "<" in val else val.strip()
                        return {
                            "extractable": True,
                            "url": url,
                            "text": f"[LINK CONTENT]\n{body}",
                            "content_type": last_ctype,
                            "reason": None,
                            "method": "json",
                        }
        except Exception:
            pass

    text = html_to_text(decoded)
    # SPA / auth shells often yield tiny or login chrome only
    if auth_walled or len(text) < 80:
        return {
            "extractable": False,
            "url": url,
            "text": "",
            "content_type": last_ctype or "text/html",
            "reason": (
                "This link appears to require sign-in or is an interactive app shell "
                "(e.g. Power BI). Open it externally and paste a description for AI grading."
            ),
            "method": "html",
        }

    return {
        "extractable": True,
        "url": url,
        "text": f"[LINK CONTENT]\nSource: {url}\n\n{text[:50000]}",
        "content_type": last_ctype or "text/html",
        "reason": None,
        "method": "html",
    }
