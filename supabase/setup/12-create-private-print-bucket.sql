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
