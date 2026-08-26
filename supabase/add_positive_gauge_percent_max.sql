-- Persists the live trade gauge scale ('Maximum positive gauge (%)') so it
-- follows the user across devices instead of living in browser localStorage.
-- Both the Trades widget gear modal and Profile & settings write this column.
alter table public.user_settings
  add column if not exists positive_gauge_percent_max numeric(8, 4) not null default 4;
