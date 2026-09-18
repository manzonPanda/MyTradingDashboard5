-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 12_behavior_engine.sql — behaviours, evidence, rules, alerts, briefs, config
-- ============================================================================
-- Mirrors supabase/table_behaviors.sql, table_behavior_evidence.sql,
-- table_trading_rules.sql, table_behavior_alerts.sql, table_trading_briefs.sql
-- and table_behavior_config.sql.
-- Live: behaviors=91, behavior_evidence=950, others=0.
--
-- The UNIQUE constraints below are what the application's idempotent upserts
-- rely on (onConflict), and behaviour_alerts uses its unique key for anti-spam
-- de-duplication, so names + column order are reproduced verbatim.
-- ============================================================================

create table if not exists public.behaviors (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  name text not null,
  name_key text not null,
  behavior_type text not null check (behavior_type in ('positive', 'negative')),
  description text null,
  status text not null default 'DETECTED' check (
    status in ('DETECTED', 'EMERGING', 'RECURRING', 'ESTABLISHED', 'RULE_CANDIDATE', 'RESOLVED', 'ARCHIVED')
  ),
  occurrence_count integer not null default 0,
  confidence numeric(5, 4) not null default 0,
  estimated_impact_pnl numeric null default 0,
  estimated_impact_r numeric null default 0,
  first_detected_at timestamp with time zone null,
  last_detected_at timestamp with time zone null,
  last_confirmed_at timestamp with time zone null,
  model text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint behaviors_pkey primary key (id),
  constraint behaviors_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint behaviors_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint behaviors_account_name_key_type_unique unique (account_id, name_key, behavior_type)
);

create index if not exists idx_behaviors_user
  on public.behaviors using btree (user_id);

create index if not exists idx_behaviors_account_status
  on public.behaviors using btree (account_id, status);

create index if not exists idx_behaviors_account_type_status
  on public.behaviors using btree (account_id, behavior_type, status);

drop trigger if exists behaviors_set_updated_at on public.behaviors;
create trigger behaviors_set_updated_at before
update on public.behaviors for each row
execute function public.set_updated_at();

create table if not exists public.behavior_evidence (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  behavior_id uuid not null,
  analysis_id uuid null,
  trade_id uuid null,
  trade_ticket numeric null,
  trade_time_open timestamp with time zone null,
  week_start date null,
  reflection_excerpt text null,
  reason text null,
  metrics_snapshot jsonb null,
  evidence_confidence numeric(5, 4) not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint behavior_evidence_pkey primary key (id),
  constraint behavior_evidence_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint behavior_evidence_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint behavior_evidence_behavior_id_fkey foreign key (behavior_id)
    references public.behaviors (id) on delete cascade,
  constraint behavior_evidence_analysis_id_fkey foreign key (analysis_id)
    references public.ai_analyses (id) on delete set null,
  constraint behavior_evidence_trade_id_fkey foreign key (trade_id)
    references public.trades (id) on delete cascade,
  constraint behavior_evidence_behavior_trade_unique unique (behavior_id, trade_id)
);

create index if not exists idx_behavior_evidence_user
  on public.behavior_evidence using btree (user_id);

create index if not exists idx_behavior_evidence_account_created
  on public.behavior_evidence using btree (account_id, created_at desc);

create index if not exists idx_behavior_evidence_behavior
  on public.behavior_evidence using btree (behavior_id);

create index if not exists idx_behavior_evidence_trade
  on public.behavior_evidence using btree (trade_id);

create index if not exists idx_behavior_evidence_week
  on public.behavior_evidence using btree (account_id, week_start);