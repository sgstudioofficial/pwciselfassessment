import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Flag,
  PlayCircle,
  ShieldCheck,
  Trophy,
  Zap,
} from 'lucide-react'
import { PageHeader, Panel, Badge, MetaItem } from '../../components/ui/Misc'
import { Button, ButtonLink } from '../../components/ui/Button'
import {
  Alert,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../components/ui/Feedback'
import { StudentAssignmentBadge } from '../../components/StatusBadge'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import { getErrorMessage } from '../../lib/errors'
import { useToast } from '../../context/ToastContext'
import {
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatScore,
} from '../../lib/format'
import type {
  AnswerFeedbackMode,
  StudentAssignment,
  StudentDashboardData,
} from '../../lib/types'

export function TestInstructionsPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [starting, setStarting] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState<AnswerFeedbackMode>('after_submit')

  const { data, loading, error, reload } = useAsyncData<StudentAssignment | null>(
    async () => {
      const dashboard = await callRpc<StudentDashboardData>('get_student_dashboard')
      return (
        dashboard.assignments.find(
          (assignment) => assignment.assignment_id === assignmentId,
        ) ?? null
      )
    },
    [assignmentId],
  )

  const startAssessment = async () => {
    if (!assignmentId) return
    setStarting(true)
    try {
      const attemptId = await callRpc<string>('start_attempt', {
        p_assignment_id: assignmentId,
        p_feedback_mode: feedbackMode,
      })
      navigate(`/student/attempts/${attemptId}`, { replace: true })
    } catch (startError) {
      toast.error('Could not start the assessment', getErrorMessage(startError))
      setStarting(false)
      reload()
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          backTo="/student"
          backLabel="Dashboard"
          title="Assessment instructions"
        />
        <LoadingState label="Preparing your assessment…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader
          backTo="/student"
          backLabel="Dashboard"
          title="Assessment instructions"
        />
        <ErrorState message={error} onRetry={reload} />
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <PageHeader
          backTo="/student"
          backLabel="Dashboard"
          title="Assessment not found"
        />
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="This assessment is not assigned to you"
          description="It may have been removed, or the link belongs to another student."
          action={
            <ButtonLink to="/student" variant="outline">
              Back to dashboard
            </ButtonLink>
          }
        />
      </div>
    )
  }

  const attemptsLeft = Math.max(0, data.attempt_limit - data.attempts_used)
  const canBegin = data.can_start
  const resumeId = data.open_attempt_id
  const blockedReason =
    data.status === 'upcoming'
      ? `This assessment opens ${formatDateTime(data.start_at)}.`
      : data.status === 'expired'
        ? 'The deadline for this assessment has passed.'
        : data.status === 'completed'
          ? 'You have used all available attempts for this assessment.'
          : !data.published
            ? 'This assessment is not currently available.'
            : null

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        backTo="/student"
        backLabel="Dashboard"
        eyebrow="Before you begin"
        title={data.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StudentAssignmentBadge status={data.status} />
            <span className="text-xs text-slate-400">
              {formatMinutes(data.duration_minutes)} · {formatNumber(data.max_marks)}{' '}
              marks
            </span>
          </span>
        }
      />

      {blockedReason ? (
        <Alert
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="You cannot start this assessment right now"
          className="mb-5"
        >
          {blockedReason}
        </Alert>
      ) : null}

      <div className="space-y-5">
        <Panel title="Instructions">
          {data.description ? (
            <p className="mb-3 text-sm leading-6 text-slate-600">{data.description}</p>
          ) : null}
          {data.instructions ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {data.instructions}
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              No additional instructions were provided. Read each question carefully
              and submit before the time runs out.
            </p>
          )}
        </Panel>

        <Panel title="Assessment details">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <MetaItem
              label="Duration"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                  {formatMinutes(data.duration_minutes)}
                </span>
              }
            />
            <MetaItem
              label="Total marks"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-slate-400" />
                  {formatNumber(data.max_marks)}
                </span>
              }
            />
            <MetaItem
              label="Passing marks"
              value={formatScore(data.passing_marks, data.max_marks)}
            />
            <MetaItem
              label="Attempts"
              value={`${data.attempts_used} used · ${attemptsLeft} left`}
            />
            <MetaItem
              label="Deadline"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                  {data.due_at ? formatDateTime(data.due_at) : 'No deadline'}
                </span>
              }
            />
            <MetaItem
              label="Results"
              value={
                data.show_results ? (
                  <Badge tone="green">Visible after submission</Badge>
                ) : (
                  <Badge tone="slate">Hidden by administrator</Badge>
                )
              }
            />
          </dl>
        </Panel>

        <Panel title="What to expect">
          <ul className="space-y-3 text-sm leading-6 text-slate-600">
            <Rule
              icon={<Clock3 className="h-4 w-4" />}
              title="The timer starts immediately"
              body={
                data.duration_minutes
                  ? `You have ${formatMinutes(data.duration_minutes)} from the moment you begin. The assessment submits automatically when time runs out.`
                  : 'There is no duration limit, but the assignment deadline still applies.'
              }
            />
            <Rule
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Answers save automatically"
              body="Each response is saved to the server as you work. If you lose connection, refresh and resume where you left off."
            />
            <Rule
              icon={<Flag className="h-4 w-4" />}
              title="Flag questions to revisit"
              body="Use the flag control to mark a question for review. Flags do not affect scoring."
            />
            <Rule
              icon={<CheckCircle2 className="h-4 w-4" />}
              title="One final submission"
              body="You can review unanswered questions before submitting. After submission, the attempt cannot be reopened."
            />
          </ul>
        </Panel>

        {data.show_results ? (
          <Panel
            title="When should answers be revealed?"
            description="Choose before you begin — this applies to this attempt only and cannot be changed afterwards."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setFeedbackMode('after_submit')}
                aria-pressed={feedbackMode === 'after_submit'}
                className={[
                  'rounded-xl border p-4 text-left transition',
                  feedbackMode === 'after_submit'
                    ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-400'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                ].join(' ')}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Eye className="h-4 w-4 text-brand-600" />
                  After I submit
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-slate-500">
                  Correct answers and your score appear once the assessment is
                  complete. You can change your answers freely until then.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFeedbackMode('immediate')}
                aria-pressed={feedbackMode === 'immediate'}
                className={[
                  'rounded-xl border p-4 text-left transition',
                  feedbackMode === 'immediate'
                    ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-400'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                ].join(' ')}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Immediately after each answer
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-slate-500">
                  See the correct answer as soon as you choose an option. Each
                  checked answer is locked. Short answers are checked with the
                  “Check answer” button.
                </span>
              </button>
            </div>

            {feedbackMode === 'immediate' ? (
              <Alert
                tone="warning"
                className="mt-4"
                title="Checked answers cannot be changed"
                icon={<Zap className="h-4 w-4" />}
              >
                Choose carefully: once an answer is revealed it is saved and
                locked for this attempt.
              </Alert>
            ) : null}
          </Panel>
        ) : (
          <Alert tone="info" title="Answer review is hidden for this assessment">
            Your administrator has hidden correct answers and scores. You will be
            able to submit the assessment, but not review the answers afterwards.
          </Alert>
        )}

        <div className="flex flex-col-reverse items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-soft sm:flex-row">
          <p className="text-xs text-slate-500">
            {resumeId
              ? 'You have an assessment in progress. Resume to continue where you left off.'
              : canBegin
                ? 'By starting, you confirm you are ready and understand the timing.'
                : 'This assessment is not available to begin.'}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <ButtonLink to="/student" variant="outline" className="flex-1 sm:flex-none">
              Cancel
            </ButtonLink>
            {resumeId ? (
              <ButtonLink
                to={`/student/attempts/${resumeId}`}
                leftIcon={<PlayCircle className="h-4 w-4" />}
                className="flex-1 sm:flex-none"
              >
                Resume assessment
              </ButtonLink>
            ) : (
              <Button
                onClick={startAssessment}
                loading={starting}
                disabled={!canBegin}
                leftIcon={!starting ? <ArrowRight className="h-4 w-4" /> : undefined}
                className="flex-1 sm:flex-none"
              >
                Begin assessment
              </Button>
            )}
          </div>
        </div>

        {data.submitted_count > 0 && data.show_results && data.last_attempt ? (
          <p className="text-center text-xs text-slate-400">
            Previous attempt:{' '}
            <ButtonLink
              to={`/student/results/${data.last_attempt.attempt_id}`}
              variant="ghost"
              size="sm"
            >
              view result
            </ButtonLink>
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Rule({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        {icon}
      </span>
      <span>
        <span className="block font-medium text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{body}</span>
      </span>
    </li>
  )
}
