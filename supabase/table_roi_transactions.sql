create table public.roi_transactions (
  id uuid not null default gen_random_uuid (),
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
  constraint roi_transactions_account_id_fkey foreign KEY (account_id) references accounts (id) on delete set null,
  constraint roi_transactions_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint roi_transactions_amount_check check ((amount > (0)::numeric)),
  constraint roi_transactions_transaction_type_check check (
    (
      transaction_type = any (array['expense'::text, 'payout'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_roi_transactions_account_id on public.roi_transactions using btree (account_id) TABLESPACE pg_default;

create index IF not exists idx_roi_transactions_date on public.roi_transactions using btree (transaction_date) TABLESPACE pg_default;

create index IF not exists idx_roi_transactions_type on public.roi_transactions using btree (transaction_type) TABLESPACE pg_default;

create index IF not exists idx_roi_transactions_user_id on public.roi_transactions using btree (user_id) TABLESPACE pg_default;

create trigger trg_roi_transactions_updated_at BEFORE
update on roi_transactions for EACH row
execute FUNCTION handle_updated_at ();