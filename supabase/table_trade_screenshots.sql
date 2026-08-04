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

alter table public.trade_screenshots enable row level security;

create policy "Users can view own trade screenshots"
on public.trade_screenshots
for select
to authenticated
using (
  exists (
    select 1
    from public.trades
    join public.accounts on accounts.id = trades.account_id
    where trades.ticket::text = trade_screenshots.ticket
      and accounts.user_id = auth.uid()
  )
);

create policy "Users can add own trade screenshots"
on public.trade_screenshots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.trades
    join public.accounts on accounts.id = trades.account_id
    where trades.ticket::text = trade_screenshots.ticket
      and accounts.user_id = auth.uid()
  )
);

create policy "Users can view own screenshot files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trade-screenshots'
  and exists (
    select 1
    from public.trades
    join public.accounts on accounts.id = trades.account_id
    where trades.ticket::text = split_part(name, '/', 1)
      and accounts.user_id = auth.uid()
  )
);

create policy "Users can upload own screenshot files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trade-screenshots'
  and exists (
    select 1
    from public.trades
    join public.accounts on accounts.id = trades.account_id
    where trades.ticket::text = split_part(name, '/', 1)
      and accounts.user_id = auth.uid()
  )
);
