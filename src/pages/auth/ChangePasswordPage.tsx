import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react'
import { AuthShell } from '../../components/layout/AuthShell'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Feedback'
import { Field, Input } from '../../components/ui/Form'
import { homePath } from '../../components/auth/ProtectedRoute'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'

export function ChangePasswordPage() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const forced = profile?.must_change_password === true

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

      const { error: flagError } = await supabase.rpc('complete_password_change')
      if (flagError) throw flagError

      await refreshProfile()
      toast.success('Password updated', 'Your new password is active.')
      navigate(homePath(profile?.role), { replace: true })
    } catch (updateError) {
      setError(getErrorMessage(updateError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      compact
      title={forced ? 'Set a password only you know' : 'Change your password'}
      subtitle={
        forced
          ? 'Your account was created with a temporary password. Choose a new password to continue.'
          : 'Choose a strong password you have not used before.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-brand-900">
          <ShieldCheck className="h-5 w-5 shrink-0 text-brand-700" />
          <p className="text-xs leading-5">
            This change signs nobody else in for you. Your administrator never sees
            your password.
          </p>
        </div>

        <Field
          label="New password"
          htmlFor="new-password"
          hint="At least 10 characters. Use a mix of letters, numbers and symbols."
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

        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={submitting}
          leftIcon={!submitting ? <KeyRound className="h-4 w-4" /> : undefined}
        >
          Save new password
        </Button>

        {!forced && profile ? (
          <Link
            to={homePath(profile.role)}
            className="block text-center text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Cancel and return to dashboard
          </Link>
        ) : null}
      </form>
    </AuthShell>
  )
}
