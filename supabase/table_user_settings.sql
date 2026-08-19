create table public.user_settings (
  user_id uuid not null,
  per_trade_target_percent numeric(8, 4) not null default 1,
  sound_notifications_threshold numeric(8, 4) not null default 2.8,
  high_priority_sound_threshold numeric(8, 4) not null default 3.4,
  daily_target_percent numeric(8, 4) not null default 2,
  weekly_r_target numeric(8, 4) not null default 5,
  default_chart_mode text not null default 'trades'::text,
  trading_day_reset_time time without time zone not null default '17:00:00'::time without time zone,
  default_account_id uuid null,
  show_account_balance boolean not null default true,
  show_pnl boolean not null default true,
  show_trading_activity boolean not null default true,
  show_news_calendar boolean not null default true,
  aura_enabled boolean not null default true,
  aura_travel_duration_ms integer not null default 2000,
  aura_min_delay_ms integer not null default 2000,
  aura_max_delay_ms integer not null default 5000,
  aura_trail_length_percent numeric(8, 4) not null default 8,
  aura_stroke_width numeric(8, 4) not null default 6,
  aura_head_radius numeric(8, 4) not null default 9,
  aura_bloom_intensity numeric(8, 4) not null default 4.5,
  aura_fade_duration_ms integer not null default 180,
  aura_color_start text not null default '#7C3AED'::text,
  aura_color_mid text not null default '#A78BFA'::text,
  aura_color_peak text not null default '#E9D5FF'::text,
  aura_color_head text not null default '#FFFFFF'::text,
  aura_min_targets integer not null default 2,
  aura_max_targets integer not null default 4,
  notifications_enabled boolean not null default true,
  daily_goal_notification boolean not null default true,
  goal_notification_sound boolean not null default true,
  notification_volume numeric(5, 4) not null default 0.7,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_settings_pkey primary key (user_id),
  constraint user_settings_default_account_id_fkey foreign KEY (default_account_id) references accounts (id) on delete set null,
  constraint user_settings_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint user_settings_default_chart_mode_check check (
    (
      default_chart_mode = any (array['daily'::text, 'trades'::text])
    )
  )
) TABLESPACE pg_default;

create trigger user_settings_set_updated_at BEFORE
update on user_settings for EACH row
execute FUNCTION set_updated_at ();
