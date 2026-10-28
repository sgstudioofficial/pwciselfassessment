# Verification record

What was actually executed, what it proves, and what still requires a real
Supabase project.

- Environment: Windows 11, Node **v26.10.0**, npm **11.19.1**.
- No Docker and no Supabase CLI were available in the build environment, so a
  live Supabase stack could not be started here. The database layer is instead
  executed against a real PostgreSQL engine (PGlite / Postgres compiled to WASM)
  with the **actual migration files** applied and a Supabase-compatible
  `auth.users`, `auth.uid()`, storage schema and role shim.

## Commands run

```bash
npm run typecheck   # tsc -b                     → 0 errors
npm run lint        # eslint .                   → 0 errors, 3 fast-refresh warnings
npm run build       # tsc -b && vite build       → built in ~0.6s
npx vitest run      # full suite                 → 36 tests passed
```

The three ESLint warnings are the standard
`react-refresh/only-export-components` notices for files that intentionally
export a provider component plus its hook (`AuthContext`, `ToastContext`,
`ProtectedRoute`). They are warnings, not errors, and do not affect the build.

## Test suite

| File | Tests | Focus |
| --- | --- | --- |
| `tests/db/security.test.ts` | 14 | Migrations, RLS, RPC validation, scoring, lifecycle, feedback modes, grids, payload limits, test deletion |
| `tests/ui/render.test.tsx` | 22 | Every page renders; env hygiene; no service-role key in `src/` |

### Database suite (`tests/db/security.test.ts`)

Boots Postgres, applies `tests/db/shim.sql`, then every migration in
`supabase/migrations/` in filename order. Sessions are simulated with
`set_config('request.jwt.claims', …)` + `SET ROLE authenticated|anon`, which is
how Supabase enforces RLS at runtime.

Covered scenarios:

1. **Profile trigger and marks sync** — `auth.users` insert creates exactly one
   `profiles` row; adding questions recomputes `tests.max_marks` (12).
2. **Student isolation** — as `authenticated` student one: `tests`, `sections`
   and `questions` return zero rows; `profiles` returns only the caller's row.
3. **Assignment isolation** — `get_student_dashboard()` for student one contains
   only their own tests; the test assigned to student two never appears; the
   payload contains neither `correct_options` nor `answer_key`.
4. **Attempt lifecycle** — start → autosave five answers (including flag and a
   short answer) → reload state (answers and flag restored) → review blocked
   before submission → submit. Score is exactly `6` of `12` (objective-only).
   The short answer stays pending. Submitting again is idempotent (same
   `submitted_at`, same status, one attempt row), and a third start is rejected
   by the attempt limit. Stored responses retain the submitted text.
5. **Answer-key protection and admin authority** — student cannot call
   `admin_dashboard_stats` or `get_admin_attempt_detail`; `get_attempt_review`
   returns `allowed: false` with no keys. Admin sees the student's answer and
   the answer key, then `grade_response()` raises the total to `9` and completes
   the attempt. With `show_results` enabled, the student's review includes the
   correct option.
6. **Direct-write denial** — student `UPDATE` on `attempts.score` is denied by
   grants; inserting a `test_assignments` row fails RLS; promoting self to
   `admin` affects 0 rows; a second student cannot read or start the first
   student's attempt; `anon` has no table access.
7. **Deadlines** — an attempt past its duration is auto-finalised at exactly 60
   seconds, the late answer is discarded, and an assignment past its due date
   cannot be started.
8. **Admin operations** — dashboard statistics are exact (active students = 2,
   completed attempts = 2, recent submissions = 2); `duplicate_test()` produces
   a draft copy with the same marks and 5 questions; publishing an empty test
   and setting passing marks above the total are both rejected.
9. **Storage** — the `question-images` bucket exists and is public; a student
   cannot insert objects; an admin can.
10. **Instant feedback** — an `immediate` attempt starts only when the test
    shows results. `check_response()` grades a single answer, returns only that
    question's key, and locks the response against further edits. Unanswered
    questions cannot be checked, and the key stays hidden until then.
