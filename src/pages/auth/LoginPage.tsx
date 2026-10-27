import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Eye,
  EyeOff,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react'
import { AuthShell } from '../../components/layout/AuthShell'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Feedback'
import { Field, Input } from '../../components/ui/Form'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { homePath } from '../../components/auth/ProtectedRoute'
import { cn } from '../../lib/cn'

type Mode = 'student' | 'admin'

export function LoginPage() {
  const { profile, loading, signInAdmin, signInStudent } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('student')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetSending, setResetSending] = useState(false)

  if (!loading && profile) {
    return (
      <Navigate
        to={homePath(profile.role, profile.must_change_password)}
        replace
      />
    )
  }

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError(null)
    setPassword('')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (mode === 'student' && !username.trim()) {
      setError('Enter your username.')
      return
    }
    if (mode === 'admin' && !email.trim()) {
      setError('Enter your administrator email.')
      return
    }
    if (!password) {
      setError('Enter your password.')
      return
    }

    setSubmitting(true)
    try {
      const nextProfile =
        mode === 'student'
          ? await signInStudent(username, password)
          : await signInAdmin(email, password)

      toast.success(
        'Welcome back',
        `Signed in as ${nextProfile.full_name}.`,
      )
      navigate(homePath(nextProfile.role, nextProfile.must_change_password), {
        replace: true,
      })
    } catch (signInError) {
      setError(getErrorMessage(signInError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your administrator email first, then request a reset link.')
      return
    }
    setResetSending(true)
    setError(null)
    try {
      await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      toast.info(
        'Reset link requested',
        'If that email has an account, a password reset link is on its way. Check your inbox and spam folder.',
      )
    } catch (resetError) {
      setError(getErrorMessage(resetError))
    } finally {
      setResetSending(false)
    }
  }

  return (
    <AuthShell
      title="Sign in to PWCI Self Assessment Tool"
      subtitle="Use your company account to continue. Public registration is disabled."
    >
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => switchMode('student')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
            mode === 'student'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800',
          )}
          aria-pressed={mode === 'student'}
        >
          <GraduationCap className="h-4 w-4" />
          Student
        </button>
        <button
          type="button"
          onClick={() => switchMode('admin')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
            mode === 'admin'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800',
          )}
          aria-pressed={mode === 'admin'}
        >
          <ShieldCheck className="h-4 w-4" />
          Administrator
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {mode === 'student' ? (
          <Field label="Username" htmlFor="username">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. jsmith"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              autoFocus
            />
          </Field>
        ) : (
          <Field label="Email address" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="admin@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
              autoFocus
            />
          </Field>
        )}

        <Field
          label="Password"
          htmlFor="password"
          hint={
            mode === 'student'
              ? 'Forgot your password? Ask your administrator to reset it.'
              : undefined
          }
        >
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </Field>

        {error ? (
          <Alert
            tone="danger"
            icon={<AlertCircle className="h-4 w-4" />}
            className="py-2.5"
          >
            {error}
          </Alert>
        ) : null}

        <Button type="submit" fullWidth loading={submitting} size="lg">
          {mode === 'student' ? 'Sign in as student' : 'Sign in as administrator'}
        </Button>

        {mode === 'admin' ? (
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={resetSending}
            className="w-full text-center text-xs font-medium text-slate-500 transition hover:text-brand-700 disabled:opacity-60"
          >
            {resetSending ? 'Requesting reset link…' : 'Forgot password?'}
          </button>
        ) : null}
      </form>

      <div className="mt-7 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs leading-5 text-slate-500">
          <span className="font-semibold text-slate-700">Accounts are created by your administrator.</span>{' '}
          Students sign in with a username; administrators sign in with email.
          There is no public registration.
        </p>
      </div>
    </AuthShell>
  )
}
