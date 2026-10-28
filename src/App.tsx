import { Suspense, lazy, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import {
  HomeRedirect,
  RequireAuth,
  RequireRole,
} from './components/auth/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { AdminLayout } from './components/layout/AdminLayout'
import { StudentLayout } from './components/layout/StudentLayout'
import { Brand } from './components/layout/Brand'
import { ButtonLink } from './components/ui/Button'
import { FullPageLoader } from './components/ui/Feedback'

const LoginPage = lazy(() =>
  import('./pages/auth/LoginPage').then((module) => ({
    default: module.LoginPage,
  })),
)
const ResetPasswordPage = lazy(() =>
  import('./pages/auth/ResetPasswordPage').then((module) => ({
    default: module.ResetPasswordPage,
  })),
)
const ChangePasswordPage = lazy(() =>
  import('./pages/auth/ChangePasswordPage').then((module) => ({
    default: module.ChangePasswordPage,
  })),
)
const AdminDashboardPage = lazy(() =>
  import('./pages/admin/DashboardPage').then((module) => ({
    default: module.AdminDashboardPage,
  })),
)
const AdminStudentsPage = lazy(() =>
  import('./pages/admin/StudentsPage').then((module) => ({
    default: module.AdminStudentsPage,
  })),
)
const AdminStudentDetailPage = lazy(() =>
  import('./pages/admin/StudentDetailPage').then((module) => ({
    default: module.AdminStudentDetailPage,
  })),
)
const AdminTestsPage = lazy(() =>
  import('./pages/admin/TestsPage').then((module) => ({
    default: module.AdminTestsPage,
  })),
)
const TestBuilderPage = lazy(() =>
  import('./pages/admin/TestBuilderPage').then((module) => ({
    default: module.TestBuilderPage,
  })),
)
const AnswerKeysPage = lazy(() =>
  import('./pages/admin/AnswerKeysPage').then((module) => ({
    default: module.AnswerKeysPage,
  })),
)
const AdminAssignmentsPage = lazy(() =>
  import('./pages/admin/AssignmentsPage').then((module) => ({
    default: module.AdminAssignmentsPage,
  })),
)
const AdminResultsPage = lazy(() =>
  import('./pages/admin/ResultsPage').then((module) => ({
    default: module.AdminResultsPage,
  })),
)
const AdminResultDetailPage = lazy(() =>
  import('./pages/admin/ResultDetailPage').then((module) => ({
    default: module.AdminResultDetailPage,
  })),
)
const AdminSettingsPage = lazy(() =>
  import('./pages/admin/SettingsPage').then((module) => ({
    default: module.AdminSettingsPage,
  })),
)
const StudentDashboardPage = lazy(() =>
  import('./pages/student/StudentDashboardPage').then((module) => ({
    default: module.StudentDashboardPage,
  })),
)
const StudentResultsPage = lazy(() =>
  import('./pages/student/StudentResultsPage').then((module) => ({
    default: module.StudentResultsPage,
  })),
)
const StudentResultDetailPage = lazy(() =>
  import('./pages/student/StudentResultDetailPage').then((module) => ({
    default: module.StudentResultDetailPage,
  })),
)
const TestInstructionsPage = lazy(() =>
  import('./pages/student/TestInstructionsPage').then((module) => ({
    default: module.TestInstructionsPage,
  })),
)
const TakeTestPage = lazy(() =>
  import('./pages/student/TakeTestPage').then((module) => ({
    default: module.TakeTestPage,
  })),
)
const SetupRequiredPage = lazy(() =>
  import('./pages/SetupRequiredPage').then((module) => ({
    default: module.SetupRequiredPage,
  })),
)

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

/**
 * Admins land on the overview; results reviewers land on their results queue.
 */
function AdminHome() {
  const { profile } = useAuth()
  if (profile?.role === 'evaluator') {
    return <Navigate to="/admin/results" replace />
  }
  return <AdminDashboardPage />
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-5 text-center">
      <Brand />
      <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
        404
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        This page doesn’t exist
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        The link may be out of date. Return to your dashboard to continue.
      </p>
      <div className="mt-6">
        <ButtonLink to="/">Go to PWCI</ButtonLink>
      </div>
      <Link
        to="/login"
        className="mt-4 text-xs font-medium text-slate-400 hover:text-slate-700"
      >
        Sign in instead
      </Link>
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <Suspense fallback={<FullPageLoader label="Loading setup…" />}>
        <SetupRequiredPage />
      </Suspense>
    )
  }

  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<FullPageLoader label="Loading PWCI Self Assessment Tool…" />}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />

            <Route element={<RequireRole roles={['admin', 'evaluator']} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminHome />} />

                {/* Results are the reviewer's whole workspace. */}
                <Route path="results" element={<AdminResultsPage />} />
                <Route
                  path="results/:attemptId"
                  element={<AdminResultDetailPage />}
                />

                {/* Everything else stays admin-only. */}
                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="students" element={<AdminStudentsPage />} />
                  <Route path="students/:id" element={<AdminStudentDetailPage />} />
                  <Route path="tests" element={<AdminTestsPage />} />
                  <Route path="tests/:id/edit" element={<TestBuilderPage />} />
                  <Route path="tests/:id/keys" element={<AnswerKeysPage />} />
                  <Route path="assignments" element={<AdminAssignmentsPage />} />
                  <Route path="settings" element={<AdminSettingsPage />} />
                </Route>
              </Route>
            </Route>

            <Route element={<RequireRole roles={['student']} />}>
              <Route path="/student" element={<StudentLayout />}>
                <Route index element={<StudentDashboardPage />} />
                <Route path="results" element={<StudentResultsPage />} />
                <Route
                  path="results/:attemptId"
                  element={<StudentResultDetailPage />}
                />
                <Route
                  path="assignments/:assignmentId"
                  element={<TestInstructionsPage />}
                />
              </Route>
              <Route path="/student/attempts/:attemptId" element={<TakeTestPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  )
}
