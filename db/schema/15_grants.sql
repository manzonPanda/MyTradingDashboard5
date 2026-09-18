-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 14_grants.sql — least-privilege grants for the aura_app application role
-- ============================================================================
-- Must run AFTER every table exists (it uses "on all tables").
--
-- aura_app is deliberately NOT the owner of any object and NOT a superuser:
--   * it gets USAGE on schema public (not CREATE) — on PostgreSQL 15+ the
--     public schema no longer grants CREATE to PUBLIC, so aura_app cannot
--     create tables, indexes, functions or extensions;
--   * it gets DML (SELECT/INSERT/UPDATE/DELETE) on the application tables;
--   * it gets SELECT only on aura_users (user lifecycle belongs to the auth
--     service that will be designed in a later phase);
--   * it gets no sequence privileges because every primary key is a UUID with a
--     default function — there are no sequences in this schema;
--   * it can never ALTER/DROP an existing object (it is not the owner).
--
-- Idempotent: GRANT/REVOKE are safe to re-run.
-- ============================================================================

grant usage on schema public to aura_app;

grant select, insert, update, delete on all tables in schema public to aura_app;

-- Phase 2: the application role may READ the local user table but must not
-- create/rename/delete users — that authority is reserved for the future auth
-- service (see db/README.md, "Phase 2 scope").
revoke insert, update, delete on public.aura_users from aura_app;

-- The updated_at triggers execute for DML issued by aura_app.
grant execute on function public.set_updated_at() to aura_app;
grant execute on function public.handle_updated_at() to aura_app;

-- Future objects created by the schema owner are automatically usable by the
-- application role (no repeat of this file needed after new migrations).
alter default privileges in schema public
  grant select, insert, update, delete on tables to aura_app;

alter default privileges in schema public
  grant execute on functions to aura_app;

-- ---------------------------------------------------------------------------
-- OPTIONAL HARDENING — not executed automatically.
-- Uncomment ONLY if this database must be reachable exclusively by aura_app
-- (note: superusers bypass these grants, so pgAdmin/postgres still works):
--
--   revoke connect on database aura_dashboard from public;
--   grant  connect on database aura_dashboard to aura_app;
-- ---------------------------------------------------------------------------