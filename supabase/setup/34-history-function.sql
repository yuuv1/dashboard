-- 34 — Função única para as três tabelas: grava a linha anterior e a nova.
create or replace function public.ec_log_history() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_key text;
  v_old jsonb := null;
  v_new jsonb := null;
begin
  if (tg_op <> 'INSERT') then v_old := to_jsonb(old); end if;
  if (tg_op <> 'DELETE') then v_new := to_jsonb(new); end if;
  v_owner := coalesce((v_new->>'user_id')::uuid, (v_old->>'user_id')::uuid);
  v_key := coalesce(v_new->>'operation_id', v_new->>'shot_id', v_old->>'operation_id', v_old->>'shot_id', 'estado');
  insert into public.ec_history (owner_id, table_name, row_key, old_row, new_row)
  values (v_owner, tg_table_name, v_key, v_old, v_new);
  return null;
end
$$;
