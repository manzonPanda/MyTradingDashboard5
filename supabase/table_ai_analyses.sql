-- Trading Behavior Engine - AI analysis job/audit layer
-- Phase 1 preparation: every AI analysis has a traceable, retriable lifecycle.
--
--   queued → running → done | failed | skipped
--
-- This table is written by the backend worker (Phase 2) and read by:
--   * the worker itself (claim next batch),
--   * the API (surfaces analysis status/errors in the UI),
--   * debugging (raw response retained for failed/malformed runs).
--
-- Account isolation: every row carries user_id (RLS) + account_id (engine
-- scope). Behavior analysis NEVER spans accounts.

create table if not exists public.ai_analyses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  trigger text not null default 'trade_saved' check (
    trigger in ('trade_saved', 'reflection_saved', 'weekly', 'manual')
  ),
  -- Optional linked trade (trades carry the Daily Reflection the analysis reads).
  trade_id uuid null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'done', 'failed', 'skipped')
  ),
  attempts smallint not null default 0,
  max_attempts smallint not null default 3,
  last_error text null,
  model text null,
  prompt_version text null,
  -- Compacted snapshot of what was sent to the LLM (trade facts + reflection
  -- + relevant behavior summaries). Never stores credentials.
  input_summary jsonb null,
  -- Raw LLM response, retained before validation so failed runs are debuggable.
  -- Only persisted when the response is valid JSON (see worker, Phase 2).
  raw_response jsonb null,
  started_at timestamp with time zone null,
  finished_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_analyses_pkey primary key (id),
  constraint ai_analyses_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade,
  constraint ai_analyses_account_id_fkey foreign key (account_id)
    references accounts (id) on delete cascade,
  constraint ai_analyses_trade_id_fkey foreign key (trade_id)
    references trades (id) on delete set null
) tablespace pg_default;

create index if not exists idx_ai_analyses_user_created
  on public.ai_analyses using btree (user_id, created_at desc)
  tablespace pg_default;

create index if not exists idx_ai_analyses_account_status
  on public.ai_analyses using btree (account_id, status)
  tablespace pg_default;

create index if not exists idx_ai_analyses_status_created
  on public.ai_analyses using btree (status, created_at asc)
  tablespace pg_default;

-- Keep updated_at current (mirrors the other table_*.sql triggers).
-- drop-if-exists keeps re-running this file safe (same guard pattern as policies).
drop trigger if exists ai_analyses_set_updated_at on ai_analyses;
create trigger ai_analyses_set_updated_at before
update on ai_analyses for each row
execute function set_updated_at();