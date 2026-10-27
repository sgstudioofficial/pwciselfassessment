import { useEffect, useState } from 'react'
import { Copy, KeyRound, ShieldCheck } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Feedback'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { invokeEdge } from '../../lib/supabase'
import { copyToClipboard } from '../../lib/clipboard'
import type { Profile } from '../../lib/types'

export function ResetPasswordDialog({
  open,
  onClose,
  student,
}: {
  open: boolean
  onClose: () => void
  student: Profile | null
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setPassword(null)
    setError(null)
  }, [open, student])

  const handleReset = async () => {
    if (!student) return
    setBusy(true)
    setError(null)
    try {
      const response = await invokeEdge<{ temporary_password: string }>(
        'admin-students',
        { action: 'reset_password', student_id: student.id },
      )
      setPassword(response.temporary_password)
      toast.success('Password reset', 'Share the temporary password securely.')
    } catch (resetError) {
      setError(getErrorMessage(resetError))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    setPassword(null)
    onClose()
  }

  const copy = async () => {
    if (!password) return
    const copied = await copyToClipboard(password)
    if (copied) toast.success('Temporary password copied')
    else toast.error('Could not copy', 'Select the password and copy it manually.')
  }

  return (
    <Modal
      open={open && Boolean(student)}
      onClose={close}
      title={password ? 'Temporary password' : 'Reset student password'}
      description={
        password
          ? 'This password is shown once. Give it to the student through a secure channel.'
          : student
            ? `${student.full_name} · @${student.username}`
            : undefined
      }
      size="sm"
      footer={
        password ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleReset}
              loading={busy}
              leftIcon={!busy ? <KeyRound className="h-4 w-4" /> : undefined}
            >
              Reset password
            </Button>
          </>
        )
      }
    >
      {password ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Temporary password
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="break-all font-mono text-sm font-semibold text-slate-900">
                {password}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                aria-label="Copy temporary password"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <Alert tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
            The student must set a new password the next time they sign in. Their
            previous password no longer works.
          </Alert>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
            <p className="text-sm leading-6 text-slate-600">
              A new strong temporary password will be generated for this student.
              Existing sessions are not interrupted, so the new password applies
              from their next sign-in.
            </p>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      )}
    </Modal>
  )
}
