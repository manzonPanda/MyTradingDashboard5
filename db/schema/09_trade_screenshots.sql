-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 09_trade_screenshots.sql — mirrors supabase/table_trade_screenshots.sql
--                            (live: 203 rows; 200 storage objects)
-- ============================================================================
-- ticket is TEXT here (not numeric) — it stores MT5 position ids as strings,
-- exactly as the live table and the pythonMt5 uploader write them.
-- This table has NO user_id column in Supabase; ownership is indirect.
-- ============================================================================

create table if not exists public.trade_screenshots (
  id uuid not null default gen_random_uuid(),
  ticket text not null,
  symbol text null,
  storage_path text not null,
  captured_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint trade_screenshots_pkey primary key (id)
);

create index if not exists trade_screenshots_ticket_idx
  on public.trade_screenshots using btree (ticket);