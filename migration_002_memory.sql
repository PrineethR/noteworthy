-- ============================================================
-- Noteworthy — Migration 002: Memory System
-- Run this in Supabase SQL Editor
-- ============================================================

-- Also add insights column if not already done (from migration 001)
ALTER TABLE public.raw_notes
ADD COLUMN IF NOT EXISTS insights jsonb DEFAULT '{}'::jsonb;

-- ─── User Memory (accumulated signals) ───────────────────────
CREATE TABLE IF NOT EXISTS public.user_memory (
  id          uuid primary key default gen_random_uuid(),
  profile     text not null check (profile in ('prineeth', 'pramoddini')),
  type        text not null check (type in ('interest', 'value', 'trait', 'ambition', 'inquiry')),
  content     text not null,
  confidence  real not null default 0.5,
  evidence    jsonb default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_user_memory_profile ON public.user_memory(profile);

-- ─── Memory Cards (swipeable feed) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.memory_cards (
  id          uuid primary key default gen_random_uuid(),
  profile     text not null check (profile in ('prineeth', 'pramoddini')),
  card_type   text not null check (card_type in ('quote', 'question', 'recommendation', 'observation', 'excerpt')),
  content     text not null,
  source      text,
  metadata    jsonb default '{}'::jsonb,
  status      text not null default 'unseen' check (status in ('unseen', 'accepted', 'dismissed')),
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_memory_cards_profile ON public.memory_cards(profile);
CREATE INDEX IF NOT EXISTS idx_memory_cards_status  ON public.memory_cards(status);

-- Disable RLS (PIN-gated server-side)
ALTER TABLE public.user_memory DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_cards DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.user_memory  TO service_role;
GRANT ALL ON public.user_memory  TO anon;
GRANT ALL ON public.memory_cards TO service_role;
GRANT ALL ON public.memory_cards TO anon;
