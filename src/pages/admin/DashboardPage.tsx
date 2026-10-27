import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileText,
  Plus,
  Send,
  UserPlus,
  Users,
} from 'lucide-react'
import { PageHeader, Panel, Badge, Avatar } from '../../components/ui/Misc'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
} from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { AttemptStatusBadge } from '../../components/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import { formatRelative, formatScore } from '../../lib/format'
import type { DashboardStats } from '../../lib/types'
import { ButtonLink } from '../../components/ui/Button'

export function AdminDashboardPage() {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useAsyncData<DashboardStats>(
    () => callRpc<DashboardStats>('admin_dashboard_stats'),
    [],
  )

  const firstName = profile?.full_name.split(' ')[0] ?? 'Administrator'
  const greeting = greetingForNow()

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title={`${greeting}, ${firstName}`}
        description="A live view of your assessment programme. Figures update from the database every time you open this page."
        actions={
          <>
            <ButtonLink
              to="/admin/assignments"
              variant="outline"
              leftIcon={<Send className="h-4 w-4" />}
            >
              Assignments
            </ButtonLink>
            <ButtonLink to="/admin/tests" leftIcon={<Plus className="h-4 w-4" />}>
              Create a test
            </ButtonLink>
          </>
        }
      />

      {loading ? (
        <LoadingState label="Loading dashboard statistics…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Active students"
              value={data.active_students}
              hint={`${data.total_students} total student ${data.total_students === 1 ? 'account' : 'accounts'}`}
              icon={<Users className="h-4 w-4" />}
              tone="brand"
            />
            <StatCard
              label="Total tests"
              value={data.total_tests}
              hint={`${data.published_tests} published`}
              icon={<FileText className="h-4 w-4" />}
            />
            <StatCard
              label="Published tests"
              value={data.published_tests}
              hint="Visible to assigned students"
              icon={<ClipboardCheck className="h-4 w-4" />}
              tone="emerald"
            />
            <StatCard
              label="Completed attempts"
              value={data.completed_attempts}
              hint={`${data.in_progress_attempts} currently in progress`}
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <StatCard
              label="Pending assignments"
              value={data.pending_assignments}
              hint="Assigned, not submitted, still within deadline"
              icon={<Clock3 className="h-4 w-4" />}
              tone="amber"
            />
            <StatCard
              label="Awaiting manual grading"
              value={data.pending_review}
              hint="Short answers need review"
              icon={<ClipboardList className="h-4 w-4" />}
              tone={data.pending_review > 0 ? 'amber' : 'emerald'}
            />
          </div>

          {data.pending_review > 0 ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {data.pending_review} submission
                    {data.pending_review === 1 ? '' : 's'} need manual review
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-amber-800">
                    Objective questions are already scored. Review short answers to
                    finalise these results.
                  </p>
                </div>
              </div>
              <ButtonLink to="/admin/results?filter=pending" variant="outline" size="sm">
                Review now
              </ButtonLink>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Panel
              title="Recent submissions"
              description="Latest completed attempts across all tests."
              actions={
                <Link
                  to="/admin/results"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
                >
                  All results
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              bodyClassName="p-0"
            >
              {data.recent_submissions.length === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="h-5 w-5" />}
                  title="No submissions yet"
                  description="Once students complete assigned assessments, their results will appear here."
                  className="rounded-none border-0"
                />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Test</Th>
                      <Th>Submitted</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Score</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {data.recent_submissions.map((submission) => (
                      <Tr key={submission.attempt_id}>
                        <Td>
                          <Link
                            to={`/admin/results/${submission.attempt_id}`}
                            className="flex items-center gap-2.5 group"
                          >
                            <Avatar name={submission.student_name} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-900 group-hover:text-brand-700">
                                {submission.student_name}
                              </span>
                              <span className="block truncate text-xs text-slate-400">
                                @{submission.username}
                              </span>
                            </span>
                          </Link>
                        </Td>
                        <Td className="max-w-[200px]">
                          <span className="block truncate">{submission.test_title}</span>
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-slate-500">
                          {formatRelative(submission.submitted_at)}
                        </Td>
                        <Td>
                          <AttemptStatusBadge status={submission.status} />
                        </Td>
                        <Td className="whitespace-nowrap text-right font-semibold text-slate-900">
                          {formatScore(submission.score, submission.max_marks)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>

            <div className="space-y-6">
              <Panel title="Quick actions">
                <div className="space-y-2">
                  <QuickAction
                    to="/admin/students?new=1"
                    icon={<UserPlus className="h-4 w-4" />}
                    title="Add a student"
                    description="Create a username and temporary password."
                  />
                  <QuickAction
                    to="/admin/tests"
                    icon={<ClipboardList className="h-4 w-4" />}
                    title="Build a test"
                    description="Sections, questions, marks and timing."
                  />
                  <QuickAction
                    to="/admin/assignments"
                    icon={<Send className="h-4 w-4" />}
                    title="Assign an assessment"
                    description="Target one student, a group or a department."
                  />
                  <QuickAction
                    to="/admin/results"
                    icon={<BarChart3 className="h-4 w-4" />}
                    title="Review results"
                    description="Inspect answers and export reports."
                  />
                </div>
              </Panel>

              <Panel title="System posture">
                <div className="space-y-3 text-sm">
                  <PostureRow label="Student self-registration" value="Disabled" tone="green" />
                  <PostureRow label="Answer-key access" value="Admin + post-submit" tone="green" />
                  <PostureRow label="Service-role key" value="Server-only" tone="green" />
                  <PostureRow
                    label="Manual grading queue"
                    value={`${data.pending_review} open`}
                    tone={data.pending_review > 0 ? 'amber' : 'green'}
                  />
                </div>
              </Panel>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function QuickAction({
  to,
  icon,
  title,
  description,
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl border border-slate-200/80 px-3.5 py-3 transition hover:border-brand-200 hover:bg-brand-50/40"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
      <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-slate-300" />
    </Link>
  )
}

function PostureRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'green' | 'amber'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <Badge tone={tone === 'green' ? 'green' : 'amber'}>{value}</Badge>
    </div>
  )
}

function greetingForNow(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
