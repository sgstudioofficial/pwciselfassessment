-- =============================================================================
-- Student-chosen answer feedback per attempt
--
-- Two modes, selected by the student before starting an attempt:
--   after_submit : correct answers are revealed only after the attempt is submitted
--   immediate    : each answer can be checked (and is locked) as soon as it is
--                  given; short answers use an explicit "Check answer" action
--
-- Auto-grading for short answers uses a single expected answer (answer_key)
-- compared case-insensitively and ignoring extra whitespace.
-- =============================================================================

alter table public.attempts
  add column if not exists feedback_mode text not null default 'after_submit'
  check (feedback_mode in ('after_submit', 'immediate'));

-- Normalise a short answer before comparing it with the stored answer key.
create or replace function public.normalize_answer_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(coalesce(p_value, ''), '[[:space:]]+', ' ', 'g')));
$$;

-- -----------------------------------------------------------------------------
-- Finalisation: short answers with an answer key are graded automatically.
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
      q.answer_key,
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
      if v_row.awarded_marks is null then
        if public.normalize_answer_text(v_row.text_answer) = '' then
          update public.responses
          set awarded_marks = 0,
              is_correct = false,
              graded_at = v_closed_at
          where id = v_row.response_id;
        elsif v_row.answer_key is not null then
          -- A single expected answer decides correctness: matching text earns
          -- full marks, anything else earns zero. No partial credit.
          v_correct :=
            public.normalize_answer_text(v_row.text_answer)
              = public.normalize_answer_text(v_row.answer_key);

          update public.responses
          set awarded_marks = case when v_correct then v_row.marks else 0 end,
              is_correct = v_correct,
              graded_at = v_closed_at
          where id = v_row.response_id;
        end if;
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

-- -----------------------------------------------------------------------------
-- Start an attempt, recording the student's feedback choice.
-- The previous single-argument signature must be removed so PostgREST cannot
-- see two ambiguous overloads.
-- -----------------------------------------------------------------------------
drop function if exists public.start_attempt(uuid);

