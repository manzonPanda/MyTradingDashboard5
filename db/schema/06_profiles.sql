-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 06_profiles.sql — RECOVERED from the live database (live: 12 rows)
-- ============================================================================
-- There is NO profiles DDL anywhere in the Supabase migration folder — the
-- table exists only in the live project (schema drift identified in the audit).
-- The 6 columns below were recovered from the live PostgREST OpenAPI schema:
--     id uuid, display_name text, avatar_url text, started_trading_date date,
--     created_at timestamptz default now(), updated_at timestamptz default now()
--
-- INTENTIONAL DIFFERENCES (documented in db/README.md):
--   * profiles.id FKs to public.aura_users(id) instead of auth.users(id).
--   * The live RLS policies and the live trigger name are not versioned in the
--     repo and cannot be read through the PostgREST API; this file creates the
--     standard set_updated_at() trigger under a consistent name. Profiles are
--     read/written by the frontend profile screen (display_name, avatar_url,
--     started_trading_date).
-- ============================================================================

create table if not exists public.profiles (
  id uuid not null,
  display_name text null,
  avatar_url text null,
  started_trading_date date null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id)
    references public.aura_users (id) on delete cascade
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before
update on public.profiles for each row
execute function public.set_updated_at();