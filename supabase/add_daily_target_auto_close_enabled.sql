-- Adds the master switch for the "close all live trades at daily target"
-- auto-close feature. Both the Trades widget toggle button and the Profile &
-- settings checkbox persist to this column.
alter table public.user_settings
  add column if not exists daily_target_auto_close_enabled boolean not null default true;
