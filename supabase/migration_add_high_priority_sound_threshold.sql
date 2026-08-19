alter table public.user_settings
  add column if not exists high_priority_sound_threshold numeric(8, 4) not null default 3.4;
