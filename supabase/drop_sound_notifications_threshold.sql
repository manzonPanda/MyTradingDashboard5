-- Optional cleanup: removes the unused 'Sound threshold (%)' setting.
-- Gauge alert sounds are controlled by live_trade_sound_threshold /
-- live_trade_high_priority_sound_threshold instead.
alter table public.user_settings
  drop column if exists sound_notifications_threshold;
