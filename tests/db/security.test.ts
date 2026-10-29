import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

type Row = Record<string, unknown>

let db: PGlite
let adminId: string
let studentOneId: string
let studentTwoId: string
let testAId: string
let testDId: string
let testEId: string
let testFId: string
let testGId: string
let testHId: string
let attemptAId: string

async function query<T extends Row = Row>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await db.query<T>(sql, params)
  return result.rows
}

async function exec(sql: string): Promise<void> {
  await db.exec(sql)
}

async function setSession(
  role: 'authenticated' | 'anon' | 'service_role' | 'postgres',
  userId?: string,
): Promise<void> {
  await exec('reset role')
  if (role === 'postgres') {
    await query("select set_config('request.jwt.claims', '', false)")
    return
  }
  await query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId ?? null, role }),
  ])
  await exec(`set role ${role}`)
}

function arrayLiteral(values: string[]): string {
  return `{${values.join(',')}}`
}

async function createUser(email: string, fullName: string): Promise<string> {
  const rows = await query<{ id: string }>(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
    [email, JSON.stringify({ full_name: fullName })],
  )
  return rows[0].id
}

type QuestionSeed = {
  type:
    | 'single_choice'
    | 'multiple_select'
    | 'true_false'
    | 'short_answer'
    | 'grid'
  prompt: string
  marks: number
  options?: { id: string; text: string }[]
  rows?: { id: string; text: string }[]
  correct?: string[]
  answerKey?: string
  answerAliases?: string[]
}

