-- One active session per account.
--
-- `profiles.active_session_id` holds the auth session id of the most recent
-- sign-in. The app registers the id after a successful login and polls
-- `is_active_session`; when another device signs in, the older browser is told
-- to sign out. `sessions_single_per_user` in the Auth settings is the
-- server-side backstop that revokes the older refresh token at the same time.
--
-- Both functions are SECURITY DEFINER so they can update the caller's row
-- without widening the profiles RLS policies, and they only ever touch
-- auth.uid()'s own row.

alter table public.profiles
  add column if not exists active_session_id uuid;

-- p_force = true on an explicit sign-in (take over the account).
-- p_force = false on page load (adopt only if nothing is registered yet).
create or replace function public.register_active_session(
  p_session_id uuid,
  p_force boolean default false
)
returns void
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  update public.profiles
     set active_session_id = p_session_id
   where id = auth.uid()
     and (p_force or active_session_id is null);
$$;

-- True when this browser holds the session that most recently signed in, or
-- when no session has been registered yet (legacy rows adopt on next login).
create or replace function public.is_active_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    (select case
              when active_session_id is null then true
              else active_session_id = p_session_id
            end
       from public.profiles
      where id = auth.uid()),
    true
  );
$$;

revoke all on function public.register_active_session(uuid, boolean) from public;
revoke all on function public.is_active_session(uuid) from public;
grant execute on function public.register_active_session(uuid, boolean) to authenticated;
grant execute on function public.is_active_session(uuid) to authenticated;
