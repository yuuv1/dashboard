create or replace function public.ec_code()
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select a.code from public.ec_accounts a where a.owner_id = auth.uid();
$$;
