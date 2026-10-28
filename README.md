# PWCI Self Assessment Tool - Company Self-Assessment Platform

A production-minded company assessment platform built with **React, Vite,
TypeScript, Tailwind CSS, React Router and Supabase**. Administrators build
structured tests, assign them to individual students or whole departments, and
review results. Students sign in with a username, take timed assessments whose
answers autosave, and see results only when the administrator allows it.

> **No demo data.** Every screen is wired to Supabase, and every privileged
> operation is validated in PostgreSQL or a Supabase Edge Function. There is no
> public registration and no service-role key in the frontend.

---

## Contents

1. [Feature overview](#feature-overview)
2. [Architecture](#architecture)
3. [Local setup](#local-setup)
4. [Provision the first administrator](#provision-the-first-administrator)
5. [Verify accounts, assignments and results](#verify-accounts-assignments-and-results)
6. [Database and security model](#database-and-security-model)
7. [Assessment behaviour](#assessment-behaviour)
8. [Question images](#question-images)
9. [Submission notifications](#submission-notifications)
10. [Tests and verification](#tests-and-verification)
11. [Deployment](#deployment)
12. [Project structure](#project-structure)
13. [Troubleshooting](#troubleshooting)
14. [Operational notes](#operational-notes)

---

## Feature overview

### Administrator

- Database-driven dashboard: active students, total/published tests, completed
  attempts, pending assignments, manual-grading queue and recent submissions.
- Student management: create secure accounts, edit details, search/filter,
  deactivate/reactivate, reset passwords, delete accounts permanently (with
  confirmation), bulk assign tests, view per-student assignments and assessment
  history.
- Test builder: drafts, publish/unpublish/archive/duplicate, delete tests that have
  no attempts, metadata, instructions, duration, passing marks, attempt limit, start/end windows,
  sections, question ordering, image uploads and a full preview with answer keys.
- Five question types: single choice, multiple select, true/false, short answer
  and grid (matrix), with marks, required flag, optional explanation and answer
  keys. Grids hold their rows inside one question and share a set of column
  options, so a checklist renders as a single table.
- Assignments: individual students, multi-select, or filter by department/batch
  and select all. Deadlines and per-assignment attempt-limit overrides.
- Results: attempt review with every answer, correct answer, section-wise and
  total scores; manual short-answer grading; CSV export of attempts and
  individual responses; visibility toggle for student results.

### Student

- Username/password sign-in (resolved server-side to the Auth email).
- Dashboard of assigned assessments grouped into to-do, upcoming, completed,
  expired and all.
- Instructions screen, timer, sections, question navigator with answered/
  unanswered/flagged states, per-answer autosave, refresh/reconnect recovery,
  final submission confirmation, duplicate-submission protection and automatic
  submission at zero.
- Result history and detailed review only when the administrator enables it.
- Forced password change after an administrator-issued temporary password.

---

## Architecture

```
React SPA (Vite, TypeScript, Tailwind, React Router)
│
├── supabase-js (anon key only)
│   ├── Supabase Auth ─────────────── sessions, admin email login
│   ├── PostgreSQL ────────────────── RLS + SECURITY DEFINER RPCs
│   └── Storage ───────────────────── question-images bucket
│
└── Supabase Edge Functions (service-role key, server-only)
    ├── student-login     username → email → Auth password grant
    ├── admin-students    create student / reset password / set status / delete student
    └── notify-submission secured database-webhook integration point
```

**Trust boundaries**

- The browser can never read `questions`, `sections` or `tests` directly as a
  student. Student data comes from RPCs that deliberately exclude answer keys.
- Attempts, responses and scores are written only by SECURITY DEFINER functions.
- Student Auth accounts, bans and password resets require the service role,
  which exists only in Edge Functions and the local admin-provisioning script.
- Publishing, assignment, reordering, duplication and grading are validated in
  the database, even if the UI is bypassed.

### Database relationship

```
auth.users 1──1 profiles
profiles(student) 1──* test_assignments *──1 tests
tests 1──* sections 1──* questions
test_assignments 1──* attempts 1──* responses *──1 questions
```

- `profiles` — identity, username, role, active flag, force-password-change flag,
  department and batch.
- `tests` — metadata, marks, timing, lifecycle status and result visibility.
- `sections` / `questions` — ordered structure, options JSON, correct options,
  answer keys, images, explanations.
- `test_assignments` — per-student assignment, deadline and attempt override.
- `attempts` — snapshot of max marks, timestamps, status, score, time taken.
- `responses` — every answer, flag, awarded marks and grading metadata.

All tables have primary keys, foreign keys with explicit delete behaviour,
timestamps, status fields where meaningful, and indexes for the queries the app
runs. The migrations are ordered in [`supabase/migrations`](supabase/migrations).

---

## Local setup

### Prerequisites

- Node.js **20.19+** (tested with Node 26) and npm.
- A Supabase project (hosted or local CLI with Docker).
- Supabase CLI for migrations/functions (optional if you use the dashboard SQL
  editor and deploy functions from CI).

### 1. Install dependencies

```bash
npm install
```

### 2. Create the Supabase project

In the Supabase dashboard create a project, then copy:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon/public key** → `VITE_SUPABASE_ANON_KEY`

Copy the example env file and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. The anon key is safe in the browser; **never** add the
service-role key with a `VITE_` prefix.

### 3. Apply database migrations

All schema, functions, RLS policies and the storage bucket live in
`supabase/migrations/`, in timestamp order.

**With the CLI (hosted project):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Without the CLI:** open the Supabase **SQL Editor** and run each file from
`supabase/migrations/` in filename order. They are written to be applied exactly
once, in this order:

1. `..._schema.sql` — tables, constraints, integrity triggers
2. `..._attempts.sql` — attempt lifecycle and answer-key-free RPCs
3. `..._student.sql` — student dashboard/results/review RPCs
4. `..._admin_ops.sql` — stats, assignment, duplication, ordering
5. `..._admin_results.sql` — grading and admin attempt detail
6. `..._rls.sql` — RLS policies, grants, assignment freeze
7. `..._storage.sql` — public question image bucket + admin-only writes
8. `..._feedback_modes.sql` — per-attempt answer feedback, instant checking,
   short-answer auto-grading

**With a local Supabase stack (Docker required):**

```bash
npx supabase start
npx supabase db reset          # applies migrations
cp supabase/functions/.env.example supabase/functions/.env
npx supabase functions serve --env-file supabase/functions/.env
```

`supabase/config.toml` already sets public sign-ups to disabled, defines the
local redirect URLs, and marks `student-login`/`notify-submission` as
JWT-exempt.

### 4. Configure Auth URLs (hosted projects)

In **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:5173` for local development,
  `https://your-domain.com` in production.
- **Redirect URLs:**
  - `http://localhost:5173/login`
  - `http://localhost:5173/reset-password`
  - the equivalent production URLs.

In **Authentication → Sign In / Providers**:

- Disable **Allow new users to sign up** (public registration must stay off).
- Disable anonymous sign-ins.
- Configure custom SMTP before production, so administrator password-reset
  emails are delivered reliably.

`supabase/config.toml` mirrors these settings for local development, but hosted
projects must also be configured in the dashboard.

### 5. Deploy the Edge Functions

```bash
npx supabase functions deploy student-login --no-verify-jwt
npx supabase functions deploy admin-students
npx supabase functions deploy notify-submission --no-verify-jwt
```

Set secrets (`STUDENT_EMAIL_DOMAIN`, `ALLOWED_ORIGIN`, `NOTIFY_WEBHOOK_SECRET`)
as described in [Submission notifications](#submission-notifications). The
Supabase runtime injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` automatically.

### 6. Start the app

```bash
npm run dev
```

Open http://localhost:5173. Until Supabase credentials are configured, the app
shows a setup screen instead of a broken UI.

---

## Provision the first administrator

Public registration is disabled, so the first administrator is created with a
trusted server-side script.

1. Add the server-only values to `.env.local` (or export them in your shell):

   ```dotenv
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

2. Run:

   ```bash
   npm run create-admin -- admin@company.com "A-strong-password-1" "Jane Admin"
   ```

The script:

- loads `.env.local`/`.env` **only on your machine**;
- creates the Auth user with a confirmed email if needed;
- promotes the matching `profiles` row to `admin`, marks it active and forces a
  password change on first sign-in;
- never prints the service-role key or the password.

Sign in at `/login` → **Administrator** with the email and temporary password.
You are redirected to a forced password change before reaching `/admin`.

**Alternative (dashboard + SQL):** create the user in Supabase
**Authentication → Users**, then run:

```sql
update public.profiles
set role = 'admin',
    username = null,
    is_active = true,
    must_change_password = true
where lower(email) = lower('admin@company.com');
```

The `handle_new_user` trigger always creates a **student** profile; it ignores
any role supplied in user metadata, so a self-registered user could never mint
an admin. Promotion is always an explicit service-role/SQL step.

---

## Verify accounts, assignments and results

### Automated verification

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run build       # production bundle
npm run test:db     # real PostgreSQL tests (PGlite)
npm run test        # database + UI suites (30 tests)
```

`npm run test:db` applies the actual migration files to a WebAssembly PostgreSQL
instance with a Supabase-compatible `auth.users`/`auth.uid()`/storage shim and
asserts nine scenarios, including:

- Auth trigger profile creation and automatic marks synchronisation.
- Students cannot read tests, sections or questions; profiles are self-only.
- Student dashboards contain only their own assignments.
- Students can't use admin RPCs, read other students' attempts, insert
  assignments, change scores, or promote themselves.
- Anon role has no table access.
- Start → autosave → state restore → submit, with exact objective scoring.
- Answer keys are absent from student state before submission and present only
  when result visibility is enabled.
- Duplicate submission is idempotent and attempt limits are enforced.
- Late saves are rejected and the attempt is finalised at the server deadline.
- Expired assignments cannot be started.
- Manual grading recalculates totals and completes the attempt.
- Admin statistics, test duplication and publish validation.
- Storage bucket exists; students cannot write images.

`tests/ui/render.test.tsx` server-renders all 18 pages inside the real router and
providers, asserting no page crashes, that the sign-in screen offers only the
student/administrator paths (no registration), and that no service-role key
appears in `src/`.

The full run and its output are recorded in
[`docs/VERIFICATION.md`](docs/VERIFICATION.md).

### Manual smoke test on your project

1. Sign in as the administrator → **Students → Add student**. Enter a name,
   username and department. Copy the one-time temporary password.
2. Sign out. On the **Student** tab, sign in with the username and temporary
   password. You are forced to choose a new password.
3. As admin, create a test, add a section and questions, set passing marks ≤ total
   marks and publish it. Use **Preview** to inspect answer keys.
4. **Assignments → Assign test**, select the student and an optional deadline.
5. As the student, refresh `/student`: the assigned test appears with an
   **Available** status. Start it, answer questions, refresh the page mid-attempt
   and confirm answers return. Submit and check the confirmation screen.
6. As admin, open **Results**, locate the attempt, verify every answer and the
   correct answer. Grade any short answer, then export the CSV.
7. With **Show results to students** enabled on the test, the student can open
   **My results → Review**. Disable it and confirm the review is withheld.
8. Deactivate the student; sign-in is blocked and existing data remains.

> **Browser-level verification caveat:** the automated suite validates the
> database, RPCs, RLS and scoring. Live Supabase Auth/Edge Function/email flows
> require a configured Supabase project and were not executed in the build
> environment (no project credentials). Use the checklist above against your
> project; every required server-side rule is already covered by the database
> tests.

---

## Database and security model

### RLS summary

| Table              | Admin                     | Student                                                |
| ------------------ | ------------------------- | ------------------------------------------------------ |
| `profiles`         | select/insert/update      | select own row only                                    |
| `tests`            | full CRUD (no delete UI)  | no direct access                                       |
| `sections`         | full CRUD                 | no direct access                                       |
| `questions`        | full CRUD                 | no direct access                                       |
| `test_assignments` | select/insert/update/delete | select own only; never insert/update                 |
| `attempts`         | select                    | select own only; never insert/update/delete            |
| `responses`        | select                    | select own attempts; never write                       |

- Only `authenticated` receives table privileges. `anon` has none.
- Trigger functions, scoring functions and internal helpers have EXECUTE revoked
  from `public`, `anon` and `authenticated`, then only the intended RPCs are
  granted back.
- `is_admin()` is `SECURITY DEFINER` so profile policies do not recurse.

### Server-enforced invariants

- A test can only be published with at least one section, one question, a
  positive total and passing marks within the total.
- Assignments can only be created for **published** tests and **active**
  students. Assignment deadlines are validated in the future.
- Once a test has any attempt, its questions, sections, timing, marks and
  attempt limit are frozen. Duplicate the test to make structural changes.
- Only one open attempt per assignment exists (partial unique index), preventing
  duplicate concurrent starts and duplicate results.
- Attempt eligibility, start/end windows, deadlines, active status and attempt
  limits are re-checked in `start_attempt()`.
- `save_response()` validates attempt ownership, question membership, option
  IDs, answer length and the server deadline.
- `submit_attempt()` is idempotent. A late submission is finalised at the
  deadline, never at the time of the late request.
- Objective scoring happens in the database. Short answers that have a single
  expected answer (`answer_key`) are graded automatically at submission with a
  case- and whitespace-insensitive comparison; short answers without a key stay
  pending until an admin calls `grade_response()`.
- Scores, submission timestamps and status cannot be written by a student.
- Students cannot read answer keys before submission because they cannot read
  the questions table at all; `get_attempt_state()` projects only prompt/options
  and no key fields. Review payloads include keys only after submission and only
  when `tests.show_results` is true.
- Assignments freeze identity (`test_id`, `student_id`) and, once attempts exist,
  deadlines and attempt limits.
- API responses use `Cache-Control: no-store`; Edge Functions restrict CORS to
  `ALLOWED_ORIGIN` when configured.

### Where the service-role key lives

Only in:

- Supabase Edge Function secrets (`student-login`, `admin-students`, and the
  notification function),
- your local `.env.local` for `npm run create-admin`,
- CI/deployment secrets if you automate provisioning.

It is never referenced by any `src/` file, never uses a `VITE_` prefix, and is
never returned to the browser. The `student-login` function returns a normal
Supabase session, not credentials or email addresses.

---

## Assessment behaviour

- **Autosave:** each change is debounced (~700 ms) and persisted with
  `save_response()`; navigation flushes immediately, and hiding the tab flushes
  pending work. Per-question save chains prevent out-of-order writes.
- **Recovery:** `get_attempt_state()` rehydrates answers and flags. The header
  shows saving/saved/interrupted state.
- **Timer:** the authoritative deadline is computed server-side from
  `started_at + duration`, the test end date and the assignment due date,
  whichever is earliest. The client synchronises with a server-time offset and
  submits at zero. Server-side saves/submissions finalize overdue attempts even
  if the browser is closed.
- **Navigation:** one question at a time with section context, prev/next,
  question navigator, answered/unanswered/flagged legend, flag toggle and clear
  answer.
- **Submission:** confirmation shows answered/unanswered/flagged counts and
  required questions still missing. After submission the attempt is read-only.
  Refreshing a submitted attempt redirects to its result.
- **Attempts:** an assignment can override the test attempt limit; every attempt
  is numbered and the latest visible score is shown when permitted.
- **Answer feedback:** before starting, the student chooses whether answers are
  revealed **after submission** or **immediately after each answer** for that
  attempt. Immediate mode requires **Show results to students**; single-choice
  and true/false answers are checked on selection, while multiple-select, short
  answers and grids use a **Check answer** button. Grids can only be checked once
  every row has a column selected. Checked responses are locked.
  `check_response()` grades one response at a time and returns only that
  question's key, so later answers stay hidden.
- **Results:** students see attempt summaries in **My results**; detailed
  answers are withheld unless the test has **Show results to students** enabled.
  Short-answer grading can make a mark "provisional" until review completes.
- **Expiry sweep:** dashboards and admin stats call `sweep_expired_attempts()`.
  Optionally schedule it with pg_cron in production:

  ```sql
  select cron.schedule(
    'meridian-expire-attempts',
    '*/5 * * * *',
    $$select public.sweep_expired_attempts();$$
  );
  ```

---

## Question images

- Bucket: `question-images`, public read, 5 MB limit, PNG/JPEG/WebP/GIF.
- Writes are admin-only at both the storage policy and UI level.
- Uploaded paths are stored on the question; students receive only the path and
  render the public URL.
- Answer options can also carry an image. The path is stored inside the option
  object (`options[].image_path`) and an option may be image-only, text-only, or
  both.
- Images are not answer material. If your policy requires private images,
  replace the public bucket with a private bucket and signed URLs generated by a
  server-side function.
- Deleting a question does not automatically remove its object; add a storage
  cleanup job if you need strict retention.

---

## Submission notifications

`supabase/functions/notify-submission` is a secured integration point, not a
fake success. It:

1. requires `x-webhook-secret` to equal `NOTIFY_WEBHOOK_SECRET` (32+ chars),
2. loads the submitted attempt with the service role,
3. skips non-submitted attempts,
4. builds a minimal payload (student, test, score, pending manual count),
5. calls `deliverNotification()` — the single place to plug in a transactional
   email provider.

Set the secret:

```bash
supabase secrets set NOTIFY_WEBHOOK_SECRET="$(openssl rand -hex 32)"
supabase secrets set ALLOWED_ORIGIN="https://assessments.company.com,http://localhost:5173"
supabase secrets set STUDENT_EMAIL_DOMAIN="students.company.com"
```

Create a **Database Webhook** in Supabase:

- Table: `attempts`
- Events: `UPDATE` (the function ignores rows without `submitted_at`)
- Type: Supabase Edge Function → `notify-submission`
- HTTP header: `x-webhook-secret: <same secret>`

Then implement the provider call inside `deliverNotification()` in
`supabase/functions/notify-submission/index.ts`. Keep provider keys in Edge
Function secrets, never in `VITE_` variables. Never include student answers in
email content.

---

## Tests and verification

```bash
npm run lint        # 0 errors
npm run typecheck   # 0 errors
npm run build       # production build
npm run test:db     # 9 PostgreSQL/RLS/assessment tests
npm run test        # 30 tests in total (database + UI render)
```

The database suite uses `@electric-sql/pglite` (PostgreSQL compiled to WASM) so it
can run without Docker. It recreates Supabase's `auth.users`, `auth.uid()`,
storage tables and roles, applies the real migrations, and uses `SET ROLE` +
JWT claims to test exactly what `anon` and `authenticated` can do.

See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the recorded run and a
manual acceptance checklist.

---

## Deployment

### Build

```bash
npm run build
```

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, S3 +
CDN). SPA fallback is required:

- **Vercel:** `vercel.json` is included.
- **Netlify:** `public/_redirects` is copied into `dist`.

Set the build environment variables in the host:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

These are embedded at build time. Rebuild after changing them.

### Hostinger (subdomain)

Hostinger shared hosting is plain Apache/LiteSpeed, which suits this app: it is
a static SPA and needs no Node runtime there. Do **not** create a Node.js
application in hPanel.

1. **Create the subdomain.** hPanel → **Domains → Subdomains**. Enter the label
   (for example `assessments` for `assessments.example.com`) and note the
   **Document Root** it shows (Hostinger typically uses
   `public_html/<subdomain>`).
2. **Build with the production Supabase values** in `.env.local`, then run
   `npm run build`. The `VITE_` variables are baked into the bundle at this
   step.
3. **Upload the contents of `dist/` into the subdomain's document root** — not
   the `dist` folder itself. Either use hPanel **File Manager** (upload
   `hostinger-site.zip` into the document root, then **Extract**) or FTP/SSH.
   If the folder already contains Hostinger's placeholder `index.html`, let the
   upload overwrite it.
   The build includes `.htaccess`, which rewrites unknown paths to `index.html`;
   without it, refreshing any route such as `/login` returns a 404.
4. **Enable SSL** for the subdomain (hPanel → **Security → SSL**) and turn on
   **Force HTTPS**. Supabase Auth redirect URLs are absolute, so the scheme must
   match what the browser actually uses.
5. **Register the new origin in Supabase** (Authentication → **URL
   Configuration**):
   - **Site URL:** `https://assessments.example.com`
   - **Redirect URLs:** `https://assessments.example.com/login` and
     `https://assessments.example.com/reset-password`
6. **Allow the origin in the Edge Functions.** `ALLOWED_ORIGIN` takes a
   comma-separated list, so the deployed site and the local dev server can both
   call the functions:

   ```bash
   supabase secrets set ALLOWED_ORIGIN="https://assessments.example.com,http://localhost:5173"
   supabase functions deploy student-login --no-verify-jwt
   supabase functions deploy admin-students
   supabase functions deploy notify-submission --no-verify-jwt
   ```

   The origin must match exactly (scheme + host + port, no trailing slash). A
   request from an origin that is not on the list gets no
   `Access-Control-Allow-Origin` header, so the browser blocks it and the app
   reports *Could not reach the server function*. That message almost always
   means the deployed site's origin is missing from `ALLOWED_ORIGIN`, or the
   function was never deployed. Redeploy the functions after changing the shared
   CORS helper, and check with:

   ```bash
   curl -i -X OPTIONS https://<project-ref>.supabase.co/functions/v1/admin-students \
     -H "Origin: https://assessments.example.com" \
     -H "Access-Control-Request-Method: POST"
   ```

   The response must echo your site origin in `Access-Control-Allow-Origin`.

Re-deploying an update is step 2–3 only: rebuild, replace the files in the
document root, and keep `.htaccess`. Asset filenames are hashed and cached
immutably while `index.html` is not cached, so an open session keeps working
across the swap. To verify, open the subdomain over HTTPS and reload a deep link
such as `/login` or `/student`.

### Production checklist

- [ ] Apply migrations to the production Supabase project.
- [ ] Deploy all three Edge Functions.
- [ ] Set `ALLOWED_ORIGIN`, `STUDENT_EMAIL_DOMAIN` and
      `NOTIFY_WEBHOOK_SECRET` as hosted secrets.
- [ ] Add the production site and `/reset-password` to Supabase Auth redirect
      URLs.
- [ ] Keep public sign-ups disabled.
- [ ] Configure custom SMTP and verify an administrator reset email.
- [ ] Create the first admin with `npm run create-admin`.
- [ ] Confirm the site is served over HTTPS and CORS rejects other origins.
- [ ] Review Supabase Auth rate limits and enable CAPTCHA if the login endpoint
      is exposed to the internet.
- [ ] Schedule `sweep_expired_attempts()` with pg_cron (optional).
- [ ] Test backups/restore and storage lifecycle rules.

The frontend is a pure SPA; there is no Node server to deploy. Supabase hosting
is already secured by RLS.

---

## Project structure

```
├── src/
│   ├── App.tsx                    # routes + role guards
│   ├── components/
│   │   ├── admin/                 # student, assignment, question dialogs
│   │   ├── auth/                  # RequireAuth / RequireRole
│   │   ├── layout/                # admin sidebar, student header, auth shell
│   │   ├── student/               # question card
│   │   └── ui/                    # buttons, forms, modal, table, feedback
│   ├── context/                   # Auth + toasts
│   ├── hooks/                     # async data helper
│   ├── lib/                       # supabase client, RPC, types, CSV, format
│   └── pages/
│       ├── admin/                 # dashboard, students, tests, results, settings
│       ├── auth/                  # login, reset, change password
│       └── student/               # dashboard, instructions, take test, results
├── supabase/
│   ├── config.toml
│   ├── functions/                 # student-login, admin-students, notify-submission
│   └── migrations/                # schema, RPCs, RLS, storage
├── scripts/create-admin.mjs
├── tests/db/                      # PGlite security and lifecycle suite
├── docs/VERIFICATION.md
├── .env.example
└── vercel.json / public/_redirects
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Setup screen instead of login | `.env.local` missing or values still placeholders; restart `npm run dev`. |
| `student-login` returns 404/401 | Deploy with `--no-verify-jwt`; verify `SUPABASE_URL` and functions are deployed. |
| Admin cannot invite students | Edge Function `admin-students` not deployed or caller profile is not an active admin. |
| "Could not reach the server function" | The hosted site's origin is missing from `ALLOWED_ORIGIN` (or the function is not deployed). Set it to the exact site origin, redeploy, and confirm the preflight echoes that origin. |
| "Only published tests can be assigned" | Publish the test first; publishing validates sections, questions and marks. |
| "This test already has attempts…" | Structure/timing is frozen after the first attempt. Duplicate the test. |
| Delete test is missing | Tests with student attempts must be archived to keep their results. Only tests with zero attempts show the delete action. |
| Student sees no assignments | The assignment exists but the test was unpublished, or the student account is inactive. |
| Answer keys visible in preview only | Correct behaviour: admin preview shows keys; students only receive key-free RPC payloads. |
| Reset email never arrives | Students have internal emails; use admin password reset. For admins configure custom SMTP and Auth redirect URLs. |
| Autosave interrupted | Check network/Edge API availability; saved answers survive refresh and retry on the next edit or submit. |
| CORS error on Edge Function | Set `ALLOWED_ORIGIN` to the exact site origin (comma-separate several) and redeploy the function. |
| 401 JWT errors in the browser | Stale session; sign out/in. Ensure `VITE_SUPABASE_ANON_KEY` matches the project. |

---

## Operational notes

- Usernames are lowercase, unique (case-insensitive index), 3–32 characters.
- Student Auth emails are internal (`<username>@$STUDENT_EMAIL_DOMAIN`) unless an
  email is supplied when creating the account. Login always uses the username.
- Renaming a username does not recreate the Auth email; the stored profile email
  remains the login identifier resolved server-side.
- Deactivation bans the Auth user and flips `is_active`; RLS/RPCs additionally
  check activity on new operations. Existing read-only sessions expire with the
  access token.
- Admin reset issues a new temporary password and forces a change at next login.
- Test totals are derived from question marks; admins set marks per question and
  cannot publish an impossible passing threshold.
- Pagination is intentionally client-side for the company-sized lists in this
  release. For very large directories, add ranged queries and server-side search.

### Imported question banks

Three banks from the PetrodrillWCI Self Assessment Tool Google Forms are loaded
as **draft, unassigned** tests so they cannot reach students until an
administrator reviews them:

| Test | Sections | Questions | Marks | Layout |
| --- | --- | --- | --- | --- |
| Principles and Procedures (Full Bank) | 8 | 679 | 692 | 6 grids |
| Mock Test for Well Control | 6 | 416 | 450 | 13 grids (47 rows) |
| Equipment Home Assignment (Full Bank) | 16 | 312 | 429 | 25 grids (134 rows) |

- Every key is a placeholder (first option or first grid column) and short
  answers have no key yet. Set the real answers before publishing.
- Grids keep their sub-items as rows of one question and carry a single figure.
  The Equipment bank includes a 13-column callout grid (Cameron "DL" annular),
  which is why grids allow up to 15 columns and choice questions up to 30
  options.
- The Equipment bank's remote-panel fault matrix is one multiple-select with 24
  compound "symptom - cause" options, because the source asks the student to
  tick every matching box rather than rate each symptom separately.
- Short answers are graded manually; once a key is set, matching ignores case
  and whitespace.
- Figures from the source forms are attached to the questions they illustrate
  (77 files for Principles: 42 figures plus 35 answer-option images across 10
  questions). Kill-sheet data sheets are shared by every question in their
  calculation group. Where a question's stem only exists as a screenshot in the
  PDF, the text was transcribed into the prompt instead of attaching a duplicate
  picture. Clicking a question image (student card or admin preview) opens the
  full-size file in a new tab, which keeps the tall multi-page kill sheets
  readable.

