-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 07_certificates.sql — mirrors supabase/table_certificates.sql (live: 4 rows)
--                       + supabase/table_payouts.sql     (live: 0 rows)
-- ============================================================================
-- certificates.account_id → accounts(id) ON DELETE RESTRICT  (as in Supabase)
-- payouts.certificate_id  → certificates(id) ON DELETE SET NULL
-- Neither table has an updated_at column, so no updated_at trigger is added.
-- ============================================================================

create table if not exists public.certificates (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  program_name text null,
  passed_date date not null,
  status text not null default 'passed'::text,
  file_path text null,
  notes text null,
  created_at timestamp with time zone null default now(),
  account_id uuid not null,
  constraint certificates_pkey primary key (id),
  constraint certificates_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete restrict,
  constraint certificates_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint certificates_status_check check (
    status = any (array['passed'::text, 'funded'::text, 'expired'::text])
  )
);

create index if not exists certificates_account_id_idx
  on public.certificates using btree (account_id);

create table if not exists public.payouts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  certificate_id uuid null,
  firm_name text not null,
  amount numeric not null,
  payout_date date not null,
  notes text null,
  proof_url text null,
  created_at timestamp with time zone null default now(),
  constraint payouts_pkey primary key (id),
  constraint payouts_certificate_id_fkey foreign key (certificate_id)
    references public.certificates (id) on delete set null,
  constraint payouts_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade
);

-- The frontend's Payout.source ('certificate' | 'roi') is a UI-derived field,
-- NOT a column — it is intentionally not created here.