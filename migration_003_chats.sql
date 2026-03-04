-- ============================================================
-- Noteworthy — Migration 003: Persistent Chats
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chats (
  id          uuid primary key default gen_random_uuid(),
  profile     text not null check (profile in ('prineeth', 'pramoddini')),
  note_id     uuid not null,
  title       text not null default 'Untitled chat',
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_chats_profile ON public.chats(profile);
CREATE INDEX IF NOT EXISTS idx_chats_note    ON public.chats(note_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON public.chats(updated_at desc);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_chats_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_chats_updated ON public.chats;
CREATE TRIGGER on_chats_updated
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.handle_chats_updated_at();

ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.chats TO service_role;
GRANT ALL ON public.chats TO anon;
