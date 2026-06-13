-- =========================================================================
-- GraphRAG Storage Setup for Student Knowledge Graph
-- Execute this script in your Supabase SQL Editor
-- =========================================================================

-- Enable pgvector (optional, useful for semantic cluster matching later)
create extension if not exists vector;

-- Stores the conceptual nodes for each student
create table if not exists public.student_knowledge_graph (
    id uuid default gen_random_uuid() primary key,
    student_canvas_id text not null, -- Links to Canvas User ID
    course_id text not null,
    concept_name text not null,
    mastery_score float default 0.5, -- 0.0 (Struggling) to 1.0 (Mastered)
    last_updated timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(student_canvas_id, course_id, concept_name)
);

create index if not exists idx_student_kg_lookup on public.student_knowledge_graph(student_canvas_id, course_id);

-- RPC Function to safely upsert and adjust mastery scores
CREATE OR REPLACE FUNCTION update_concept_mastery(
    p_student_id text,
    p_course_id text,
    p_concept text,
    p_adjustment float
) RETURNS void AS $$
DECLARE
    current_score float;
BEGIN
    SELECT mastery_score INTO current_score 
    FROM public.student_knowledge_graph 
    WHERE student_canvas_id = p_student_id AND course_id = p_course_id AND concept_name = p_concept;

    IF FOUND THEN
        UPDATE public.student_knowledge_graph
        SET mastery_score = GREATEST(0.0, LEAST(1.0, current_score + p_adjustment)),
            last_updated = now()
        WHERE student_canvas_id = p_student_id AND course_id = p_course_id AND concept_name = p_concept;
    ELSE
        INSERT INTO public.student_knowledge_graph (student_canvas_id, course_id, concept_name, mastery_score)
        VALUES (p_student_id, p_course_id, p_concept, GREATEST(0.0, LEAST(1.0, 0.5 + p_adjustment)));
    END IF;
END;
$$ LANGUAGE plpgsql;
