import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Hourglass,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { PageHeader, Badge, Panel } from '../../components/ui/Misc'
import { Button, ButtonLink } from '../../components/ui/Button'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
  Alert,
} from '../../components/ui/Feedback'
import { StudentAssignmentBadge } from '../../components/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import {
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatScore,
} from '../../lib/format'
import type { StudentAssignment, StudentDashboardData } from '../../lib/types'
import { cn } from '../../lib/cn'

type TabKey = 'todo' | 'upcoming' | 'completed' | 'expired' | 'all'

export function StudentDashboardPage() {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useAsyncData<StudentDashboardData>(
    () => callRpc<StudentDashboardData>('get_student_dashboard'),
    [],
  )

  const [tab, setTab] = useState<TabKey>('todo')
  const assignments = useMemo(
    () => sortAssignments(data?.assignments ?? []),
    [data],
  )

  const stats = useMemo(() => {
    const available = assignments.filter(
      (assignment) =>
        assignment.status === 'available' || assignment.status === 'in_progress',
    ).length
    const upcoming = assignments.filter(
      (assignment) => assignment.status === 'upcoming',
    ).length
    const completed = assignments.filter(
      (assignment) => assignment.submitted_count > 0,
    )
    const expired = assignments.filter(
      (assignment) => assignment.status === 'expired',
    ).length
    const scores = completed
      .map((assignment) => assignment.last_attempt)
      .filter(
        (attempt): attempt is NonNullable<typeof attempt> =>
          attempt != null && attempt.score != null && attempt.max_marks > 0,
      )
    const average =
      scores.length > 0
        ? Math.round(
            (scores.reduce(
              (total, attempt) =>
                total + (attempt.score ?? 0) / attempt.max_marks,
              0,
            ) /
              scores.length) *
              100,
          )
        : null
    return { available, upcoming, completed, expired, average }
  }, [assignments])

  const filtered = assignments.filter((assignment) => {
    if (tab === 'todo') {
      return (
        assignment.status === 'available' || assignment.status === 'in_progress'
      )
    }
    if (tab === 'upcoming') return assignment.status === 'upcoming'
    if (tab === 'expired') return assignment.status === 'expired'
    if (tab === 'completed') return assignment.submitted_count > 0
    return true
  })

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'todo', label: 'To do', count: stats.available },
    { key: 'upcoming', label: 'Upcoming', count: stats.upcoming },
    { key: 'completed', label: 'Completed', count: stats.completed.length },
    { key: 'expired', label: 'Expired', count: stats.expired },
    { key: 'all', label: 'All assigned', count: assignments.length },
  ]

  const firstName = profile?.full_name.split(' ')[0] ?? 'there'

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Student portal" title="Your assessments" />
        <LoadingState label="Loading your assessments…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="Student portal" title="Your assessments" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow={formatToday()}
        title={`Hello, ${firstName}`}
        description="Here is everything currently assigned to you. Your answers save automatically once you start."
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={reload}
            >
              Refresh
            </Button>
            <ButtonLink to="/student/results" leftIcon={<BarChart3 className="h-4 w-4" />}>
              My results
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Available now"
          value={stats.available}
          hint="Ready to start or resume"
          icon={<PlayCircle className="h-4 w-4" />}
          tone="brand"
        />
        <StatCard
          label="Upcoming"
          value={stats.upcoming}
          hint="Scheduled for later"
          icon={<Hourglass className="h-4 w-4" />}
        />
        <StatCard
          label="Completed"
          value={stats.completed.length}
          hint="Assessments submitted"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          label="Average score"
          value={stats.average == null ? '—' : `${stats.average}%`}
          hint="Where results are visible"
          icon={<Trophy className="h-4 w-4" />}
        />
      </div>

      {stats.available > 0 ? (
        <Alert
          tone="info"
          icon={<Sparkles className="h-4 w-4" />}
          title={`${stats.available} ${stats.available === 1 ? 'assessment is' : 'assessments are'} waiting for you`}
          className="mt-6"
        >
          Read the instructions carefully before starting. Once you begin, the timer
          cannot be paused.
        </Alert>
      ) : null}

      <div className="mt-7">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                tab === item.key
                  ? 'bg-ink-900 text-white'
                  : 'text-slate-500 hover:bg-white hover:text-slate-900',
              )}
            >
              {item.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px]',
                  tab === item.key
                    ? 'bg-white/15 text-white'
                    : 'bg-slate-200/70 text-slate-500',
                )}
              >
                {item.count}
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title={
              assignments.length === 0
                ? 'No assessments assigned yet'
                : tab === 'todo'
                  ? 'You are all caught up'
                  : 'Nothing in this section'
            }
            description={
              assignments.length === 0
                ? 'When your administrator assigns a test, it will appear here with instructions and a deadline.'
                : tab === 'todo'
                  ? 'There are no assessments available right now. Check the upcoming tab for what is next.'
                  : 'Try another tab to see your other assignments.'
            }
            action={
              assignments.length > 0 && tab !== 'all' ? (
                <Button variant="outline" onClick={() => setTab('all')}>
                  View all assignments
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((assignment) => (
              <AssignmentCard
                key={assignment.assignment_id}
                assignment={assignment}
                onRefresh={reload}
              />
            ))}
          </div>
        )}
      </div>

      {assignments.length > 0 ? (
        <Panel className="mt-7" title="How assessments work">
          <div className="grid gap-5 sm:grid-cols-3">
            <InfoStep
              number="1"
              title="Read the instructions"
              body="Each assessment explains timing, marks and rules before you begin."
            />
            <InfoStep
              number="2"
              title="Your answers autosave"
              body="Every response is stored securely. A refresh will not lose your progress."
            />
            <InfoStep
              number="3"
              title="Submit before time ends"
              body="The assessment submits automatically when the timer reaches zero."
            />
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function AssignmentCard({
  assignment,
  onRefresh,
}: {
  assignment: StudentAssignment
  onRefresh: () => void
}) {
  const lastAttempt = assignment.last_attempt
  const resultVisible = assignment.show_results && lastAttempt != null
  const underReview = resultVisible && lastAttempt.status === 'submitted'
  const percent =
    resultVisible &&
    lastAttempt.score != null &&
    lastAttempt.max_marks > 0 &&
    lastAttempt.status === 'graded'
      ? Math.round((lastAttempt.score / lastAttempt.max_marks) * 100)
      : null
  const dueDate = assignment.due_at ?? assignment.end_at
  const deadlinePassed = dueDate ? new Date(dueDate).getTime() < Date.now() : false

  let primaryAction: ReactNode = null
  if (assignment.status === 'in_progress' && assignment.open_attempt_id) {
    primaryAction = (
      <ButtonLink
        to={`/student/attempts/${assignment.open_attempt_id}`}
        leftIcon={<PlayCircle className="h-4 w-4" />}
      >
        Resume assessment
      </ButtonLink>
    )
  } else if (assignment.can_start) {
    primaryAction = (
      <ButtonLink
        to={`/student/assignments/${assignment.assignment_id}`}
        leftIcon={<PlayCircle className="h-4 w-4" />}
      >
        {assignment.submitted_count > 0 ? 'Start another attempt' : 'Start assessment'}
      </ButtonLink>
    )
  } else if (resultVisible) {
    primaryAction = (
      <ButtonLink
        to={`/student/results/${lastAttempt.attempt_id}`}
        variant="outline"
        leftIcon={<BarChart3 className="h-4 w-4" />}
      >
        View result
      </ButtonLink>
    )
  }

  return (
    <article
      className={cn(
        'flex flex-col rounded-2xl border bg-white p-5 shadow-soft transition hover:shadow-lift',
        assignment.status === 'in_progress'
          ? 'border-brand-300 ring-1 ring-brand-200'
          : 'border-slate-200/80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StudentAssignmentBadge status={assignment.status} />
            {assignment.attempts_used > 0 ? (
              <Badge tone="slate">
                {assignment.attempts_used} / {assignment.attempt_limit}{' '}
                {assignment.attempt_limit === 1 ? 'attempt' : 'attempts'}
              </Badge>
            ) : null}
          </div>
          <h3 className="text-base font-semibold leading-6 text-slate-900">
            {assignment.title}
          </h3>
          {assignment.description ? (
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
              {assignment.description}
            </p>
          ) : null}
        </div>
        {percent != null ? (
          <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-center">
            <p className="text-lg font-bold text-slate-900">{percent}%</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Score</p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          {formatMinutes(assignment.duration_minutes)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5" />
          {formatNumber(assignment.max_marks)} marks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {dueDate ? (
            <span className={deadlinePassed ? 'text-slate-400' : ''}>
              Due {formatDateTime(dueDate)}
            </span>
          ) : (
            'No deadline'
          )}
        </span>
      </div>

      {resultVisible && lastAttempt ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="text-slate-500">
            Attempt #{lastAttempt.attempt_number} ·{' '}
            {underReview ? 'Provisional — review in progress' : 'Latest score'}
          </span>
          <span className="font-semibold text-slate-900">
            {lastAttempt.score == null
              ? 'Pending'
              : formatScore(lastAttempt.score, lastAttempt.max_marks)}
          </span>
        </div>
      ) : assignment.submitted_count > 0 ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Submitted. Results are hidden by your administrator.
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-400">
          {assignment.status === 'upcoming' && assignment.start_at
            ? `Opens ${formatDateTime(assignment.start_at)}`
            : assignment.status === 'expired'
              ? 'The deadline has passed'
              : assignment.status === 'completed'
              ? 'All attempts used'
              : `${Math.max(0, assignment.attempt_limit - assignment.attempts_used)} of ${assignment.attempt_limit} attempts left`}
        </span>
        <div className="flex items-center gap-2">
          {primaryAction}
          {assignment.status === 'upcoming' ? (
            <Button variant="outline" disabled>
              Not open yet
            </Button>
          ) : null}
          {assignment.status === 'expired' ? (
            <Button variant="outline" disabled>
              Closed
            </Button>
          ) : null}
          {assignment.can_start && assignment.submitted_count > 0 && resultVisible ? (
            <ButtonLink
              to={`/student/results/${lastAttempt.attempt_id}`}
              variant="outline"
              size="sm"
            >
              View result
            </ButtonLink>
          ) : null}
          {assignment.status === 'available' && !assignment.can_start ? (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function InfoStep({
  number,
  title,
  body,
}: {
  number: string
  title: string
  body: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
        {number}
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{body}</p>
      </div>
    </div>
  )
}

function sortAssignments(assignments: StudentAssignment[]): StudentAssignment[] {
  return [...assignments].sort((a, b) => {
    const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER
    const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER
    return aDue - bDue
  })
}

function formatToday(): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
}
