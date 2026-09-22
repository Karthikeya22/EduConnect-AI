-- Tracks which LLM provider produced embeddings for an assignment/course.
-- Required so grading can refuse mixed vector spaces after a provider switch.

CREATE TABLE IF NOT EXISTS public.assignment_embedding_meta (
    scope_key text PRIMARY KEY,
    assignment_id text,
    course_id text,
    embedding_provider text NOT NULL,
    embedding_model text,
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.assignment_embedding_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on assignment_embedding_meta" ON public.assignment_embedding_meta;
CREATE POLICY "Allow all on assignment_embedding_meta" ON public.assignment_embedding_meta
    FOR ALL USING (true) WITH CHECK (true);
