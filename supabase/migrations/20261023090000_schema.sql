-- =============================================================================
-- Meridian company assessment platform — core schema
-- Run order: 20261023090000_schema.sql -> ...090500_functions.sql ->
--            ...091000_rls.sql -> ...091500_storage.sql
-- =============================================================================

create type public.user_role as enum ('admin', 'student');
create type public.test_status as enum ('draft', 'published', 'archived');
create type public.question_type as enum (
  'single_choice',
  'multiple_select',
  'true_false',
  'short_answer'
);
create type public.attempt_status as enum ('in_progress', 'submitted', 'graded');

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user, public-safe identity and role
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text,
  full_name text not null,
  role public.user_role not null default 'student',
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  department text,
  batch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null
    or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'
  ),
  constraint profiles_full_name_length check (char_length(btrim(full_name)) between 1 and 120),
  constraint profiles_department_length check (department is null or char_length(department) <= 80),
  constraint profiles_batch_length check (batch is null or char_length(batch) <= 80)
);

create unique index profiles_username_key
  on public.profiles (lower(username))
  where username is not null;
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_active_idx on public.profiles (role, is_active);
create index profiles_department_idx on public.profiles (department) where role = 'student';
create index profiles_batch_idx on public.profiles (batch) where role = 'student';

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- The trigger runs for every new auth user. It intentionally IGNORES any
-- user-supplied role metadata: client sign-ups must never be able to mint
-- admin accounts. Admin promotion is a separate, documented service-role step.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, email, username, full_name, role)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@unknown.invalid'),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'student'), '@', 1)
    ),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- tests
-- -----------------------------------------------------------------------------
create table public.tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  instructions text,
  duration_minutes integer,
  max_marks numeric(10, 2) not null default 0,
  passing_marks numeric(10, 2) not null default 0,
  attempt_limit integer not null default 1,
  start_at timestamptz,
  end_at timestamptz,
  status public.test_status not null default 'draft',
  show_results boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tests_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint tests_duration_range check (
    duration_minutes is null or duration_minutes between 1 and 1440
  ),
  constraint tests_attempt_limit_range check (attempt_limit between 1 and 20),
  constraint tests_marks_non_negative check (max_marks >= 0 and passing_marks >= 0),
  constraint tests_window_valid check (
    start_at is null or end_at is null or end_at > start_at
  )
);

create index tests_status_idx on public.tests (status);
create index tests_created_by_idx on public.tests (created_by);

create trigger tests_set_updated_at
before update on public.tests
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- sections
-- -----------------------------------------------------------------------------
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sections_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint sections_position_non_negative check (position >= 0),
  constraint sections_position_unique unique (test_id, position) deferrable initially deferred
);

create index sections_test_position_idx on public.sections (test_id, position);

create trigger sections_set_updated_at
before update on public.sections
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- questions
-- -----------------------------------------------------------------------------
create or replace function public.question_choice_payload_valid(
  p_options jsonb,
  p_correct_options text[]
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p_options) = 'array'
    and jsonb_array_length(p_options) between 2 and 10
    and coalesce(array_length(p_correct_options, 1), 0) >= 1
    and (
      select count(*) = count(distinct option ->> 'id')
      from jsonb_array_elements(p_options) as option
    )
    and not exists (
      select 1
      from unnest(p_correct_options) as correct_id
      where not exists (
        select 1
        from jsonb_array_elements(p_options) as option
        where option ->> 'id' = correct_id
      )
    );
$$;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  question_type public.question_type not null,
  prompt text not null,
  image_path text,
  marks numeric(6, 2) not null default 1,
  is_required boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  correct_options text[] not null default '{}',
  answer_key text,
  explanation text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_prompt_length check (char_length(btrim(prompt)) between 1 and 4000),
  constraint questions_marks_range check (marks > 0 and marks <= 100),
  constraint questions_position_non_negative check (position >= 0),
  constraint questions_position_unique unique (section_id, position) deferrable initially deferred,
  constraint questions_options_is_array check (jsonb_typeof(options) = 'array'),
  constraint questions_choice_shape check (
    case question_type
      when 'single_choice' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) = 1
      when 'true_false' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) = 1
      when 'multiple_select' then
        public.question_choice_payload_valid(options, correct_options)
        and array_length(correct_options, 1) >= 1
      else
        correct_options = '{}' and options = '[]'::jsonb
    end
  )
);

create index questions_section_position_idx on public.questions (section_id, position);

create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

