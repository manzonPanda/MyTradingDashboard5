-- Trading Behavior Engine - trading_briefs
-- Weekly brief cached per (account_id, week_start) so page loads never
-- regenerate an unchanged brief. New evidence invalidates and triggers a
-- regeneration (backend decides), but the UNIQUE constraint guarantees at most
-- one brief per account per week.

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
    references auth.users (id) on delete cascade,
  constraint trading_briefs_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint trading_briefs_account_week_unique unique (account_id, week_start)
) tablespace pg_default;

create index if not exists idx_trading_briefs_user
  on public.trading_briefs using btree (user_id) tablespace pg_default;

create index if not exists idx_trading_briefs_account_week
  on public.trading_briefs using btree (account_id, week_start desc) tablespace pg_default;

-- drop-if-exists keeps re-running this file safe (same guard pattern as policies).
drop trigger if exists trading_briefs_set_updated_at on trading_briefs;
create trigger trading_briefs_set_updated_at before
update on trading_briefs for each row
execute function set_updated_at();