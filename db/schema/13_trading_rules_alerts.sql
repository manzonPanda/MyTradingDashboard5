-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 13_trading_rules_alerts.sql — trading_rules, behavior_alerts
-- ============================================================================
-- Live counts at audit time: both tables 0 rows (the engine writes to them).
-- ============================================================================

create table if not exists public.trading_rules (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  source_behavior_id uuid null,
  rule text not null,
  rationale text null,
  confidence numeric(5, 4) not null default 0,
  evidence_summary jsonb null,
  status text not null default 'candidate' check (
    status in ('candidate', 'active', 'archived')
  ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint trading_rules_pkey primary key (id),
  constraint trading_rules_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint trading_rules_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint trading_rules_source_behavior_id_fkey foreign key (source_behavior_id)
    references public.behaviors (id) on delete set null,
  constraint trading_rules_account_rule_unique unique (account_id, rule)
);

create index if not exists idx_trading_rules_user
  on public.trading_rules using btree (user_id);

create index if not exists idx_trading_rules_account_status
  on public.trading_rules using btree (account_id, status);

drop trigger if exists trading_rules_set_updated_at on public.trading_rules;
create trigger trading_rules_set_updated_at before
update on public.trading_rules for each row
execute function public.set_updated_at();

create table if not exists public.behavior_alerts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  alert_type text not null default 'other' check (
    alert_type in ('recurrence', 'post_loss_entry', 'frequency_spike', 'risk_spike', 'rule_violation', 'other')
  ),
  severity text not null default 'info' check (
    severity in ('info', 'warning', 'critical')
  ),
  status text not null default 'new' check (
    status in ('new', 'read', 'dismissed')
  ),
  message text not null,
  behavior_id uuid null,
  trade_id uuid null,
  analysis_id uuid null,
  dedupe_key text not null,
  created_at timestamp with time zone not null default now(),
  constraint behavior_alerts_pkey primary key (id),
  constraint behavior_alerts_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint behavior_alerts_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint behavior_alerts_behavior_id_fkey foreign key (behavior_id)
    references public.behaviors (id) on delete set null,
  constraint behavior_alerts_trade_id_fkey foreign key (trade_id)
    references public.trades (id) on delete set null,
  constraint behavior_alerts_analysis_id_fkey foreign key (analysis_id)
    references public.ai_analyses (id) on delete set null,
  constraint behavior_alerts_account_dedupe_unique unique (account_id, dedupe_key)
);

create index if not exists idx_behavior_alerts_user
  on public.behavior_alerts using btree (user_id);

create index if not exists idx_behavior_alerts_account_status
  on public.behavior_alerts using btree (account_id, status, created_at desc);

create index if not exists idx_behavior_alerts_behavior
  on public.behavior_alerts using btree (behavior_id);