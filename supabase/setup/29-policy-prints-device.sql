alter policy ec_prints_own on storage.objects
  using (bucket_id = 'edgecontrol-prints' and ((storage.foldername(name))[1] = (select auth.uid()::text) or (storage.foldername(name))[1] in (select m.owner_id::text from public.ec_members m where m.device_id = (select auth.uid()))))
  with check (bucket_id = 'edgecontrol-prints' and ((storage.foldername(name))[1] = (select auth.uid()::text) or (storage.foldername(name))[1] in (select m.owner_id::text from public.ec_members m where m.device_id = (select auth.uid()))));
