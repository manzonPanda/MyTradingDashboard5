-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 10_ai_core.sql — ai_conversations, ai_messages, ai_memories, ai_insights
--                  (live: 3 conversations / 33 messages / 0 memories / 0 insights)
-- ============================================================================
-- !! INTENTIONAL DEVIATION — ai_memories DOES NOT HAVE THE embedding COLUMN !!
--
-- Audit findings (2026-09-18): ai_memories holds 0 rows; semantic memory is
-- retired in code (aura-backend/src/memory.js: the hash pseudo-embedding was
-- removed and searchMemories now uses deterministic ILIKE + importance +
-- recency ordering); the match_memories/match_conversations RPCs are not called
-- by any code; and pgvector is NOT available in this Windows PostgreSQL 18
-- installation.
--
-- Therefore this file creates ai_memories WITHOUT the vector(1536) column and
-- WITHOUT the HNSW index. Nothing in the current application selects or writes
-- `embedding`, so no runtime behaviour is lost. If semantic memory is ever
-- revived, see db/schema/optional/ai_memories_pgvector.sql (NOT part of the
-- apply order) to add the column + index once pgvector is installed.
--
-- Phase 3 note: the Supabase export must use an EXPLICIT column list for
-- ai_memories (never "select *") because the source table has one extra column.
-- ============================================================================

create table if not exists public.ai_conversations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New conversation'::text,
  summary text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_conversations_pkey primary key (id),
  constraint ai_conversations_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade
);

create index if not exists idx_ai_conversations_user_updated
  on public.ai_conversations using btree (user_id, updated_at desc);

drop trigger if exists ai_conversations_set_updated_at on public.ai_conversations;
create trigger ai_conversations_set_updated_at before
update on public.ai_conversations for each row
execute function public.set_updated_at();

create table if not exists public.ai_messages (
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  tool_calls jsonb null,
  tool_name text null,
  token_count integer null,
  created_at timestamp with time zone not null default now(),
  constraint ai_messages_pkey primary key (id),
  constraint ai_messages_conversation_id_fkey foreign key (conversation_id)
    references public.ai_conversations (id) on delete cascade,
  constraint ai_messages_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade
);

create index if not exists idx_ai_messages_conversation_created
  on public.ai_messages using btree (conversation_id, created_at asc);

create index if not exists idx_ai_messages_user_created
  on public.ai_messages using btree (user_id, created_at desc);

create table if not exists public.ai_memories (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  memory text not null,
  memory_type text not null check (
    memory_type in (
      'preference', 'trading_rule', 'behavior', 'goal',
      'fact', 'strategy', 'conversation', 'insight'
    )
  ),
  importance smallint not null default 5 check (importance between 1 and 10),
  source text null,
  is_active boolean not null default true,
  expires_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_memories_pkey primary key (id),
  constraint ai_memories_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade
);

create index if not exists idx_ai_memories_user_active
  on public.ai_memories using btree (user_id, is_active, created_at desc);

drop trigger if exists ai_memories_set_updated_at on public.ai_memories;
create trigger ai_memories_set_updated_at before
update on public.ai_memories for each row
execute function public.set_updated_at();

create table if not exists public.ai_insights (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  insight_type text not null check (
    insight_type in (
      'performance_review', 'behavioral_pattern', 'risk_warning', 'coaching_tip',
      'proactive_alert', 'weekly_review', 'daily_summary'
    )
  ),
  title text not null,
  content text not null,
  severity text not null default 'info' check (
    severity in ('info', 'warning', 'critical', 'positive')
  ),
  related_data jsonb null,
  is_read boolean not null default false,
  is_dismissed boolean not null default false,
  created_at timestamp with time zone not null default now(),
  constraint ai_insights_pkey primary key (id),
  constraint ai_insights_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade
);

create index if not exists idx_ai_insights_user_created
  on public.ai_insights using btree (user_id, created_at desc);

create index if not exists idx_ai_insights_user_unread
  on public.ai_insights using btree (user_id, is_read, is_dismissed);