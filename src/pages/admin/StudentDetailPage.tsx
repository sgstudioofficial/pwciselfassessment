import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardList,
  KeyRound,
  Mail,
  Pencil,
  Send,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react'
import { PageHeader, Panel, Avatar, MetaItem, Badge } from '../../components/ui/Misc'
import { Button, ButtonLink, IconLink } from '../../components/ui/Button'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
  Alert,
} from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { ConfirmDialog } from '../../components/ui/Modal'
import { StudentDialog } from '../../components/admin/StudentDialog'
import { ResetPasswordDialog } from '../../components/admin/ResetPasswordDialog'
import { AssignTestDialog } from '../../components/admin/AssignTestDialog'
import { useAsyncData } from '../../hooks/useAsyncData'
import { supabase, invokeEdge } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errors'
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatScore,
  formatTimeTaken,
} from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import type { Attempt, Profile, Test, TestAssignment } from '../../lib/types'
import { TestStatusBadge, AttemptStatusBadge } from '../../components/StatusBadge'

type AssignmentRow = TestAssignment & {
  tests: Pick<
    Test,
    | 'id'
    | 'title'
    | 'status'
    | 'duration_minutes'
    | 'max_marks'
    | 'passing_marks'
    | 'show_results'
    | 'attempt_limit'
  > | null
}

type AttemptRow = Attempt & {
  tests: Pick<Test, 'id' | 'title' | 'passing_marks' | 'show_results'> | null
}

type StudentDetail = {
  student: Profile
  assignments: AssignmentRow[]
  attempts: AttemptRow[]
}

