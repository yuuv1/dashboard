create table if not exists public.ec_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);
