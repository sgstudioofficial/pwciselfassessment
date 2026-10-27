import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, Copy, Eye, EyeOff, UserPlus } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Feedback'
import { Field, Input } from '../ui/Form'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { invokeEdge, supabase } from '../../lib/supabase'
import { copyToClipboard } from '../../lib/clipboard'
import type { Profile } from '../../lib/types'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/

interface CreatedStudentResponse {
  student: {
    id: string
    username: string
    full_name: string
    email: string
  }
  temporary_password: string
}

export function StudentDialog({
  open,
  onClose,
  student,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  student: Profile | null
  onSaved: () => void
}) {
  const toast = useToast()
  const editing = Boolean(student)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [department, setDepartment] = useState('')
  const [batch, setBatch] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<CreatedStudentResponse | null>(null)

  useEffect(() => {
    if (!open) return
    setFullName(student?.full_name ?? '')
    setUsername(student?.username ?? '')
    setEmail(student?.email ?? '')
    setDepartment(student?.department ?? '')
    setBatch(student?.batch ?? '')
    setPassword('')
    setError(null)
    setCreated(null)
    setShowPassword(false)
  }, [open, student])

  const handleClose = () => {
    if (saving) return
    setCreated(null)
    onClose()
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!fullName.trim()) return setError('Enter the student’s full name.')
    if (!USERNAME_PATTERN.test(username.trim().toLowerCase())) {
      return setError(
        'Username must be 3–32 characters: lowercase letters, numbers, dots, dashes or underscores.',
      )
    }
    if (password && (password.length < 10 || password.length > 72)) {
      return setError('Temporary password must be 10–72 characters.')
    }

    setSaving(true)
    try {
      if (editing && student) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            username: username.trim().toLowerCase(),
            department: department.trim() || null,
            batch: batch.trim() || null,
          })
          .eq('id', student.id)

        if (updateError) throw updateError
        toast.success('Student updated', 'Profile details were saved.')
        onSaved()
        onClose()
      } else {
        const response = await invokeEdge<CreatedStudentResponse>(
          'admin-students',
          {
            action: 'create_student',
            full_name: fullName.trim(),
            username: username.trim().toLowerCase(),
            email: email.trim() || undefined,
            department: department.trim() || undefined,
            batch: batch.trim() || undefined,
            password: password || undefined,
          },
        )
        setCreated(response)
        toast.success('Student account created')
        onSaved()
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const copy = async (value: string, label: string) => {
    const copied = await copyToClipboard(value)
    if (copied) toast.success(`${label} copied`)
    else toast.error('Could not copy', 'Select and copy the value manually.')
  }

  if (created) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Student account ready"
        description="Share these credentials securely. The temporary password is shown only once."
        size="md"
        footer={
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning" title="One-time credentials">
            The student will be asked to choose a new password the first time they
            sign in. This temporary password cannot be viewed again — reset the
            password if it is lost.
          </Alert>
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <CredentialRow
              label="Full name"
              value={created.student.full_name}
              onCopy={() => copy(created.student.full_name, 'Name')}
            />
            <CredentialRow
              label="Username"
              value={created.student.username}
              onCopy={() => copy(created.student.username, 'Username')}
            />
            <CredentialRow
              label="Temporary password"
              value={created.temporary_password}
              mono
              onCopy={() => copy(created.temporary_password, 'Password')}
            />
          </div>
          <p className="text-xs leading-5 text-slate-500">
            The account is active and can sign in immediately. The sign-in email is
            kept server-side; the student only needs the username and password.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={editing ? 'Edit student' : 'Add a student'}
      description={
        editing
          ? 'Update profile details. The username is the student’s sign-in identifier.'
          : 'Create a unique account. Only administrators can provision students.'
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="student-form"
            loading={saving}
            leftIcon={!saving && !editing ? <UserPlus className="h-4 w-4" /> : undefined}
          >
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <form id="student-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="student-name" required>
          <Input
            id="student-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="e.g. Amina Yusuf"
            disabled={saving}
            autoFocus
            maxLength={120}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Username"
            htmlFor="student-username"
            required
            hint="Lowercase, 3–32 characters. Used to sign in."
          >
            <Input
              id="student-username"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.toLowerCase().replace(/\s+/g, ''))
              }
              placeholder="e.g. ayusuf"
              disabled={saving}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Email (optional)"
            htmlFor="student-email"
            hint={
              editing
                ? 'Sign-in email is managed server-side and cannot be edited here.'
                : 'For records only. Leave blank to use an internal student address.'
            }
          >
            <Input
              id="student-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="student@company.com"
              disabled={saving || editing}
            />
          </Field>

          <Field label="Department" htmlFor="student-department">
            <Input
              id="student-department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="e.g. Finance"
              disabled={saving}
              maxLength={80}
            />
          </Field>

          <Field label="Batch / cohort" htmlFor="student-batch">
            <Input
              id="student-batch"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              placeholder="e.g. 2026-Q1"
              disabled={saving}
              maxLength={80}
            />
          </Field>
        </div>

        {!editing ? (
          <Field
            label="Temporary password"
            htmlFor="student-password"
            hint="Optional. Must be 10–72 characters; leave blank to generate a strong password."
          >
            <div className="relative">
              <Input
                id="student-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Leave blank to auto-generate"
                disabled={saving}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        ) : null}

        {error ? (
          <Alert tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
            {error}
          </Alert>
        ) : null}
      </form>
    </Modal>
  )
}

function CredentialRow({
  label,
  value,
  mono = false,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  onCopy: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p
          className={
            mono
              ? 'mt-0.5 truncate font-mono text-sm font-semibold text-slate-900'
              : 'mt-0.5 truncate text-sm font-medium text-slate-900'
          }
        >
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

