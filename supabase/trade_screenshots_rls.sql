create table public.trade_screenshots (
  id uuid not null default gen_random_uuid (),
  ticket text not null,
  symbol text null,
  storage_path text not null,
  captured_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint trade_screenshots_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists trade_screenshots_ticket_idx on public.trade_screenshots using btree (ticket) TABLESPACE pg_default;