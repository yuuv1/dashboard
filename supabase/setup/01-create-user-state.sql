create table if not exists public.ec_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint ec_user_state_payload_object check (jsonb_typeof(payload) = 'object')
);
