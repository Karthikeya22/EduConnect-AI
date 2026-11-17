-- =========================================================================
-- Drop legacy unique index that blocks course-scoped embedding activation.
--
-- STATUS: applied 2026-11-01 to pxvwdjrraronjlumwljv (constraint+index drop).
--
-- course files stamp assignment_id = 'course:<course_id>' for every file.
-- The old UNIQUE (assignment_id, chunk_index) therefore collides across files
-- and with leftover NULL-course_id rows. Course-scoped partial uniques remain:
--   uq_cmc_course_file_chunk
--   uq_cmc_course_assignment_desc_chunk
-- =========================================================================

ALTER TABLE public.course_material_chunks
    DROP CONSTRAINT IF EXISTS uq_cmc_assignment_chunk;
DROP INDEX IF EXISTS public.uq_cmc_assignment_chunk;

-- Ensure the intended partial uniques exist (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmc_course_file_chunk
    ON public.course_material_chunks (course_id, canvas_file_id, chunk_index)
    WHERE canvas_file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cmc_course_assignment_desc_chunk
    ON public.course_material_chunks (course_id, assignment_id, chunk_index)
    WHERE canvas_file_id IS NULL;

-- Clear leftover pre-course-scope rows that blocked re-activation under the old unique.
DELETE FROM public.course_material_chunks
 WHERE course_id IS NULL;
