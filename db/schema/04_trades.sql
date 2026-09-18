-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 04_trades.sql — mirrors supabase/table_trades.sql (live: 2,057 rows)
-- ============================================================================
-- Column types/order match the live table exactly (28 columns).
--
-- NOTES
--  * time_open / time_close are MT5 server time (timestamp WITHOUT time zone),
--    written by the frontend. time_open_ph / time_close_ph are the derived
--    Asia/Manila columns. PH is created/updated by the application, not by a
--    database trigger — no trigger is added here.
--  * idx_trades_ticket_unique is a PARTIAL UNIQUE INDEX on (ticket)
--    WHERE ticket IS NOT NULL (2,057 rows, 955 of them with a NULL ticket).
--    The application detects duplicate-ticket inserts by matching the
--    PostgreSQL error text "duplicate key value violates unique constraint",
--    so the index must stay an INDEX with this exact name.
--  * account_id deliberately has NO ON DELETE action (matches Supabase).
--  * The live table has NO "mup" column; the frontend references it only
--    defensively (dead code) and never writes it.
-- ============================================================================

create table if not exists public.trades (
  id uuid not null default gen_random_uuid(),
  buy_sell text null,
  commission numeric null,
  daily_reflection text null default ''::text,
  time_open timestamp without time zone null,
  time_close timestamp without time zone null,
  instrument text null,
  lots numeric null,
  pips numeric null,
  pnl numeric null,
  rules_violated text null default ''::text,
  weekly_retrospective text null default ''::text,
  mfe numeric null,
  price_close numeric null,
  price_open numeric null,
  risk_per_trade numeric null,
  rrr text null,
  sl numeric null,
  swap numeric null,
  ticket numeric null,
  tp numeric null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  held text null,
  account_id uuid null,
  mae numeric null,
  time_open_ph timestamp without time zone null,
  time_close_ph timestamp without time zone null,
  constraint trades_pkey primary key (id),
  constraint trades_account_id_fkey foreign key (account_id)
    references public.accounts (id),
  constraint trades_buy_sell_check check (
    buy_sell = any (array['Buy'::text, 'Sell'::text])
  )
);

create index if not exists idx_trades_instrument
  on public.trades using btree (instrument);

create index if not exists idx_trades_ticket
  on public.trades using btree (ticket);

create unique index if not exists idx_trades_ticket_unique
  on public.trades using btree (ticket)
  where (ticket is not null);

create index if not exists idx_trades_date_start
  on public.trades using btree (time_open);

create index if not exists idx_trades_time_open_ph
  on public.trades using btree (time_open_ph);

create index if not exists idx_trades_time_close_ph
  on public.trades using btree (time_close_ph);

drop trigger if exists trg_trades_updated_at on public.trades;
create trigger trg_trades_updated_at before
update on public.trades for each row
execute function public.handle_updated_at();