-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 00_functions.sql — shared updated_at trigger functions
-- ============================================================================
-- Mirrors the Supabase project exactly:
--   * public.set_updated_at()    — used by the behaviour-engine / AI tables and
--                                  user_settings (see supabase/table_*.sql).
--   * public.handle_updated_at() — used LIVE by trades and roi_transactions
--                                  (supabase/table_trades.sql,
--                                   supabase/table_roi_transactions.sql).
--
-- Both functions behave identically (new.updated_at = now()). Two names exist
-- because the Supabase project defines two; we reproduce both so that
-- behaviour, not just intent, is preserved.
--
-- Idempotent: "create or replace" is safe to re-run.
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;