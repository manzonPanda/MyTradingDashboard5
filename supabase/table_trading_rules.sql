-- Trading Behavior Engine - trading_rules
-- Evidence-backed rules promoted from ESTABLISHED behaviors.
-- unique(account_id, rule) prevents duplicate rules.
-- source_behavior_id SET NULL when behavior removed so the rule survives.

create table if not exists public.trading_rules (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  source_behavior_id uuid null,
  rule text not null,
  rationale text null,
  confidence numeric(5, 4) not null default 0,
  -- Backend-computed counts (journal reflections, behavior occurrences, weeks).
  evidence_summary jsonb null,
  status text not null default 'candidate' check (
    status in ('candidate', 'active', 'archived')
  ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint trading_rules_pkey primary key (id),
  constraint trading_rules_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint trading_rules_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint trading_rules_source_behavior_id_fkey foreign key (source_behavior_id)
    references behaviors (id) on delete set null,
  constraint trading_rules_account_rule_unique unique (account_id, rule)
) tablespace pg_default;

create index if not exists idx_trading_rules_user
  on public.trading_rules using btree (user_id) tablespace pg_default;

create index if not exists idx_trading_rules_account_status
  on public.trading_rules using btree (account_id, status) tablespace pg_default;

-- drop-if-exists keeps re-running this file safe (same guard pattern as policies).
drop trigger if exists trading_rules_set_updated_at on trading_rules;
create trigger trading_rules_set_updated_at before
update on trading_rules for each row
execute function set_updated_at();