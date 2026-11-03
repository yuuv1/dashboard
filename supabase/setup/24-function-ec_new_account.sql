create or replace function public.ec_new_account(p_pin text)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_code text;
begin
  if v_owner is null then raise exception 'sem sessao'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then raise exception 'o PIN precisa ter 6 numeros'; end if;
  select a.code into v_code from public.ec_accounts a where a.owner_id = v_owner;
  if v_code is null then
    loop
      v_code := 'EC-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4)) || '-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4));
      exit when not exists (select 1 from public.ec_accounts where code = v_code);
    end loop;
  end if;
  insert into public.ec_accounts(owner_id, code, pin_hash)
    values (v_owner, v_code, extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (owner_id) do update set pin_hash = excluded.pin_hash;
  insert into public.ec_members(device_id, owner_id) values (v_owner, v_owner) on conflict do nothing;
  return v_code;
end;
$$;
