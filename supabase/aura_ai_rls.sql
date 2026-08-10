-- AURA AI - Row Level Security policies
-- Ensures strict user-data isolation: users can only access their own AI data

-- ============================================================
-- Enable RLS on all AI tables
-- ============================================================
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_memories enable row level security;
alter table public.ai_insights enable row level security;

-- ============================================================
-- ai_conversations policies
-- ============================================================
create policy "Users can view own conversations"
  on public.ai_conversations for select
  using (auth.uid() = user_id);

create policy "Users can create own conversations"
  on public.ai_conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own conversations"
  on public.ai_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own conversations"
  on public.ai_conversations for delete
  using (auth.uid() = user_id);

-- ============================================================
-- ai_messages policies
-- ============================================================
create policy "Users can view own messages"
  on public.ai_messages for select
  using (auth.uid() = user_id);

create policy "Users can create own messages"
  on public.ai_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can update own messages"
  on public.ai_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own messages"
  on public.ai_messages for delete
  using (auth.uid() = user_id);

-- ============================================================
-- ai_memories policies
-- ============================================================
create policy "Users can view own memories"
  on public.ai_memories for select
  using (auth.uid() = user_id);

create policy "Users can create own memories"
  on public.ai_memories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own memories"
  on public.ai_memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own memories"
  on public.ai_memories for delete
  using (auth.uid() = user_id);

-- ============================================================
-- ai_insights policies
-- ============================================================
create policy "Users can view own insights"
  on public.ai_insights for select
  using (auth.uid() = user_id);

create policy "Users can create own insights"
  on public.ai_insights for insert
  with check (auth.uid() = user_id);

create policy "Users can update own insights"
  on public.ai_insights for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own insights"
  on public.ai_insights for delete
  using (auth.uid() = user_id);