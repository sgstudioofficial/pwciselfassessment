import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BellRing,
  CheckCircle2,
  Database,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { PageHeader, Panel, MetaItem, Avatar, Badge } from '../../components/ui/Misc'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Feedback'
import { Field, Input } from '../../components/ui/Form'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'

export function AdminSettingsPage() {
  const { profile, session, refreshProfile } = useAuth()
  const toast = useToast()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
  }, [profile?.full_name])

  const projectHost = (() => {
    try {
      return new URL(String(import.meta.env.VITE_SUPABASE_URL)).host
    } catch {
      return 'Not configured'
    }
  })()

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!profile) return
    if (!fullName.trim()) {
      toast.error('Name required', 'Enter your display name.')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', profile.id)
      if (error) throw error
      await refreshProfile()
      toast.success('Profile updated')
    } catch (updateError) {
      toast.error('Could not update profile', getErrorMessage(updateError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Your account, security posture and system integrations."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Panel title="Administrator account">
            <div className="mb-5 flex items-center gap-4">
              <Avatar name={profile?.full_name ?? 'Admin'} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {profile?.full_name}
                </p>
                <p className="truncate text-xs text-slate-500">{profile?.email}</p>
                <div className="mt-1">
                  <Badge tone="brand">Administrator</Badge>
                </div>
              </div>
            </div>

            <form onSubmit={saveProfile} className="space-y-4">
              <Field label="Display name" htmlFor="admin-name">
                <Input
                  id="admin-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  maxLength={120}
                  disabled={saving}
                />
              </Field>
              <Field
                label="Email"
                htmlFor="admin-email"
                hint="Sign-in email is managed by Supabase Auth."
              >
                <Input id="admin-email" value={profile?.email ?? ''} disabled readOnly />
              </Field>
              <Button
                type="submit"
                loading={saving}
                leftIcon={!saving ? <UserRound className="h-4 w-4" /> : undefined}
              >
                Save name
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Password</p>
                <p className="text-xs text-slate-500">
                  Choose a new password for your account.
                </p>
              </div>
              <ButtonLink
                to="/change-password"
                variant="outline"
                size="sm"
                leftIcon={<KeyRound className="h-3.5 w-3.5" />}
              >
                Change
              </ButtonLink>
            </div>
          </Panel>

          <Panel title="Session">
            <dl className="space-y-4">
              <MetaItem
                label="Signed in as"
                value={`${profile?.full_name} (${profile?.role})`}
              />
              <MetaItem
                label="Last sign-in"
                value={formatDateTime(session?.user.last_sign_in_at ?? null)}
              />
              <MetaItem
                label="Account ID"
                value={
                  <span className="break-all font-mono text-xs">{profile?.id}</span>
                }
              />
            </dl>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Security posture">
            <div className="space-y-3">
              <SecurityRow
                icon={<Lock className="h-4 w-4" />}
                title="Row Level Security"
                description="Enabled on every application table. Students only read their own profile, assignments, attempts and responses."
                status="Enforced in database"
              />
              <SecurityRow
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Answer keys"
                description="Students receive questions through RPCs that never select correct answers. Keys unlock only after submission when results are enabled."
                status="Server-side"
              />
              <SecurityRow
                icon={<KeyRound className="h-4 w-4" />}
                title="Service-role key"
                description="Used only by the admin-students and notification Edge Functions. It is never shipped in the frontend bundle."
                status="Server-only"
              />
              <SecurityRow
                icon={<Database className="h-4 w-4" />}
                title="Objective scoring"
                description="Grading runs inside SECURITY DEFINER functions in PostgreSQL; scores and submission status cannot be written by browsers."
                status="Trusted SQL"
              />
            </div>
          </Panel>

          <Panel title="Supabase connection">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MetaItem label="Project" value={<span className="break-all">{projectHost}</span>} />
              <MetaItem label="Image bucket" value="question-images" />
              <MetaItem label="Client key" value="Anon key · public by design" />
              <MetaItem label="Student auth" value="Username → email resolver" />
            </dl>
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              The browser uses only VITE_SUPABASE_URL and
              VITE_SUPABASE_ANON_KEY. Keep the service-role key in Edge Function
              secrets and your local .env.local for provisioning scripts.
            </p>
          </Panel>

          <Panel
            title="Submission notifications"
            actions={<Badge tone="amber">Integration point</Badge>}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <BellRing className="h-4 w-4" />
              </span>
              <div className="text-sm leading-6 text-slate-600">
                <p>
                  A secured <code className="rounded bg-slate-100 px-1 text-xs">notify-submission</code>{' '}
                  Edge Function is included. Point a Supabase Database Webhook at it
                  when an attempt’s <code className="rounded bg-slate-100 px-1 text-xs">submitted_at</code>{' '}
                  is set, and pass the shared{' '}
                  <code className="rounded bg-slate-100 px-1 text-xs">NOTIFY_WEBHOOK_SECRET</code>{' '}
                  header.
                </p>
                <p className="mt-2">
                  The function validates the secret, loads the attempt with the
                  service role and exposes one delivery hook for your email provider.
                  No provider credentials belong in the browser.
                </p>
                <Link
                  to="/admin/results?filter=pending"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700"
                >
                  Open the grading queue
                </Link>
              </div>
            </div>
          </Panel>

          <Alert
            tone="info"
            icon={<Mail className="h-4 w-4" />}
            title="Student password reset"
          >
            Students have no public email inbox on record. Use Students → Reset
            password to issue a temporary password; the student is asked to replace it
            at the next sign-in.
          </Alert>

          <div className="flex items-center gap-2 px-1 text-xs text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            PWCI Self Assessment Tool v1.0 · Role-based assessment platform
          </div>
        </div>
      </div>
    </div>
  )
}

function SecurityRow({
  icon,
  title,
  description,
  status,
}: {
  icon: React.ReactNode
  title: string
  description: string
  status: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200/80 p-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
            {status}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  )
}
