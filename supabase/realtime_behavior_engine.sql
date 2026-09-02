-- Trading Behavior Engine - Realtime publication
--
-- The dashboard subscribes to postgres_changes on the three behavior-engine
-- tables (scoped by account_id). For CHANGE events to actually be broadcast,
-- each table must be a member of the `supabase_realtime` publication.
--
-- Idempotent: re-running is safe (a table already in the publication is
-- skipped). Apply AFTER the table_*.sql files (they must exist first) and
-- AFTER the RLS files (Realtime respects RLS — the client receives only
-- events the authenticated user is allowed to SELECT).
--
-- No second realtime architecture is created: this merely exposes the SAME
-- tables the dashboard already watches through supabase-js `channel()`.
do $$
declare
  t text;
begin
  foreach t in array array['trades', 'behaviors', 'behavior_evidence', 'ai_analyses']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Push REPLICA IDENTITY FULL so UPDATE/DELETE events carry the full row
-- (account_id included) — required for client-side `account_id=eq.…` filters.
do $$
declare
  t text;
begin
  foreach t in array array['trades', 'behaviors', 'behavior_evidence', 'ai_analyses']
  loop
    execute format(
      'alter table public.%I replica identity full',
      t
    );
  end loop;
end $$;