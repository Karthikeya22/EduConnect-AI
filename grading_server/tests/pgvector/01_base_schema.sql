-- Pre-migration state of the grading tables as left by the repo setup SQL
-- (setup_ingestion_tables, setup_course_material_cache, setup_embedding_meta,
-- setup_tables.grading_results, setup_graphrag), including the open USING (true) policies.
SET search_path = public, extensions;

CREATE TABLE public.course_material_chunks (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id  TEXT NOT NULL,
    chunk_text     TEXT NOT NULL,
    chunk_index    INTEGER NOT NULL DEFAULT 0,
    source_title   TEXT,
    embedding      vector(768),
    created_at     TIMESTAMPTZ DEFAULT now(),
    course_id      TEXT,
    canvas_file_id TEXT
);
CREATE UNIQUE INDEX uq_cmc_course_file_chunk ON public.course_material_chunks (course_id, canvas_file_id, chunk_index)
    WHERE canvas_file_id IS NOT NULL;
CREATE UNIQUE INDEX uq_cmc_assignment_desc_chunk ON public.course_material_chunks (assignment_id, chunk_index)
    WHERE canvas_file_id IS NULL;

CREATE TABLE public.rubric_criteria (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    criterion_id  TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    max_score     INTEGER NOT NULL,
    dimension     TEXT NOT NULL CHECK (dimension IN ('content', 'structure')),
    CONSTRAINT uq_rubric_assignment_criterion UNIQUE (assignment_id, criterion_id)
);

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
    CONSTRAINT uq_exemplar_criterion_assignment_score UNIQUE (assignment_id, criterion_id, score)
);

CREATE TABLE public.grading_results (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_id    TEXT NOT NULL,
    result_json   JSONB NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.assignment_embedding_meta (
    scope_key          TEXT PRIMARY KEY,
    assignment_id      TEXT,
    course_id          TEXT,
    embedding_provider TEXT NOT NULL,
    embedding_model    TEXT,
    updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.course_file_ingest (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    course_id      TEXT NOT NULL,
    canvas_file_id TEXT NOT NULL,
    filename       TEXT,
    updated_at     TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    chunk_count    INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    ingested_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_course_file_ingest UNIQUE (course_id, canvas_file_id)
);

CREATE TABLE public.teacher_preferences (
    teacher_email   TEXT PRIMARY KEY,
    canvas_token    TEXT,
    llm_api_key     TEXT,
    llm_provider    TEXT,
    gemini_api_key  TEXT
);

CREATE TABLE public.student_knowledge_graph (
    id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_canvas_id TEXT NOT NULL,
    course_id         TEXT NOT NULL,
    concept_name      TEXT NOT NULL,
    mastery_score     FLOAT DEFAULT 0.5,
    UNIQUE (student_canvas_id, course_id, concept_name)
);

CREATE FUNCTION public.match_course_material_chunks(
    query_embedding vector(768), match_count INT DEFAULT 8,
    filter_assignment_id TEXT DEFAULT NULL, filter_course_id TEXT DEFAULT NULL
) RETURNS TABLE (id UUID, chunk_text TEXT, source_title TEXT, chunk_index INTEGER, similarity FLOAT)
LANGUAGE sql AS $$
    SELECT c.id, c.chunk_text, c.source_title, c.chunk_index, 1 - (c.embedding <=> query_embedding)
      FROM public.course_material_chunks c ORDER BY c.embedding <=> query_embedding LIMIT match_count
$$;
CREATE FUNCTION public.update_concept_mastery(p_student_id TEXT, p_course_id TEXT, p_concept TEXT, p_adjustment FLOAT)
RETURNS void LANGUAGE sql AS $$ SELECT $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['course_material_chunks','rubric_criteria','exemplars','grading_results',
                             'assignment_embedding_meta','course_file_ingest','teacher_preferences','student_knowledge_graph'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)', 'Allow all on ' || t, t);
        EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', t);
    END LOOP;
END $$;
