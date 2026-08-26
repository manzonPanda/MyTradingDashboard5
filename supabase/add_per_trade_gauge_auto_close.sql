-- Master switch for closing each individual trade when its PnL% reaches the
-- 'Maximum positive gauge (%)' setting (positive_gauge_percent_max).
alter table public.user_settings
  add column if not exists per_trade_gauge_auto_close_enabled boolean not null default true;
