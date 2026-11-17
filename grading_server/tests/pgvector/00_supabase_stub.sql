-- Minimal stand-in for the Supabase pieces the migrations depend on.
-- Mirrors Supabase semantics: auth.uid()/auth.jwt() read the per-request JWT claims
-- that PostgREST sets with set_config('request.jwt.claims', ..., true).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT anon, authenticated, service_role TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database()); END $$;
SET search_path = public, extensions;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS auth.users (
    id    UUID PRIMARY KEY,
    email TEXT UNIQUE
);

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;
