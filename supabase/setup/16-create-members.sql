create table if not exists public.ec_members (
  device_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references public.ec_accounts(owner_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, owner_id)
);
