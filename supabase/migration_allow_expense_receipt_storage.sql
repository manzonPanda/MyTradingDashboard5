drop policy if exists "Users can upload own expense images" on storage.objects;
drop policy if exists "Users can view own expense images" on storage.objects;
drop policy if exists "Users can delete own expense images" on storage.objects;

create policy "Users can upload own expense images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'certificates'
  and name like ((select auth.uid()::text) || '-%/expenses/%')
);

create policy "Users can view own expense images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'certificates'
  and name like ((select auth.uid()::text) || '-%/expenses/%')
);

create policy "Users can delete own expense images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'certificates'
  and name like ((select auth.uid()::text) || '-%/expenses/%')
);
