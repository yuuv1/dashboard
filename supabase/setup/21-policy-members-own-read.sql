create policy ec_members_own_read on public.ec_members
  for select to authenticated
  using (device_id = (select auth.uid()));
