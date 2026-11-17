# Disposable pgvector harness

Status on 2026-10-31: **NOT EXECUTED**. The development machine has no Docker, Postgres,
WSL distribution, or `psycopg`. `test_db_integration.py` skips itself when either
`EDUCONNECT_PG_URL` or `psycopg` is missing. Skipped is not passed.

## Prerequisites (owner approval needed to install)

- Docker Desktop (or any local Postgres 16 with pgvector 0.7+).
- `py -m pip install "psycopg[binary]>=3.1"` (test-only; not a runtime dependency).

## Run

```powershell
docker compose -f grading_server/tests/pgvector/docker-compose.yml up -d
$env:EDUCONNECT_PG_URL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres"
py -m pytest grading_server/tests/pgvector -q -rs
docker compose -f grading_server/tests/pgvector/docker-compose.yml down -v
```

Each run creates a throwaway database named `educonnect_it_<random>`, applies the files below,
runs the tests, and drops the database. Never point `EDUCONNECT_PG_URL` at Supabase.

| Order | File | Purpose |
|---|---|---|
| 1 | `00_supabase_stub.sql` | `anon`/`authenticated` roles, `auth.users`, `auth.uid()`, `auth.jwt()`, pgvector in `extensions` |
| 2 | `01_base_schema.sql` | Pre-migration tables with the current open `USING (true)` policies |
| 3 | `../../migrations/2026_10_31_embedding_provenance.sql` | Provenance columns and RPCs |
| 4 | `../../migrations/2026_10_31_authz_scope.sql` | Memberships, RLS, authorized RPCs |
| 5 | `02_fixtures.sql` | Artificial users, memberships, and legacy rows |

## What it covers

- The migrations re-run cleanly, and legacy rows are preserved without being assigned to a course.
- Grants: anon has no table or RPC access, and the legacy v1 search and mastery RPCs are closed to every API role.
- Denials: no session, another course's teacher, a revoked membership, a student, and a membership on another LMS host.
- Teachers can't write into a foreign course, can't grant themselves memberships, and only see their own preferences.
- Replacing one file never deletes another file's chunks, and every returned row is described by active metadata.
- A space change never certifies untouched rows, and assignment rows don't leak into other assignments.
- Stale activations are refused, duplicate activations leave one batch, and failed activations keep prior data.
- Concurrent activations end in one consistent batch.

## Not covered here

- Rollback SQL, which is commented out in the migration. Rehearse it by hand on a disposable database.
- PostgREST itself (the HTTP layer) and the real Supabase `auth` schema. Re-run the RPC privilege checks on a Supabase branch project before production.
