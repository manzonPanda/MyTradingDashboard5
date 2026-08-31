-- Trading Behavior Engine - behavior_evidence
-- Links a behavior to the actual trades/reflections that caused the detection
-- (evidence-first design). FK references trades — trade info is NOT duplicated
-- except trade_ticket + trade_time_open used purely for display/timeline speed.
--
-- Idempotency: unique(behavior_id, trade_id). A retried analysis upserts the
-- same evidence row instead of creating duplicates.

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
  -- Backend-computed objective stats at analysis time (R, PnL, hold, session…).
  metrics_snapshot jsonb null,
  evidence_confidence numeric(5, 4) not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint behavior_evidence_pkey primary key (id),
  constraint behavior_evidence_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint behavior_evidence_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint behavior_evidence_behavior_id_fkey foreign key (behavior_id)
    references behaviors (id) on delete cascade,
  constraint behavior_evidence_analysis_id_fkey foreign key (analysis_id)
    references ai_analyses (id) on delete set null,
  constraint behavior_evidence_trade_id_fkey foreign key (trade_id)
    references trades (id) on delete cascade,
  constraint behavior_evidence_behavior_trade_unique unique (behavior_id, trade_id)
) tablespace pg_default;

create index if not exists idx_behavior_evidence_user
  on public.behavior_evidence using btree (user_id) tablespace pg_default;

create index if not exists idx_behavior_evidence_account_created
  on public.behavior_evidence using btree (account_id, created_at desc) tablespace pg_default;

create index if not exists idx_behavior_evidence_behavior
  on public.behavior_evidence using btree (behavior_id) tablespace pg_default;

create index if not exists idx_behavior_evidence_trade
  on public.behavior_evidence using btree (trade_id) tablespace pg_default;

create index if not exists idx_behavior_evidence_week
  on public.behavior_evidence using btree (account_id, week_start) tablespace pg_default;