async function createPublishedTest(options: {
  title: string
  showResults?: boolean
  attemptLimit?: number
  durationMinutes?: number | null
  passingMarks?: number
  questions: QuestionSeed[]
  startAt?: string | null
  endAt?: string | null
}): Promise<string> {
  const testRows = await query<{ id: string }>(
    `insert into public.tests
      (title, description, instructions, duration_minutes, passing_marks,
       attempt_limit, show_results, created_by, start_at, end_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      options.title,
      'Test description',
      'Test instructions',
      options.durationMinutes ?? null,
      options.passingMarks ?? 0,
      options.attemptLimit ?? 1,
      options.showResults ?? false,
      adminId,
      options.startAt ?? null,
      options.endAt ?? null,
    ],
  )
  const testId = testRows[0].id

  const sectionRows = await query<{ id: string }>(
    'insert into public.sections (test_id, title, description, position) values ($1, $2, $3, 0) returning id',
    [testId, 'Section one', 'Section description'],
  )
  const sectionId = sectionRows[0].id

  let position = 0
  for (const question of options.questions) {
    await query(
      `insert into public.questions
        (section_id, question_type, prompt, marks, is_required, options,
         correct_options, answer_key, answer_aliases, explanation, position, grid_rows)
       values ($1, $2::public.question_type, $3, $4, true, $5::jsonb,
               $6::text[], $7, $8::text[], $9, $10, $11::jsonb)`,
      [
        sectionId,
        question.type,
        question.prompt,
        question.marks,
        JSON.stringify(question.options ?? []),
        arrayLiteral(question.correct ?? []),
        question.answerKey ?? null,
        arrayLiteral(question.answerAliases ?? []),
        question.type === 'single_choice' ? 'Explained in the training.' : null,
        position,
        JSON.stringify(question.rows ?? []),
      ],
    )
    position += 1
  }

  await query('update public.tests set status = $1 where id = $2', [
    'published',
    testId,
  ])
  return testId
}

async function assignTest(testId: string, studentIds: string[]): Promise<number> {
  await setSession('authenticated', adminId)
  try {
    const rows = await query<{ assign_test: number }>(
      `select public.assign_test($1, array[${studentIds.map((id) => `'${id}'::uuid`).join(',')}]::uuid[], null, null) as assign_test`,
      [testId],
    )
    return rows[0].assign_test
  } finally {
    await setSession('postgres')
  }
}

async function startAttempt(
  assignmentId: string,
  feedbackMode: 'after_submit' | 'immediate' = 'after_submit',
): Promise<string> {
  await setSession('authenticated', studentOneId)
  try {
    const rows = await query<{ attempt_id: string }>(
      'select public.start_attempt($1, $2) as attempt_id',
      [assignmentId, feedbackMode],
    )
    return rows[0].attempt_id
  } finally {
    await setSession('postgres')
  }
}

async function checkResponse(
  attemptId: string,
  questionId: string,
): Promise<{
  question_id: string
  is_correct: boolean
  awarded_marks: number
  marks: number
  correct_options: string[]
  answer_key: string | null
  explanation: string | null
}> {
  await setSession('authenticated', studentOneId)
  try {
    return await jsonRpc('check_response', [attemptId, questionId])
  } finally {
    await setSession('postgres')
  }
}

async function saveAnswer(
  attemptId: string,
  questionId: string,
  selected: string[],
  text: string | null,
  flagged = false,
): Promise<{ attempt_status: string }> {
  await setSession('authenticated', studentOneId)
  try {
    const rows = await query<{ attempt_status: string }>(
      `select * from public.save_response(
        $1, $2, '${arrayLiteral(selected)}'::text[], $3, $4
      )`,
      [attemptId, questionId, text, flagged],
    )
    return rows[0]
  } finally {
    await setSession('postgres')
  }
}

async function jsonRpc<T>(name: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ')
  const rows = await query<{ result: T }>(
    `select public.${name}(${placeholders}) as result`,
    args,
  )
  return rows[0].result
}

describe('PWCI database, RLS and assessment lifecycle', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.waitReady

    const shim = readFileSync(join(process.cwd(), 'tests/db/shim.sql'), 'utf8')
    await exec(shim)

    const migrationsDirectory = join(process.cwd(), 'supabase/migrations')
    const migrations = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    for (const migration of migrations) {
      await exec(readFileSync(join(migrationsDirectory, migration), 'utf8'))
    }

    adminId = await createUser('admin@example.com', 'Admin User')
    studentOneId = await createUser('student.one@example.com', 'Student One')
    studentTwoId = await createUser('student.two@example.com', 'Student Two')

    await query(
      `update public.profiles set role = 'admin', full_name = 'Admin User',
        username = null, is_active = true, must_change_password = false
       where id = $1`,
      [adminId],
    )
    await query(
      `update public.profiles set username = 'student.one', full_name = 'Student One',
        department = 'Finance', batch = '2026-Q1', must_change_password = false
       where id = $1`,
      [studentOneId],
    )
    await query(
      `update public.profiles set username = 'student.two', full_name = 'Student Two',
        department = 'Operations', batch = '2026-Q1', must_change_password = false
       where id = $1`,
      [studentTwoId],
    )

    testAId = await createPublishedTest({
      title: 'Compliance basics',
      passingMarks: 6,
      questions: [
        {
          type: 'single_choice',
          prompt: 'Pick A',
          marks: 2,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
          ],
          correct: ['a'],
        },
        {
          type: 'multiple_select',
          prompt: 'Pick A and B',
          marks: 3,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
            { id: 'c', text: 'Gamma' },
          ],
          correct: ['a', 'b'],
        },
        {
          type: 'true_false',
          prompt: 'The sky is blue',
          marks: 1,
          options: [
            { id: 'true', text: 'True' },
            { id: 'false', text: 'False' },
          ],
          correct: ['true'],
        },
        {
          type: 'single_choice',
          prompt: 'Pick B',
          marks: 2,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
          ],
          correct: ['b'],
        },
        {
          type: 'short_answer',
          prompt: 'Explain the policy',
          marks: 4,
          answerKey: 'The policy requires annual review.',
        },
      ],
    })

    // Test assigned only to student two, to prove isolation.
    const testBId = await createPublishedTest({
      title: 'Operations only',
      showResults: true,
      questions: [
        {
          type: 'true_false',
          prompt: 'Operations is fun',
          marks: 1,
          options: [
            { id: 'true', text: 'True' },
            { id: 'false', text: 'False' },
          ],
          correct: ['true'],
        },
      ],
    })
    await query(
      `insert into public.test_assignments (test_id, student_id, assigned_by)
       values ($1, $2, $3)`,
      [testBId, studentTwoId, adminId],
    )

    testDId = await createPublishedTest({
      title: 'Timed safety check',
      durationMinutes: 1,
      passingMarks: 1,
      questions: [
        {
          type: 'single_choice',
          prompt: 'Safety first?',
          marks: 2,
          options: [
            { id: 'yes', text: 'Yes' },
            { id: 'no', text: 'No' },
          ],
          correct: ['yes'],
        },
      ],
    })

    testEId = await createPublishedTest({
      title: 'Expired window',
      passingMarks: 0,
      questions: [
        {
          type: 'true_false',
          prompt: 'This assignment is expired',
          marks: 1,
          options: [
            { id: 'true', text: 'True' },
            { id: 'false', text: 'False' },
          ],
          correct: ['true'],
        },
      ],
    })

    const inserted = await assignTest(testAId, [studentOneId])
    expect(inserted).toBe(1)
    await assignTest(testDId, [studentOneId])

    testFId = await createPublishedTest({
      title: 'Instant feedback practice',
      showResults: true,
      questions: [
        {
          type: 'single_choice',
          prompt: 'Pick A instantly',
          marks: 2,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
          ],
          correct: ['a'],
        },
        {
          type: 'multiple_select',
          prompt: 'Pick X and Y instantly',
          marks: 2,
          options: [
            { id: 'x', text: 'Xray' },
            { id: 'y', text: 'Yankee' },
            { id: 'z', text: 'Zulu' },
          ],
          correct: ['x', 'y'],
        },
        {
          type: 'short_answer',
          prompt: 'How often is the policy reviewed?',
          marks: 3,
          answerKey: 'Annual review',
        },
      ],
    })
    await assignTest(testFId, [studentOneId])

    testGId = await createPublishedTest({
      title: 'Grid inspection',
      showResults: true,
      questions: [
        {
          type: 'grid',
          prompt: 'Inspect the stack',
          marks: 4,
          rows: [
            { id: 'r1', text: 'Row one is correct' },
            { id: 'r2', text: 'Row two is correct' },
          ],
          options: [
            { id: 'no', text: 'No' },
            { id: 'yes', text: 'Yes' },
          ],
          correct: ['r1:yes', 'r2:no'],
        },
      ],
    })
    await assignTest(testGId, [studentOneId])

    testHId = await createPublishedTest({
      title: 'Grid instant practice',
      showResults: true,
      questions: [
        {
          type: 'grid',
          prompt: 'Check the valves',
          marks: 3,
          rows: [
            { id: 'v1', text: 'Valve one' },
            { id: 'v2', text: 'Valve two' },
          ],
          options: [
            { id: 'open', text: 'Open' },
            { id: 'shut', text: 'Shut' },
          ],
          correct: ['v1:shut', 'v2:shut'],
        },
      ],
    })
    await assignTest(testHId, [studentOneId])

    await query(
      `insert into public.test_assignments (test_id, student_id, assigned_by, due_at)
       values ($1, $2, $3, now() - interval '1 hour')`,
      [testEId, studentOneId, adminId],
    )

    const attempts = await query<{ id: string }>(
      `select id from public.attempts limit 1`,
    )
    expect(attempts).toHaveLength(0)
  })

  afterAll(async () => {
    await db?.close()
  })

  it('creates profiles through the auth trigger and syncs test marks', async () => {
    const profiles = await query<{ count: number }>(
      `select count(*)::int as count from public.profiles`,
    )
    expect(profiles[0].count).toBe(3)

    const testRow = await query<{ max_marks: string; status: string }>(
      `select max_marks::text, status::text from public.tests where id = $1`,
      [testAId],
    )
    expect(Number(testRow[0].max_marks)).toBe(12)
    expect(testRow[0].status).toBe('published')
  })

  it('hides tests, sections, questions and other profiles from students', async () => {
    await setSession('authenticated', studentOneId)
    try {
      const tests = await query<{ count: number }>(
        'select count(*)::int as count from public.tests',
      )
      const questions = await query<{ count: number }>(
        'select count(*)::int as count from public.questions',
      )
      const profiles = await query<{ id: string }>(
        'select id from public.profiles',
      )
      expect(tests[0].count).toBe(0)
      expect(questions[0].count).toBe(0)
      expect(profiles.map((profile) => profile.id)).toEqual([studentOneId])
    } finally {
      await setSession('postgres')
    }
  })

  it('shows each student only their own assignments', async () => {
    await setSession('authenticated', studentOneId)
    try {
      const dashboard = await jsonRpc<{
        assignments: { title: string }[]
      }>('get_student_dashboard')
      const titles = dashboard.assignments.map((assignment) => assignment.title)
      expect(titles).toContain('Compliance basics')
      expect(titles).toContain('Timed safety check')
      expect(titles).not.toContain('Operations only')
      expect(JSON.stringify(dashboard)).not.toContain('correct_options')
      expect(JSON.stringify(dashboard)).not.toContain('answer_key')
    } finally {
      await setSession('postgres')
    }

    await setSession('authenticated', studentTwoId)
    try {
      const dashboard = await jsonRpc<{
        assignments: { title: string }[]
      }>('get_student_dashboard')
      expect(dashboard.assignments.map((assignment) => assignment.title)).toEqual([
        'Operations only',
      ])
    } finally {
      await setSession('postgres')
    }
  })

  it('runs the attempt lifecycle without exposing answer keys', async () => {
    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testAId, studentOneId],
    )
    const assignmentId = assignmentRows[0].id

    attemptAId = await startAttempt(assignmentId)

    await setSession('authenticated', studentOneId)
    let state: {
      attempt: { status: string; seconds_remaining: number | null }
      sections: {
        questions: { id: string; prompt: string }[]
      }[]
      responses: unknown[]
    }
    try {
      state = await jsonRpc('get_attempt_state', [attemptAId])
    } finally {
      await setSession('postgres')
    }

    expect(state.attempt.status).toBe('in_progress')
    expect(state.attempt.seconds_remaining).toBeNull()
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('correct_options')
    expect(serialized).not.toContain('answer_key')
    expect(serialized).not.toContain('The policy requires annual review')
    expect(state.sections[0].questions).toHaveLength(5)

    const questionRows = await query<{
      id: string
      prompt: string
      question_type: string
    }>(
      `select q.id, q.prompt, q.question_type::text as question_type
       from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1 order by q.position`,
      [testAId],
    )
    const [q1, q2, q3, q4, q5] = questionRows

    expect((await saveAnswer(attemptAId, q1.id, ['a'], null)).attempt_status).toBe(
      'in_progress',
    )
    expect(
      (await saveAnswer(attemptAId, q2.id, ['a', 'b'], null)).attempt_status,
    ).toBe('in_progress')
    expect(
      (await saveAnswer(attemptAId, q3.id, ['true'], null, true)).attempt_status,
    ).toBe('in_progress')
    await saveAnswer(attemptAId, q4.id, ['a'], null)
    await saveAnswer(attemptAId, q5.id, [], 'Because the policy says so.')

    await setSession('authenticated', studentOneId)
    let resumed: {
      responses: {
        question_id: string
        selected_options: string[]
        text_answer: string | null
        is_flagged: boolean
      }[]
    }
    try {
      resumed = await jsonRpc('get_attempt_state', [attemptAId])
      await expect(
        jsonRpc('get_attempt_review', [attemptAId]),
      ).rejects.toThrow(/not been submitted/i)
    } finally {
      await setSession('postgres')
    }

    const q3Response = resumed.responses.find(
      (response) => response.question_id === q3.id,
    )
    expect(q3Response?.selected_options).toEqual(['true'])
    expect(q3Response?.is_flagged).toBe(true)
    expect(JSON.stringify(resumed)).not.toContain('correct_options')

    await setSession('authenticated', studentOneId)
    let submitted: {
      id: string
      status: string
      score: string
      max_marks: string
      submitted_at: string
      time_taken_seconds: number
    }
    try {
      const rows = await query<typeof submitted>(
        'select * from public.submit_attempt($1)',
        [attemptAId],
      )
      submitted = rows[0]
    } finally {
      await setSession('postgres')
    }

    expect(submitted.status).toBe('graded')
    expect(Number(submitted.score)).toBe(6)
    expect(Number(submitted.max_marks)).toBe(12)
    expect(submitted.submitted_at).toBeTruthy()

    const firstSubmittedAt = submitted.submitted_at
    await setSession('authenticated', studentOneId)
    try {
      const rows = await query<{ status: string; submitted_at: string }>(
        'select status::text, submitted_at from public.submit_attempt($1)',
        [attemptAId],
      )
      expect(rows[0].status).toBe('graded')
      expect(new Date(rows[0].submitted_at).getTime()).toBe(
        new Date(firstSubmittedAt).getTime(),
      )
    } finally {
      await setSession('postgres')
    }

    const attemptCount = await query<{ count: number }>(
      'select count(*)::int as count from public.attempts where assignment_id = $1',
      [assignmentId],
    )
    expect(attemptCount[0].count).toBe(1)

    const storedResponse = await query<{
      selected_options: string[]
      text_answer: string | null
    }>(
      `select r.selected_options, r.text_answer
       from public.responses r
       join public.questions q on q.id = r.question_id
       where r.attempt_id = $1 and q.prompt = 'Explain the policy'`,
      [attemptAId],
    )
    expect(storedResponse[0].text_answer).toBe('Because the policy says so.')

    // Short answers with a single expected answer are auto-graded at submit:
    // a mismatch earns zero and needs no manual review.
    const autoGraded = await query<{
      awarded_marks: string
      is_correct: boolean
      graded_at: string | null
    }>(
      `select r.awarded_marks::text, r.is_correct, r.graded_at
       from public.responses r
       join public.questions q on q.id = r.question_id
       where r.attempt_id = $1 and q.prompt = 'Explain the policy'`,
      [attemptAId],
    )
    expect(Number(autoGraded[0].awarded_marks)).toBe(0)
    expect(autoGraded[0].is_correct).toBe(false)
    expect(autoGraded[0].graded_at).toBeTruthy()

    await expect(startAttempt(assignmentId)).rejects.toThrow(/used all/i)
  })

  it('requires admin access for the admin API and hides results when disabled', async () => {
    await setSession('authenticated', studentOneId)
    try {
      await expect(jsonRpc('admin_dashboard_stats')).rejects.toThrow(
        /Administrator access required/i,
      )
      await expect(
        jsonRpc('get_admin_attempt_detail', [attemptAId]),
      ).rejects.toThrow(/results access required/i)

      const review = await jsonRpc<{ allowed: boolean }>('get_attempt_review', [
        attemptAId,
      ])
      expect(review.allowed).toBe(false)
      expect(JSON.stringify(review)).not.toContain('correct_options')
    } finally {
      await setSession('postgres')
    }

    await setSession('authenticated', adminId)
    try {
      const detail = await jsonRpc<{
        sections: {
          questions: {
            answer_key: string | null
            prompt: string
            response: { text_answer: string | null } | null
          }[]
        }[]
        totals: { score: number; pending_manual: number; passed: boolean }
      }>('get_admin_attempt_detail', [attemptAId])
      expect(detail.totals.pending_manual).toBe(0)
      expect(detail.totals.score).toBe(6)
      const shortAnswer = detail.sections[0].questions.find(
        (question) => question.prompt === 'Explain the policy',
      )
      expect(shortAnswer?.answer_key).toBe('The policy requires annual review.')
      expect(shortAnswer?.response?.text_answer).toBe('Because the policy says so.')
    } finally {
      await setSession('postgres')
    }

    // Enable result visibility, then override the auto-grade of the short
    // answer (admins can still adjust a short answer after submission).
    await query('update public.tests set show_results = true where id = $1', [
      testAId,
    ])

    const shortResponse = await query<{ id: string }>(
      `select r.id from public.responses r
       join public.questions q on q.id = r.question_id
       where r.attempt_id = $1 and q.question_type = 'short_answer'`,
      [attemptAId],
    )

    await setSession('authenticated', adminId)
    try {
      const graded = await query<{
        score: string
        status: string
      }>('select * from public.grade_response($1, $2)', [
        shortResponse[0].id,
        3,
      ])
      expect(Number(graded[0].score)).toBe(9)
      expect(graded[0].status).toBe('graded')
    } finally {
      await setSession('postgres')
    }

    await setSession('authenticated', studentOneId)
    try {
      const review = await jsonRpc<{
        allowed: boolean
        sections: { questions: { correct_options: string[] }[] }[]
        totals: { score: number; pending_manual: number; passed: boolean }
      }>('get_attempt_review', [attemptAId])
      expect(review.allowed).toBe(true)
      expect(review.totals.score).toBe(9)
      expect(review.totals.pending_manual).toBe(0)
      expect(review.totals.passed).toBe(true)
      expect(review.sections[0].questions[0].correct_options).toEqual(['a'])
    } finally {
      await setSession('postgres')
    }
  })

  it('blocks direct writes and cross-student access', async () => {
    const assignmentA = await query<{ id: string }>(
      'select id from public.test_assignments where test_id = $1',
      [testAId],
    )

    await setSession('authenticated', studentOneId)
    try {
      const attemptsBefore = await query<{ score: string | null }>(
        'select score from public.attempts where id = $1',
        [attemptAId],
      )
      expect(attemptsBefore).toHaveLength(1)

      await expect(
        query('update public.attempts set score = 100 where id = $1', [
          attemptAId,
        ]),
      ).rejects.toThrow(/permission denied/i)

      await expect(
        query(
          `insert into public.test_assignments (test_id, student_id)
           values ($1, $2)`,
          [testAId, studentOneId],
        ),
      ).rejects.toThrow(/row-level security|violates/i)

      const roleUpdate = await query<{ id: string }>(
        `update public.profiles set role = 'admin' where id = $1 returning id`,
        [studentOneId],
      )
      expect(roleUpdate).toHaveLength(0)

      const assignments = await query<{ student_id: string }>(
        'select student_id from public.test_assignments',
      )
      expect(assignments.every((row) => row.student_id === studentOneId)).toBe(true)
    } finally {
      await setSession('postgres')
    }

    const role = await query<{ role: string }>(
      'select role::text from public.profiles where id = $1',
      [studentOneId],
    )
    expect(role[0].role).toBe('student')

    await setSession('authenticated', studentTwoId)
    try {
      await expect(
        jsonRpc('get_attempt_state', [attemptAId]),
      ).rejects.toThrow(/Attempt not found/i)
      await expect(
        jsonRpc('get_attempt_review', [attemptAId]),
      ).rejects.toThrow(/Attempt not found/i)

      const leaked = await query('select id from public.attempts where id = $1', [
        attemptAId,
      ])
      expect(leaked).toHaveLength(0)

      await expect(
        query('select public.start_attempt($1)', [assignmentA[0].id]),
      ).rejects.toThrow(/Assignment not found/i)
    } finally {
      await setSession('postgres')
    }

    await setSession('anon')
    try {
      await expect(query('select count(*) from public.tests')).rejects.toThrow(
        /permission denied/i,
      )
    } finally {
      await setSession('postgres')
    }
  })

  it('auto-finals attempts at the server deadline and rejects expired assignments', async () => {
    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testDId, studentOneId],
    )
    const attemptDId = await startAttempt(assignmentRows[0].id)

    await query(
      `update public.attempts
       set started_at = now() - interval '5 minutes'
       where id = $1`,
      [attemptDId],
    )

    const questionRows = await query<{ id: string }>(
      `select q.id from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1`,
      [testDId],
    )
    const late = await saveAnswer(attemptDId, questionRows[0].id, ['yes'], null)
    expect(late.attempt_status).toBe('graded')

    const attemptRow = await query<{
      status: string
      submitted_at: string
      time_taken_seconds: number
    }>(
      'select status::text, submitted_at, time_taken_seconds from public.attempts where id = $1',
      [attemptDId],
    )
    expect(attemptRow[0].status).toBe('graded')
    expect(attemptRow[0].time_taken_seconds).toBe(60)

    const responseRow = await query<{ selected_options: string[] }>(
      'select selected_options from public.responses where attempt_id = $1 and question_id = $2',
      [attemptDId, questionRows[0].id],
    )
    expect(responseRow[0].selected_options).toEqual([])

    const expiredAssignment = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testEId, studentOneId],
    )
    await expect(startAttempt(expiredAssignment[0].id)).rejects.toThrow(
      /expired/i,
    )
  })

  it('reports accurate admin statistics and supports duplication and publish validation', async () => {
    await setSession('authenticated', adminId)
    let stats: {
      active_students: number
      total_tests: number
      published_tests: number
      completed_attempts: number
      pending_review: number
      recent_submissions: unknown[]
    }
    try {
      stats = await jsonRpc('admin_dashboard_stats')
      const duplicateId = await jsonRpc<string>('duplicate_test', [testAId])

      const duplicated = await query<{
        status: string
        max_marks: string
        question_count: number
      }>(
        `select t.status::text, t.max_marks::text,
           (select count(*)::int from public.questions q
            join public.sections s on s.id = q.section_id
            where s.test_id = t.id) as question_count
         from public.tests t where t.id = $1`,
        [duplicateId],
      )
      expect(duplicated[0].status).toBe('draft')
      expect(Number(duplicated[0].max_marks)).toBe(12)
      expect(duplicated[0].question_count).toBe(5)

      const emptyTest = await query<{ id: string }>(
        `insert into public.tests (title, created_by) values ('Empty draft', $1) returning id`,
        [adminId],
      )
      await expect(
        jsonRpc('set_test_status', [emptyTest[0].id, 'published']),
      ).rejects.toThrow(/at least one section/i)

      await expect(
        query('update public.tests set passing_marks = 20 where id = $1', [
          testAId,
        ]),
      ).rejects.toThrow(/passing marks cannot exceed/i)
    } finally {
      await setSession('postgres')
    }

    expect(stats.active_students).toBe(2)
    expect(stats.total_tests).toBeGreaterThanOrEqual(4)
    expect(stats.published_tests).toBeGreaterThanOrEqual(3)
    expect(stats.completed_attempts).toBe(2)
    expect(stats.pending_review).toBe(0)
    expect(stats.recent_submissions.length).toBe(2)
  })

  it('enforces storage bucket configuration and admin-only writes', async () => {
    const buckets = await query<{ public: boolean; name: string }>(
      `select public, name from storage.buckets where id = 'question-images'`,
    )
    expect(buckets).toHaveLength(1)
    expect(buckets[0].public).toBe(true)

    await setSession('authenticated', studentOneId)
    try {
      await expect(
        query(
          `insert into storage.objects (bucket_id, name) values ('question-images', 'student-upload.png')`,
        ),
      ).rejects.toThrow(/row-level security|permission denied/i)
    } finally {
      await setSession('postgres')
    }

    await setSession('authenticated', adminId)
    try {
      await query(
        `insert into storage.objects (bucket_id, name) values ('question-images', 'admin-upload.png')`,
      )
      const uploaded = await query<{ count: number }>(
        `select count(*)::int as count from storage.objects where bucket_id = 'question-images'`,
      )
      expect(uploaded[0].count).toBeGreaterThanOrEqual(1)
    } finally {
      await setSession('postgres')
    }
  })

  it('checks answers immediately, allows retries until correct, and reveals the key only on success', async () => {
    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testFId, studentOneId],
    )
    const attemptId = await startAttempt(assignmentRows[0].id, 'immediate')

    const storedMode = await query<{ feedback_mode: string }>(
      'select feedback_mode from public.attempts where id = $1',
      [attemptId],
    )
    expect(storedMode[0].feedback_mode).toBe('immediate')

    const questionRows = await query<{
      id: string
      prompt: string
    }>(
      `select q.id, q.prompt
       from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1 order by q.position`,
      [testFId],
    )
    const [q1, q2, q3] = questionRows

    await setSession('authenticated', studentOneId)
    let initialState: {
      attempt: { feedback_mode: string }
      responses: {
        question_id: string
        feedback: unknown
      }[]
    }
    try {
      initialState = await jsonRpc('get_attempt_state', [attemptId])
    } finally {
      await setSession('postgres')
    }
    expect(initialState.attempt.feedback_mode).toBe('immediate')
    expect(initialState.responses).toHaveLength(0)
    const initialSerialized = JSON.stringify(initialState)
    expect(initialSerialized).not.toContain('correct_options')
    expect(initialSerialized).not.toContain('answer_key')
    expect(initialSerialized).not.toContain('Annual review')

    // Nothing can be checked before a response exists.
    await expect(checkResponse(attemptId, q1.id)).rejects.toThrow(
      /Answer the question/i,
    )

    // A wrong choice shows red, awards nothing and reveals nothing.
    await saveAnswer(attemptId, q1.id, ['b'], null)
    const wrong = await checkResponse(attemptId, q1.id)
    expect(wrong.is_correct).toBe(false)
    expect(wrong.awarded_marks).toBe(0)
    expect(wrong.marks).toBe(2)
    expect(wrong.correct_options).toEqual([])
    expect(wrong.answer_key).toBeNull()
    expect(wrong.explanation).toBeNull()

    const wrongRow = await query<{
      awarded_marks: string | null
      graded_at: string | null
      checked_at: string | null
      check_attempts: number
    }>(
      `select awarded_marks::text, graded_at::text, checked_at::text, check_attempts
       from public.responses where attempt_id = $1 and question_id = $2`,
      [attemptId, q1.id],
    )
    expect(wrongRow[0].awarded_marks).toBeNull()
    expect(wrongRow[0].graded_at).toBeNull()
    expect(wrongRow[0].checked_at).not.toBeNull()
    expect(wrongRow[0].check_attempts).toBe(1)

    // The answer stays editable; flagging alone preserves the red state.
    const flagged = await saveAnswer(attemptId, q1.id, ['b'], null, true)
    expect(flagged.attempt_status).toBe('in_progress')
    const flaggedRow = await query<{ is_flagged: boolean }>(
      'select is_flagged from public.responses where attempt_id = $1 and question_id = $2',
      [attemptId, q1.id],
    )
    expect(flaggedRow[0].is_flagged).toBe(true)

    await setSession('authenticated', studentOneId)
    let flaggedState: {
      responses: {
        question_id: string
        feedback: {
          is_correct: boolean
          correct_options: string[]
          answer_key: string | null
        } | null
      }[]
    }
    try {
      flaggedState = await jsonRpc('get_attempt_state', [attemptId])
    } finally {
      await setSession('postgres')
    }
    const flaggedQ1 = flaggedState.responses.find(
      (response) => response.question_id === q1.id,
    )
    expect(flaggedQ1?.feedback?.is_correct).toBe(false)
    expect(flaggedQ1?.feedback?.correct_options).toEqual([])
    expect(flaggedQ1?.feedback?.answer_key).toBeNull()
    expect(JSON.stringify(flaggedState)).not.toContain('Annual review')

    // Changing the answer clears the red state.
    await saveAnswer(attemptId, q1.id, ['a'], null)
    await setSession('authenticated', studentOneId)
    let clearedState: {
      responses: {
        question_id: string
        feedback: unknown
      }[]
    }
    try {
      clearedState = await jsonRpc('get_attempt_state', [attemptId])
    } finally {
      await setSession('postgres')
    }
    expect(
      clearedState.responses.find((response) => response.question_id === q1.id)
        ?.feedback ?? null,
    ).toBeNull()

    // Checking the new answer succeeds, reveals the key and locks it.
    const right = await checkResponse(attemptId, q1.id)
    expect(right.is_correct).toBe(true)
    expect(right.awarded_marks).toBe(2)
    expect(right.correct_options).toEqual(['a'])
    await expect(saveAnswer(attemptId, q1.id, ['b'], null)).rejects.toThrow(
      /locked/i,
    )

    // Re-checking a correct answer is stable and does not regrade.
    const repeated = await checkResponse(attemptId, q1.id)
    expect(repeated.is_correct).toBe(true)
    expect(repeated.awarded_marks).toBe(2)
    const stableRow = await query<{ check_attempts: number }>(
      'select check_attempts from public.responses where attempt_id = $1 and question_id = $2',
      [attemptId, q1.id],
    )
    expect(stableRow[0].check_attempts).toBe(2)

    await expect(checkResponse(attemptId, q2.id)).rejects.toThrow(
      /Answer the question/i,
    )

    // Short answers can also be retried, and only success reveals the key.
    await saveAnswer(attemptId, q3.id, [], 'Something else entirely')
    const shortWrong = await checkResponse(attemptId, q3.id)
    expect(shortWrong.is_correct).toBe(false)
    expect(shortWrong.awarded_marks).toBe(0)
    expect(shortWrong.answer_key).toBeNull()

    await saveAnswer(attemptId, q3.id, [], '  ANNUAL   REVIEW  ')
    const shortCheck = await checkResponse(attemptId, q3.id)
    expect(shortCheck.is_correct).toBe(true)
    expect(shortCheck.awarded_marks).toBe(3)
    expect(shortCheck.answer_key).toBe('Annual review')
    await expect(
      saveAnswer(attemptId, q3.id, [], 'Something else entirely'),
    ).rejects.toThrow(/locked/i)

    // Multi-select must match the full key, but a wrong check can be retried.
    await saveAnswer(attemptId, q2.id, ['x'], null)
    const partial = await checkResponse(attemptId, q2.id)
    expect(partial.is_correct).toBe(false)
    expect(partial.awarded_marks).toBe(0)
    expect(partial.correct_options).toEqual([])

    await saveAnswer(attemptId, q2.id, ['x', 'y'], null)
    const full = await checkResponse(attemptId, q2.id)
    expect(full.is_correct).toBe(true)
    expect(full.awarded_marks).toBe(2)
    expect(full.correct_options).toEqual(['x', 'y'])

    await setSession('authenticated', studentOneId)
    try {
      const submitted = await query<{ status: string; score: string }>(
        'select status::text, score::text from public.submit_attempt($1)',
        [attemptId],
      )
      expect(submitted[0].status).toBe('graded')
      expect(Number(submitted[0].score)).toBe(7)
      await expect(checkResponse(attemptId, q1.id)).rejects.toThrow(
        /no longer open/i,
      )
    } finally {
      await setSession('postgres')
    }

    // Instant feedback is unavailable when result visibility is off.
    const hiddenAssignment = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testDId, studentOneId],
    )
    await expect(
      startAttempt(hiddenAssignment[0].id, 'immediate'),
    ).rejects.toThrow(/instant feedback is unavailable/i)
  })

  it('stores grid answers as row/column pairs and grades them at submit', async () => {
    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testGId, studentOneId],
    )
    const attemptId = await startAttempt(assignmentRows[0].id)

    await setSession('authenticated', studentOneId)
    let state: {
      sections: {
        questions: {
          id: string
          question_type: string
          rows: { id: string; text: string }[]
        }[]
      }[]
    }
    try {
      state = await jsonRpc('get_attempt_state', [attemptId])
    } finally {
      await setSession('postgres')
    }

    const grid = state.sections[0].questions[0]
    expect(grid.question_type).toBe('grid')
    expect(grid.rows.map((row) => row.id)).toEqual(['r1', 'r2'])
    expect(JSON.stringify(state)).not.toContain('correct_options')

    // Invalid row/column pairs and duplicate rows are rejected.
    await expect(
      saveAnswer(attemptId, grid.id, ['r1:maybe'], null),
    ).rejects.toThrow(/invalid/i)
    await expect(
      saveAnswer(attemptId, grid.id, ['r1:yes', 'r1:no'], null),
    ).rejects.toThrow(/one answer per row/i)
    await expect(
      saveAnswer(attemptId, grid.id, ['r1yes'], null),
    ).rejects.toThrow(/invalid/i)

    // A partial grid saves while the student is working.
    await saveAnswer(attemptId, grid.id, ['r1:yes'], null)
    const partial = await query<{ selected_options: string[] }>(
      'select selected_options from public.responses where attempt_id = $1 and question_id = $2',
      [attemptId, grid.id],
    )
    expect(partial[0].selected_options).toEqual(['r1:yes'])

    await saveAnswer(attemptId, grid.id, ['r1:yes', 'r2:no'], null)

    await setSession('authenticated', studentOneId)
    try {
      const rows = await query<{ status: string; score: string }>(
        'select status::text, score::text from public.submit_attempt($1)',
        [attemptId],
      )
      expect(rows[0].status).toBe('graded')
      expect(Number(rows[0].score)).toBe(4)
    } finally {
      await setSession('postgres')
    }
  })

  it('requires every grid row before checking and only reveals the grid key on success', async () => {
    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testHId, studentOneId],
    )
    const attemptId = await startAttempt(assignmentRows[0].id, 'immediate')

    const questionRows = await query<{ id: string }>(
      `select q.id from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1`,
      [testHId],
    )
    const questionId = questionRows[0].id

    await saveAnswer(attemptId, questionId, ['v1:shut'], null)
    await expect(checkResponse(attemptId, questionId)).rejects.toThrow(
      /every row/i,
    )

    await saveAnswer(attemptId, questionId, ['v1:open', 'v2:open'], null)
    const wrong = await checkResponse(attemptId, questionId)
    expect(wrong.is_correct).toBe(false)
    expect(wrong.awarded_marks).toBe(0)
    expect(wrong.marks).toBe(3)
    expect(wrong.correct_options).toEqual([])

    // A wrong grid stays editable; the correct grid reveals the key and locks.
    await saveAnswer(attemptId, questionId, ['v1:shut', 'v2:shut'], null)
    const right = await checkResponse(attemptId, questionId)
    expect(right.is_correct).toBe(true)
    expect(right.awarded_marks).toBe(3)
    expect(right.correct_options).toEqual(['v1:shut', 'v2:shut'])

    await expect(
      saveAnswer(attemptId, questionId, ['v1:open', 'v2:open'], null),
    ).rejects.toThrow(/locked/i)
  })

  it('accepts a range of short answers and compares numbers by value', async () => {
    const testId = await createPublishedTest({
      title: 'Answer range practice',
      showResults: true,
      attemptLimit: 4,
      questions: [
        {
          type: 'short_answer',
          prompt: 'What is the value?',
          marks: 2,
          answerKey: '0.12',
          answerAliases: ['0.1', '0.128'],
        },
      ],
    })
    await assignTest(testId, [studentOneId])

    const assignmentRows = await query<{ id: string }>(
      `select id from public.test_assignments where test_id = $1 and student_id = $2`,
      [testId, studentOneId],
    )
    const questionRows = await query<{ id: string }>(
      `select q.id from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1`,
      [testId],
    )
    const questionId = questionRows[0].id

    const cases = [
      { answer: '0.120', expected: 2 },
      { answer: ' 0.1 ', expected: 2 },
      { answer: '0.128', expected: 2 },
      { answer: '0.13', expected: 0 },
    ]

    let firstAttemptId = ''
    for (const testCase of cases) {
      const attemptId = await startAttempt(assignmentRows[0].id)
      if (!firstAttemptId) firstAttemptId = attemptId
      await saveAnswer(attemptId, questionId, [], testCase.answer)
      await setSession('authenticated', studentOneId)
      try {
        const submitted = await query<{ status: string; score: string }>(
          'select status::text, score::text from public.submit_attempt($1)',
          [attemptId],
        )
        expect(submitted[0].status).toBe('graded')
        expect(Number(submitted[0].score)).toBe(testCase.expected)
      } finally {
        await setSession('postgres')
      }
    }

    // The accepted alternatives are visible on the result for staff and student.
    await setSession('authenticated', studentOneId)
    let review: {
      sections: { questions: { answer_aliases: string[] }[] }[]
    }
    try {
      review = await jsonRpc('get_attempt_review', [firstAttemptId])
    } finally {
      await setSession('postgres')
    }
    expect(review.sections[0].questions[0].answer_aliases).toEqual([
      '0.1',
      '0.128',
    ])

    await setSession('authenticated', adminId)
    let detail: {
      sections: { questions: { answer_aliases: string[] }[] }[]
    }
    try {
      detail = await jsonRpc('get_admin_attempt_detail', [firstAttemptId])
    } finally {
      await setSession('postgres')
    }
    expect(detail.sections[0].questions[0].answer_aliases).toEqual([
      '0.1',
      '0.128',
    ])
  })

  it('accepts wide grids and long option lists up to the imported-bank limits', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: `g${index + 1}`,
      text: `Callout ${index + 1}`,
    }))
    const columns = Array.from({ length: 15 }, (_, index) => ({
      id: `h${index + 1}`,
      text: `${index + 1}`,
    }))
    const testId = await createPublishedTest({
      title: 'Imported bank limits',
      questions: [
        {
          type: 'grid',
          prompt: 'Match the numbered callouts',
          marks: 2,
          rows,
          options: columns,
          correct: rows.map((row) => `${row.id}:h1`),
        },
        {
          type: 'multiple_select',
          prompt: 'Tick the open valves',
          marks: 2,
          options: Array.from({ length: 30 }, (_, index) => ({
            id: `v${index + 1}`,
            text: `Valve ${index + 1}`,
          })),
          correct: ['v1', 'v2'],
        },
      ],
    })

    const stored = await query<{
      question_type: string
      options: string
      grid_rows: string
    }>(
      `select q.question_type::text, q.options::text, q.grid_rows::text
       from public.questions q
       join public.sections s on s.id = q.section_id
       where s.test_id = $1
       order by q.position`,
      [testId],
    )
    expect(JSON.parse(stored[0].grid_rows)).toHaveLength(10)
    expect(JSON.parse(stored[0].options)).toHaveLength(15)
    expect(JSON.parse(stored[1].options)).toHaveLength(30)

    const sectionRows = await query<{ id: string }>(
      'select id from public.sections where test_id = $1',
      [testId],
    )
    const sectionId = sectionRows[0].id

    await expect(
      query(
        `insert into public.questions
          (section_id, question_type, prompt, marks, options, correct_options,
           grid_rows, position)
         values ($1, 'grid', 'Too many columns', 1, $2::jsonb, $3::text[],
                 $4::jsonb, 10)`,
        [
          sectionId,
          JSON.stringify(
            Array.from({ length: 16 }, (_, index) => ({
              id: `x${index + 1}`,
              text: `${index + 1}`,
            })),
          ),
          arrayLiteral(rows.map((row) => `${row.id}:x1`)),
          JSON.stringify(rows),
        ],
      ),
    ).rejects.toThrow(/questions_choice_shape|violates check/i)

    await expect(
      query(
        `insert into public.questions
          (section_id, question_type, prompt, marks, options, correct_options,
           position)
         values ($1, 'multiple_select', 'Too many options', 1, $2::jsonb,
                 $3::text[], 11)`,
        [
          sectionId,
          JSON.stringify(
            Array.from({ length: 31 }, (_, index) => ({
              id: `y${index + 1}`,
              text: `${index + 1}`,
            })),
          ),
          arrayLiteral(['y1']),
        ],
      ),
    ).rejects.toThrow(/questions_choice_shape|violates check/i)
  })

  it('lets admins delete tests without attempts and protects tests with results', async () => {
    const disposableId = await createPublishedTest({
      title: 'Disposable test',
      questions: [
        {
          type: 'single_choice',
          prompt: 'Pick A',
          marks: 1,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
          ],
          correct: ['a'],
        },
      ],
    })

    await setSession('authenticated', studentOneId)
    try {
      await expect(jsonRpc('delete_test', [disposableId])).rejects.toThrow(
        /administrator/i,
      )
    } finally {
      await setSession('postgres')
    }

    await setSession('authenticated', adminId)
    let imagePaths: string[]
    try {
      imagePaths = await jsonRpc<string[]>('delete_test', [disposableId])
    } finally {
      await setSession('postgres')
    }
    expect(imagePaths).toEqual([])

    const remaining = await query<{ tests: number; sections: number }>(
      `select
         (select count(*)::int from public.tests where id = $1) as tests,
         (select count(*)::int from public.sections where test_id = $1) as sections`,
      [disposableId],
    )
    expect(remaining[0]).toEqual({ tests: 0, sections: 0 })

    await setSession('authenticated', adminId)
    try {
      await expect(jsonRpc('delete_test', [testAId])).rejects.toThrow(/attempts/i)
    } finally {
      await setSession('postgres')
    }
    const stillThere = await query<{ count: number }>(
      'select count(*)::int as count from public.tests where id = $1',
      [testAId],
    )
    expect(stillThere[0].count).toBe(1)
  })

  it('lets evaluators read and grade results without admin powers', async () => {
    const evaluatorId = await createUser('reviewer@example.com', 'Results Reviewer')
    await query(
      `update public.profiles
       set role = 'evaluator', username = 'reviewer', full_name = 'Results Reviewer',
           is_active = true, must_change_password = false
       where id = $1`,
      [evaluatorId],
    )

    await setSession('authenticated', evaluatorId)
    try {
      const attemptRows = await query<{ id: string }>(
        'select id from public.attempts where status <> $1 limit 1',
        ['in_progress'],
      )
      expect(attemptRows).toHaveLength(1)

      const detail = await jsonRpc<{ test: { id: string }; sections: unknown[] }>(
        'get_admin_attempt_detail',
        [attemptRows[0].id],
      )
      expect(detail.test.id).toBe(testAId)
      expect(detail.sections.length).toBeGreaterThan(0)

      const profiles = await query<{ count: number }>(
        'select count(*)::int as count from public.profiles',
      )
      expect(profiles[0].count).toBeGreaterThan(1)

      // The guard passed: it reached the lookup instead of refusing the role.
      await expect(
        jsonRpc('grade_response', [
          '00000000-0000-0000-0000-000000000000',
          1,
        ]),
      ).rejects.toThrow(/response not found/i)

      await expect(
        jsonRpc('assign_test', [testAId, [studentOneId]]),
      ).rejects.toThrow(/administrator access required/i)

      await expect(
        query(
          `insert into public.profiles (id, email, full_name)
           values (gen_random_uuid(), 'sneaky@example.com', 'Sneaky')`,
        ),
      ).rejects.toThrow(/row-level security/i)

      await query('update public.tests set title = $1 where id = $2', [
        'Hijacked',
        testAId,
      ])
      const unchanged = await query<{ title: string }>(
        'select title from public.tests where id = $1',
        [testAId],
      )
      expect(unchanged[0].title).toBe('Compliance basics')
    } finally {
      await setSession('postgres')
    }
  })

  it('accepts an unlimited attempt override and reports it to the student', async () => {
    const unlimitedTestId = await createPublishedTest({
      title: 'Unlimited practice',
      questions: [
        {
          type: 'single_choice',
          prompt: 'Pick A',
          marks: 1,
          options: [
            { id: 'a', text: 'Alpha' },
            { id: 'b', text: 'Beta' },
          ],
          correct: ['a'],
        },
      ],
    })

    await setSession('authenticated', adminId)
    let inserted: number
    try {
      const rows = await query<{ assign_test: number }>(
        `select public.assign_test(
           $1, array[$2]::uuid[], null, 1000000000
         ) as assign_test`,
        [unlimitedTestId, studentTwoId],
      )
      inserted = rows[0].assign_test
    } finally {
      await setSession('postgres')
    }
    expect(inserted).toBe(1)

    const assignmentRows = await query<{ attempt_limit: number }>(
      `select attempt_limit from public.test_assignments
       where test_id = $1 and student_id = $2`,
      [unlimitedTestId, studentTwoId],
    )
    expect(assignmentRows[0].attempt_limit).toBe(1_000_000_000)

    await setSession('authenticated', studentTwoId)
    let assignment: { attempt_limit: number; status: string; can_start: boolean }
    try {
      const dashboard = await jsonRpc<{
        assignments: { test_id: string; attempt_limit: number; status: string; can_start: boolean }[]
      }>('get_student_dashboard')
      assignment = dashboard.assignments.find(
        (item) => item.test_id === unlimitedTestId,
      )!
    } finally {
      await setSession('postgres')
    }

    expect(assignment.attempt_limit).toBe(1_000_000_000)
    expect(assignment.status).toBe('available')
    expect(assignment.can_start).toBe(true)

    // The old 1–20 cap still applies; only the sentinel is extra.
    await expect(
      query(
        `update public.test_assignments set attempt_limit = 21
         where test_id = $1 and student_id = $2`,
        [unlimitedTestId, studentTwoId],
      ),
    ).rejects.toThrow(/test_assignments_attempt_limit_range/)

    await expect(
      query(
        `update public.test_assignments set attempt_limit = 1000000001
         where test_id = $1 and student_id = $2`,
        [unlimitedTestId, studentTwoId],
      ),
    ).rejects.toThrow(/test_assignments_attempt_limit_range/)

    await expect(
      query(
        `update public.test_assignments set attempt_limit = 1000000000
         where test_id = $1 and student_id = $2`,
        [unlimitedTestId, studentTwoId],
      ),
    ).resolves.toBeDefined()
  })
})
