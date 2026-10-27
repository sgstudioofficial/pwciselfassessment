-- =============================================================================
-- Meridian — question image storage
-- Public read (question images are not sensitive); writes are admin-only.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Question images are readable by authenticated users"
on storage.objects for select
to authenticated
using (bucket_id = 'question-images');

create policy "Admins can upload question images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'question-images' and public.is_admin());

create policy "Admins can replace question images"
on storage.objects for update
to authenticated
using (bucket_id = 'question-images' and public.is_admin())
with check (bucket_id = 'question-images' and public.is_admin());

create policy "Admins can delete question images"
on storage.objects for delete
to authenticated
using (bucket_id = 'question-images' and public.is_admin());
