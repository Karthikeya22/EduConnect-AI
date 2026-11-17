"""Find Canvas assignments/submissions that look like audio/video attachments."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
env_path = ROOT / ".env"
for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

CANVAS = (os.environ.get("CANVAS_BASE_URL") or "https://usflearn.instructure.com").rstrip("/")
MEDIA_RE = re.compile(
    r"\.(mp3|wav|m4a|ogg|flac|aac|wma|mp4|mov|m4v|webm|mkv|avi)(?:\?|$)",
    re.I,
)
MEDIA_TYPES = re.compile(r"audio/|video/", re.I)

# Prefer explicit token from env; never print it.
token = (
    os.environ.get("CANVAS_API_TOKEN")
    or os.environ.get("CUSTOM_CANVAS_TOKEN")
    or os.environ.get("CANVAS_TOKEN")
    or ""
).strip()
if not token:
    # optional local override file (gitignored) teachers sometimes keep
    for p in (ROOT / ".canvas_token", Path.home() / ".educonnect_canvas_token"):
        if p.exists():
            token = p.read_text(encoding="utf-8").strip()
            break

if not token:
    print("NO_CANVAS_TOKEN")
    # Still scan local caches / supabase if possible
else:
    headers = {"Authorization": f"Bearer {token}", "User-Agent": "EduConnect-AI/1.0"}
    courses = requests.get(
        f"{CANVAS}/api/v1/courses",
        headers=headers,
        params={"enrollment_type": "teacher", "per_page": 50, "state[]": "available"},
        timeout=30,
    )
    if courses.status_code != 200:
        # try all enrollments
        courses = requests.get(
            f"{CANVAS}/api/v1/courses",
            headers=headers,
            params={"per_page": 50},
            timeout=30,
        )
    courses.raise_for_status()
    course_list = courses.json()
    hits = []
    for c in course_list:
        cid = c.get("id")
        cname = c.get("name") or c.get("course_code") or str(cid)
        # assignments
        asg = requests.get(
            f"{CANVAS}/api/v1/courses/{cid}/assignments",
            headers=headers,
            params={"per_page": 50},
            timeout=30,
        )
        if asg.status_code != 200:
            continue
        for a in asg.json():
            aid = a.get("id")
            aname = a.get("name") or str(aid)
            # sample submissions with include[]=submission_history & attachments
            subs = requests.get(
                f"{CANVAS}/api/v1/courses/{cid}/assignments/{aid}/submissions",
                headers=headers,
                params={
                    "per_page": 50,
                    "include[]": ["submission_history", "user"],
                },
                timeout=45,
            )
            if subs.status_code != 200:
                continue
            for s in subs.json():
                atts = s.get("attachments") or []
                media = []
                for att in atts:
                    fn = str(att.get("filename") or att.get("display_name") or "")
                    ct = str(att.get("content-type") or att.get("content_type") or "")
                    if MEDIA_RE.search(fn) or MEDIA_TYPES.search(ct):
                        media.append(
                            {
                                "filename": fn,
                                "content_type": ct,
                                "size": att.get("size"),
                            }
                        )
                # media_comment / media objects
                mc = s.get("media_comment") or {}
                if mc.get("media_type") in ("audio", "video") or MEDIA_RE.search(
                    str(mc.get("url") or "")
                ):
                    media.append(
                        {
                            "filename": f"media_comment:{mc.get('media_type')}",
                            "content_type": mc.get("media_type"),
                            "size": None,
                        }
                    )
                if media:
                    user = s.get("user") or {}
                    hits.append(
                        {
                            "course_id": cid,
                            "course": cname,
                            "assignment_id": aid,
                            "assignment": aname,
                            "student_id": s.get("user_id"),
                            "student": user.get("name") or s.get("user_id"),
                            "media": media,
                        }
                    )
        # also scan discussions lightly? skip for speed
    print(json.dumps({"hits": hits[:40], "count": len(hits)}, indent=2))
    sys.exit(0)

# Fallback: supabase ai grade blobs
try:
    from supabase import create_client

    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    sb = create_client(url, key)
    print("SUPABASE_OK probing tables…")
    for t in ("ai_grades", "grading_results", "cached_grades"):
        try:
            r = sb.table(t).select("*").limit(5).execute()
            print(t, "sample", len(r.data or []))
        except Exception as e:
            print(t, "miss", str(e)[:80])
except Exception as e:
    print("SUPABASE_FAIL", str(e)[:120])
