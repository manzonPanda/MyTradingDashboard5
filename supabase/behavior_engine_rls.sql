-- Trading Behavior Engine - Row Level Security
-- Every behavior-engine table carries user_id (RLS) + account_id (engine
-- scope). Policies use auth.uid() = user_id, mirroring aura_ai_rls.sql.
-- The backend worker uses the service-role key (RLS bypass) and MUST further
-- scope every query by account_id through TradingDataAccess.

-- ============================================================
-- behaviors
-- ============================================================
alter table public.behaviors enable row level security;

drop policy if exists "Users can view own behaviors" on public.behaviors;
create policy "Users can view own behaviors"
  on public.behaviors for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own behaviors" on public.behaviors;
create policy "Users can create own behaviors"
  on public.behaviors for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own behaviors" on public.behaviors;
create policy "Users can update own behaviors"
  on public.behaviors for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own behaviors" on public.behaviors;
create policy "Users can delete own behaviors"
  on public.behaviors for delete
  using (auth.uid() = user_id);

-- ============================================================
-- behavior_evidence
-- ============================================================
alter table public.behavior_evidence enable row level security;

drop policy if exists "Users can view own evidence" on public.behavior_evidence;
create policy "Users can view own evidence"
  on public.behavior_evidence for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own evidence" on public.behavior_evidence;
create policy "Users can create own evidence"
  on public.behavior_evidence for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own evidence" on public.behavior_evidence;
create policy "Users can update own evidence"
  on public.behavior_evidence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own evidence" on public.behavior_evidence;
create policy "Users can delete own evidence"
  on public.behavior_evidence for delete
  using (auth.uid() = user_id);

-- ============================================================
-- trading_rules
-- ============================================================
alter table public.trading_rules enable row level security;

drop policy if exists "Users can view own trading rules" on public.trading_rules;
create policy "Users can view own trading rules"
  on public.trading_rules for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own trading rules" on public.trading_rules;
create policy "Users can create own trading rules"
  on public.trading_rules for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own trading rules" on public.trading_rules;
create policy "Users can update own trading rules"
  on public.trading_rules for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own trading rules" on public.trading_rules;
create policy "Users can delete own trading rules"
  on public.trading_rules for delete
  using (auth.uid() = user_id);

-- ============================================================
-- behavior_alerts
-- ============================================================
alter table public.behavior_alerts enable row level security;

drop policy if exists "Users can view own behavior alerts" on public.behavior_alerts;
create policy "Users can view own behavior alerts"
  on public.behavior_alerts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own behavior alerts" on public.behavior_alerts;
create policy "Users can create own behavior alerts"
  on public.behavior_alerts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own behavior alerts" on public.behavior_alerts;
create policy "Users can update own behavior alerts"
  on public.behavior_alerts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own behavior alerts" on public.behavior_alerts;
create policy "Users can delete own behavior alerts"
  on public.behavior_alerts for delete
  using (auth.uid() = user_id);

-- ============================================================
-- trading_briefs
-- ============================================================
alter table public.trading_briefs enable row level security;

drop policy if exists "Users can view own trading briefs" on public.trading_briefs;
create policy "Users can view own trading briefs"
  on public.trading_briefs for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own trading briefs" on public.trading_briefs;
create policy "Users can create own trading briefs"
  on public.trading_briefs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own trading briefs" on public.trading_briefs;
create policy "Users can update own trading briefs"
  on public.trading_briefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own trading briefs" on public.trading_briefs;
create policy "Users can delete own trading briefs"
  on public.trading_briefs for delete
  using (auth.uid() = user_id);

-- ============================================================
-- behavior_config
-- ============================================================
alter table public.behavior_config enable row level security;

drop policy if exists "Users can view own behavior config" on public.behavior_config;
create policy "Users can view own behavior config"
  on public.behavior_config for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own behavior config" on public.behavior_config;
create policy "Users can create own behavior config"
  on public.behavior_config for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own behavior config" on public.behavior_config;
create policy "Users can update own behavior config"
  on public.behavior_config for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own behavior config" on public.behavior_config;
create policy "Users can delete own behavior config"
  on public.behavior_config for delete
  using (auth.uid() = user_id);