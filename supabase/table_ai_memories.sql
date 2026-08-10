-- AURA AI - Semantic long-term memory
-- Requires pgvector extension: create extension if not exists vector;

create table public.ai_memories (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  memory text not null,
  memory_type text not null check (
    memory_type in (
      'preference',
      'trading_rule',
      'behavior',
      'goal',
      'fact',
      'strategy',
      'conversation',
      'insight'
    )
  ),
  importance smallint not null default 5 check (importance between 1 and 10),
  source text null,
  embedding vector(1536) null,
  is_active boolean not null default true,
  expires_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_memories_pkey primary key (id),
  constraint ai_memories_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_ai_memories_user_active
  on public.ai_memories using btree (user_id, is_active, created_at desc)
  tablespace pg_default;

-- Vector similarity index for semantic search
create index if not exists idx_ai_memories_embedding
  on public.ai_memories using hnsw (embedding vector_cosine_ops)
  tablespace pg_default;

-- Trigger to keep updated_at current
create trigger ai_memories_set_updated_at before
update on ai_memories for each row
execute function set_updated_at();