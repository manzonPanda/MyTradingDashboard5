-- AURA AI - pgvector match functions for semantic search
-- These functions enable vector similarity search on memories and conversations
--
-- Prerequisites:
--   1. Enable pgvector extension: create extension if not exists vector;
--   2. Run table_ai_memories.sql first

-- ============================================================
-- match_memories: Semantic search of user memories
-- ============================================================
create or replace function match_memories(
  query_embedding vector(1536),
  query_user_id uuid,
  match_count integer default 5
)
returns table (
  id uuid,
  memory text,
  memory_type text,
  importance smallint,
  source text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    m.id,
    m.memory,
    m.memory_type,
    m.importance,
    m.source,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.ai_memories m
  where
    m.user_id = query_user_id
    and m.is_active = true
    and (m.expires_at is null or m.expires_at > now())
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- ============================================================
-- match_conversations: Semantic search of conversation summaries
-- (Requires an embedding column on ai_conversations — optional)
-- ============================================================
-- Note: This function requires an 'embedding' column on ai_conversations.
-- If you don't have one, the fallback text search in memory.js will be used.
-- To enable this, add an embedding column:
--   alter table ai_conversations add column embedding vector(1536);

create or replace function match_conversations(
  query_embedding vector(1536),
  query_user_id uuid,
  match_count integer default 3
)
returns table (
  id uuid,
  title text,
  summary text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.title,
    c.summary,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.ai_conversations c
  where
    c.user_id = query_user_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;