11. **Grid answers** — a grid answer is stored as `"<rowId>:<optionId>"` pairs.
    Unknown rows/columns, duplicate rows and malformed pairs are rejected, a
    partial grid still saves, and submitting grades the grid as a whole.
12. **Grid feedback** — every row is required before checking, a wrong grid
    award zero with the correct pairs revealed, and the checked grid is locked.
13. **Payload limits** — a 15-column grid and a 30-option multiple select are
    stored, while 16 columns and 31 options are rejected by the check
    constraints (the limits the imported banks need).
14. **Test deletion** — `delete_test()` refuses a student, returns the question
    image paths, and cascades a test with no attempts (sections gone). A test
    with attempts is rejected with "archive it instead" and stays in place.

### UI suite (`tests/ui/render.test.tsx`)

Server-renders every route (login, reset password, forced password change, setup,
all nine admin pages, all five student pages) inside the real router and
providers, matching each URL against its route pattern. This catches import-time
and render-time crashes and missing route wiring. It also asserts:

- the sign-in page exposes only the Student/Administrator tabs and states that
  there is no public registration (no "Sign up" affordance);
- `.env.example` defines the two `VITE_` variables and no `VITE_*SERVICE_ROLE*`;
- the Supabase client, auth context and RPC helpers never mention a service-role
  key.

## Browser check performed

The Vite dev server was started with placeholder credentials and inspected in a
browser at 390×844 and desktop widths:

- `/login` renders the role switch, validation messages, password reveal and
  forgot-password affordance.
- `/admin` while signed out redirects to `/login` (protected route works).
- `/reset-password` without a recovery token shows the "link is no longer valid"
  state instead of crashing.
- `/does-not-exist` renders the 404 page with working links.
- No console errors were produced by any of these pages.

The app also renders a setup screen instead of a broken UI when Supabase
credentials are absent (`src/pages/SetupRequiredPage.tsx`).

### Imported question banks (live project)

The three PetrodrillWCI Google Forms banks were loaded into the live project
through the service-role REST API and then checked in the browser:

- **Counts match the source** — 679/692 (Principles), 416/450 (Mock) and
  312/429 (Equipment) questions/marks, with 6, 13 and 25 grids respectively.
  Grid rows (47 and 134) are rows of one question, not separate questions.
- **Builder** shows the expected section and question totals; the preview
  renders all 25 Equipment grids with the right row/column counts, including the
  13-column Cameron "DL" callout grid, and all 71 question images load
  (`naturalWidth > 0`).
- **Editor limits** — the 13-column grid reports `13 / 15` columns and the
  24-option remote-panel question reports `24 / 30`, so both can be edited and
  re-saved without truncation.
- **Grid answer keys** — each row's "Correct column" select is bound to the
  column id, so rows can be set independently and the saved `row:column` pairs
  are not double-encoded. Verified live on a two-column True/False grid (row 1
  set to False, saved, re-opened, then restored) and on a three-column grid;
  `tests/ui/grid.test.ts` covers the encoding helpers.
- **Both feedback modes** were exercised end to end on the earlier banks,
  including immediate checking for grids and the per-question key response.
- **Exports and results** include grid answers as `row:column` pairs for the
  admin results page and both CSVs.
- **Principles figures and image options** — 77 files were uploaded for the
  Principles bank: 35 option images for the 10 questions whose answers are
  pictures, plus 42 question figures (gauge panels, leak-off plots, stripping
  diagrams and the kill-sheet data sheets shared by the calculation groups).
  The 26 stems that exist only as screenshots in the source PDF (the 25
  placeholder questions and the SIDPP/SICP pair) were transcribed into the
  prompt text rather than attached as duplicate pictures; the "Gauge Problems"
  section intro image was not attached to any question. All 77 public URLs
  return 200 and no placeholder prompt remains. Question images open full size
  in a new tab from the student question card (and from the admin preview), so
  the tall three-page kill-sheet data sheet stays readable despite the
  thumbnail height cap.

The banks remain **draft and unassigned**; their keys are placeholders and must
be replaced before publishing.

### Hosted deployment: Edge Function CORS (live project)

- Calling `POST /functions/v1/admin-students` from the live project without a
  token returns `401 Missing authorization header`, so the function is deployed
  and reachable — the failure was not a missing deployment.
