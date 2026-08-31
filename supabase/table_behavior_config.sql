-- Trading Behavior Engine - behavior_config
-- Per-account threshold overrides, stored as DATA (not hardcoded in the UI or
-- backend). Backend applies defaults when no row exists. Thresholds control
-- the deterministic lifecycle transitions, alert windows, and resolution.

create table if not exists public.behavior_config (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  thresholds jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint behavior_config_pkey primary key (id),
  constraint behavior_config_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint behavior_config_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint behavior_config_account_unique unique (account_id)
) tablespace pg_default;

create index if not exists idx_behavior_config_user
  on public.behavior_config using btree (user_id) tablespace pg_default;

-- drop-if-exists keeps re-running this file safe (same guard pattern as policies).
drop trigger if exists behavior_config_set_updated_at on behavior_config;
create trigger behavior_config_set_updated_at before
update on behavior_config for each row
execute function set_updated_at();