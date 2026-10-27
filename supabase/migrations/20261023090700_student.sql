-- =============================================================================
-- Meridian — student read models (no answer keys before submission)
-- =============================================================================

create or replace function public.get_student_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile record;
  v_assignments jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select role, is_active into v_profile from public.profiles where id = v_uid;
  if v_profile.role is distinct from 'student' or v_profile.is_active is not true then
    raise exception 'Your account is not active.' using errcode = 'insufficient_privilege';
  end if;

  perform public.sweep_expired_attempts(v_uid);

  select coalesce(
    jsonb_agg(assignment_json order by sort_key),
    '[]'::jsonb
  ) into v_assignments
  from (
    select
      t.title as sort_key,
      jsonb_build_object(
        'assignment_id', ta.id,
        'test_id', t.id,
        'title', t.title,
        'description', t.description,
        'instructions', t.instructions,
        'duration_minutes', t.duration_minutes,
        'max_marks', t.max_marks,
        'passing_marks', t.passing_marks,
        'attempt_limit', coalesce(ta.attempt_limit, t.attempt_limit),
        'attempts_used', agg.used_count,
        'submitted_count', agg.submitted_count,
        'open_attempt_id', agg.open_id,
        'last_attempt', agg.last_attempt,
        'start_at', t.start_at,
        'end_at', t.end_at,
        'due_at', ta.due_at,
        'show_results', t.show_results,
        'published', t.status = 'published',
        'can_start', (
          t.status = 'published'
          and agg.open_id is null
          and (t.start_at is null or t.start_at <= now())
          and (least(ta.due_at, t.end_at) is null or least(ta.due_at, t.end_at) > now())
          and agg.used_count < coalesce(ta.attempt_limit, t.attempt_limit)
        ),
        'status', case
          when t.status <> 'published' then 'unavailable'
          when agg.open_id is not null then 'in_progress'
          when agg.submitted_count > 0
            and (
              agg.used_count >= coalesce(ta.attempt_limit, t.attempt_limit)
              or (least(ta.due_at, t.end_at) is not null and least(ta.due_at, t.end_at) <= now())
            ) then 'completed'
          when t.start_at is not null and t.start_at > now() then 'upcoming'
          when least(ta.due_at, t.end_at) is not null and least(ta.due_at, t.end_at) <= now()
            then 'expired'
          when agg.used_count >= coalesce(ta.attempt_limit, t.attempt_limit) then 'completed'
          else 'available'
        end
      ) as assignment_json
    from public.test_assignments ta
    join public.tests t on t.id = ta.test_id
    left join lateral (
      select
        count(*)::integer as used_count,
        count(*) filter (where a.status <> 'in_progress')::integer as submitted_count,
        (array_agg(a.id) filter (where a.status = 'in_progress'))[1] as open_id,
        (
          select jsonb_build_object(
            'attempt_id', la.id,
            'score', case when t.show_results then la.score else null end,
            'max_marks', la.max_marks,
            'status', la.status,
            'submitted_at', la.submitted_at,
            'attempt_number', la.attempt_number
          )
          from public.attempts la
          where la.assignment_id = ta.id
            and la.status <> 'in_progress'
          order by la.attempt_number desc
          limit 1
        ) as last_attempt
      from public.attempts a
      where a.assignment_id = ta.id
    ) agg on true
    where ta.student_id = v_uid
  ) rows;

  return jsonb_build_object(
    'server_now', now(),
    'assignments', v_assignments
  );
end;
$$;

create or replace function public.get_my_results()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_results jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attempt_id', a.id,
        'test_id', t.id,
        'test_title', t.title,
        'attempt_number', a.attempt_number,
        'status', a.status,
        'score', case when t.show_results then a.score else null end,
        'max_marks', a.max_marks,
        'passing_marks', t.passing_marks,
        'submitted_at', a.submitted_at,
        'time_taken_seconds', a.time_taken_seconds,
        'show_results', t.show_results,
        'needs_grading', a.status = 'submitted'
      ) order by a.submitted_at desc
    ),
    '[]'::jsonb
  ) into v_results
  from public.attempts a
  join public.tests t on t.id = a.test_id
  where a.student_id = v_uid
    and a.status <> 'in_progress';

  return jsonb_build_object('results', v_results);
end;
$$;

-- Post-submission review for the owning student. Answer keys are only included
-- when the admin has enabled result visibility for this test.
create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_test public.tests%rowtype;
  v_sections jsonb;
  v_pending integer;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found or v_attempt.student_id <> v_uid then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;
  if v_attempt.status = 'in_progress' then
    raise exception 'This attempt has not been submitted yet.' using errcode = 'check_violation';
  end if;

  select * into v_test from public.tests where id = v_attempt.test_id;

  if not v_test.show_results then
    return jsonb_build_object(
      'allowed', false,
      'attempt', jsonb_build_object(
        'id', v_attempt.id,
        'status', v_attempt.status,
        'submitted_at', v_attempt.submitted_at,
        'attempt_number', v_attempt.attempt_number
      ),
      'test', jsonb_build_object('id', v_test.id, 'title', v_test.title)
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'description', s.description,
        'position', s.position,
        'max_marks', coalesce(
          (select sum(q.marks) from public.questions q where q.section_id = s.id),
          0
        ),
        'score', coalesce(
          (
            select sum(r.awarded_marks)
            from public.questions q
            join public.responses r on r.question_id = q.id
            where q.section_id = s.id and r.attempt_id = v_attempt.id
          ),
          0
        ),
        'questions', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'question_type', q.question_type,
                'prompt', q.prompt,
                'image_path', q.image_path,
                'marks', q.marks,
                'options', q.options,
                'correct_options', to_jsonb(q.correct_options),
                'answer_key', q.answer_key,
                'explanation', q.explanation,
                'response', (
                  select jsonb_build_object(
                    'id', r.id,
                    'selected_options', r.selected_options,
                    'text_answer', r.text_answer,
                    'awarded_marks', r.awarded_marks,
                    'is_correct', r.is_correct,
                    'is_flagged', r.is_flagged,
                    'graded_at', r.graded_at
                  )
                  from public.responses r
                  where r.attempt_id = v_attempt.id and r.question_id = q.id
                )
              ) order by q.position
            )
            from public.questions q
            where q.section_id = s.id
          ),
          '[]'::jsonb
        )
      ) order by s.position
    ),
    '[]'::jsonb
  ) into v_sections
  from public.sections s
  where s.test_id = v_test.id;

  select count(*) into v_pending
  from public.responses
  where attempt_id = v_attempt.id and awarded_marks is null;

  return jsonb_build_object(
    'allowed', true,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'score', v_attempt.score,
      'max_marks', v_attempt.max_marks,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'time_taken_seconds', v_attempt.time_taken_seconds,
      'attempt_number', v_attempt.attempt_number
    ),
    'test', jsonb_build_object(
      'id', v_test.id,
      'title', v_test.title,
      'description', v_test.description,
      'passing_marks', v_test.passing_marks,
      'show_results', v_test.show_results
    ),
    'sections', v_sections,
    'totals', jsonb_build_object(
      'score', v_attempt.score,
      'max_marks', v_attempt.max_marks,
      'pending_manual', v_pending,
      'passed', coalesce(v_attempt.score, 0) >= v_test.passing_marks
    )
  );
end;
$$;

-- Called by the client after a successful Supabase password update. It can only
-- clear the caller's own flag; it cannot alter role, status or identity fields.
create or replace function public.complete_password_change()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
  set must_change_password = false
  where id = v_uid;

  return found;
end;
$$;
