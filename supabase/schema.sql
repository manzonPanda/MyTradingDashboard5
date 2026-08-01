-- ============================================================================
-- MyTradingDashboard2 — Supabase Schema (matches Notion CSV export)
-- ============================================================================
-- Single-table design that exactly mirrors your Notion CSV export columns.
--
-- CSV columns:
--   Account, Buy/Sell, Commission, Daily Reflection, Date, Formula, Held,
--   Instrument, Lots, Pips, PnL, Rules violated, Weekly Retrospective, mup,
--   price_close, price_open, riskPerTrade, rrr, sl, swap, ticket, tp
--
-- "Formula" is a Notion formula column (not stored) — recomputed by the
-- trades_with_formulas view at the bottom of this file.
-- "Held" is stored verbatim from the CSV (e.g. "0m", "27m", "6h 15m").
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste & Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TRADES  (core journal — one row per trade)
-- ----------------------------------------------------------------------------
create table if not exists public.trades (
    id                   uuid primary key default gen_random_uuid(),

    account              text,                          -- "Account" (multi-select in Notion, single value in CSV)
    buy_sell             text check (buy_sell in ('Buy', 'Sell')),  -- "Buy/Sell"
    commission           numeric,                        -- "Commission"
    daily_reflection     text default '',                -- "Daily Reflection"
    date_start           timestamptz,                    -- "Date" (start / open time)
    date_end             timestamptz,                    -- "Date" (end / close time, from Notion date ranges)
    held                 text,                          -- "Held" (duration string, e.g. "0m", "27m", "6h 15m")
    instrument           text,                          -- "Instrument" (EUR/USD, XAU/USD, NAS100, ...)
    lots                 numeric,                        -- "Lots"
    pips                 numeric,                        -- "Pips"
    pnl                  numeric,                        -- "PnL"
    rules_violated       text default '',                -- "Rules violated" (free-form text, may be prose)
    weekly_retrospective text default '',                -- "Weekly Retrospective"
    mup                  numeric,                        -- "mup" (Max Favorable Excursion / MFE)
    price_close          numeric,                        -- "price_close"
    price_open           numeric,                        -- "price_open"
    risk_per_trade       numeric,                        -- "riskPerTrade"
    rrr                  text,                           -- "rrr" (e.g. "+13.80R", "-0.75R" — has R suffix)
    sl                   numeric,                        -- "sl" (stop loss price)
    swap                 numeric,                        -- "swap"
    ticket               numeric,                        -- "ticket" (MT5 position ticket — numeric to accept "413000919.0" from Excel/CSV)
    tp                   numeric,                        -- "tp" (take profit price)

    -- Timestamps
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

-- Safe for existing databases: add held column if it doesn't exist yet.
alter table public.trades add column if not exists held text;

-- Safe for existing databases: relax ticket from bigint to numeric so that
-- Excel/CSV exports like "413000919.0" import cleanly. bigint -> numeric is
-- always safe (no data loss), and numeric accepts decimal-string input.
alter table public.trades alter column ticket type numeric using ticket::numeric;

-- ----------------------------------------------------------------------------
-- 2. INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_trades_date_start  on public.trades (date_start);
create index if not exists idx_trades_ticket       on public.trades (ticket);
create index if not exists idx_trades_account     on public.trades (account);
create index if not exists idx_trades_instrument  on public.trades (instrument);

-- Unique constraint on ticket (partial — NULLs allowed for non-MT5 trades).
-- Required for upsert mode (--update) in tools/migrate_notion_to_supabase.py
-- which uses on_conflict=ticket.
create unique index if not exists idx_trades_ticket_unique
    on public.trades (ticket) where ticket is not null;

-- ----------------------------------------------------------------------------
-- 3. AUTO-UPDATE updated_at
-- ----------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_trades_updated_at on public.trades;
create trigger trg_trades_updated_at
    before update on public.trades
    for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 4. FORMULA REPLACEMENTS  (Notion formulas -> SQL view)
--    "Formula" is a Notion formula column — not stored in the table, but
--    recomputed here so you can query it. "Held" is stored in the table;
--    format_held() is kept as a helper to recompute it from dates if needed.
-- ----------------------------------------------------------------------------

-- Helper: format a duration as human-readable "Xh Ym" / "Ym" / "0m"
-- (matches the Notion "Held" format like "6h 15m", "27m", "0m")
create or replace function public.format_held(d_start timestamptz, d_end timestamptz)
returns text
language plpgsql immutable as $$
declare
    secs int;
    hrs   int;
    mins  int;
begin
    if d_start is null or d_end is null then
        return '';
    end if;
    secs := extract(epoch from (d_end - d_start))::int;
    if secs <= 0 then
        return '0m';
    end if;
    hrs  := secs / 3600;
    mins := (secs % 3600) / 60;
    if hrs > 0 then
        return hrs::text || 'h ' || mins::text || 'm';
    end if;
    return mins::text || 'm';
end;
$$;

create or replace view public.trades_with_formulas as
select
    t.*,
    -- Held is now stored in the trades table (verbatim from the CSV).
    -- To recompute it from dates, use: public.format_held(date_start, date_end)
    -- Formula: placeholder (was Notion formula — customize as needed)
    t.pnl as formula
from public.trades t;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY  (single-user personal app -> allow authenticated)
-- ----------------------------------------------------------------------------
alter table public.trades enable row level security;

drop policy if exists "Allow all for authenticated" on public.trades;
create policy "Allow all for authenticated" on public.trades
    for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 6. STORAGE BUCKET  (for screenshots / outcome files — optional)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('trade-files', 'trade-files', true)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated to upload trade-files" on storage.objects;
create policy "Allow authenticated to upload trade-files" on storage.objects
    for insert to authenticated with check (bucket_id = 'trade-files');

drop policy if exists "Allow public read trade-files" on storage.objects;
create policy "Allow public read trade-files" on storage.objects
    for select using (bucket_id = 'trade-files');

-- ============================================================================
-- DONE!
-- Next: run tools/migrate_notion_to_supabase.py to import your Notion CSV.
-- See supabase/MIGRATION_GUIDE.md for full instructions.
-- ============================================================================