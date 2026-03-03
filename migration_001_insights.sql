-- ============================================================
-- Noteworthy — Migration: Add insights column
-- Run this in Supabase SQL Editor (does NOT drop existing data)
-- ============================================================

ALTER TABLE public.raw_notes
ADD COLUMN IF NOT EXISTS insights jsonb DEFAULT '{}'::jsonb;

-- Re-process existing notes to populate insights:
-- UPDATE public.raw_notes SET status = 'pending' WHERE status = 'processed';
-- Then restart the server — it will reprocess them with the new prompt.
