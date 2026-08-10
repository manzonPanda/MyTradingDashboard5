-- AURA AI - Message storage
-- Episodic conversation memory

create table public.ai_messages (
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
  constraint ai_messages_conversation_id_fkey foreign key (conversation_id) references ai_conversations (id) on delete cascade,
  constraint ai_messages_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_ai_messages_conversation_created
  on public.ai_messages using btree (conversation_id, created_at asc)
  tablespace pg_default;

create index if not exists idx_ai_messages_user_created
  on public.ai_messages using btree (user_id, created_at desc)
  tablespace pg_default;