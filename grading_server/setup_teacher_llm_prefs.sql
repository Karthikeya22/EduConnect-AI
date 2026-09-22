-- Optional columns for BYOK multi-provider preferences.
-- Safe to run multiple times.

ALTER TABLE public.teacher_preferences
    ADD COLUMN IF NOT EXISTS llm_provider text;

ALTER TABLE public.teacher_preferences
    ADD COLUMN IF NOT EXISTS llm_api_key text;
