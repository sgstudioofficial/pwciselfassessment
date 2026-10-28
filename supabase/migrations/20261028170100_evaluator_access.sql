-- =============================================================================
-- Evaluator ("results reviewer") access
--
-- An evaluator may read results (attempts, responses, the students and tests
-- behind them) and grade short answers, but cannot create students, change
-- tests, assign work or alter profiles. Those mutations stay admin-only.
-- =============================================================================

-- Same shape as is_admin(), widened to every staff role. SECURITY DEFINER so
-- it can be used inside profiles policies without recursive RLS evaluation.
create or replace function public.is_staff()
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
      and role in ('admin', 'evaluator')
      and is_active
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- Read policies: staff can read the data a result is made of.
-- Write policies are deliberately left untouched (is_admin() only).
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists tests_admin_select on public.tests;
create policy tests_admin_select on public.tests
  for select to authenticated using (public.is_staff());

drop policy if exists sections_admin_select on public.sections;
create policy sections_admin_select on public.sections
  for select to authenticated using (public.is_staff());

drop policy if exists questions_admin_select on public.questions;
create policy questions_admin_select on public.questions
  for select to authenticated using (public.is_staff());

drop policy if exists assignments_select on public.test_assignments;
create policy assignments_select on public.test_assignments
  for select to authenticated
  using (student_id = auth.uid() or public.is_staff());

drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts
  for select to authenticated
  using (student_id = auth.uid() or public.is_staff());

drop policy if exists responses_select on public.responses;
create policy responses_select on public.responses
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.attempts a
      where a.id = responses.attempt_id and a.student_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Grading: evaluators may award marks on short answers.
-- -----------------------------------------------------------------------------
create or replace function public.grade_response(
  p_response_id uuid,
  p_awarded_marks numeric
)
returns table (attempt_id uuid, score numeric, status public.attempt_status)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_response public.responses%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.questions%rowtype;
  v_pending integer;
  v_score numeric;
  v_status public.attempt_status;
begin
  if not public.is_staff() then
    raise exception 'Results access required.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_response
  from public.responses where id = p_response_id for update;
  if not found then
    raise exception 'Response not found.' using errcode = 'no_data_found';
  end if;

  select * into v_attempt
  from public.attempts where id = v_response.attempt_id for update;
  if v_attempt.status = 'in_progress' then
    raise exception 'This attempt is still in progress.' using errcode = 'check_violation';
  end if;

  select * into v_question from public.questions where id = v_response.question_id;
  if v_question.question_type <> 'short_answer' then
    raise exception 'Objective answers are graded automatically.'
      using errcode = 'check_violation';
  end if;
  if p_awarded_marks is null or p_awarded_marks < 0 or p_awarded_marks > v_question.marks then
    raise exception 'Marks must be between 0 and %.', v_question.marks
      using errcode = 'check_violation';
  end if;

  update public.responses
  set awarded_marks = p_awarded_marks,
      is_correct = p_awarded_marks >= v_question.marks,
      graded_by = auth.uid(),
      graded_at = now()
  where id = p_response_id;

  select count(*) into v_pending
  from public.responses r
  where r.attempt_id = v_attempt.id and r.awarded_marks is null;

  select coalesce(sum(r.awarded_marks), 0) into v_score
  from public.responses r
  where r.attempt_id = v_attempt.id;

  v_status := case when v_pending = 0 then 'graded'::public.attempt_status
                   else 'submitted'::public.attempt_status end;

  update public.attempts
  set score = v_score,
      status = v_status,
      graded_at = case when v_pending = 0 then now() else null end
  where id = v_attempt.id;

  return query select v_attempt.id, v_score, v_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- Result detail: same payload, readable by staff, and the attempt limit now
-- reflects the assignment override (0/very large values render as unlimited in
-- the app).
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
  v_assignment_limit integer;
begin
  if not public.is_staff() then
    raise exception 'Results access required.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_attempt from public.attempts where id = p_attempt_id;
  if not found then
    raise exception 'Attempt not found.' using errcode = 'no_data_found';
  end if;
  select * into v_test from public.tests where id = v_attempt.test_id;
  select * into v_profile from public.profiles where id = v_attempt.student_id;
  select ta.attempt_limit into v_assignment_limit
  from public.test_assignments ta
  where ta.id = v_attempt.assignment_id;

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
      'attempt_limit', coalesce(v_assignment_limit, v_test.attempt_limit)
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
