-- ============================================================
-- Noteworthy — Migration 004: Images Support
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add images column to raw_notes
-- Each image is: { url, filename, uploaded_at }
ALTER TABLE public.raw_notes
ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;
