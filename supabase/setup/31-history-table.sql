-- 31 — Histórico (rede de segurança contra apagão acidental).
-- Guarda uma cópia de cada versão gravada em ec_operations, ec_user_state e
-- ec_shots. Fica fora do alcance de qualquer aparelho: só leitura pela
-- administração do projeto, e serve para desfazer exclusão em massa ou
-- recuperar uma operação alterada por engano.
create table if not exists public.ec_history (
  id bigserial primary key,
  owner_id uuid not null,
  table_name text not null,
  row_key text,
  old_row jsonb,
  new_row jsonb,
  at timestamptz not null default now()
);
