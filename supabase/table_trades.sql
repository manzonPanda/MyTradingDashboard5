create table public.trades (
  id uuid not null default gen_random_uuid (),
  buy_sell text null,
  commission numeric null,
  daily_reflection text null default ''::text,
  time_open timestamp without time zone null,
  time_close timestamp without time zone null,
  instrument text null,
  lots numeric null,
  pips numeric null,
  pnl numeric null,
  rules_violated text null default ''::text,
  weekly_retrospective text null default ''::text,
  mfe numeric null,
  price_close numeric null,
  price_open numeric null,
  risk_per_trade numeric null,
  rrr text null,
  sl numeric null,
  swap numeric null,
  ticket numeric null,
  tp numeric null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  held text null,
  account_id uuid null,
  mae numeric null,
  time_open_ph timestamp without time zone null,
  time_close_ph timestamp without time zone null,
  constraint trades_pkey primary key (id),
  constraint trades_account_id_fkey foreign KEY (account_id) references accounts (id),
  constraint trades_buy_sell_check check (
    (buy_sell = any (array['Buy'::text, 'Sell'::text]))
  )
) TABLESPACE pg_default;

create index IF not exists idx_trades_instrument on public.trades using btree (instrument) TABLESPACE pg_default;

create index IF not exists idx_trades_ticket on public.trades using btree (ticket) TABLESPACE pg_default;

create unique INDEX IF not exists idx_trades_ticket_unique on public.trades using btree (ticket) TABLESPACE pg_default
where
  (ticket is not null);

create index IF not exists idx_trades_date_start on public.trades using btree (time_open) TABLESPACE pg_default;

create index IF not exists idx_trades_time_open_ph on public.trades using btree (time_open_ph) TABLESPACE pg_default;

create index IF not exists idx_trades_time_close_ph on public.trades using btree (time_close_ph) TABLESPACE pg_default;

create trigger trg_trades_updated_at BEFORE
update on trades for EACH row
execute FUNCTION handle_updated_at ();