-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 01_aura_users.sql — minimal local user table (PHASE 2 PLACEHOLDER)
-- ============================================================================
-- !! THIS IS NOT THE FINAL AUTHENTICATION SYSTEM !!
--
-- Purpose (Phase 2 ONLY): give the schema a local foreign-key target so the
-- 17 "references auth.users(id)" relationships from Supabase can be recreated
-- without implementing authentication. Authentication is explicitly out of
-- scope for this phase and will be designed in a later phase.
--
-- The live Supabase data set has 12 distinct user ids (see the audit report).
-- Those exact UUIDs will be inserted into this table in PHASE 3 so that every
-- existing row keeps pointing at the same owner.
--
-- Deliverable differences vs. Supabase's auth.users:
--   * Supabase stores email, encrypted_password, confirmation state, sessions,
--     MFA, metadata, audience, etc. None of that is implemented here.
--   * email is NULLABLE and UNIQUE: the 12 real addresses are not readable
--     through the PostgREST API, so they are left to be filled in during
--     Phase 3 (or a later auth phase) rather than invented.
--   * No password/token columns of any kind are created in this phase.
--
-- Idempotent: create table if not exists + drop/create trigger.
-- ============================================================================

create table if not exists public.aura_users (
  id uuid not null default gen_random_uuid(),
  email text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint aura_users_pkey primary key (id),
  -- Postgres treats NULLs as distinct, so multiple unknown-email rows are fine.
  constraint aura_users_email_key unique (email)
);

-- Keeps updated_at current, matching every other table in the schema.
drop trigger if exists aura_users_set_updated_at on public.aura_users;
create trigger aura_users_set_updated_at before
update on public.aura_users for each row
execute function public.set_updated_at();