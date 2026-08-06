create table public.certificates (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  program_name text null,
  passed_date date not null,
  status text not null default 'passed'::text,
  file_path text null,
  notes text null,
  created_at timestamp with time zone null default now(),
  account_id uuid not null,
  constraint certificates_pkey primary key (id),
  constraint certificates_account_id_fkey foreign KEY (account_id) references accounts (id) on delete RESTRICT,
  constraint certificates_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint certificates_status_check check (
    (
      status = any (
        array['passed'::text, 'funded'::text, 'expired'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists certificates_account_id_idx on public.certificates using btree (account_id) TABLESPACE pg_default;