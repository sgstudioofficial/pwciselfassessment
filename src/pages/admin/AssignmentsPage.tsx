import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, Send, Trash2, Users } from 'lucide-react'
import { PageHeader, Panel, Avatar, Badge } from '../../components/ui/Misc'
import { Button, IconButton, IconLink } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Form'
import { EmptyState, ErrorState, LoadingState, StatCard } from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { ConfirmDialog } from '../../components/ui/Modal'
import { AssignTestDialog } from '../../components/admin/AssignTestDialog'
import { useAsyncData } from '../../hooks/useAsyncData'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errors'
import { formatAttemptLimitCount } from '../../lib/attempts'
import { formatDateTime, formatRelative } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import type { AssignmentListRow } from '../../lib/types'
import { cn } from '../../lib/cn'

type AssignmentStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'unavailable'

function deriveStatus(assignment: AssignmentListRow): AssignmentStatus {
  const attempts = assignment.attempts ?? []
  if (attempts.some((attempt) => attempt.status === 'in_progress')) return 'in_progress'
  if (attempts.some((attempt) => attempt.status !== 'in_progress')) return 'completed'
  if (assignment.tests?.status !== 'published') return 'unavailable'
  if (assignment.due_at && new Date(assignment.due_at).getTime() <= Date.now()) {
    return 'overdue'
  }
  return 'pending'
}

const statusLabels: Record<AssignmentStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  overdue: 'Overdue',
  unavailable: 'Unavailable',
}

