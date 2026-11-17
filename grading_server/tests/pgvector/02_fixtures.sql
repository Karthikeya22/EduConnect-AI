-- Artificial fixtures only. No real people, courses, or student work.
SET search_path = public, extensions;

INSERT INTO app_private.settings (key, value) VALUES ('lms_host', 'canvas.test');

INSERT INTO auth.users (id, email) VALUES
    ('00000000-0000-0000-0000-00000000000a', 'teacher11@example.test'),
    ('00000000-0000-0000-0000-00000000000b', 'teacher22@example.test'),
    ('00000000-0000-0000-0000-00000000000c', 'revoked11@example.test'),
    ('00000000-0000-0000-0000-00000000000d', 'student11@example.test'),
    ('00000000-0000-0000-0000-00000000000e', 'otherhost11@example.test');

INSERT INTO public.memberships (user_id, lms_host, course_id, role, verified_by, revoked_at) VALUES
    ('00000000-0000-0000-0000-00000000000a', 'canvas.test', '11', 'teacher', 'fixture', NULL),
    ('00000000-0000-0000-0000-00000000000b', 'canvas.test', '22', 'teacher', 'fixture', NULL),
    ('00000000-0000-0000-0000-00000000000c', 'canvas.test', '11', 'teacher', 'fixture', now()),
    ('00000000-0000-0000-0000-00000000000d', 'canvas.test', '11', 'student', 'fixture', NULL),
    ('00000000-0000-0000-0000-00000000000e', 'other.test',  '11', 'teacher', 'fixture', NULL);

-- Legacy rows written before course scoping: unknown ownership, must stay invisible and untouched.
INSERT INTO public.course_material_chunks (assignment_id, chunk_text, chunk_index, embedding, course_id, canvas_file_id)
VALUES ('101', 'legacy unscoped description', 0, array_fill(0.01::real, ARRAY[768])::vector, NULL, NULL),
       ('101', 'legacy course-11 file chunk', 0, array_fill(0.01::real, ARRAY[768])::vector, '11', 'legacy-f');
INSERT INTO public.assignment_embedding_meta (scope_key, assignment_id, course_id, embedding_provider)
VALUES ('assignment:101', '101', NULL, 'gemini'), ('course:11', NULL, '11', 'gemini');
INSERT INTO public.rubric_criteria (criterion_id, assignment_id, title, description, max_score, dimension)
VALUES ('c1', '101', 'Legacy criterion', 'unscoped', 10, 'content');
INSERT INTO public.grading_results (assignment_id, student_id, result_json)
VALUES ('101', 's1', '{"total_score": 7}');
INSERT INTO public.teacher_preferences (teacher_email, canvas_token) VALUES
    ('teacher11@example.test', 'fixture-token-11'), ('teacher22@example.test', 'fixture-token-22');
