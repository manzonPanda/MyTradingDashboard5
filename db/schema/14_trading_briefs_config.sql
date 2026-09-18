-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 14_trading_briefs_config.sql — trading_briefs, behavior_config
-- ============================================================================
-- Live counts at audit time: both 0 rows.
-- UNIQUE (account_id, week_start) guarantees at most one cached brief per
-- account per week; UNIQUE (account_id) keeps one threshold row per account.
-- ============================================================================

create table if not exists public.trading_briefs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  week_start date not null,
  week_end date not null,
  payload jsonb not null default '{}'::jsonb,
  model text null,
  prompt_version text null,
  generated_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint trading_briefs_pkey primary key (id),
  constraint trading_briefs_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint trading_briefs_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint trading_briefs_account_week_unique unique (account_id, week_start)
);

create index if not exists idx_trading_briefs_user
  on public.trading_briefs using btree (user_id);

create index if not exists idx_trading_briefs_account_week
  on public.trading_briefs using btree (account_id, week_start desc);

drop trigger if exists trading_briefs_set_updated_at on public.trading_briefs;
create trigger trading_briefs_set_updated_at before
update on public.trading_briefs for each row
execute function public.set_updated_at();

create table if not exists public.behavior_config (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  thresholds jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint behavior_config_pkey primary key (id),
  constraint behavior_config_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint behavior_config_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint behavior_config_account_unique unique (account_id)
);

create index if not exists idx_behavior_config_user
  on public.behavior_config using btree (user_id);

drop trigger if exists behavior_config_set_updated_at on public.behavior_config;
create trigger behavior_config_set_updated_at before
update on public.behavior_config for each row
execute function public.set_updated_at();