export function AdminAssignmentsPage() {
  const toast = useToast()
  const { data: assignments, loading, error, reload } = useAsyncData<
    AssignmentListRow[]
  >(async () => {
    const { data, error: loadError } = await supabase
      .from('test_assignments')
      .select(
        '*, tests(id, title, status, duration_minutes, max_marks, attempt_limit), profiles!test_assignments_student_id_fkey(id, full_name, username, is_active, department, batch), attempts(id, status, submitted_at, score, attempt_number)',
      )
      .order('created_at', { ascending: false })
    if (loadError) throw loadError
    return (data ?? []) as unknown as AssignmentListRow[]
  }, [])

  const [search, setSearch] = useState('')
  const [testFilter, setTestFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AssignmentStatus>('all')
  const [assignOpen, setAssignOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AssignmentListRow | null>(null)
  const [revoking, setRevoking] = useState(false)

  const testOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const assignment of assignments ?? []) {
      if (assignment.tests) seen.set(assignment.tests.id, assignment.tests.title)
    }
    return Array.from(seen.entries())
  }, [assignments])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (assignments ?? [])
      .map((assignment) => ({ assignment, status: deriveStatus(assignment) }))
      .filter(({ assignment, status }) => {
        if (testFilter && assignment.tests?.id !== testFilter) return false
        if (statusFilter !== 'all' && status !== statusFilter) return false
        if (!term) return true
        return (
          (assignment.tests?.title ?? '').toLowerCase().includes(term) ||
          (assignment.profiles?.full_name ?? '').toLowerCase().includes(term) ||
          (assignment.profiles?.username ?? '').toLowerCase().includes(term)
        )
      })
  }, [assignments, search, testFilter, statusFilter])

  const allRows = useMemo(
    () => (assignments ?? []).map((assignment) => deriveStatus(assignment)),
    [assignments],
  )
  const counts = {
    total: assignments?.length ?? 0,
    pending: allRows.filter((status) => status === 'pending').length,
    inProgress: allRows.filter((status) => status === 'in_progress').length,
    completed: allRows.filter((status) => status === 'completed').length,
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const { error: deleteError } = await supabase
        .from('test_assignments')
        .delete()
        .eq('id', revokeTarget.id)
      if (deleteError) throw deleteError
      toast.success('Assignment revoked')
      setRevokeTarget(null)
      reload()
    } catch (revokeError) {
      toast.error('Could not revoke assignment', getErrorMessage(revokeError))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Delivery"
        title="Assignments"
        description="Every published test assigned to a student, with attempt progress and deadlines."
        actions={
          <Button
            leftIcon={<Send className="h-4 w-4" />}
            onClick={() => setAssignOpen(true)}
          >
            Assign test
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total assignments"
          value={counts.total}
          icon={<Users className="h-4 w-4" />}
          tone="brand"
        />
        <StatCard
          label="Pending"
          value={counts.pending}
          icon={<CalendarClock className="h-4 w-4" />}
          tone="amber"
        />
        <StatCard label="In progress" value={counts.inProgress} />
        <StatCard label="Completed" value={counts.completed} tone="emerald" />
      </div>

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search student or test…"
            className="lg:max-w-md lg:flex-1"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={testFilter}
              onChange={(event) => setTestFilter(event.target.value)}
              aria-label="Filter by test"
              className="sm:w-56"
            >
              <option value="">All tests</option>
              {testOptions.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </Select>
            <Select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | AssignmentStatus)
              }
              aria-label="Filter by assignment status"
              className="sm:w-40"
            >
              <option value="all">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {loading ? (
          <LoadingState className="rounded-none border-0" label="Loading assignments…" />
        ) : error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Send className="h-5 w-5" />}
            title={(assignments ?? []).length === 0 ? 'No assignments yet' : 'No matches'}
            description={
              (assignments ?? []).length === 0
                ? 'Assign a published test to one student, a selection or a whole department.'
                : 'Try a different filter or search term.'
            }
            action={
              (assignments ?? []).length === 0 ? (
                <Button onClick={() => setAssignOpen(true)}>Assign a test</Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setTestFilter('')
                    setStatusFilter('all')
                  }}
                >
                  Clear filters
                </Button>
              )
            }
            className="rounded-none border-0"
          />
        ) : (
          <Table className="min-w-[980px]">
            <THead>
              <tr>
                <Th>Student</Th>
                <Th>Test</Th>
                <Th>Assigned</Th>
                <Th>Deadline</Th>
                <Th>Attempts</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map(({ assignment, status }) => {
                const attempts = assignment.attempts ?? []
                const submitted = attempts.filter(
                  (attempt) => attempt.status !== 'in_progress',
                )
                const latest = submitted.sort(
                  (a, b) => b.attempt_number - a.attempt_number,
                )[0]
                const effectiveLimit =
                  assignment.attempt_limit ?? assignment.tests?.attempt_limit ?? null
                const isOverdue = status === 'overdue'
                return (
                  <Tr key={assignment.id}>
                    <Td>
                      {assignment.profiles ? (
                        <Link
                          to={`/admin/students/${assignment.profiles.id}`}
                          className="group flex items-center gap-3"
                        >
                          <Avatar name={assignment.profiles.full_name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900 group-hover:text-brand-700">
                              {assignment.profiles.full_name}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              @{assignment.profiles.username}
                              {assignment.profiles.department
                                ? ` · ${assignment.profiles.department}`
                                : ''}
                            </span>
                          </span>
                        </Link>
                      ) : (
                        <span className="text-sm text-slate-500">Deleted student</span>
                      )}
                    </Td>
                    <Td>
                      <p className="max-w-[220px] truncate text-sm font-medium text-slate-800">
                        {assignment.tests?.title ?? 'Deleted test'}
                      </p>
                      {assignment.tests?.status !== 'published' ? (
                        <span className="text-xs text-slate-400">
                          Test is {assignment.tests?.status ?? 'unavailable'}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatRelative(assignment.created_at)}
                    </Td>
                    <Td
                      className={cn(
                        'whitespace-nowrap text-xs',
                        isOverdue ? 'font-semibold text-rose-600' : 'text-slate-500',
                      )}
                    >
                      {assignment.due_at ? formatDateTime(assignment.due_at) : 'No deadline'}
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-700">
                        {attempts.length}
                        {effectiveLimit ? ` / ${formatAttemptLimitCount(effectiveLimit)}` : ''}
                      </span>
                      {latest ? (
                        <p className="text-xs text-slate-400">
                          Latest: {latest.score ?? '—'} /{' '}
                          {assignment.tests?.max_marks ?? '—'}
                        </p>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          status === 'completed'
                            ? 'green'
                            : status === 'in_progress'
                              ? 'blue'
                              : status === 'overdue'
                                ? 'rose'
                                : status === 'unavailable'
                                  ? 'slate'
                                  : 'amber'
                        }
                        dot
                      >
                        {statusLabels[status]}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        {assignment.profiles ? (
                          <IconLink
                            to={`/admin/students/${assignment.profiles.id}`}
                            label="View student"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </IconLink>
                        ) : null}
                        <IconButton
                          label="Revoke assignment"
                          variant="danger"
                          onClick={() => setRevokeTarget(assignment)}
                          disabled={attempts.length > 0}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      <AssignTestDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onAssigned={reload}
      />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        loading={revoking}
        title="Revoke this assignment?"
        description={`${revokeTarget?.profiles?.full_name ?? 'This student'} will no longer see “${revokeTarget?.tests?.title ?? 'this test'}”. This is only possible before they start an attempt.`}
        confirmLabel="Revoke assignment"
      />
    </div>
  )
}
