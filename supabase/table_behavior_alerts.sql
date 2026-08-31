-- Trading Behavior Engine - behavior_alerts
-- Immediate/high-priority behavioral signals.
--
-- Anti-spam: unique(account_id, dedupe_key). The backend computes a stable
-- dedupe_key per alert type (e.g. `recurrence:<behavior_id>:<trade_id>` or
-- `post_loss_entry:<behavior_id>:<week_start>`), so the same alert can never
-- fire twice even across job retries.

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
    references auth.users (id) on delete cascade,
  constraint behavior_alerts_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint behavior_alerts_behavior_id_fkey foreign key (behavior_id)
    references behaviors (id) on delete set null,
  constraint behavior_alerts_trade_id_fkey foreign key (trade_id)
    references trades (id) on delete set null,
  constraint behavior_alerts_analysis_id_fkey foreign key (analysis_id)
    references ai_analyses (id) on delete set null,
  constraint behavior_alerts_account_dedupe_unique unique (account_id, dedupe_key)
) tablespace pg_default;

create index if not exists idx_behavior_alerts_user
  on public.behavior_alerts using btree (user_id) tablespace pg_default;

create index if not exists idx_behavior_alerts_account_status
  on public.behavior_alerts using btree (account_id, status, created_at desc) tablespace pg_default;

create index if not exists idx_behavior_alerts_behavior
  on public.behavior_alerts using btree (behavior_id) tablespace pg_default;