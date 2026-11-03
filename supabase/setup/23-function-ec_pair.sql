create or replace function public.ec_pair(p_code text, p_pin text)
returns uuid language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_device uuid := auth.uid();
  v_owner uuid;
  v_fails int;
begin
  if v_device is null then raise exception 'sem sessao no aparelho'; end if;
  delete from public.ec_pair_tries where at < now() - interval '1 hour';
  select count(*) into v_fails from public.ec_pair_tries
   where device_id = v_device and ok = false and at > now() - interval '15 minutes';
  if v_fails >= 10 then raise exception 'muitas tentativas: aguarde 15 minutos'; end if;
  select a.owner_id into v_owner from public.ec_accounts a
   where upper(a.code) = upper(btrim(coalesce(p_code, '')))
     and a.pin_hash = extensions.crypt(coalesce(p_pin, ''), a.pin_hash);
  insert into public.ec_pair_tries(device_id, ok) values (v_device, v_owner is not null);
  if v_owner is null then raise exception 'codigo ou PIN invalido'; end if;
  insert into public.ec_members(device_id, owner_id) values (v_device, v_owner) on conflict do nothing;
  return v_owner;
end;
$$;
