create or replace function public.user_owns_trade_ticket(p_ticket text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trades t
    join public.accounts a on a.id = t.account_id
    where t.ticket::text = p_ticket
      and a.user_id = auth.uid()
  );
$$;

revoke all on function public.user_owns_trade_ticket(text) from public;
grant execute on function public.user_owns_trade_ticket(text) to authenticated;

alter table public.trade_screenshots enable row level security;

drop policy if exists "Users can view own trade screenshots" on public.trade_screenshots;
drop policy if exists "Users can add own trade screenshots" on public.trade_screenshots;
drop policy if exists "Users can view own screenshot files" on storage.objects;
drop policy if exists "Users can upload own screenshot files" on storage.objects;

create policy "Users can view own trade screenshots"
on public.trade_screenshots
for select
to authenticated
using (public.user_owns_trade_ticket(ticket));

create policy "Users can add own trade screenshots"
on public.trade_screenshots
for insert
to authenticated
with check (public.user_owns_trade_ticket(ticket));

create policy "Users can view own screenshot files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trade-screenshots'
  and (
    public.user_owns_trade_ticket(split_part(name, '/', 1))
    or exists (
      select 1
      from public.trade_screenshots s
      where s.storage_path = name
        and public.user_owns_trade_ticket(s.ticket)
    )
  )
);

create policy "Users can upload own screenshot files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trade-screenshots'
  and (
    public.user_owns_trade_ticket(split_part(name, '/', 1))
    or exists (
      select 1
      from public.trade_screenshots s
      where s.storage_path = name
        and public.user_owns_trade_ticket(s.ticket)
    )
  )
);
