-- Trading Behavior Engine - RLS for ai_analyses
-- Users can only see/create/update their OWN analysis rows.
-- The backend worker runs with the service-role key (RLS bypass) and
-- filters by user_id + account_id programmatically.

alter table public.ai_analyses enable row level security;

drop policy if exists "Users can view own analyses" on public.ai_analyses;
create policy "Users can view own analyses"
  on public.ai_analyses for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own analyses" on public.ai_analyses;
create policy "Users can create own analyses"
  on public.ai_analyses for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own analyses" on public.ai_analyses;
create policy "Users can update own analyses"
  on public.ai_analyses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own analyses" on public.ai_analyses;
create policy "Users can delete own analyses"
  on public.ai_analyses for delete
  using (auth.uid() = user_id);