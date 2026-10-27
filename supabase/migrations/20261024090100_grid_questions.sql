-- =============================================================================
-- Grid (matrix) questions
--
-- A grid question is one question with several rows and a shared set of column
-- options, e.g. a stack inspection checklist:
--
--   rows    : a) …  b) …  c) …  d) …
--   columns : No | Yes
--
-- The answer key and a student's answer are stored as "<rowId>:<optionId>"
-- pairs in correct_options / selected_options. Grading is binary: the attempt
-- earns full marks only when every row matches the key.
-- =============================================================================

alter table public.questions
  add column if not exists grid_rows jsonb not null default '[]'::jsonb;

alter table public.questions
  add constraint questions_grid_rows_is_array
  check (jsonb_typeof(grid_rows) = 'array');

-- Validate a grid payload: 1-15 unique rows with text, 2-10 unique columns and
-- either no key yet or exactly one valid column per row.
create or replace function public.question_grid_payload_valid(
  p_rows jsonb,
  p_options jsonb,
  p_correct_options text[]
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p_rows) = 'array'
    and jsonb_array_length(p_rows) between 1 and 15
    and jsonb_typeof(p_options) = 'array'
    and jsonb_array_length(p_options) between 2 and 10
    and (
      select count(*) = count(distinct row_data ->> 'id')
      from jsonb_array_elements(p_rows) as row_data
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_rows) as row_data
      where coalesce(btrim(row_data ->> 'id'), '') = ''
         or coalesce(btrim(row_data ->> 'text'), '') = ''
    )
    and (
      select count(*) = count(distinct option ->> 'id')
      from jsonb_array_elements(p_options) as option
    )
    and (
      coalesce(array_length(p_correct_options, 1), 0) = 0
      or (
        array_length(p_correct_options, 1) = jsonb_array_length(p_rows)
        and (
          select count(distinct split_part(pair, ':', 1))
          from unnest(p_correct_options) as pair
        ) = jsonb_array_length(p_rows)
        and not exists (
          select 1
          from unnest(p_correct_options) as pair
          where length(pair) - length(replace(pair, ':', '')) <> 1
             or not exists (
               select 1
               from jsonb_array_elements(p_rows) as row_data
               where row_data ->> 'id' = split_part(pair, ':', 1)
             )
             or not exists (
               select 1
               from jsonb_array_elements(p_options) as option
               where option ->> 'id' = split_part(pair, ':', 2)
             )
        )
      )
    );
$$;

grant execute on function public.question_grid_payload_valid(jsonb, jsonb, text[])
  to authenticated;

alter table public.questions drop constraint if exists questions_choice_shape;

alter table public.questions
  add constraint questions_choice_shape check (
    case question_type
      when 'single_choice' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) = 1
        and grid_rows = '[]'::jsonb
      when 'true_false' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) = 1
        and grid_rows = '[]'::jsonb
      when 'multiple_select' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) >= 1
        and grid_rows = '[]'::jsonb
      when 'grid' then
        public.question_grid_payload_valid(grid_rows, options, correct_options)
      else
        correct_options = '{}' and options = '[]'::jsonb and grid_rows = '[]'::jsonb
    end
  );

-- -----------------------------------------------------------------------------
-- Save a response. Grid answers must reference an existing row and column, with
-- at most one column per row.
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
  elsif v_question.question_type = 'grid' then
    -- Every selection must be a "<rowId>:<optionId>" pair.
    if exists (
      select 1
      from unnest(v_selected) as pair
      where length(pair) - length(replace(pair, ':', '')) <> 1
    ) then
      raise exception 'One or more selected answers are invalid.' using errcode = 'check_violation';
    end if;

    if exists (
      select 1
      from unnest(v_selected) as pair
      where not exists (
        select 1
        from jsonb_array_elements(v_question.grid_rows) as row_data
        where row_data ->> 'id' = split_part(pair, ':', 1)
      )
      or not exists (
        select 1
        from jsonb_array_elements(v_question.options) as option
        where option ->> 'id' = split_part(pair, ':', 2)
      )
    ) then
      raise exception 'One or more selected answers are invalid.' using errcode = 'check_violation';
    end if;

    if (
      select count(*) from unnest(v_selected) as pair
    ) <> (
      select count(distinct split_part(pair, ':', 1)) from unnest(v_selected) as pair
    ) then
      raise exception 'Choose only one answer per row.' using errcode = 'check_violation';
    end if;
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
-- Check one answer during an instant-feedback attempt. A grid can only be
-- checked once every row has a selection.
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

  if v_question.question_type = 'grid'
    and coalesce(array_length(v_response.selected_options, 1), 0)
      < jsonb_array_length(v_question.grid_rows) then
    raise exception 'Answer every row before checking it.'
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
-- Attempt state: include grid rows so the student can render the matrix.
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
                'rows', q.grid_rows,
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

-- -----------------------------------------------------------------------------
-- Student review: include grid rows.
-- -----------------------------------------------------------------------------
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
                'rows', q.grid_rows,
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

-- -----------------------------------------------------------------------------
-- Admin attempt detail: include grid rows.
-- -----------------------------------------------------------------------------
create or replace function public.get_admin_attempt_detail(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.attempts%rowtype;
  v_test public.tests%rowtype;
  v_profile public.profiles%rowtype;
  v_sections jsonb;
  v_pending integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;
  select * into v_test from public.tests where id = v_attempt.test_id;
  select * into v_profile from public.profiles where id = v_attempt.student_id;

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
                'is_required', q.is_required,
                'options', q.options,
                'rows', q.grid_rows,
                'correct_options', to_jsonb(q.correct_options),
                'answer_key', q.answer_key,
                'explanation', q.explanation,
                'position', q.position,
                'response', (
                  select jsonb_build_object(
                    'id', r.id,
                    'selected_options', r.selected_options,
                    'text_answer', r.text_answer,
                    'awarded_marks', r.awarded_marks,
                    'is_correct', r.is_correct,
                    'is_flagged', r.is_flagged,
                    'graded_at', r.graded_at,
                    'graded_by', r.graded_by
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
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number,
      'status', v_attempt.status,
      'score', v_attempt.score,
      'max_marks', v_attempt.max_marks,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'graded_at', v_attempt.graded_at,
      'time_taken_seconds', v_attempt.time_taken_seconds
    ),
    'student', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'username', v_profile.username,
      'email', v_profile.email,
      'department', v_profile.department,
      'batch', v_profile.batch
    ),
    'test', jsonb_build_object(
      'id', v_test.id,
      'title', v_test.title,
      'description', v_test.description,
      'instructions', v_test.instructions,
      'passing_marks', v_test.passing_marks,
      'attempt_limit', v_test.attempt_limit
    ),
    'sections', v_sections,
    'totals', jsonb_build_object(
      'score', coalesce(v_attempt.score, 0),
      'max_marks', v_attempt.max_marks,
      'pending_manual', v_pending,
      'passed', coalesce(v_attempt.score, 0) >= v_test.passing_marks
    )
  );
end;
$$;
