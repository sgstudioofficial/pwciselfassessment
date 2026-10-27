import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../../src/context/AuthContext'
import { ToastProvider } from '../../src/context/ToastContext'
import { LoginPage } from '../../src/pages/auth/LoginPage'
import { ResetPasswordPage } from '../../src/pages/auth/ResetPasswordPage'
import { ChangePasswordPage } from '../../src/pages/auth/ChangePasswordPage'
import { SetupRequiredPage } from '../../src/pages/SetupRequiredPage'
import { AdminDashboardPage } from '../../src/pages/admin/DashboardPage'
import { AdminStudentsPage } from '../../src/pages/admin/StudentsPage'
import { AdminStudentDetailPage } from '../../src/pages/admin/StudentDetailPage'
import { AdminTestsPage } from '../../src/pages/admin/TestsPage'
import { TestBuilderPage } from '../../src/pages/admin/TestBuilderPage'
import { AdminAssignmentsPage } from '../../src/pages/admin/AssignmentsPage'
import { AdminResultsPage } from '../../src/pages/admin/ResultsPage'
import { AdminResultDetailPage } from '../../src/pages/admin/ResultDetailPage'
import { AdminSettingsPage } from '../../src/pages/admin/SettingsPage'
import { StudentDashboardPage } from '../../src/pages/student/StudentDashboardPage'
import { StudentResultsPage } from '../../src/pages/student/StudentResultsPage'
import { StudentResultDetailPage } from '../../src/pages/student/StudentResultDetailPage'
import { TestInstructionsPage } from '../../src/pages/student/TestInstructionsPage'
import { TakeTestPage } from '../../src/pages/student/TakeTestPage'
import { QuestionCard } from '../../src/components/student/QuestionCard'

function render(url: string, pattern: string, element: ReactElement): string {
  return renderToString(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path={pattern} element={element} />
            <Route path="*" element={<div>route-not-matched</div>} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

type PageCase = {
  name: string
  url: string
  pattern: string
  element: ReactElement
}

const pages: PageCase[] = [
  { name: 'login', url: '/login', pattern: '/login', element: <LoginPage /> },
  {
    name: 'reset password',
    url: '/reset-password',
    pattern: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    name: 'change password',
    url: '/change-password',
    pattern: '/change-password',
    element: <ChangePasswordPage />,
  },
  { name: 'setup', url: '/setup', pattern: '/setup', element: <SetupRequiredPage /> },
  {
    name: 'admin dashboard',
    url: '/admin',
    pattern: '/admin',
    element: <AdminDashboardPage />,
  },
  {
    name: 'admin students',
    url: '/admin/students',
    pattern: '/admin/students',
    element: <AdminStudentsPage />,
  },
  {
    name: 'admin student detail',
    url: '/admin/students/11111111-1111-4111-8111-111111111111',
    pattern: '/admin/students/:id',
    element: <AdminStudentDetailPage />,
  },
  {
    name: 'admin tests',
    url: '/admin/tests',
    pattern: '/admin/tests',
    element: <AdminTestsPage />,
  },
  {
    name: 'test builder',
    url: '/admin/tests/22222222-2222-4222-8222-222222222222/edit',
    pattern: '/admin/tests/:id/edit',
    element: <TestBuilderPage />,
  },
  {
    name: 'admin assignments',
    url: '/admin/assignments',
    pattern: '/admin/assignments',
    element: <AdminAssignmentsPage />,
  },
  {
    name: 'admin results',
    url: '/admin/results',
    pattern: '/admin/results',
    element: <AdminResultsPage />,
  },
  {
    name: 'admin result detail',
    url: '/admin/results/33333333-3333-4333-8333-333333333333',
    pattern: '/admin/results/:attemptId',
    element: <AdminResultDetailPage />,
  },
  {
    name: 'admin settings',
    url: '/admin/settings',
    pattern: '/admin/settings',
    element: <AdminSettingsPage />,
  },
  {
    name: 'student dashboard',
    url: '/student',
    pattern: '/student',
    element: <StudentDashboardPage />,
  },
  {
    name: 'student results',
    url: '/student/results',
    pattern: '/student/results',
    element: <StudentResultsPage />,
  },
  {
    name: 'student result detail',
    url: '/student/results/44444444-4444-4444-8444-444444444444',
    pattern: '/student/results/:attemptId',
    element: <StudentResultDetailPage />,
  },
  {
    name: 'test instructions',
    url: '/student/assignments/55555555-5555-4555-8555-555555555555',
    pattern: '/student/assignments/:assignmentId',
    element: <TestInstructionsPage />,
  },
  {
    name: 'take test',
    url: '/student/attempts/66666666-6666-4666-8666-666666666666',
    pattern: '/student/attempts/:attemptId',
    element: <TakeTestPage />,
  },
]

describe('page rendering', () => {
  it.each(pages)('renders $name without crashing', ({ url, pattern, element }) => {
    const html = render(url, pattern, element)
    expect(html).not.toBe('')
    expect(html).not.toContain('route-not-matched')
  })

  it('renders the sign-in form with both roles and no public registration', () => {
    const html = render('/login', '/login', <LoginPage />)
    expect(html).toContain('Sign in to PWCI Self Assessment Tool')
    expect(html).toContain('Student')
    expect(html).toContain('Administrator')
    expect(html.toLowerCase()).toContain('no public registration')
    expect(html).not.toContain('Sign up')
  })

  it('renders image-based answer options for students', () => {
    const html = renderToString(
      <QuestionCard
        question={{
          id: '11111111-1111-4111-8111-111111111111',
          question_type: 'single_choice',
          prompt: 'Which gauge shows the correct reading?',
          image_path: null,
          marks: 1,
          is_required: true,
          options: [
            { id: 'a', text: '', image_path: 'section/option-a.png' },
            { id: 'b', text: 'Text-only option', image_path: null },
          ],
          position: 0,
        }}
        sectionTitle="Section 1"
        index={0}
        total={1}
        answer={{ selected: [], text: '', flagged: false }}
        disabled={false}
        onChange={() => undefined}
        onFlag={() => undefined}
      />,
    )
    expect(html).toContain('Option A image')
    expect(html).toContain('Text-only option')
  })

  it('documents the required environment variables', () => {
    const env = readFileSync(join(process.cwd(), '.env.example'), 'utf8')
    expect(env).toContain('VITE_SUPABASE_URL')
    expect(env).toContain('VITE_SUPABASE_ANON_KEY')
    expect(env).not.toMatch(/^VITE_.*SERVICE_ROLE/m)
  })

  it('never ships a service-role key in frontend sources', () => {
    const files = [
      'src/lib/supabase.ts',
      'src/context/AuthContext.tsx',
      'src/lib/rpc.ts',
      'src/lib/attempt.ts',
    ]
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source).not.toContain('SERVICE_ROLE')
      expect(source).not.toContain('service_role')
    }
  })
})
