create table public.certificates (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  firm_name text not null,
  program_name text null,
  account_size numeric null,
  certificate_type text not null default 'evaluation'::text,
  passed_date date not null,
  status text not null default 'passed'::text,
  file_path text null,
  notes text null,
  created_at timestamp with time zone null default now(),
  constraint certificates_pkey primary key (id),
  constraint certificates_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;