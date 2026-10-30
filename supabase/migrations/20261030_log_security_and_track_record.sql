-- Conviction 2.0 — analysis log: Track Record columns and row-level security.
-- Apply once (Supabase SQL Editor, or `supabase db push`). Idempotent: safe to run again.
-- It never drops a table or deletes a row.

-- 1. Columns needed by the Track Record tab (nullable; existing rows are untouched).
alter table public.analyses add column if not exists asset_type text;   -- stock | equity_etf | bond_etf | treasury
alter table public.analyses add column if not exists label text;        -- Low | Neutral | High | Very High (shown as Weak … Very Strong)
alter table public.analyses add column if not exists price_source text; -- how price_at_run was obtained

-- 2. Row-level security.
alter table public.analyses enable row level security;

-- Browser-facing roles start with nothing …
revoke all on table public.analyses from anon, authenticated;
-- … then anon gets INSERT only (no SELECT, UPDATE or DELETE). With no SELECT grant and no SELECT
-- policy, anon cannot read a single row, including its own insert (use Prefer: return=minimal).
grant insert on table public.analyses to anon;

drop policy if exists analyses_anon_insert_valid on public.analyses;
create policy analyses_anon_insert_valid on public.analyses
  for insert to anon
  with check (
        ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,11}$'
    and score is not null and score >= 0 and score <= 100
    and mode in ('standard', 'wharton')
    and (asset_type is null or asset_type in ('stock', 'equity_etf', 'bond_etf', 'treasury'))
    and (label is null or label in ('Low', 'Neutral', 'High', 'Very High'))
    and (price_at_run is null or price_at_run > 0)
    and user_id is null
    and (company_name is null or char_length(company_name) <= 200)
    and (app_version is null or char_length(app_version) <= 40)
    and (model_subscores is null or (jsonb_typeof(model_subscores) = 'object' and octet_length(model_subscores::text) <= 20000))
    and (dcf is null or (jsonb_typeof(dcf) = 'object' and octet_length(dcf::text) <= 20000))
    and (inputs is null or (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 20000))
  );

-- The `authenticated` role gets no grants and no policies: there are no user accounts.
-- Reads happen only on the server (service role, which bypasses RLS) behind the History passcode.
grant all on table public.analyses to service_role;

-- 3. Fill the two new columns for rows written before v2.4.0. Both values are derived, not estimated:
--    before v2.4.0 only the stock path wrote to the log, so asset_type = 'stock'; the label is the fixed
--    score band (0–39 Low, 40–59 Neutral, 60–79 High, 80–100 Very High) of the stored score.
update public.analyses set asset_type = 'stock' where asset_type is null;
update public.analyses
   set label = case when score < 40 then 'Low' when score < 60 then 'Neutral' when score < 80 then 'High' else 'Very High' end
 where label is null and score is not null;
update public.analyses set price_source = 'Alpaca IEX latest daily close at run time'
 where price_source is null and price_at_run is not null;
