-- add_metadata_column.sql
-- Run this script in the Supabase SQL Editor to add the missing metadata column

ALTER TABLE public.student_assignment_logs 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
