create table if not exists public.ec_shots (
  user_id uuid not null references auth.users(id) on delete cascade,
  shot_id text not null,
  object_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  sha256 text not null default '',
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, shot_id),
  constraint ec_shots_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ec_shots_id_nonempty check (length(shot_id) > 0),
  constraint ec_shots_path_owned check (object_path like user_id::text || '/%')
);
