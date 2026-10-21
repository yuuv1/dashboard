create table if not exists public.ec_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, operation_id),
  constraint ec_operations_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint ec_operations_id_nonempty check (length(operation_id) > 0)
);
