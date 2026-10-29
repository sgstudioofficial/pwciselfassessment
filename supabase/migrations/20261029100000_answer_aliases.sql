-- =============================================================================
-- Answer range for short answers
--
-- A short-answer question can now accept more than one spelling of the same
-- answer. `answer_key` stays the primary model answer (shown to students and
-- used by manual graders); `answer_aliases` holds additional accepted answers.
--
-- Matching is still case- and whitespace-insensitive, and numeric answers are
-- compared by value so "0.120" matches "0.12". A range is expressed by listing
-- the accepted values, e.g. answer_key = '0.128' with aliases {'0.12','0.1'}.
-- =============================================================================

alter table public.questions
  add column if not exists answer_aliases text[] not null default '{}';

-- Aliases only make sense for short answers; every other type must keep them
-- empty so a stray value can never influence grading.
alter table public.questions
  drop constraint if exists questions_aliases_shape;
alter table public.questions
  add constraint questions_aliases_shape check (
    question_type = 'short_answer' or answer_aliases = '{}'::text[]
  );

-- -----------------------------------------------------------------------------
-- Decide whether a student's short answer matches the key or one of its
-- accepted alternatives. Text is normalised first; pure numbers are also
-- compared numerically.
-- -----------------------------------------------------------------------------
create or replace function public.short_answer_matches(
  p_answer text,
  p_key text,
  p_aliases text[] default '{}'
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_answer text := public.normalize_answer_text(p_answer);
  v_candidate text;
  v_answer_number numeric;
  v_candidate_number numeric;
  v_number_pattern text := '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$';
begin
  if v_answer = '' then
    return false;
  end if;

  v_answer_number := case
    when v_answer ~ v_number_pattern then v_answer::numeric
    else null
  end;

  if p_key is not null then
    v_candidate := public.normalize_answer_text(p_key);
    if v_candidate = v_answer then
      return true;
    end if;
    v_candidate_number := case
      when v_candidate ~ v_number_pattern then v_candidate::numeric
      else null
    end;
    if v_answer_number is not null
      and v_candidate_number is not null
      and v_candidate_number = v_answer_number then
      return true;
    end if;
  end if;

  foreach v_candidate in array coalesce(p_aliases, '{}'::text[]) loop
    v_candidate := public.normalize_answer_text(v_candidate);
    if v_candidate = '' then
      continue;
    end if;
    if v_candidate = v_answer then
      return true;
    end if;
    v_candidate_number := case
      when v_candidate ~ v_number_pattern then v_candidate::numeric
      else null
    end;
    if v_answer_number is not null
      and v_candidate_number is not null
      and v_candidate_number = v_answer_number then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Finalisation: short answers are graded against the key or any alias.
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
      q.answer_aliases,
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
          -- Matching the key or any accepted alternative earns full marks;
          -- anything else earns zero. No partial credit.
          v_correct := public.short_answer_matches(
            v_row.text_answer,
            v_row.answer_key,
            v_row.answer_aliases
          );

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
-- Duplicating a test must keep the accepted alternatives with the question.
-- -----------------------------------------------------------------------------
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
        options, correct_options, answer_key, answer_aliases, explanation, position
      )
      values (
        v_new_section, v_question.question_type, v_question.prompt,
        v_question.image_path, v_question.marks, v_question.is_required,
        v_question.options, v_question.correct_options, v_question.answer_key,
        v_question.answer_aliases, v_question.explanation, v_question.position
      );
    end loop;
  end loop;

  perform public.recalculate_test_marks(v_new_test);
  return v_new_test;
end;
$$;

-- -----------------------------------------------------------------------------
-- Student review: expose the accepted alternatives with the model answer.
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
                'answer_aliases', to_jsonb(q.answer_aliases),
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
