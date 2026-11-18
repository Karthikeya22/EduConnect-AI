# Canvas staff key authz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let trusted helpers grade with a shared instructor Canvas key without SQL membership bootstrap, while blocking non-staff Canvas keys.

**Architecture:** Keep DB membership as the fast path. On miss, verify teacher/TA via Canvas using the request token, then best-effort upsert membership.

**Tech Stack:** Flask grading_server, existing `authz.py` + `membership_sync.py`, pytest, Vercel frontend copy in `gradingApi.ts`.

## Global Constraints

- Staff roles only: `teacher`, `ta` (Canvas-confirmed).
- Never authorize from JWT metadata or token presence alone.
- Prefer smallest diff in `require_course_role` / helpers.

---

## Task 1: Failing authz tests

**Files:** `grading_server/tests/test_authz.py`

- [ ] Add tests for staff-token fallback allow / student deny / missing token deny
- [ ] Adjust forged-role test so Canvas staff is not accidentally confirmed
- [ ] Run tests; confirm new ones fail

## Task 2: Implement Canvas staff fallback

**Files:** `grading_server/utils/authz.py` (optional tiny helper reuse from `membership_sync.py`)

- [ ] Implement `canvas_staff_role_for_course`
- [ ] Wire into `require_course_role` after membership miss
- [ ] Best-effort upsert via existing RPC
- [ ] Run authz tests green

## Task 3: Frontend copy

**Files:** `src/lib/gradingApi.ts`, `src/lib/gradingContracts.test.ts`

- [ ] Update `COURSE_ACCESS_DENIED` message
- [ ] Update contract assert

## Task 4: Deploy

- [ ] Push/trigger Render deploy for grading server; Vercel if frontend ships
