create policy ec_prints_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
