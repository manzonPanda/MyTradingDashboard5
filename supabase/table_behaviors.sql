-- Trading Behavior Engine - behaviors (canonical per-account behavior)
-- Every behavior belongs to exactly one account (account_id) and one user
-- (user_id, for RLS). Never mixes accounts.
--
-- Lifecycle (deterministic, transitioned by backend, thresholds from
-- behavior_config):
--   DETECTED → EMERGING → RECURRING → ESTABLISHED → RULE_CANDIDATE
--   plus RESOLVED (no new evidence for N days) and ARCHIVED (user hidden).
--
-- LLM NEVER writes objective fields (occurrence_count, confidence,
-- estimated_impact_*). Those are backend-computed from behavior_evidence.

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
    references auth.users (id) on delete cascade,
  constraint behaviors_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  -- Convergent naming: repeated detections of the same behavior collapse onto
  -- one row (upsert), never fragment into variants.
  constraint behaviors_account_name_key_type_unique unique (account_id, name_key, behavior_type)
) tablespace pg_default;

create index if not exists idx_behaviors_user
  on public.behaviors using btree (user_id) tablespace pg_default;

create index if not exists idx_behaviors_account_status
  on public.behaviors using btree (account_id, status) tablespace pg_default;

create index if not exists idx_behaviors_account_type_status
  on public.behaviors using btree (account_id, behavior_type, status) tablespace pg_default;

-- drop-if-exists keeps re-running this file safe (same guard pattern as policies).
drop trigger if exists behaviors_set_updated_at on behaviors;
create trigger behaviors_set_updated_at before
update on behaviors for each row
execute function set_updated_at();