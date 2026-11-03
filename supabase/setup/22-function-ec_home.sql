create or replace function public.ec_home()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select m.owner_id from public.ec_members m where m.device_id = auth.uid() limit 1;
$$;
