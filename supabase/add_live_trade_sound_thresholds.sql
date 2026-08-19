alter table public.user_settings
  add column if not exists live_trade_sound_threshold numeric(8, 4) not null default 2.8,
  add column if not exists live_trade_high_priority_sound_threshold numeric(8, 4) not null default 3.4;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_live_trade_sound_threshold_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_live_trade_sound_threshold_check
      check (live_trade_sound_threshold >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_live_trade_high_priority_sound_threshold_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_live_trade_high_priority_sound_threshold_check
      check (live_trade_high_priority_sound_threshold > live_trade_sound_threshold);
  end if;
end $$;
