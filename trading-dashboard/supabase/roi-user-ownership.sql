alter table public.roi_transactions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.roi_transactions transactions
set user_id = accounts.user_id
from public.accounts accounts
where transactions.account_id = accounts.id
  and transactions.user_id is null;

create index if not exists idx_roi_transactions_user_id
  on public.roi_transactions using btree (user_id);

alter table public.roi_transactions enable row level security;

drop policy if exists roi_transactions_select_own on public.roi_transactions;
create policy roi_transactions_select_own
on public.roi_transactions for select
using (auth.uid() = user_id);

drop policy if exists roi_transactions_insert_own on public.roi_transactions;
create policy roi_transactions_insert_own
on public.roi_transactions for insert
with check (auth.uid() = user_id);

drop policy if exists roi_transactions_update_own on public.roi_transactions;
create policy roi_transactions_update_own
on public.roi_transactions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists roi_transactions_delete_own on public.roi_transactions;
create policy roi_transactions_delete_own
on public.roi_transactions for delete
using (auth.uid() = user_id);