export function AdminStudentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useAsyncData<StudentDetail>(
    async () => {
      if (!id) throw new Error('Student not found.')
      const { data: student, error: studentError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .eq('role', 'student')
        .maybeSingle()
      if (studentError) throw studentError
      if (!student) throw new Error('This student could not be found.')

      const [assignmentsResult, attemptsResult] = await Promise.all([
        supabase
          .from('test_assignments')
          .select(
            '*, tests(id, title, status, duration_minutes, max_marks, passing_marks, show_results, attempt_limit)',
          )
          .eq('student_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('attempts')
          .select('*, tests(id, title, passing_marks, show_results)')
          .eq('student_id', id)
          .order('started_at', { ascending: false }),
      ])
      if (assignmentsResult.error) throw assignmentsResult.error
      if (attemptsResult.error) throw attemptsResult.error

      return {
        student: student as Profile,
        assignments: (assignmentsResult.data ?? []) as AssignmentRow[],
        attempts: (attemptsResult.data ?? []) as AttemptRow[],
      }
    },
    [id],
  )

  const [editOpen, setEditOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const toggleStatus = async () => {
    if (!data) return
    setStatusUpdating(true)
    try {
      await invokeEdge('admin-students', {
        action: 'set_status',
        student_id: data.student.id,
        is_active: !data.student.is_active,
      })
      toast.success(
        data.student.is_active ? 'Student deactivated' : 'Student reactivated',
      )
      setStatusOpen(false)
      reload()
    } catch (statusError) {
      toast.error('Could not update status', getErrorMessage(statusError))
    } finally {
      setStatusUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!data) return
    setDeleteBusy(true)
    try {
      await invokeEdge('admin-students', {
        action: 'delete_student',
        student_id: data.student.id,
      })
      toast.success(
        'Student deleted',
        `${data.student.full_name}'s account, assignments and results were permanently removed.`,
      )
      navigate('/admin/students')
    } catch (deleteError) {
      toast.error('Could not delete student', getErrorMessage(deleteError))
      setDeleteBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader backTo="/admin/students" backLabel="Students" title="Student" />
        <LoadingState label="Loading student profile…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader backTo="/admin/students" backLabel="Students" title="Student" />
        <ErrorState message={error ?? 'Student not found.'} onRetry={reload} />
      </div>
    )
  }

  const { student, assignments, attempts } = data
  const submittedAttempts = attempts.filter((attempt) => attempt.status !== 'in_progress')
  const latestAttempt = submittedAttempts[0] ?? null
  const averageScore =
    submittedAttempts.length > 0
      ? submittedAttempts.reduce((total, attempt) => total + (attempt.score ?? 0), 0) /
        submittedAttempts.length
      : null

  return (
    <div>
      <PageHeader
        backTo="/admin/students"
        backLabel="All students"
        eyebrow="Student profile"
        title={student.full_name}
        description={`@${student.username ?? '—'} · ${student.department ?? 'No department'}${student.batch ? ` · ${student.batch}` : ''}`}
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<Pencil className="h-4 w-4" />}
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
            <Button
              variant="outline"
              leftIcon={<Send className="h-4 w-4" />}
              onClick={() => setAssignOpen(true)}
            >
              Assign test
            </Button>
            <Button
              leftIcon={<KeyRound className="h-4 w-4" />}
              onClick={() => setResetOpen(true)}
            >
              Reset password
            </Button>
          </>
        }
      />

      {!student.is_active ? (
        <Alert tone="warning" className="mb-6" title="Account is deactivated">
          This student cannot sign in. Assignments and results remain available to
          administrators.{' '}
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            className="font-semibold underline underline-offset-2"
          >
            Reactivate account
          </button>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Assigned tests" value={assignments.length} />
        <StatCard
          label="Attempts submitted"
          value={submittedAttempts.length}
          hint={`${attempts.length} total attempts started`}
        />
        <StatCard
          label="Average score"
          value={
            averageScore == null
              ? '—'
              : Number(averageScore.toFixed(2))
          }
          hint="Across submitted attempts"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_2fr]">
        <div className="space-y-6">
          <Panel title="Account details">
            <div className="flex items-center gap-4">
              <Avatar name={student.full_name} size="xl" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">
                  {student.full_name}
                </p>
                <p className="truncate text-sm text-slate-500">@{student.username}</p>
                <div className="mt-1.5">
                  {student.is_active ? (
                    <Badge tone="green" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="rose" dot>
                      Inactive
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <MetaItem
                label="Email"
                value={
                  <span className="inline-flex items-center gap-1.5 break-all">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    {student.email}
                  </span>
                }
              />
              <MetaItem label="Department" value={student.department ?? '—'} />
              <MetaItem label="Batch / cohort" value={student.batch ?? '—'} />
              <MetaItem label="Account created" value={formatDate(student.created_at)} />
              <MetaItem
                label="Password status"
                value={
                  student.must_change_password ? (
                    <Badge tone="amber">Temporary password</Badge>
                  ) : (
                    <Badge tone="green">Set by student</Badge>
                  )
                }
              />
            </dl>
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              <span className="text-xs text-slate-400">Account access</span>
              <Button
                variant={student.is_active ? 'danger' : 'outline'}
                size="sm"
                onClick={() => setStatusOpen(true)}
                leftIcon={
                  student.is_active ? (
                    <UserX className="h-3.5 w-3.5" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )
                }
              >
                {student.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          </Panel>

          <Panel title="Latest activity">
            {latestAttempt ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-slate-900">
                  {latestAttempt.tests?.title ?? 'Assessment'}
                </p>
                <p className="text-xs text-slate-500">
                  Submitted {formatDateTime(latestAttempt.submitted_at)} ·{' '}
                  {formatTimeTaken(latestAttempt.time_taken_seconds)}
                </p>
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-xs text-slate-500">Score</span>
                  <span className="text-sm font-semibold">
                    {formatScore(latestAttempt.score, latestAttempt.max_marks)}
                  </span>
                </div>
                <Link
                  to={`/admin/results/${latestAttempt.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700"
                >
                  Open result
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No submissions yet.</p>
            )}
          </Panel>

          <Panel
            title="Danger zone"
            description="Permanent actions for this account."
          >
            <p className="text-sm text-slate-600">
              Deleting this student removes their login and every assignment, attempt
              and result tied to them. This cannot be undone.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-4"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete student permanently
            </Button>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title="Assigned tests"
            description="Per-student assignments with attempt usage."
            actions={
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Send className="h-3.5 w-3.5" />}
                onClick={() => setAssignOpen(true)}
              >
                Assign
              </Button>
            }
            bodyClassName="p-0"
          >
            {assignments.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="h-5 w-5" />}
                title="No assignments"
                description="Assign a published test to this student to get started."
                action={
                  <Button size="sm" onClick={() => setAssignOpen(true)}>
                    Assign a test
                  </Button>
                }
                className="rounded-none border-0"
              />
            ) : (
              <Table className="min-w-[680px]">
                <THead>
                  <tr>
                    <Th>Test</Th>
                    <Th>Status</Th>
                    <Th>Due</Th>
                    <Th>Attempts</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <TBody>
                  {assignments.map((assignment) => {
                    const test = assignment.tests
                    const assignmentAttempts = attempts.filter(
                      (attempt) => attempt.assignment_id === assignment.id,
                    )
                    const submitted = assignmentAttempts.filter(
                      (attempt) => attempt.status !== 'in_progress',
                    )
                    const latest = submitted[0]
                    const limit = assignment.attempt_limit ?? test?.attempt_limit ?? 1
                    return (
                      <Tr key={assignment.id}>
                        <Td>
                          <p className="font-medium text-slate-900">
                            {test?.title ?? 'Deleted test'}
                          </p>
                          <p className="text-xs text-slate-400">
                            {formatMinutes(test?.duration_minutes ?? null)} ·{' '}
                            {formatNumber(test?.max_marks ?? 0)} marks
                          </p>
                        </Td>
                        <Td>
                          {test ? <TestStatusBadge status={test.status} /> : '—'}
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-slate-500">
                          {formatDateTime(assignment.due_at)}
                        </Td>
                        <Td>
                          <span className="text-sm text-slate-700">
                            {assignmentAttempts.length} / {limit}
                          </span>
                          {latest ? (
                            <p className="text-xs text-slate-400">
                              Latest: {formatScore(latest.score, latest.max_marks)}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {test ? (
                              <ButtonLink
                                to={`/admin/tests/${test.id}/edit`}
                                variant="ghost"
                                size="sm"
                              >
                                Test
                              </ButtonLink>
                            ) : null}
                            {latest ? (
                              <ButtonLink
                                to={`/admin/results/${latest.id}`}
                                variant="ghost"
                                size="sm"
                              >
                                Result
                              </ButtonLink>
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Panel>

          <Panel
            title="Assessment history"
            description="Every attempt started by this student."
            bodyClassName="p-0"
          >
            {attempts.length === 0 ? (
              <EmptyState
                title="No attempts yet"
                description="Attempts appear here once the student starts an assigned test."
                className="rounded-none border-0"
              />
            ) : (
              <Table className="min-w-[680px]">
                <THead>
                  <tr>
                    <Th>Assessment</Th>
                    <Th>Attempt</Th>
                    <Th>Submitted</Th>
                    <Th>Status</Th>
                    <Th>Score</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </THead>
                <TBody>
                  {attempts.map((attempt) => (
                    <Tr key={attempt.id}>
                      <Td>
                        <p className="font-medium text-slate-900">
                          {attempt.tests?.title ?? 'Deleted test'}
                        </p>
                        <p className="text-xs text-slate-400">
                          Started {formatDateTime(attempt.started_at)}
                        </p>
                      </Td>
                      <Td className="text-slate-600">#{attempt.attempt_number}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">
                        {attempt.status === 'in_progress'
                          ? 'In progress'
                          : formatDateTime(attempt.submitted_at)}
                      </Td>
                      <Td>
                        <AttemptStatusBadge status={attempt.status} />
                      </Td>
                      <Td className="whitespace-nowrap font-medium">
                        {formatScore(attempt.score, attempt.max_marks)}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          {attempt.status !== 'in_progress' ? (
                            <IconLink
                              to={`/admin/results/${attempt.id}`}
                              label="View result"
                            >
                              <ArrowRight className="h-4 w-4" />
                            </IconLink>
                          ) : (
                            <span className="text-xs text-slate-400">Live</span>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>
      </div>

      <StudentDialog
        open={editOpen}
        student={student}
        onClose={() => setEditOpen(false)}
        onSaved={reload}
      />
      <ResetPasswordDialog
        open={resetOpen}
        student={student}
        onClose={() => setResetOpen(false)}
      />
      <AssignTestDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        initialStudentIds={[student.id]}
        lockStudents
        onAssigned={reload}
      />
      <ConfirmDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        onConfirm={toggleStatus}
        loading={statusUpdating}
        tone={student.is_active ? 'danger' : 'primary'}
        title={student.is_active ? 'Deactivate student?' : 'Reactivate student?'}
        description={
          student.is_active
            ? `${student.full_name} will not be able to sign in. Their assignments and results are retained.`
            : `${student.full_name} will be able to sign in and continue assigned assessments.`
        }
        confirmLabel={student.is_active ? 'Deactivate' : 'Reactivate'}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        tone="danger"
        title="Delete this student permanently?"
        description={`${student.full_name} will be removed from the directory and their login will stop working. Their assignments, attempts and results are deleted too. This cannot be undone — deactivate instead if you need to keep the results.`}
        confirmLabel="Delete permanently"
      />
    </div>
  )
}
