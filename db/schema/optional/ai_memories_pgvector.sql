-- ============================================================================
-- AURA Dashboard — OPTIONAL / NOT PART OF THE PHASE 2 APPLY ORDER
-- optional/ai_memories_pgvector.sql
-- ============================================================================
-- The Phase 2 schema creates public.ai_memories WITHOUT the embedding column
-- and WITHOUT the HNSW vector index, because:
--   * the table holds 0 rows in the live Supabase project;
--   * semantic memory is retired in code (aura-backend/src/memory.js no longer
--     generates embeddings; searchMemories uses deterministic ILIKE + ordering);
--   * the match_memories()/match_conversations() RPCs are called by NO code;
--   * pgvector is not available in this Windows PostgreSQL 18 installation.
--
-- Run this file ONLY if a future phase reintroduces real semantic memory AND
-- the pgvector extension has been installed for this cluster.
-- It is intentionally excluded from db/_lib.mjs APPLY_ORDER.
--
-- Prerequisites:
--   1. pgvector binaries available for PostgreSQL 18 on Windows, e.g.
--      build/install from https://github.com/pgvector/pgvector
--   2. create extension vector;   (requires superuser — aura_app cannot do it)
-- ============================================================================

-- create extension if not exists vector;

-- alter table public.ai_memories
--   add column if not exists embedding vector(1536) null;

-- create index if not exists idx_ai_memories_embedding
--   on public.ai_memories using hnsw (embedding vector_cosine_ops);

-- The retired Supabase RPCs, for reference only (not recreated in Phase 2):
--   public.match_memories(query_embedding vector(1536), query_user_id uuid, match_count integer)
--   public.match_conversations(query_embedding vector(1536), query_user_id uuid, match_count integer)