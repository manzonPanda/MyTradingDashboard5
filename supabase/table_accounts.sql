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
  user_id uuid null,
  phase text not null default 'phase1'::text,
  constraint accounts_pkey primary key (id),
  constraint accounts_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint accounts_phase_check check (
    (
      phase = any (
        array['phase1'::text, 'phase2'::text, 'funded'::text]
      )
    )
  )
) TABLESPACE pg_default;