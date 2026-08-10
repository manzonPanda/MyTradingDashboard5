-- AURA AI - Conversation storage
-- Episodic conversation memory

create table public.ai_conversations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New conversation'::text,
  summary text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ai_conversations_pkey primary key (id),
  constraint ai_conversations_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_ai_conversations_user_updated
  on public.ai_conversations using btree (user_id, updated_at desc)
  tablespace pg_default;

-- Trigger to keep updated_at current
create trigger ai_conversations_set_updated_at before
update on ai_conversations for each row
execute function set_updated_at();