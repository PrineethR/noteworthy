-- ============================================================
-- Noteworthy — Migration 005: Search Indexes
-- Run this in Supabase SQL Editor
-- ============================================================

-- GIN index on tags for fast jsonb containment queries
CREATE INDEX IF NOT EXISTS idx_raw_notes_tags ON public.raw_notes USING GIN (tags);

-- Full-text search: add a generated tsvector column
ALTER TABLE public.raw_notes
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(raw_text, '') || ' ' || coalesce(summary, ''))
) STORED;

-- GIN index on the tsvector column for fast full-text search
CREATE INDEX IF NOT EXISTS idx_raw_notes_search ON public.raw_notes USING GIN (search_vector);
