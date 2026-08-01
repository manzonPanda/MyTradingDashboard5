create table public.accounts (
  id uuid not null default gen_random_uuid (),
  name text not null,
  firm text null,
  account_number text null,
  initial_balance numeric null,
  profit_target_percent numeric null,
  max_total_drawdown_percent numeric null,
  daily_loss_limit_percent numeric null,
  start_date timestamp with time zone null,
  status text null default 'active'::text,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint accounts_pkey primary key (id)
) TABLESPACE pg_default;