- The preflight (`OPTIONS`) answered **every** origin with
  `Access-Control-Allow-Origin: http://localhost:5173`, because `ALLOWED_ORIGIN`
  was set to the local dev origin. A browser on the hosted site therefore blocks
  the request, and supabase-js reports *Failed to send a request to the Edge
  Function* — which is exactly what **Add student** showed. `student-login` is
  restricted by the same setting, so student sign-in on the hosted site fails
  the same way.
- The shared CORS helper now accepts a comma-separated allowlist, echoes the
  matching origin, and omits the header entirely for unlisted origins. Verified
  with a Node harness against the real helper: unset → `*`; listed origin →
  echoed; unlisted origin → no header; trailing slash normalised; preflight for
  an unlisted origin returns `204` without `Access-Control-Allow-Origin`.
- Remaining manual step (needs project access): set `ALLOWED_ORIGIN` to the
  hosted origin(s) and redeploy the three functions.

### Test deletion (live project)

- `delete_test()` was applied to the live project and called with a real admin
  token: a throwaway draft (grid question with an image) was removed with its
  section, and the RPC returned the image object path for bucket cleanup.
- The same call with a student token returned `403 Administrator access required`.
- The admin **Tests** list shows a trash action only on tests with 0 attempts;
  tests with attempts keep the archive action. Clicking it, confirming, and
  returning to the list removed the row and showed the "Test deleted" toast.


## Not executed here (requires your Supabase project)

These depend on services that cannot run in this environment (no Docker/Supabase
CLI, no project credentials). They are implemented and must be exercised against
your project with the checklist below:

- Supabase Auth sign-in for the administrator, forced password change, reset
  email delivery.
- `student-login` Edge Function (username → internal email → password grant) and
  session establishment.
- `admin-students` Edge Function (create student, reset password, ban/unban).
- Question image upload to the `question-images` storage bucket from the admin
  UI and image display for students.
- The database webhook → `notify-submission` (provider call is a documented
  integration point; no email provider is wired by design).

## Manual acceptance checklist (run against your project)

1. `npm run create-admin -- admin@company.com "<password>" "Jane Admin"`, sign in
   at `/login` → Administrator, complete the forced password change, land on
   `/admin`.
2. Dashboard tiles match the database (empty state first, then after seeding).
3. **Students → Add student**: new username + temporary password shown once.
   Sign out, sign in on the Student tab, change the password on first login.
4. Create a test with two sections, one question of each type, an image, marks
   and passing marks; save, preview (keys visible), publish.
5. Try publishing a test with no sections and with passing marks > total; both
   must be refused with a clear message.
6. **Assignments → Assign test** to the student (and to a department filter) with
   a deadline and attempt limit; confirm duplicates are skipped.
7. Student sees only assigned tests; correct ones are marked Available, not yet
   open, or Expired.
8. Start the test: timer runs from the server deadline, answers autosave, refresh
   mid-attempt restores answers and the flag, submit shows the confirmation, a
   second submission is blocked, and a timer-expiry auto-submits.
9. Admin **Results**: open the attempt, see every answer plus the correct answer,
   grade the short answer, watch the total and status update; export the attempts
   CSV and the per-response CSV.
10. Toggle **Show results to students**; the student's review appears only when
    it is on.
11. Deactivate the student; sign-in is refused and the data remains. Reactivate.
12. Create a throwaway draft test with no attempts and delete it from **Tests**;
    the row disappears. A test with attempts shows no delete action (archive it
    instead), and a direct `delete_test` call on it is refused.
13. Attempt the following in the browser console with a student session and
    confirm each fails: `select` on `questions`, `update` on `attempts`,
    inserting into `test_assignments`, calling `admin_dashboard_stats`,
    reading another student's attempt id.

## Known limitations

- Lists are paginated client-side; fine for company-sized cohorts, but add
  ranged queries before a directory grows into the thousands.
- Deleting a question does not delete its uploaded image object.
- `sweep_expired_attempts()` runs when dashboards are loaded; schedule it with
  pg_cron for unattended expiry.
- Email notification delivery is intentionally unimplemented beyond the secured
  `deliverNotification()` hook.
