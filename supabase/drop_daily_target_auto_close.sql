-- Optional cleanup: removes the column of the retired daily-target
-- auto-close feature (superseded by per_trade_gauge_auto_close_enabled).
alter table public.user_settings
  drop column if exists daily_target_auto_close_enabled;
