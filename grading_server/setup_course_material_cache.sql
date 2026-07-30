-- Run this entire script in the Supabase SQL Editor once before using course cache.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE patterns where possible.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Registry of ingested Canvas files per course
CREATE TABLE IF NOT EXISTS public.course_file_ingest (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    course_id       TEXT NOT NULL,
    canvas_file_id  TEXT NOT NULL,
    filename        TEXT,
    updated_at      TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ready', 'failed')),
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    ingested_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_course_file_ingest UNIQUE (course_id, canvas_file_id)
);

CREATE INDEX IF NOT EXISTS idx_cfi_course
    ON public.course_file_ingest(course_id);

ALTER TABLE public.course_file_ingest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on course_file_ingest" ON public.course_file_ingest;
CREATE POLICY "Allow all on course_file_ingest" ON public.course_file_ingest
    FOR ALL USING (true) WITH CHECK (true);

-- 2. Extend chunks for course-scoped file materials
ALTER TABLE public.course_material_chunks
    ADD COLUMN IF NOT EXISTS course_id TEXT,
    ADD COLUMN IF NOT EXISTS canvas_file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cmc_course
    ON public.course_material_chunks(course_id);

CREATE INDEX IF NOT EXISTS idx_cmc_course_file
    ON public.course_material_chunks(course_id, canvas_file_id);

-- Drop old unique if present, then add partial uniques
ALTER TABLE public.course_material_chunks
    DROP CONSTRAINT IF EXISTS uq_cmc_assignment_chunk;

DROP INDEX IF EXISTS uq_cmc_course_file_chunk;
CREATE UNIQUE INDEX uq_cmc_course_file_chunk
    ON public.course_material_chunks (course_id, canvas_file_id, chunk_index)
    WHERE canvas_file_id IS NOT NULL;

DROP INDEX IF EXISTS uq_cmc_assignment_desc_chunk;
CREATE UNIQUE INDEX uq_cmc_assignment_desc_chunk
    ON public.course_material_chunks (assignment_id, chunk_index)
    WHERE canvas_file_id IS NULL;

-- 3. RPC: match by course_id and/or assignment_id (union)
-- Postgres treats a different argument list as a new overload, and PostgREST
-- refuses to resolve a call when several overloads match. Drop every known
-- signature before creating the 4-argument version.
DROP FUNCTION IF EXISTS public.match_course_material_chunks(vector(768), int, text);
DROP FUNCTION IF EXISTS public.match_course_material_chunks(vector(3072), int, text);
DROP FUNCTION IF EXISTS public.match_course_material_chunks(vector(768), int, text, text);
DROP FUNCTION IF EXISTS public.match_course_material_chunks(vector(3072), int, text, text);

CREATE OR REPLACE FUNCTION public.match_course_material_chunks(
    query_embedding vector(768),
    match_count int DEFAULT 8,
    filter_assignment_id text DEFAULT NULL,
    filter_course_id text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    chunk_text text,
    source_title text,
    chunk_index integer,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cmc.id,
        cmc.chunk_text,
        cmc.source_title,
        cmc.chunk_index,
        1 - (cmc.embedding <=> query_embedding) AS similarity
    FROM public.course_material_chunks cmc
    WHERE
        cmc.embedding IS NOT NULL
        AND (
            (filter_course_id IS NOT NULL AND cmc.course_id = filter_course_id)
            OR (filter_assignment_id IS NOT NULL AND cmc.assignment_id = filter_assignment_id)
            OR (filter_course_id IS NULL AND filter_assignment_id IS NULL)
        )
    ORDER BY cmc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Make PostgREST pick up the new signature immediately.
NOTIFY pgrst, 'reload schema';
