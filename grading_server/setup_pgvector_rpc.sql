-- =========================================================================
-- pgvector Similarity Search RPC Function
-- This function is called by the Python retrieve node.
-- Run this in the Supabase SQL Editor AFTER running setup_tables.sql.
-- =========================================================================

CREATE OR REPLACE FUNCTION match_course_material_chunks(
    query_embedding vector(3072),
    match_count int DEFAULT 8,
    filter_assignment_id text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    chunk_text text,
    source_title text,
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
        1 - (cmc.embedding <=> query_embedding) AS similarity
    FROM public.course_material_chunks cmc
    WHERE
        (filter_assignment_id IS NULL OR cmc.assignment_id = filter_assignment_id)
        AND cmc.embedding IS NOT NULL
    ORDER BY cmc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
