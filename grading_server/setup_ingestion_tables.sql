-- =========================================================================
-- Phase 2: Ingestion Pipeline Schema Migration
-- Run this in the Supabase SQL Editor.
-- This updates existing tables to support the ingestion endpoints.
-- =========================================================================

-- Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================================================
-- 1. course_material_chunks — RECREATE with 768-dim embeddings + chunk_index
-- =========================================================================

-- Drop the old table if it exists
DROP TABLE IF EXISTS public.course_material_chunks CASCADE;

CREATE TABLE public.course_material_chunks (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id   TEXT NOT NULL,
    chunk_text      TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL DEFAULT 0,
    source_title    TEXT,
    embedding       vector(768),
    created_at      TIMESTAMPTZ DEFAULT now(),

    -- Composite unique constraint: one chunk per assignment + index position
    CONSTRAINT uq_cmc_assignment_chunk UNIQUE (assignment_id, chunk_index)
);

-- Index for fast assignment lookups
CREATE INDEX IF NOT EXISTS idx_cmc_assignment
    ON public.course_material_chunks(assignment_id);

-- IVFFlat index on embedding for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_cmc_embedding
    ON public.course_material_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);


-- =========================================================================
-- 2. rubric_criteria — ADD assignment_id as part of the unique key
-- =========================================================================

-- Drop and recreate with composite primary key for upsert support
DROP TABLE IF EXISTS public.exemplars CASCADE;
DROP TABLE IF EXISTS public.rubric_criteria CASCADE;

CREATE TABLE public.rubric_criteria (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    criterion_id    TEXT NOT NULL,
    assignment_id   TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    max_score       INTEGER NOT NULL,
    dimension       TEXT NOT NULL CHECK (dimension IN ('content', 'structure')),

    -- Composite unique: same criterion_id + assignment_id = one row
    CONSTRAINT uq_rubric_assignment_criterion UNIQUE (assignment_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_rubric_criteria_assignment
    ON public.rubric_criteria(assignment_id);


-- =========================================================================
-- 3. exemplars — RECREATE with assignment_id + 768-dim embedding
-- =========================================================================

CREATE TABLE public.exemplars (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    criterion_id    TEXT NOT NULL,
    assignment_id   TEXT NOT NULL,
    submission_text TEXT NOT NULL,
    score           INTEGER NOT NULL,
    max_score       INTEGER NOT NULL,
    dimension       TEXT NOT NULL CHECK (dimension IN ('content', 'structure')),
    embedding       vector(768),
    created_at      TIMESTAMPTZ DEFAULT now(),

    -- Composite unique: one exemplar per criterion + assignment + score
    CONSTRAINT uq_exemplar_criterion_assignment_score UNIQUE (assignment_id, criterion_id, score)
);

CREATE INDEX IF NOT EXISTS idx_exemplars_assignment
    ON public.exemplars(assignment_id);

CREATE INDEX IF NOT EXISTS idx_exemplars_criterion
    ON public.exemplars(criterion_id);

-- IVFFlat index for exemplar similarity search
CREATE INDEX IF NOT EXISTS idx_exemplars_embedding
    ON public.exemplars
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);


-- =========================================================================
-- 4. Updated RPC function for 768-dim cosine search
-- =========================================================================

CREATE OR REPLACE FUNCTION match_course_material_chunks(
    query_embedding vector(768),
    match_count int DEFAULT 8,
    filter_assignment_id text DEFAULT NULL
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
        (filter_assignment_id IS NULL OR cmc.assignment_id = filter_assignment_id)
        AND cmc.embedding IS NOT NULL
    ORDER BY cmc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- =========================================================================
-- 5. RLS Policies (permissive — tighten for production)
-- =========================================================================

ALTER TABLE public.course_material_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on course_material_chunks" ON public.course_material_chunks
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.rubric_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rubric_criteria" ON public.rubric_criteria
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.exemplars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on exemplars" ON public.exemplars
    FOR ALL USING (true) WITH CHECK (true);
