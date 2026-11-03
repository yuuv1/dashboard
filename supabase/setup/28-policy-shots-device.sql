alter policy ec_shots_own on public.ec_shots
  using (user_id = (select auth.uid()) or exists (select 1 from public.ec_members m where m.device_id = (select auth.uid()) and m.owner_id = user_id))
  with check (user_id = (select auth.uid()) or exists (select 1 from public.ec_members m where m.device_id = (select auth.uid()) and m.owner_id = user_id));
