-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 03_accounts.sql — live public.accounts (20 columns, verified 2026-09-18)
-- ============================================================================
-- Sources: supabase/table_accounts.sql + migration_add_account_platform.sql
--          + migration_add_drawdown_settings.sql + the live PostgREST schema.
--
-- INTENTIONAL DIFFERENCE (Phase 2): accounts_user_id_fkey targets
-- public.aura_users(id) instead of auth.users(id). See db/README.md.
--
-- trades_account_id_fkey is deliberately NO ACTION (no on delete clause),
-- exactly as in Supabase: deleting an account that still has trades fails.
-- ============================================================================

create table if not exists public.accounts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  account_number text null,
  initial_balance numeric null,
  profit_target_percent numeric null,
  max_total_drawdown_percent numeric null,
  daily_loss_limit_percent numeric null,
  start_date timestamp with time zone null,
  status text null default 'active'::text,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  user_id uuid null,
  phase text not null default 'phase1'::text,
  prop_firm_id uuid null,
  platform text not null default 'MT5'::text,
  drawdown_mode text not null default 'fixed'::text,
  drawdown_basis text not null default 'balance'::text,
  drawdown_stop_at_initial_balance boolean not null default false,
  drawdown_eod_timezone text not null default 'America/New_York'::text,
  constraint accounts_pkey primary key (id),
  constraint accounts_prop_firm_id_fkey foreign key (prop_firm_id)
    references public.prop_firms (id) on delete set null,
  constraint accounts_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint accounts_phase_check check (
    phase = any (array['phase1'::text, 'phase2'::text, 'funded'::text])
  ),
  constraint accounts_platform_check check (
    platform = any (array['MT5'::text, 'Tradovate'::text, 'Wealthcharts'::text])
  ),
  constraint accounts_drawdown_mode_check check (
    drawdown_mode = any (array[
      'fixed'::text, 'intraday_trailing'::text,
      'balance_trailing'::text, 'eod_trailing'::text
    ])
  ),
  constraint accounts_drawdown_basis_check check (
    drawdown_basis = any (array['balance'::text, 'equity'::text])
  )
);

create index if not exists accounts_prop_firm_id_idx
  on public.accounts using btree (prop_firm_id);

-- Phase 2 normalisation (documented in db/README.md): the live trigger state
-- for accounts is unknown (no accounts DDL exists in supabase/), so the same
-- set_updated_at() behaviour used everywhere else is applied here too.
drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at before
update on public.accounts for each row
execute function public.set_updated_at();