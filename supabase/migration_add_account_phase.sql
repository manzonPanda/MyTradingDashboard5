alter table public.accounts
  add column if not exists phase text not null default 'phase1';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_phase_check'
      and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_phase_check
      check (phase = any (array['phase1'::text, 'phase2'::text, 'funded'::text]));
  end if;
end $$;
