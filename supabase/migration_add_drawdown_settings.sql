-- Drawdown rule configuration for the existing accounts table.
-- Only CONFIGURATION lives here — the current calculated floor is derived at
-- runtime by the drawdown calculation engine from trading data.
alter table public.accounts
  add column if not exists drawdown_mode text not null default 'fixed',
  add column if not exists drawdown_basis text not null default 'balance',
  add column if not exists drawdown_stop_at_initial_balance boolean not null default false,
  add column if not exists drawdown_eod_timezone text not null default 'America/New_York';

-- Allowed drawdown rule types (no separate lock mode: the initial-balance stop
-- is a behavior of any trailing mode, configured via drawdown_stop_at_initial_balance).
alter table public.accounts drop constraint if exists accounts_drawdown_mode_check;
alter table public.accounts
  add constraint accounts_drawdown_mode_check
  check (
    drawdown_mode = any (
      array[
        'fixed'::text,
        'intraday_trailing'::text,
        'balance_trailing'::text,
        'eod_trailing'::text
      ]
    )
  );

-- Trailing / EOD basis (realized balance vs. equity).
alter table public.accounts drop constraint if exists accounts_drawdown_basis_check;
alter table public.accounts
  add constraint accounts_drawdown_basis_check
  check (
    drawdown_basis = any (
      array['balance'::text, 'equity'::text]
    )
  );
