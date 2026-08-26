-- OPTIONAL cleanup — run ONLY AFTER the aura-backend has been redeployed
-- with the updated tools.js (which no longer selects this column).
alter table public.user_settings
  drop column if exists per_trade_target_percent;
