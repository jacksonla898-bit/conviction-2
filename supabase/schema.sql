-- Conviction 2.0 analysis log.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- It is safe to run again: every statement is idempotent.

create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ticker text not null,
  company_name text,
  price_at_run numeric,
  price_as_of timestamptz,
  score numeric,
  mode text not null check (mode in ('standard','wharton')),
  model_subscores jsonb,   -- {model: {subscore, weight, status, reason}}
  dcf jsonb,               -- base/bull/bear fair values + inputs used
  inputs jsonb,            -- settings used, incl. FCF growth override
  app_version text,
  user_id uuid             -- nullable; for future accounts
);

create index if not exists analyses_ticker_created_at_idx on public.analyses (ticker, created_at desc);

alter table public.analyses enable row level security;
-- No public policies: only server-side code using the service role key can read/write.

-- Belt and braces: browser-facing roles get nothing; the server role gets full access.
revoke all on table public.analyses from anon, authenticated;
grant all on table public.analyses to service_role;

-- Future: a "price now vs price at run" view can be added on top of this table without changing it.
