-- =========================================================================
-- RAG Grading Pipeline — Supabase Schema
-- Run this in the Supabase SQL Editor BEFORE starting the Flask server.
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;  (already enabled)
-- =========================================================================

-- 1. Rubric Criteria
-- Stores per-criterion rubric rows for each assignment.
CREATE TABLE IF NOT EXISTS public.rubric_criteria (
    criterion_id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    max_score INTEGER NOT NULL,
    dimension TEXT NOT NULL CHECK (dimension IN ('content', 'structure'))
);
CREATE INDEX IF NOT EXISTS idx_rubric_criteria_assignment
    ON public.rubric_criteria(assignment_id);

-- 2. Course Material Chunks (with pgvector embedding)
-- Pre-embedded course material text chunks for semantic retrieval.
CREATE TABLE IF NOT EXISTS public.course_material_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    source_title TEXT,
    embedding vector(3072),
    created_at TIMESTAMPTZ DEFAULT now()
);
-- IVFFlat index for fast cosine similarity search.
-- NOTE: You need at least ~100 rows before the IVFFlat index works well.
-- For small datasets, drop this index and rely on sequential scan.
-- CREATE INDEX IF NOT EXISTS idx_cmc_embedding
--     ON public.course_material_chunks
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- 3. Exemplars
-- Sample high/low-scoring submissions per rubric criterion for few-shot grading.
CREATE TABLE IF NOT EXISTS public.exemplars (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    criterion_id TEXT NOT NULL REFERENCES public.rubric_criteria(criterion_id),
    submission_text TEXT NOT NULL,
    score INTEGER NOT NULL,
    max_score INTEGER NOT NULL,
    dimension TEXT NOT NULL CHECK (dimension IN ('content', 'structure'))
);
CREATE INDEX IF NOT EXISTS idx_exemplars_criterion
    ON public.exemplars(criterion_id);

-- 4. Grading Results
-- Stores the full JSON output of each grading run.
CREATE TABLE IF NOT EXISTS public.grading_results (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    result_json JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grading_results_lookup
    ON public.grading_results(assignment_id, student_id);

-- RLS Policies (permissive for now — tighten in production)
ALTER TABLE public.rubric_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rubric_criteria" ON public.rubric_criteria FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.course_material_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to course_material_chunks" ON public.course_material_chunks FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.exemplars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to exemplars" ON public.exemplars FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.grading_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to grading_results" ON public.grading_results FOR ALL USING (true) WITH CHECK (true);
