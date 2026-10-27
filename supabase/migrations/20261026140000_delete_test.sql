-- =============================================================================
-- Delete a test
--
-- Admins can permanently remove a test together with its sections, questions
-- and assignments, but only while no student has attempted it. Once attempts
-- exist the results are part of the record, so the test must be archived
-- instead of deleted.
--
-- The function returns the question image paths so the caller can remove the
-- files from the question-images bucket once the rows are gone.
-- =============================================================================

create or replace function public.delete_test(p_test_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_images text[];
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.tests where id = p_test_id for update;
  if not found then
    raise exception 'Test not found.' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.attempts where test_id = p_test_id) then
    raise exception 'This test has attempts and cannot be deleted. Archive it instead.'
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(distinct image_path), '{}'::text[])
  into v_images
  from (
    select q.image_path
    from public.questions q
    join public.sections s on s.id = q.section_id
    where s.test_id = p_test_id
      and q.image_path is not null
    union
    select option_data ->> 'image_path'
    from public.questions q
    join public.sections s on s.id = q.section_id
    cross join lateral jsonb_array_elements(q.options) as option_data
    where s.test_id = p_test_id
      and coalesce(option_data ->> 'image_path', '') <> ''
  ) images;

  delete from public.tests where id = p_test_id;

  return v_images;
end;
$$;

grant execute on function public.delete_test(uuid) to authenticated;
