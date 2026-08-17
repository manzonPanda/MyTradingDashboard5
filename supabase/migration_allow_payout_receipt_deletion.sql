drop policy if exists "Users can delete own payout receipts" on storage.objects;

create policy "Users can delete own payout receipts"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'certificates'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and (storage.foldername(name))[3] = 'payouts'
);
