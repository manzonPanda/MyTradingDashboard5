# Supabase Migration Workflow

This project does **not** use the Supabase CLI (`config.toml`/`migrations/`). The
established workflow is **versioned SQL files applied via the Supabase SQL Editor**,
in the order documented below. Every file is idempotent
(`create table if not exists`, `create index if not exists`,
`drop policy if exists` before `create policy`).

## Rules

- Never run a destructive migration. We do not DROP or ALTER existing tables.
- Apply in order. New files are appended to the end of the list.
- `function_set_updated_at.sql` must run before any `table_*.sql` that creates
  a trigger calling `set_updated_at()`.

## Apply order (Phase 1 + Phase 2 — Trading Behavior Engine)

| # | File | Purpose |
|---|------|---------|
| 0 | `function_set_updated_at.sql` | shared `set_updated_at()` trigger function (idempotent `create or replace`) |
| 1 | `table_ai_analyses.sql` | AI analysis job/audit layer (`queued→running→done|failed|skipped`) |
| 2 | `table_behaviors.sql` | canonical per-account behaviors + lifecycle status |
| 3 | `table_behavior_evidence.sql` | evidence rows linking behaviors → trades/reflections |
| 4 | `table_trading_rules.sql` | evidence-backed rules promoted from established behaviors |
| 5 | `table_behavior_alerts.sql` | behavior alerts (anti-spam via unique dedupe_key) |
| 6 | `table_trading_briefs.sql` | cached weekly briefs (unique per account+week) |
| 7 | `table_behavior_config.sql` | per-account thresholds as data (not UI-hardcoded) |
| 8 | `ai_analyses_rls.sql` | RLS for `ai_analyses` |
| 9 | `behavior_engine_rls.sql` | RLS for the 6 behavior-engine tables |

> Pre-existing project tables (`trades`, `accounts`, `ai_*`, `user_settings`, …)
> are untouched. `set_updated_at()` is re-created with identical behavior so the
> existing triggers keep working.