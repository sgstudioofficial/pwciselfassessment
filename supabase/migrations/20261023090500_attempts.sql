-- =============================================================================
-- Meridian — attempt lifecycle (trusted server-side RPCs)
-- The browser never writes attempts, responses or scores directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helper. SECURITY DEFINER avoids recursive RLS evaluation on
-- profiles when this function is used inside a profiles policy.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active
  );
$$;

-- -----------------------------------------------------------------------------
-- The hard deadline for an attempt is the earliest of:
--   * start + the test duration (null for untimed tests)
--   * the test's own end date
--   * the assignment due date
-- LEAST() ignores null arguments, so untimed tests simply use the window.
-- -----------------------------------------------------------------------------
create or replace function public.attempt_deadline(p_attempt_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select least(
    a.started_at + make_interval(mins => t.duration_minutes),
    t.end_at,
    ta.due_at
  )
  from public.attempts a
  join public.tests t on t.id = a.test_id
  join public.test_assignments ta on ta.id = a.assignment_id
  where a.id = p_attempt_id;
$$;

-- -----------------------------------------------------------------------------
-- Grade and close one in-progress attempt. Idempotent and only callable from
-- other SECURITY DEFINER functions (execute is revoked from all client roles).
-- Objective answers are scored here; non-empty short answers wait for an admin.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_attempt_internal(
  p_attempt_id uuid,
  p_at timestamptz
)
returns public.attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.attempts%rowtype;
  v_row record;
  v_correct boolean;
  v_pending integer := 0;
  v_score numeric := 0;
  v_closed_at timestamptz := least(coalesce(p_at, now()), now());
begin
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id
  for update;

  if not found or v_attempt.status <> 'in_progress' then
    return v_attempt;
  end if;

  -- Materialize a response row for every unanswered question so results and
  -- section totals are complete even when the student skipped questions.
  insert into public.responses (attempt_id, question_id, answered_at)
  select v_attempt.id, q.id, v_closed_at
  from public.sections s
  join public.questions q on q.section_id = s.id
  where s.test_id = v_attempt.test_id
    and not exists (
      select 1 from public.responses r
      where r.attempt_id = v_attempt.id and r.question_id = q.id
    )
  on conflict (attempt_id, question_id) do nothing;

  for v_row in
    select
      q.id as question_id,
      q.question_type,
      q.marks,
      q.correct_options,
      coalesce(r.selected_options, '{}'::text[]) as selected_options,
      r.text_answer,
      r.id as response_id,
      r.awarded_marks
    from public.sections s
    join public.questions q on q.section_id = s.id
    left join public.responses r
      on r.attempt_id = v_attempt.id and r.question_id = q.id
    where s.test_id = v_attempt.test_id
  loop
    if v_row.question_type = 'short_answer' then
      -- Blank short answers are objectively worth zero; only non-empty answers
      -- require human review.
      if btrim(coalesce(v_row.text_answer, '')) = ''
        and v_row.awarded_marks is null then
        update public.responses
        set awarded_marks = 0,
            is_correct = false,
            graded_at = v_closed_at
        where id = v_row.response_id;
      end if;
    elsif v_row.awarded_marks is null then
      v_correct :=
        coalesce(array_length(v_row.selected_options, 1), 0) > 0
        and (
          select array_agg(option_id order by option_id)
          from unnest(v_row.selected_options) as option_id
        ) = (
          select array_agg(option_id order by option_id)
          from unnest(v_row.correct_options) as option_id
        );

      update public.responses
      set awarded_marks = case when v_correct then v_row.marks else 0 end,
          is_correct = v_correct,
          graded_at = v_closed_at
      where id = v_row.response_id;
    end if;
  end loop;

  select count(*) into v_pending
  from public.responses
  where attempt_id = v_attempt.id
    and awarded_marks is null;

  select coalesce(sum(awarded_marks), 0) into v_score
  from public.responses
  where attempt_id = v_attempt.id;

  update public.attempts
  set status = case when v_pending = 0 then 'graded'::public.attempt_status
                    else 'submitted'::public.attempt_status end,
      score = v_score,
      submitted_at = v_closed_at,
      graded_at = case when v_pending = 0 then v_closed_at else null end,
      time_taken_seconds = greatest(
        0,
        floor(extract(epoch from (v_closed_at - v_attempt.started_at)))::integer
      )
  where id = v_attempt.id
  returning * into v_attempt;

  return v_attempt;
end;
$$;

-- Finalize any open attempts whose deadline has passed. Used by student reads
-- and the admin dashboard; safe to call repeatedly. Optional pg_cron scheduling
-- is documented in the README for fully hands-off expiry.
create or replace function public.sweep_expired_attempts(p_student_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
  v_deadline timestamptz;
begin
  for v_row in
    select a.id
    from public.attempts a
    join public.tests t on t.id = a.test_id
    join public.test_assignments ta on ta.id = a.assignment_id
    where a.status = 'in_progress'
      and (p_student_id is null or a.student_id = p_student_id)
      and least(
        a.started_at + make_interval(mins => t.duration_minutes),
        t.end_at,
        ta.due_at
      ) <= now()
  loop
    v_deadline := public.attempt_deadline(v_row.id);
    perform public.finalize_attempt_internal(v_row.id, v_deadline);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Start or resume an attempt. All eligibility rules are enforced here.
-- -----------------------------------------------------------------------------
create or replace function public.start_attempt(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.test_assignments%rowtype;
  v_test public.tests%rowtype;
  v_profile record;
  v_existing uuid;
  v_open_id uuid;
  v_used integer;
  v_limit integer;
  v_deadline timestamptz;
  v_max_marks numeric;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_assignment
  from public.test_assignments
  where id = p_assignment_id
  for update;

  if not found or v_assignment.student_id <> v_uid then
    raise exception 'Assignment not found.' using errcode = 'no_data_found';
  end if;

  select role, is_active into v_profile
  from public.profiles where id = v_uid;

  if v_profile.role is distinct from 'student' or v_profile.is_active is not true then
    raise exception 'Your account is not active.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_test from public.tests where id = v_assignment.test_id;
  if v_test.status is distinct from 'published' then
    raise exception 'This test is not currently available.' using errcode = 'check_violation';
  end if;

  -- Reopen an existing in-progress attempt (refresh-safe).
  select id into v_open_id
  from public.attempts
  where assignment_id = v_assignment.id and status = 'in_progress'
  limit 1;

  if v_open_id is not null then
    perform public.sweep_expired_attempts(v_uid);
    select id into v_open_id
    from public.attempts
    where assignment_id = v_assignment.id and status = 'in_progress'
    limit 1;
    if v_open_id is not null then
      return v_open_id;
    end if;
  end if;

  perform public.sweep_expired_attempts(v_uid);

  v_deadline := least(v_test.end_at, v_assignment.due_at);
  if v_deadline is not null and v_deadline <= now() then
    raise exception 'This assignment has expired.' using errcode = 'check_violation';
  end if;
  if v_test.start_at is not null and now() < v_test.start_at then
    raise exception 'This test is not open yet.' using errcode = 'check_violation';
  end if;

  select count(*) into v_used
  from public.attempts
  where assignment_id = v_assignment.id;

  v_limit := coalesce(v_assignment.attempt_limit, v_test.attempt_limit);
  if v_used >= v_limit then
    raise exception 'You have used all % attempt(s) for this test.', v_limit
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(q.marks), 0) into v_max_marks
  from public.sections s
  join public.questions q on q.section_id = s.id
  where s.test_id = v_test.id;

  if v_max_marks <= 0 then
    raise exception 'This test has no questions.' using errcode = 'check_violation';
  end if;

  insert into public.attempts (
    assignment_id,
    test_id,
    student_id,
    attempt_number,
    status,
    max_marks,
    due_at
  )
  values (
    v_assignment.id,
    v_test.id,
    v_uid,
    v_used + 1,
    'in_progress',
    v_max_marks,
    v_assignment.due_at
  )
  returning id into v_new_id;

  return v_new_id;
exception
  when unique_violation then
    -- Two concurrent starts: return the attempt that won the race.
    select id into v_existing
    from public.attempts
    where assignment_id = p_assignment_id and status = 'in_progress'
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

-- -----------------------------------------------------------------------------
-- Persist a single answer (autosave or explicit save). Returns the server time
-- and the attempt status; if the deadline has just passed the attempt is closed
-- and the answer is not accepted.
-- -----------------------------------------------------------------------------
create or replace function public.save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_options text[] default '{}',
  p_text_answer text default null,
  p_is_flagged boolean default null
)
returns table (server_now timestamptz, attempt_status public.attempt_status)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_question public.questions%rowtype;
  v_deadline timestamptz;
  v_active boolean;
  v_selected text[] := coalesce(p_selected_options, '{}'::text[]);
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select is_active into v_active from public.profiles where id = v_uid;
  if v_active is not true then
    raise exception 'Your account is not active.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id
  for update;

  if not found or v_attempt.student_id <> v_uid then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;

  if v_attempt.status <> 'in_progress' then
    return query select now(), v_attempt.status;
    return;
  end if;

  v_deadline := public.attempt_deadline(v_attempt.id);
  if v_deadline is not null and now() >= v_deadline then
    v_attempt := public.finalize_attempt_internal(v_attempt.id, v_deadline);
    return query select now(), v_attempt.status;
    return;
  end if;

  select q.* into v_question
  from public.questions q
  join public.sections s on s.id = q.section_id
  where q.id = p_question_id and s.test_id = v_attempt.test_id;

  if not found then
    raise exception 'Question does not belong to this attempt.' using errcode = 'check_violation';
  end if;

  if v_question.question_type = 'short_answer' then
    v_selected := '{}'::text[];
  else
    if exists (
      select 1
      from unnest(v_selected) as selected_id
      where not exists (
        select 1 from jsonb_array_elements(v_question.options) as option
        where option ->> 'id' = selected_id
      )
    ) then
      raise exception 'One or more selected answers are invalid.' using errcode = 'check_violation';
    end if;

    if v_question.question_type in ('single_choice', 'true_false')
      and coalesce(array_length(v_selected, 1), 0) > 1 then
      raise exception 'This question accepts only one answer.' using errcode = 'check_violation';
    end if;
  end if;

  if p_text_answer is not null and char_length(p_text_answer) > 10000 then
    raise exception 'Your answer is too long (10,000 character limit).'
      using errcode = 'check_violation';
  end if;

  insert into public.responses (
    attempt_id,
    question_id,
    selected_options,
    text_answer,
    is_flagged,
    answered_at
  )
  values (
    v_attempt.id,
    p_question_id,
    v_selected,
    case when v_question.question_type = 'short_answer' then p_text_answer else null end,
    coalesce(p_is_flagged, false),
    now()
  )
  on conflict (attempt_id, question_id) do update
  set selected_options = excluded.selected_options,
      text_answer = excluded.text_answer,
      is_flagged = coalesce(p_is_flagged, public.responses.is_flagged),
      answered_at = now();

  return query select now(), v_attempt.status;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submit. Idempotent: calling it twice can never create a duplicate result.
-- A submission after the deadline is finalised at the deadline, not at the
-- time of the late request, so extra time cannot be gained by a stale client.
-- -----------------------------------------------------------------------------
create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_deadline timestamptz;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id
  for update;

  if not found or v_attempt.student_id <> v_uid then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;

  if v_attempt.status <> 'in_progress' then
    return v_attempt;
  end if;

  v_deadline := public.attempt_deadline(v_attempt.id);

  if v_deadline is not null and now() >= v_deadline then
    return public.finalize_attempt_internal(v_attempt.id, v_deadline);
  end if;

  return public.finalize_attempt_internal(v_attempt.id, now());
end;
$$;

-- -----------------------------------------------------------------------------
-- Full state for the test-taking screen. Contains no answer keys.
-- -----------------------------------------------------------------------------
create or replace function public.get_attempt_state(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_test public.tests%rowtype;
  v_deadline timestamptz;
  v_now timestamptz := now();
  v_active boolean;
  v_sections jsonb;
  v_responses jsonb;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  select is_active into v_active from public.profiles where id = v_uid;
  if v_active is not true then
    raise exception 'Your account is not active.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found or v_attempt.student_id <> v_uid then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;

  v_deadline := public.attempt_deadline(v_attempt.id);
  if v_attempt.status = 'in_progress'
    and v_deadline is not null
    and v_now >= v_deadline then
    v_attempt := public.finalize_attempt_internal(v_attempt.id, v_deadline);
  end if;

  select * into v_test from public.tests where id = v_attempt.test_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'description', s.description,
        'position', s.position,
        'questions', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', q.id,
                'question_type', q.question_type,
                'prompt', q.prompt,
                'image_path', q.image_path,
                'marks', q.marks,
                'is_required', q.is_required,
                'options', q.options,
                'position', q.position
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
  where s.test_id = v_attempt.test_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', r.question_id,
        'selected_options', r.selected_options,
        'text_answer', r.text_answer,
        'is_flagged', r.is_flagged,
        'answered_at', r.answered_at
      )
    ),
    '[]'::jsonb
  ) into v_responses
  from public.responses r
  where r.attempt_id = v_attempt.id;

  return jsonb_build_object(
    'server_now', v_now,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'score', case when v_test.show_results then v_attempt.score else null end,
      'max_marks', v_attempt.max_marks,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'time_taken_seconds', v_attempt.time_taken_seconds,
      'attempt_number', v_attempt.attempt_number,
      'deadline_at', v_deadline,
      'seconds_remaining', case
        when v_deadline is null then null
        else greatest(0, floor(extract(epoch from (v_deadline - v_now)))::integer)
      end
    ),
    'test', jsonb_build_object(
      'id', v_test.id,
      'title', v_test.title,
      'description', v_test.description,
      'instructions', v_test.instructions,
      'duration_minutes', v_test.duration_minutes,
      'show_results', v_test.show_results
    ),
    'sections', v_sections,
    'responses', v_responses
  );
end;
$$;
