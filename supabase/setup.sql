-- EdgeControl Supabase setup
-- Run once in Supabase Dashboard > SQL Editor > New query.
-- Keep the prints bucket PRIVATE. The client must never use service_role.

do $ec_setup$
begin
create table if not exists public.ec_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint ec_user_state_payload_object check (jsonb_typeof(payload) = 'object')
);

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

create index if not exists ec_operations_user_updated_idx
  on public.ec_operations (user_id, updated_at desc);

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

create index if not exists ec_shots_user_updated_idx
  on public.ec_shots (user_id, updated_at desc);

-- Every authenticated user can access only rows bearing their own auth.uid().
alter table public.ec_user_state enable row level security;
alter table public.ec_operations enable row level security;
alter table public.ec_shots enable row level security;

drop policy if exists ec_user_state_select_own on public.ec_user_state;
create policy ec_user_state_select_own on public.ec_user_state
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ec_user_state_insert_own on public.ec_user_state;
create policy ec_user_state_insert_own on public.ec_user_state
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists ec_user_state_update_own on public.ec_user_state;
create policy ec_user_state_update_own on public.ec_user_state
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ec_user_state_delete_own on public.ec_user_state;
create policy ec_user_state_delete_own on public.ec_user_state
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists ec_operations_select_own on public.ec_operations;
create policy ec_operations_select_own on public.ec_operations
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ec_operations_insert_own on public.ec_operations;
create policy ec_operations_insert_own on public.ec_operations
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists ec_operations_update_own on public.ec_operations;
create policy ec_operations_update_own on public.ec_operations
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ec_operations_delete_own on public.ec_operations;
create policy ec_operations_delete_own on public.ec_operations
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists ec_shots_select_own on public.ec_shots;
create policy ec_shots_select_own on public.ec_shots
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ec_shots_insert_own on public.ec_shots;
create policy ec_shots_insert_own on public.ec_shots
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists ec_shots_update_own on public.ec_shots;
create policy ec_shots_update_own on public.ec_shots
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ec_shots_delete_own on public.ec_shots;
create policy ec_shots_delete_own on public.ec_shots
  for delete to authenticated using (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.ec_user_state to authenticated;
grant select, insert, update, delete on public.ec_operations to authenticated;
grant select, insert, update, delete on public.ec_shots to authenticated;

-- Private object bucket for original print images. The first folder in each
-- object path is the authenticated user's UUID: <user_id>/<shot_id>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'edgecontrol-prints',
  'edgecontrol-prints',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ec_prints_read_own on storage.objects;
create policy ec_prints_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
drop policy if exists ec_prints_upload_own on storage.objects;
create policy ec_prints_upload_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
drop policy if exists ec_prints_update_own on storage.objects;
create policy ec_prints_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
drop policy if exists ec_prints_delete_own on storage.objects;
create policy ec_prints_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'edgecontrol-prints'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
end;
$ec_setup$;
