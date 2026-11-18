# Canvas staff key authz (trusted helper) design

**Status:** Approved (Approach A)  
**Date:** 2026-11-17

## Problem

Trusted helpers (friend/TA using a shared instructor Canvas API key) hit `COURSE_ACCESS_DENIED` because EduConnect only checks `public.memberships` for the logged-in Supabase user. Manual SQL bootstrap is the current workaround.

## Goal

Allow grading when a real EduConnect session presents a Canvas API key that Canvas confirms is **teacher or TA** on the requested course — even if that Supabase user has no membership row yet. Block student-owned keys that are not staff on the course.

## Non-goals

- Allowing any working Canvas token (student self-grade).
- Removing Supabase login.
- Changing assignment↔course Canvas verification.

## Behavior

1. Verify Supabase access token (unchanged).
2. `require_course_role`: if active teacher/TA membership exists → allow.
3. Else require `X-Canvas-Token` / `canvas_token`.
4. Ask Canvas whether that token is teacher/TA on `course_id` for the request LMS host.
5. If yes → allow; best-effort upsert membership for the caller so the next request hits the DB.
6. If no / invalid token → `COURSE_ACCESS_DENIED`.
7. Canvas unreachable during fallback → `AUTH_UNAVAILABLE` (503).

## Copy

Update frontend `COURSE_ACCESS_DENIED` text so it no longer says “ask the project owner to add your membership.”

## Tests

- No membership + Canvas staff token → allow.
- No membership + non-staff / student token → deny.
- No membership + missing token → deny.
- Existing membership path unchanged.
- Forged JWT roles still do not grant access without Canvas staff confirmation.
