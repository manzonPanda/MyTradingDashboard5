create table public.prop_firms (
  id uuid not null default gen_random_uuid (),
  name text not null,
  logo_url text null,
  website_url text null,
  created_at timestamp with time zone null default now(),
  constraint prop_firms_pkey primary key (id),
  constraint prop_firms_name_key unique (name)
) TABLESPACE pg_default;