create or replace function public.start_attempt(
  p_assignment_id uuid,
  p_feedback_mode text default 'after_submit'
)
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
  v_mode text := coalesce(nullif(btrim(p_feedback_mode), ''), 'after_submit');
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = 'insufficient_privilege';
  end if;

  if v_mode not in ('after_submit', 'immediate') then
    raise exception 'Unknown feedback mode.' using errcode = 'check_violation';
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

  if v_mode = 'immediate' and not v_test.show_results then
    raise exception 'Answers are hidden for this test, so instant feedback is unavailable.'
      using errcode = 'check_violation';
  end if;

  -- Reopen an existing in-progress attempt (refresh-safe). Its feedback mode
  -- was fixed when it was created.
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
    due_at,
    feedback_mode
  )
  values (
    v_assignment.id,
    v_test.id,
    v_uid,
    v_used + 1,
    'in_progress',
    v_max_marks,
    v_assignment.due_at,
    v_mode
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
-- Save a response. In instant mode, checked answers become immutable
-- (flag changes are still allowed).
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
  v_existing public.responses%rowtype;
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

  if v_attempt.feedback_mode = 'immediate' then
    select * into v_existing
    from public.responses
    where attempt_id = v_attempt.id and question_id = p_question_id
    for update;

    if found and v_existing.graded_at is not null then
      if v_question.question_type = 'short_answer' then
        if coalesce(v_existing.text_answer, '') is distinct from coalesce(p_text_answer, '') then
          raise exception 'This answer has already been checked and is locked.'
            using errcode = 'check_violation';
        end if;
      elsif v_existing.selected_options is distinct from v_selected then
        raise exception 'This answer has already been checked and is locked.'
          using errcode = 'check_violation';
      end if;
    end if;
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
-- Check one answer during an instant-feedback attempt. Grades it immediately
-- and returns only that question's key so the rest stay hidden.
-- -----------------------------------------------------------------------------
create or replace function public.check_response(
  p_attempt_id uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_test public.tests%rowtype;
  v_question public.questions%rowtype;
  v_response public.responses%rowtype;
  v_deadline timestamptz;
  v_active boolean;
  v_correct boolean;
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
    raise exception 'This attempt is no longer open.' using errcode = 'check_violation';
  end if;

  if v_attempt.feedback_mode <> 'immediate' then
    raise exception 'Instant feedback is not enabled for this attempt.'
      using errcode = 'check_violation';
  end if;

  select * into v_test from public.tests where id = v_attempt.test_id;
  if not v_test.show_results then
    raise exception 'Answers are hidden for this test.' using errcode = 'check_violation';
  end if;

  v_deadline := public.attempt_deadline(v_attempt.id);
  if v_deadline is not null and now() >= v_deadline then
    perform public.finalize_attempt_internal(v_attempt.id, v_deadline);
    raise exception 'Time is up. The attempt has been submitted.'
      using errcode = 'check_violation';
  end if;

  select q.* into v_question
  from public.questions q
  join public.sections s on s.id = q.section_id
  where q.id = p_question_id and s.test_id = v_attempt.test_id;

  if not found then
    raise exception 'Question does not belong to this attempt.'
      using errcode = 'check_violation';
  end if;

  select * into v_response
  from public.responses
  where attempt_id = v_attempt.id and question_id = p_question_id
  for update;

  if not found
    or (
      v_question.question_type = 'short_answer'
      and public.normalize_answer_text(v_response.text_answer) = ''
    )
    or (
      v_question.question_type <> 'short_answer'
      and coalesce(array_length(v_response.selected_options, 1), 0) = 0
    ) then
    raise exception 'Answer the question before checking it.'
      using errcode = 'check_violation';
  end if;

  if v_response.graded_at is null then
    if v_question.question_type = 'short_answer' then
      if v_question.answer_key is null then
        raise exception 'This question is graded manually.'
          using errcode = 'check_violation';
      end if;
      v_correct :=
        public.normalize_answer_text(v_response.text_answer)
          = public.normalize_answer_text(v_question.answer_key);
    else
      v_correct :=
        coalesce(array_length(v_response.selected_options, 1), 0) > 0
        and (
          select array_agg(option_id order by option_id)
          from unnest(v_response.selected_options) as option_id
        ) = (
          select array_agg(option_id order by option_id)
          from unnest(v_question.correct_options) as option_id
        );
    end if;

    update public.responses
    set awarded_marks = case when v_correct then v_question.marks else 0 end,
        is_correct = v_correct,
        graded_at = now()
    where id = v_response.id
    returning * into v_response;
  end if;

  return jsonb_build_object(
    'question_id', v_question.id,
    'is_correct', v_response.is_correct,
    'awarded_marks', v_response.awarded_marks,
    'marks', v_question.marks,
    'correct_options', to_jsonb(v_question.correct_options),
    'answer_key', case
      when v_question.question_type = 'short_answer' then v_question.answer_key
      else null
    end,
    'explanation', v_question.explanation
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Attempt state: expose the chosen mode and, only for checked answers in
-- instant mode, that question's result and key.
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
        'answered_at', r.answered_at,
        'awarded_marks', r.awarded_marks,
        'is_correct', r.is_correct,
        'graded_at', r.graded_at,
        'feedback', case
          when v_attempt.feedback_mode = 'immediate' and r.graded_at is not null then
            jsonb_build_object(
              'question_id', q.id,
              'is_correct', r.is_correct,
              'awarded_marks', r.awarded_marks,
              'marks', q.marks,
              'correct_options', to_jsonb(q.correct_options),
              'answer_key', case
                when q.question_type = 'short_answer' then q.answer_key
                else null
              end,
              'explanation', q.explanation
            )
          else null
        end
      )
    ),
    '[]'::jsonb
  ) into v_responses
  from public.responses r
  join public.questions q on q.id = r.question_id
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
      end,
      'feedback_mode', v_attempt.feedback_mode
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

-- Students may call the new RPC; execution is guarded inside the function.
grant execute on function public.check_response(uuid, uuid) to authenticated;
