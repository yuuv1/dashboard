create table if not exists public.ec_pair_tries (
  id bigserial primary key,
  device_id uuid not null,
  ok boolean not null default false,
  at timestamptz not null default now()
);
