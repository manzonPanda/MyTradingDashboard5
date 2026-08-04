create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  started_trading_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  per_trade_target_percent numeric(8,4) not null default 1,
  sound_notifications_threshold numeric(8,4) not null default 2.8,
  daily_target_percent numeric(8,4) not null default 2,
  weekly_r_target numeric(8,4) not null default 5,
  default_chart_mode text not null default 'trades' check (default_chart_mode in ('daily', 'trades')),
  trading_day_reset_time time not null default '17:00:00',
  default_account_id uuid,
  show_account_balance boolean not null default true,
  show_pnl boolean not null default true,
  show_trading_activity boolean not null default true,
  show_news_calendar boolean not null default true,
  aura_enabled boolean not null default true,
  aura_travel_duration_ms integer not null default 2000,
  aura_min_delay_ms integer not null default 2000,
  aura_max_delay_ms integer not null default 5000,
  aura_trail_length_percent numeric(8,4) not null default 8,
  aura_stroke_width numeric(8,4) not null default 6,
  aura_head_radius numeric(8,4) not null default 9,
  aura_bloom_intensity numeric(8,4) not null default 4.5,
  aura_fade_duration_ms integer not null default 180,
  aura_color_start text not null default '#7C3AED',
  aura_color_mid text not null default '#A78BFA',
  aura_color_peak text not null default '#E9D5FF',
  aura_color_head text not null default '#FFFFFF',
  aura_min_targets integer not null default 2,
  aura_max_targets integer not null default 4,
  notifications_enabled boolean not null default true,
  daily_goal_notification boolean not null default true,
  goal_notification_sound boolean not null default true,
  notification_volume numeric(5,4) not null default 0.7,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.user_settings drop constraint if exists user_settings_default_account_id_fkey;
alter table public.user_settings add constraint user_settings_default_account_id_fkey foreign key (default_account_id) references public.accounts(id) on delete set null;

create or replace function public.create_user_settings()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_settings on auth.users;
create trigger on_auth_user_created_settings
after insert on auth.users
for each row execute function public.create_user_settings();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at before update on public.user_settings
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.accounts enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings for select using (auth.uid() = user_id);
drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings for insert with check (auth.uid() = user_id);
drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own on public.accounts for select using (auth.uid() = user_id);
drop policy if exists accounts_insert_own on public.accounts;
create policy accounts_insert_own on public.accounts for insert with check (auth.uid() = user_id);
drop policy if exists accounts_update_own on public.accounts;
create policy accounts_update_own on public.accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists accounts_delete_own on public.accounts;
create policy accounts_delete_own on public.accounts for delete using (auth.uid() = user_id);