-- Keep tests.max_marks in sync with the sum of question marks. The admin sets
-- marks per question, so the test total is always trustworthy.
create or replace function public.recalculate_test_marks(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.test_status;
  v_passing numeric;
  v_total numeric;
begin
  select status, passing_marks into v_status, v_passing
  from public.tests where id = p_test_id;
  if not found then
    return;
  end if;

  select coalesce(sum(q.marks), 0) into v_total
  from public.sections s
  join public.questions q on q.section_id = s.id
  where s.test_id = p_test_id;

  -- A published test must never become impossible to pass. Drafts are allowed
  -- to be temporarily inconsistent while the admin is building them.
  if v_status = 'published' and v_total < v_passing then
    raise exception
      'Total marks (%) cannot fall below the passing marks (%). Lower the passing marks first.',
      v_total, v_passing
      using errcode = 'check_violation';
  end if;

  update public.tests
  set max_marks = v_total
  where id = p_test_id and max_marks is distinct from v_total;
end;
$$;

create or replace function public.questions_recalculate_marks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_test uuid;
  v_new_test uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select test_id into v_old_test from public.sections where id = old.section_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select test_id into v_new_test from public.sections where id = new.section_id;
  end if;

  if v_old_test is not null then
    perform public.recalculate_test_marks(v_old_test);
  end if;
  if v_new_test is not null and v_new_test is distinct from v_old_test then
    perform public.recalculate_test_marks(v_new_test);
  end if;
  return null;
end;
$$;

create trigger questions_marks_sync
after insert or update or delete on public.questions
for each row execute function public.questions_recalculate_marks();

create or replace function public.sections_recalculate_marks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recalculate_test_marks(old.test_id);
  return null;
end;
$$;

create trigger sections_marks_sync
after delete on public.sections
for each row execute function public.sections_recalculate_marks();

-- -----------------------------------------------------------------------------
-- test assignments
-- -----------------------------------------------------------------------------
create table public.test_assignments (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  due_at timestamptz,
  attempt_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_assignments_unique unique (test_id, student_id),
  constraint test_assignments_attempt_limit_range check (
    attempt_limit is null or attempt_limit between 1 and 20
  )
);

create index test_assignments_student_idx on public.test_assignments (student_id);
create index test_assignments_test_idx on public.test_assignments (test_id);
create index test_assignments_due_idx on public.test_assignments (due_at);

create trigger test_assignments_set_updated_at
before update on public.test_assignments
for each row execute function public.set_updated_at();

create or replace function public.validate_test_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.test_status;
  v_role public.user_role;
  v_active boolean;
begin
  select status into v_status from public.tests where id = new.test_id;
  if v_status is distinct from 'published' then
    raise exception 'Only published tests can be assigned.'
      using errcode = 'check_violation';
  end if;

  select role, is_active into v_role, v_active
  from public.profiles where id = new.student_id;

  if v_role is distinct from 'student' or v_active is not true then
    raise exception 'Tests can only be assigned to active students.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger test_assignments_validate
before insert on public.test_assignments
for each row execute function public.validate_test_assignment();

create or replace function public.prevent_assignment_delete_with_attempts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.attempts where assignment_id = old.id) then
    raise exception 'This assignment has attempts and cannot be revoked.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger test_assignments_prevent_delete
before delete on public.test_assignments
for each row execute function public.prevent_assignment_delete_with_attempts();

-- -----------------------------------------------------------------------------
-- attempts
-- -----------------------------------------------------------------------------
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.test_assignments (id) on delete cascade,
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  attempt_number integer not null,
  status public.attempt_status not null default 'in_progress',
  max_marks numeric(10, 2) not null default 0,
  score numeric(10, 2),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  graded_at timestamptz,
  time_taken_seconds integer,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attempts_number_positive check (attempt_number >= 1),
  constraint attempts_unique_number unique (assignment_id, attempt_number),
  constraint attempts_state_valid check (
    (status = 'in_progress' and submitted_at is null)
    or (status in ('submitted', 'graded') and submitted_at is not null)
  ),
  constraint attempts_score_non_negative check (score is null or score >= 0)
);

-- Exactly one open attempt per assignment. This is the database-level guard
-- against duplicate concurrent starts and duplicate submissions.
create unique index attempts_one_open_per_assignment
  on public.attempts (assignment_id)
  where status = 'in_progress';
