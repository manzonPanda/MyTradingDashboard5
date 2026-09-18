-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 11_ai_analyses.sql — Behaviour Engine analysis job/audit layer
--                      (mirrors supabase/table_ai_analyses.sql — live: 921 rows)
-- ============================================================================
-- Lifecycle: queued → running → done | failed | skipped
--
-- The worker claims jobs with a single conditional UPDATE that re-checks
-- (id + status + staleness + attempts); the stale-lock recovery logic reads
-- updated_at, so ai_analyses_set_updated_at is REQUIRED for correctness.
--
-- The live status/attempt distribution was: done=903, failed=18
-- (18 failed = 'abandoned: lock expired after 3/3 attempts', 'llm_chat: fetch
-- failed', 'repair_invalid: ...').
--
-- NOTE: "trigger" is a non-reserved keyword but is quoted here for clarity; the
-- resulting column name is identical to the unquoted Supabase column.
-- ============================================================================

create table if not exists public.ai_analyses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  "trigger" text not null default 'trade_saved' check (
    "trigger" in ('trade_saved', 'reflection_saved', 'weekly', 'manual')
  ),
  trade_id uuid null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'done', 'failed', 'skipped')
  ),
  attempts smallint not null default 0,
  max_attempts smallint not null default 3,
  last_error text null,
  model text null,
  prompt_version text null,
  input_summary jsonb null,
  raw_response jsonb null,
  started_at timestamp with time zone null,
  finished_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_analyses_pkey primary key (id),
  constraint ai_analyses_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint ai_analyses_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete cascade,
  constraint ai_analyses_trade_id_fkey foreign key (trade_id)
    references public.trades (id) on delete set null
);

create index if not exists idx_ai_analyses_user_created
  on public.ai_analyses using btree (user_id, created_at desc);

create index if not exists idx_ai_analyses_account_status
  on public.ai_analyses using btree (account_id, status);

create index if not exists idx_ai_analyses_status_created
  on public.ai_analyses using btree (status, created_at asc);

drop trigger if exists ai_analyses_set_updated_at on public.ai_analyses;
create trigger ai_analyses_set_updated_at before
update on public.ai_analyses for each row
execute function public.set_updated_at();