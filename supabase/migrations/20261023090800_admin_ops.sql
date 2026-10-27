-- =============================================================================
-- Meridian — admin operations
-- =============================================================================

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;

  perform public.sweep_expired_attempts();

  select jsonb_build_object(
    'active_students', (
      select count(*) from public.profiles where role = 'student' and is_active
    ),
    'total_students', (
      select count(*) from public.profiles where role = 'student'
    ),
    'total_tests', (select count(*) from public.tests),
    'published_tests', (select count(*) from public.tests where status = 'published'),
    'completed_attempts', (
      select count(*) from public.attempts where status <> 'in_progress'
    ),
    'in_progress_attempts', (
      select count(*) from public.attempts where status = 'in_progress'
    ),
    'pending_review', (
      select count(*) from public.attempts where status = 'submitted'
    ),
    'pending_assignments', (
      select count(*)
      from public.test_assignments ta
      join public.tests t on t.id = ta.test_id
      where t.status = 'published'
        and not exists (
          select 1 from public.attempts a
          where a.assignment_id = ta.id and a.status <> 'in_progress'
        )
        and (
          least(ta.due_at, t.end_at) is null
          or least(ta.due_at, t.end_at) > now()
        )
    ),
    'recent_submissions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'attempt_id', r.id,
            'student_id', r.student_id,
            'student_name', r.full_name,
            'username', r.username,
            'test_id', r.test_id,
            'test_title', r.title,
            'status', r.status,
            'score', r.score,
            'max_marks', r.max_marks,
            'submitted_at', r.submitted_at
          ) order by r.submitted_at desc
        )
        from (
          select
            a.id, a.student_id, p.full_name, p.username,
            a.test_id, t.title, a.status, a.score, a.max_marks, a.submitted_at
          from public.attempts a
          join public.profiles p on p.id = a.student_id
          join public.tests t on t.id = a.test_id
          where a.status <> 'in_progress'
          order by a.submitted_at desc
          limit 8
        ) r
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.assign_test(
  p_test_id uuid,
  p_student_ids uuid[],
  p_due_at timestamptz default null,
  p_attempt_limit integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;
  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'Select at least one student.' using errcode = 'check_violation';
  end if;
  if p_due_at is not null and p_due_at <= now() then
    raise exception 'The assignment deadline must be in the future.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.tests where id = p_test_id and status = 'published'
  ) then
    raise exception 'Only published tests can be assigned.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.profiles
    where id = any (p_student_ids)
      and (role <> 'student' or is_active is not true)
  ) then
    raise exception 'Tests can only be assigned to active students.'
      using errcode = 'check_violation';
  end if;

  insert into public.test_assignments (test_id, student_id, assigned_by, due_at, attempt_limit)
  select p_test_id, student_id, v_uid, p_due_at, p_attempt_limit
  from (select distinct unnest(p_student_ids) as student_id) selected
  on conflict (test_id, student_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.duplicate_test(p_test_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_src public.tests%rowtype;
  v_new_test uuid;
  v_new_section uuid;
  v_section record;
  v_question record;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_src from public.tests where id = p_test_id;
  if not found then
    raise exception 'Test not found.' using errcode = 'no_data_found';
  end if;

  insert into public.tests (
    title, description, instructions, duration_minutes, max_marks,
    passing_marks, attempt_limit, start_at, end_at, status, show_results,
    created_by
  )
  values (
    left('Copy of ' || v_src.title, 200),
    v_src.description,
    v_src.instructions,
    v_src.duration_minutes,
    0,
    v_src.passing_marks,
    v_src.attempt_limit,
    v_src.start_at,
    v_src.end_at,
    'draft',
    v_src.show_results,
    v_uid
  )
  returning id into v_new_test;

  for v_section in
    select * from public.sections where test_id = p_test_id order by position
  loop
    insert into public.sections (test_id, title, description, position)
    values (v_new_test, v_section.title, v_section.description, v_section.position)
    returning id into v_new_section;

    for v_question in
      select * from public.questions where section_id = v_section.id order by position
    loop
      insert into public.questions (
        section_id, question_type, prompt, image_path, marks, is_required,
        options, correct_options, answer_key, explanation, position
      )
      values (
        v_new_section, v_question.question_type, v_question.prompt,
        v_question.image_path, v_question.marks, v_question.is_required,
        v_question.options, v_question.correct_options, v_question.answer_key,
        v_question.explanation, v_question.position
      );
    end loop;
  end loop;

  perform public.recalculate_test_marks(v_new_test);
  return v_new_test;
end;
$$;

create or replace function public.set_test_status(
  p_test_id uuid,
  p_status public.test_status
)
returns public.test_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.test_status;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;

  update public.tests
  set status = p_status
  where id = p_test_id
  returning status into v_status;

  if v_status is null then
    raise exception 'Test not found.' using errcode = 'no_data_found';
  end if;

  return v_status;
end;
$$;

create or replace function public.reorder_sections(
  p_test_id uuid,
  p_section_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.tests where id = p_test_id) then
    raise exception 'Test not found.' using errcode = 'no_data_found';
  end if;
  if coalesce(array_length(p_section_ids, 1), 0) <> (
      select count(*) from public.sections where test_id = p_test_id
    )
    or exists (
      select 1 from public.sections
      where test_id = p_test_id and id <> all (p_section_ids)
    ) then
    raise exception 'Section order is out of date. Reload and try again.'
      using errcode = 'check_violation';
  end if;

  update public.sections s
  set position = ordered.ord - 1
  from unnest(p_section_ids) with ordinality as ordered(id, ord)
  where s.id = ordered.id and s.test_id = p_test_id;
end;
$$;

create or replace function public.reorder_questions(
  p_section_id uuid,
  p_question_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.sections where id = p_section_id) then
    raise exception 'Section not found.' using errcode = 'no_data_found';
  end if;
  if coalesce(array_length(p_question_ids, 1), 0) <> (
      select count(*) from public.questions where section_id = p_section_id
    )
    or exists (
      select 1 from public.questions
      where section_id = p_section_id and id <> all (p_question_ids)
    ) then
    raise exception 'Question order is out of date. Reload and try again.'
      using errcode = 'check_violation';
  end if;

  update public.questions q
  set position = ordered.ord - 1
  from unnest(p_question_ids) with ordinality as ordered(id, ord)
  where q.id = ordered.id and q.section_id = p_section_id;
end;
$$;