create index attempts_student_idx on public.attempts (student_id, status);
create index attempts_test_idx on public.attempts (test_id, status);
create index attempts_assignment_idx on public.attempts (assignment_id);
create index attempts_submitted_idx
  on public.attempts (submitted_at desc)
  where submitted_at is not null;

create trigger attempts_set_updated_at
before update on public.attempts
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- responses
-- -----------------------------------------------------------------------------
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  selected_options text[] not null default '{}',
  text_answer text,
  is_flagged boolean not null default false,
  awarded_marks numeric(6, 2),
  is_correct boolean,
  graded_by uuid references public.profiles (id) on delete set null,
  graded_at timestamptz,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint responses_unique_question unique (attempt_id, question_id),
  constraint responses_awarded_valid check (
    awarded_marks is null or (awarded_marks >= 0 and awarded_marks <= 100)
  ),
  constraint responses_text_length check (text_answer is null or char_length(text_answer) <= 10000)
);

create index responses_attempt_idx on public.responses (attempt_id);
create index responses_question_idx on public.responses (question_id);

create trigger responses_set_updated_at
before update on public.responses
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Structural locking: once a test has attempts, its structure and rules are
-- frozen so submitted answer history and scores cannot be invalidated.
-- -----------------------------------------------------------------------------
create or replace function public.test_has_attempts(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.attempts where test_id = p_test_id);
$$;

create or replace function public.guard_test_structure_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_test_id uuid;
begin
  if tg_table_name = 'sections' then
    if tg_op = 'DELETE' then
      v_test_id := old.test_id;
    else
      v_test_id := new.test_id;
    end if;
  else
    if tg_op = 'DELETE' then
      select test_id into v_test_id
      from public.sections where id = old.section_id;
    else
      select test_id into v_test_id
      from public.sections where id = new.section_id;
    end if;
  end if;

  if v_test_id is not null and public.test_has_attempts(v_test_id) then
    raise exception
      'This test already has attempts. Duplicate the test to make structural changes.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger sections_guard_structure
before insert or update or delete on public.sections
for each row execute function public.guard_test_structure_mutation();

create trigger questions_guard_structure
before insert or update or delete on public.questions
for each row execute function public.guard_test_structure_mutation();

create or replace function public.guard_test_settings_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published' and new.passing_marks > new.max_marks then
    raise exception 'Passing marks cannot exceed the total marks.'
      using errcode = 'check_violation';
  end if;

  if public.test_has_attempts(old.id) then
    if new.duration_minutes is distinct from old.duration_minutes
      or new.attempt_limit is distinct from old.attempt_limit
      or new.start_at is distinct from old.start_at
      or new.end_at is distinct from old.end_at
      or new.passing_marks is distinct from old.passing_marks
      or new.max_marks is distinct from old.max_marks then
      raise exception
        'This test already has attempts. Its timing, marks and attempt limit are locked.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger tests_guard_settings
before update on public.tests
for each row execute function public.guard_test_settings_mutation();

-- Publishing through any path must satisfy the same readiness rules.
create or replace function public.validate_test_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sections integer;
  v_questions integer;
  v_total numeric;
  v_should_validate boolean := false;
begin
  if new.status = 'published' then
    if tg_op = 'INSERT' then
      v_should_validate := true;
    elsif old.status is distinct from 'published' then
      v_should_validate := true;
    end if;
  end if;

  if v_should_validate then
    select count(*) into v_sections from public.sections where test_id = new.id;
    select count(*), coalesce(sum(q.marks), 0) into v_questions, v_total
    from public.sections s
    join public.questions q on q.section_id = s.id
    where s.test_id = new.id;

    if v_sections = 0 or v_questions = 0 or v_total <= 0 then
      raise exception 'Add at least one section and one question before publishing.'
        using errcode = 'check_violation';
    end if;
    if new.passing_marks > new.max_marks then
      raise exception 'Passing marks cannot exceed the total marks.'
        using errcode = 'check_violation';
    end if;
    if new.end_at is not null and new.end_at <= now() then
      raise exception 'The test end date must be in the future.'
        using errcode = 'check_violation';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger tests_validate_publish
before insert or update of status on public.tests
for each row execute function public.validate_test_publish();

-- -----------------------------------------------------------------------------
-- CSV-friendly indexes on results
-- -----------------------------------------------------------------------------
create index attempts_score_idx on public.attempts (test_id, submitted_at desc)
  where submitted_at is not null;
create index responses_grading_pending_idx on public.responses (attempt_id)
  where awarded_marks is null;
