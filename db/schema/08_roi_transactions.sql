-- ============================================================================
-- AURA Dashboard — local PostgreSQL schema (Phase 2)
-- 08_roi_transactions.sql — mirrors supabase/table_roi_transactions.sql
--                           (live: 27 rows, all transaction_type='expense')
-- ============================================================================
-- image_url stores a Supabase Storage object path today; in Phase 3 the same
-- relative paths are preserved when files move to local storage.
-- ============================================================================

create table if not exists public.roi_transactions (
  id uuid not null default gen_random_uuid(),
  transaction_date date not null,
  transaction_type text not null,
  amount numeric not null,
  note text null,
  image_url text null,
  account_id uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  user_id uuid null,
  constraint roi_transactions_pkey primary key (id),
  constraint roi_transactions_account_id_fkey foreign key (account_id)
    references public.accounts (id) on delete set null,
  constraint roi_transactions_user_id_fkey foreign key (user_id)
    references public.aura_users (id) on delete cascade,
  constraint roi_transactions_amount_check check (amount > 0),
  constraint roi_transactions_transaction_type_check check (
    transaction_type = any (array['expense'::text, 'payout'::text])
  )
);

create index if not exists idx_roi_transactions_account_id
  on public.roi_transactions using btree (account_id);

create index if not exists idx_roi_transactions_date
  on public.roi_transactions using btree (transaction_date);

create index if not exists idx_roi_transactions_type
  on public.roi_transactions using btree (transaction_type);

create index if not exists idx_roi_transactions_user_id
  on public.roi_transactions using btree (user_id);

-- Supabase uses the handle_updated_at() name for this table (table_roi_transactions.sql).
drop trigger if exists trg_roi_transactions_updated_at on public.roi_transactions;
create trigger trg_roi_transactions_updated_at before
update on public.roi_transactions for each row
execute function public.handle_updated_at();