import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, KeyRound } from 'lucide-react'
import { AuthShell } from '../../components/layout/AuthShell'
import { Button } from '../../components/ui/Button'
import { Alert, Spinner } from '../../components/ui/Feedback'
import { Field, Input } from '../../components/ui/Form'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

export function ResetPasswordPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [ready, setReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let mounted = true
    let timer: number | undefined

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        mounted &&
        session &&
        (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')
      ) {
        setReady(true)
      }
    })

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!mounted) return
      if (sessionData.session) {
        setReady(true)
        return
      }
      timer = window.setTimeout(() => {
        if (mounted) setReady(false)
      }, 1600)
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password.length < 10) {
      setError('Use at least 10 characters for your new password.')
      return
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      await supabase.rpc('complete_password_change')
      toast.success('Password updated', 'Sign in again with your new password.')
      await supabase.auth.signOut()
      navigate('/login', { replace: true })
    } catch (updateError) {
      setError(getErrorMessage(updateError))
    } finally {
      setSubmitting(false)
    }
  }

  if (ready === null) {
    return (
      <AuthShell
        compact
        title="Verifying your reset link"
        subtitle="This only takes a moment."
      >
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          <Spinner />
          Checking the recovery session…
        </div>
      </AuthShell>
    )
  }

  if (!ready) {
    return (
      <AuthShell
        compact
        title="Reset link expired"
        subtitle="For security, password reset links are single-use and expire quickly."
      >
        <div className="space-y-5">
          <Alert
            tone="warning"
            icon={<AlertCircle className="h-4 w-4" />}
            title="This link is no longer valid"
          >
            Request a new reset email from the administrator sign-in page, or ask
            an administrator to reset your password.
          </Alert>
          <Link
            to="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      compact
      title="Choose a new password"
      subtitle="Your reset link has been verified. Set a new password to regain access."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <KeyRound className="h-5 w-5" />
        </div>

        <Field
          label="New password"
          htmlFor="new-password"
          hint="At least 10 characters."
        >
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            autoFocus
          />
        </Field>

        <Field label="Confirm new password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={submitting}
            invalid={Boolean(confirmPassword) && password !== confirmPassword}
          />
        </Field>

        {error ? (
          <Alert tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
            {error}
          </Alert>
        ) : null}

        <Button type="submit" fullWidth loading={submitting} size="lg">
          Update password
        </Button>
      </form>
    </AuthShell>
  )
}
