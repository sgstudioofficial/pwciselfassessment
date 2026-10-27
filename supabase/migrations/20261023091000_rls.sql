-- =============================================================================
-- Meridian — Row Level Security, privileges and API surface
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.tests enable row level security;
alter table public.sections enable row level security;
alter table public.questions enable row level security;
alter table public.test_assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.responses enable row level security;

-- -----------------------------------------------------------------------------
-- Profiles: students may read themselves; only admins may write profiles.
-- (Student account creation/reset happens through the service role.)
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Content tables: admin-only direct access. Students receive question data
-- through answer-key-free RPCs, never by selecting these tables.
-- -----------------------------------------------------------------------------
create policy tests_admin_select on public.tests
  for select to authenticated using (public.is_admin());
create policy tests_admin_insert on public.tests
  for insert to authenticated with check (public.is_admin());
create policy tests_admin_update on public.tests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sections_admin_select on public.sections
  for select to authenticated using (public.is_admin());
create policy sections_admin_insert on public.sections
  for insert to authenticated with check (public.is_admin());
create policy sections_admin_update on public.sections
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sections_admin_delete on public.sections
  for delete to authenticated using (public.is_admin());

create policy questions_admin_select on public.questions
  for select to authenticated using (public.is_admin());
create policy questions_admin_insert on public.questions
  for insert to authenticated with check (public.is_admin());
create policy questions_admin_update on public.questions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy questions_admin_delete on public.questions
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Assignments: students see only their own; only admins may change them.
-- -----------------------------------------------------------------------------
create policy assignments_select on public.test_assignments
  for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

create policy assignments_admin_insert on public.test_assignments
  for insert to authenticated with check (public.is_admin());

create policy assignments_admin_update on public.test_assignments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy assignments_admin_delete on public.test_assignments
  for delete to authenticated using (public.is_admin());

-- Assignment identity is immutable, and once an attempt exists the deadline
-- and attempt limit are frozen so time cannot be extended mid-assessment.
create or replace function public.guard_assignment_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.test_id is distinct from old.test_id
    or new.student_id is distinct from old.student_id then
    raise exception 'An assignment cannot be moved to a different test or student.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.attempts where assignment_id = old.id)
    and (
      new.due_at is distinct from old.due_at
      or new.attempt_limit is distinct from old.attempt_limit
    ) then
    raise exception 'This assignment already has attempts; its deadline and attempt limit are locked.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger test_assignments_guard_update
before update on public.test_assignments
for each row execute function public.guard_assignment_mutation();

-- -----------------------------------------------------------------------------
-- Attempts and responses are read-only to clients. All mutations go through
-- the validated SECURITY DEFINER RPCs.
-- -----------------------------------------------------------------------------
create policy attempts_select on public.attempts
  for select to authenticated
  using (student_id = auth.uid() or public.is_admin());

create policy responses_select on public.responses
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.attempts a
      where a.id = responses.attempt_id and a.student_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Privileges. RLS is the second gate; grants are the first.
-- -----------------------------------------------------------------------------
revoke all on schema public from anon;
grant usage on schema public to anon, authenticated, service_role;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.profiles,
  public.tests, public.sections, public.questions, public.test_assignments
  to authenticated;
grant select on public.attempts, public.responses to authenticated;
grant all on all tables in schema public to service_role;

-- Remove implicit PUBLIC/anonymous execution from every function in public.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_function.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      v_function.signature
    );
  end loop;
end;
$$;

-- Constraint helper executed by the admin inserting a question.
grant execute on function public.question_choice_payload_valid(jsonb, text[]) to authenticated;

-- RLS helper used inside policies for the signed-in role.
grant execute on function public.is_admin() to authenticated;

-- Student-facing API.
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.save_response(uuid, uuid, text[], text, boolean) to authenticated;
grant execute on function public.submit_attempt(uuid) to authenticated;
grant execute on function public.get_attempt_state(uuid) to authenticated;
grant execute on function public.get_student_dashboard() to authenticated;
grant execute on function public.get_my_results() to authenticated;
grant execute on function public.get_attempt_review(uuid) to authenticated;
grant execute on function public.complete_password_change() to authenticated;

-- Admin API (each function re-checks public.is_admin()).
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.assign_test(uuid, uuid[], timestamptz, integer) to authenticated;
grant execute on function public.duplicate_test(uuid) to authenticated;
grant execute on function public.set_test_status(uuid, public.test_status) to authenticated;
grant execute on function public.reorder_sections(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_questions(uuid, uuid[]) to authenticated;
grant execute on function public.grade_response(uuid, numeric) to authenticated;
grant execute on function public.get_admin_attempt_detail(uuid) to authenticated;

-- Make PostgREST aware of the new schema immediately.
notify pgrst, 'reload schema';
