-- Shared updated_at trigger function used by the trading dashboard tables.
-- The live DB already has this (all existing table_*.sql triggers call it),
-- but defining it in-repo keeps migrations self-contained and idempotent
-- (create or replace is safe: it re-creates the same behavior).
--
-- Apply order: run this file BEFORE any table_*.sql that creates triggers.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;