begin;

alter table public.accounts
  add column if not exists platform text;

update public.accounts
set platform = 'MT5'
where platform is null;

alter table public.accounts
  alter column platform set default 'MT5'::text,
  alter column platform set not null;

alter table public.accounts
  drop constraint if exists accounts_platform_check;

alter table public.accounts
  add constraint accounts_platform_check check (
    platform = any (
      array['MT5'::text, 'Tradovate'::text, 'Wealthcharts'::text]
    )
  );

commit;
