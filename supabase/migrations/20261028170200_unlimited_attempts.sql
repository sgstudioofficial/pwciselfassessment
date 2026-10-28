-- Unlimited attempts.
--
-- 1,000,000,000 is the sentinel the app sends for "unlimited". It stays a
-- positive integer so every existing comparison (used < limit, used >= limit)
-- keeps working without touching the attempt lifecycle functions: a student
-- can never exhaust a billion attempts, and the dashboard never marks the
-- assignment "completed" because of the limit.
--
-- The app renders any limit >= UNLIMITED_ATTEMPT_LIMIT as "Unlimited"
-- (src/lib/attempts.ts keeps the same constant).

-- The old 1–20 cap still applies; 1,000,000,000 is the only extra value the
-- app may store, so an "unlimited" assignment cannot be confused with a typo
-- such as 200 attempts.

alter table public.tests
  drop constraint if exists tests_attempt_limit_range;
alter table public.tests
  add constraint tests_attempt_limit_range
  check (attempt_limit between 1 and 20 or attempt_limit = 1000000000);

alter table public.test_assignments
  drop constraint if exists test_assignments_attempt_limit_range;
alter table public.test_assignments
  add constraint test_assignments_attempt_limit_range
  check (
    attempt_limit is null
    or attempt_limit between 1 and 20
    or attempt_limit = 1000000000
  );
