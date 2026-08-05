create table public.certificates (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  program_name text null,
  account_size numeric null,
  prop_firm_id uuid null,
  certificate_type text not null default 'evaluation'::text,
  passed_date date not null,
  status text not null default 'passed'::text,
  file_path text null,
  notes text null,
  created_at timestamp with time zone null default now(),
  constraint certificates_pkey primary key (id),
  constraint certificates_prop_firm_id_fkey foreign KEY (prop_firm_id) references public.prop_firms (id) on delete set null,
  constraint certificates_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint certificates_type_check check (certificate_type = any (array['evaluation'::text, 'funded'::text, 'other'::text])),
  constraint certificates_status_check check (status = any (array['passed'::text, 'funded'::text, 'expired'::text]))
) TABLESPACE pg_default;

create index if not exists certificates_prop_firm_id_idx
on public.certificates using btree (prop_firm_id)
TABLESPACE pg_default;
