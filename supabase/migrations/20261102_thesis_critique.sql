-- Conviction 2.0 — Thesis critic (Standard mode): per-IP daily rate limit and a 24-hour result cache.
-- Apply once (Supabase SQL Editor, or `supabase db push`). Idempotent: safe to run again.
-- Both tables are written ONLY by the server with the service role key. Row-level security is on with
-- no policies, and the browser-facing roles (anon, authenticated) have no grants at all, so nothing in
-- the browser can read or write them. Neither table stores the thesis text or any IP address:
-- ip_hash = SHA-256(THESIS_CRITIQUE_SALT || client IP); input_hash = SHA-256 of the canonical payload.

-- 1. Daily usage counter per hashed IP.
create table if not exists public.thesis_critique_usage (
  ip_hash text not null,
  day date not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (ip_hash, day)
);

alter table public.thesis_critique_usage enable row level security;
revoke all on table public.thesis_critique_usage from anon, authenticated, public;
grant all on table public.thesis_critique_usage to service_role;

-- Atomic increment, returns the new count for (ip_hash, day). Only the service role may call it.
create or replace function public.thesis_critique_bump(p_ip_hash text, p_day date)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.thesis_critique_usage (ip_hash, day, count, updated_at)
  values (p_ip_hash, p_day, 1, now())
  on conflict (ip_hash, day) do update
    set count = public.thesis_critique_usage.count + 1, updated_at = now()
  returning count;
$$;

revoke all on function public.thesis_critique_bump(text, date) from public, anon, authenticated;
grant execute on function public.thesis_critique_bump(text, date) to service_role;

-- 2. Cache of validated critiques keyed by the hash of the full input payload (24-hour TTL enforced by the server).
create table if not exists public.thesis_critique_cache (
  input_hash text primary key,
  critique jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists thesis_critique_cache_created_at_idx on public.thesis_critique_cache (created_at);

alter table public.thesis_critique_cache enable row level security;
revoke all on table public.thesis_critique_cache from anon, authenticated, public;
grant all on table public.thesis_critique_cache to service_role;

-- Optional housekeeping (run by hand when wanted): delete expired cache rows and old counters.
--   delete from public.thesis_critique_cache where created_at < now() - interval '24 hours';
--   delete from public.thesis_critique_usage where day < current_date - 7;
