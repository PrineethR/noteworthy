-- ============================================================
-- Noteworthy — Updated Schema for Cloud Deployment
-- Run this in Supabase SQL Editor (replaces the old schema)
-- ============================================================

-- Drop old table if exists
drop table if exists public.raw_notes;

-- Create fresh table with profile column
create table public.raw_notes (
  id           uuid primary key default gen_random_uuid(),
  profile      text not null check (profile in ('prineeth', 'pramoddini')),
  raw_text     text not null,
  summary      text,
  tags         jsonb default '[]'::jsonb,
  category     text,
  sentiment    text,
  status       text not null default 'pending'
                   check (status in ('pending', 'processing', 'processed', 'error')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  processed_at timestamptz
);

-- Indexes
create index idx_raw_notes_profile on public.raw_notes(profile);
create index idx_raw_notes_status  on public.raw_notes(status);
create index idx_raw_notes_created on public.raw_notes(created_at desc);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_raw_notes_updated
  before update on public.raw_notes
  for each row execute function public.handle_updated_at();

-- No RLS — access is controlled server-side by PIN
-- Service role key bypasses RLS anyway, but let's be explicit:
alter table public.raw_notes disable row level security;

-- Grant service_role full access
grant all on public.raw_notes to service_role;
grant all on public.raw_notes to anon;
