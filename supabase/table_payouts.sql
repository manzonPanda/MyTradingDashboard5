create table public.payouts (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  certificate_id uuid null,
  firm_name text not null,
  amount numeric not null,
  payout_date date not null,
  notes text null,
  proof_url text null,
  created_at timestamp with time zone null default now(),
  constraint payouts_pkey primary key (id),
  constraint payouts_certificate_id_fkey foreign KEY (certificate_id) references certificates (id) on delete set null,
  constraint payouts_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;