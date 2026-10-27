import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Eye,
  KeyRound,
  Pencil,
  Send,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { PageHeader, Badge, Avatar, Panel } from '../../components/ui/Misc'
import { Button, ButtonLink, IconButton, IconLink } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Form'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { ConfirmDialog } from '../../components/ui/Modal'
import { StudentDialog } from '../../components/admin/StudentDialog'
import { ResetPasswordDialog } from '../../components/admin/ResetPasswordDialog'
import { AssignTestDialog } from '../../components/admin/AssignTestDialog'
import { useAsyncData } from '../../hooks/useAsyncData'
import { supabase } from '../../lib/supabase'
import { invokeEdge } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useToast } from '../../context/ToastContext'
import type { Profile } from '../../lib/types'
import { cn } from '../../lib/cn'

export function AdminStudentsPage() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: students, loading, error, reload } = useAsyncData<Profile[]>(
    async () => {
      const { data, error: loadError } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('full_name')
      if (loadError) throw loadError
      return (data ?? []) as Profile[]
    },
    [],
  )

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Profile | null>(null)
  const [resetStudent, setResetStudent] = useState<Profile | null>(null)
  const [statusTarget, setStatusTarget] = useState<Profile | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [assignState, setAssignState] = useState<{
    open: boolean
    ids: string[]
    lock: boolean
  }>({ open: false, ids: [], lock: false })

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const departments = useMemo(
    () =>
      Array.from(
        new Set((students ?? []).map((student) => student.department).filter(Boolean)),
      ).sort() as string[],
    [students],
  )

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (students ?? []).filter((student) => {
      if (statusFilter === 'active' && !student.is_active) return false
      if (statusFilter === 'inactive' && student.is_active) return false
      if (departmentFilter && student.department !== departmentFilter) return false
      if (!term) return true
      return (
        student.full_name.toLowerCase().includes(term) ||
        (student.username ?? '').toLowerCase().includes(term) ||
        student.email.toLowerCase().includes(term) ||
        (student.department ?? '').toLowerCase().includes(term) ||
        (student.batch ?? '').toLowerCase().includes(term)
      )
    })
  }, [students, search, statusFilter, departmentFilter])

  const activeCount = (students ?? []).filter((student) => student.is_active).length
  const allVisibleSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((student) => selectedIds.has(student.id))

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const student of filteredStudents) {
        if (allVisibleSelected) next.delete(student.id)
        else next.add(student.id)
      }
      return next
    })
  }

  const openAssignForStudent = (student: Profile) => {
    setAssignState({ open: true, ids: [student.id], lock: true })
  }

  const openAssignForSelection = () => {
    setAssignState({ open: true, ids: Array.from(selectedIds), lock: false })
  }

  const handleStatusChange = async () => {
    if (!statusTarget) return
    setStatusUpdating(true)
    try {
      await invokeEdge('admin-students', {
        action: 'set_status',
        student_id: statusTarget.id,
        is_active: !statusTarget.is_active,
      })
      toast.success(
        statusTarget.is_active ? 'Student deactivated' : 'Student reactivated',
        statusTarget.is_active
          ? `${statusTarget.full_name} can no longer sign in.`
          : `${statusTarget.full_name} can sign in and access assignments again.`,
      )
      setStatusTarget(null)
      reload()
    } catch (statusError) {
      toast.error('Could not update status', getErrorMessage(statusError))
    } finally {
      setStatusUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await invokeEdge('admin-students', {
        action: 'delete_student',
        student_id: deleteTarget.id,
      })
      toast.success(
        'Student deleted',
        `${deleteTarget.full_name}'s account, assignments and results were permanently removed.`,
      )
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(deleteTarget.id)
        return next
      })
      setDeleteTarget(null)
      reload()
    } catch (deleteError) {
      toast.error('Could not delete student', getErrorMessage(deleteError))
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkDeleteBusy(true)
    let deleted = 0
    const failures: string[] = []
    for (const id of ids) {
      try {
        await invokeEdge('admin-students', {
          action: 'delete_student',
          student_id: id,
        })
        deleted += 1
      } catch (deleteError) {
        failures.push(getErrorMessage(deleteError))
      }
    }
    setBulkDeleteBusy(false)
    setBulkDeleteOpen(false)
    setSelectedIds(new Set())
    reload()
    if (deleted > 0) {
      toast.success(
        `${deleted} ${deleted === 1 ? 'student' : 'students'} deleted`,
        'Their accounts, assignments and results were permanently removed.',
      )
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} ${failures.length === 1 ? 'student' : 'students'} could not be deleted`,
        failures[0],
      )
    }
  }

  const assignInitialIds = useMemo(() => assignState.ids, [assignState.ids])

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Students"
        description="Create accounts, manage access and assign assessments. Every student has a unique username and profile."
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<Send className="h-4 w-4" />}
              onClick={openAssignForSelection}
              disabled={selectedIds.size === 0}
            >
              Assign {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </Button>
            <Button
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => setCreateOpen(true)}
            >
              Add student
            </Button>
          </>
        }
      />

      <Panel
        title={`Student directory · ${students?.length ?? 0}`}
        description={`${activeCount} active · ${(students?.length ?? 0) - activeCount} inactive`}
        actions={
          <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">
            <Users className="h-3.5 w-3.5" />
            Admin-managed accounts
          </span>
        }
        bodyClassName="p-0"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, username, email or department…"
            className="lg:max-w-md lg:flex-1"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')
              }
              aria-label="Filter by status"
              className="sm:w-40"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Select
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
              aria-label="Filter by department"
              className="sm:w-44"
            >
              <option value="">All departments</option>
              {departments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-50 px-5 py-2.5 text-xs">
            <span className="font-medium text-brand-900">
              {selectedIds.size} {selectedIds.size === 1 ? 'student' : 'students'}{' '}
              selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openAssignForSelection}
                className="font-semibold text-brand-700 hover:text-brand-800"
              >
                Assign a test
              </button>
              <span className="text-brand-300">|</span>
              <button
                type="button"
                onClick={() => setBulkDeleteOpen(true)}
                className="font-semibold text-rose-600 hover:text-rose-700"
              >
                Delete selected
              </button>
              <span className="text-brand-300">|</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-brand-700/70 hover:text-brand-800"
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <LoadingState className="rounded-none border-0" label="Loading students…" />
        ) : error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : filteredStudents.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={(students ?? []).length === 0 ? 'No students yet' : 'No matches'}
            description={
              (students ?? []).length === 0
                ? 'Add your first student to start assigning assessments.'
                : 'Try a different search term or filter.'
            }
            action={
              (students ?? []).length === 0 ? (
                <Button
                  leftIcon={<UserPlus className="h-4 w-4" />}
                  onClick={() => setCreateOpen(true)}
                >
                  Add student
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
                    setDepartmentFilter('')
                  }}
                >
                  Clear filters
                </Button>
              )
            }
            className="rounded-none border-0"
          />
        ) : (
          <Table className="min-w-[900px]">
            <THead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible students"
                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  />
                </Th>
                <Th>Student</Th>
                <Th>Department / batch</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {filteredStudents.map((student) => {
                const checked = selectedIds.has(student.id)
                return (
                  <Tr key={student.id} className={cn(checked && 'bg-brand-50/40')}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(student.id)}
                        aria-label={`Select ${student.full_name}`}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      />
                    </Td>
                    <Td>
                      <Link
                        to={`/admin/students/${student.id}`}
                        className="group flex items-center gap-3"
                      >
                        <Avatar name={student.full_name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                            {student.full_name}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            @{student.username ?? '—'} · {student.email}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="slate">{student.department ?? 'No department'}</Badge>
                        {student.batch ? (
                          <Badge tone="blue">{student.batch}</Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {student.is_active ? (
                        <Badge tone="green" dot>
                          Active
                        </Badge>
                      ) : (
                        <Badge tone="rose" dot>
                          Inactive
                        </Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(student.created_at)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        <IconLink
                          to={`/admin/students/${student.id}`}
                          label="View student"
                        >
                          <Eye className="h-4 w-4" />
                        </IconLink>
                        <IconButton
                          label="Edit student"
                          onClick={() => setEditingStudent(student)}
                        >
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Assign a test"
                          onClick={() => openAssignForStudent(student)}
                        >
                          <Send className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Reset password"
                          onClick={() => setResetStudent(student)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={student.is_active ? 'Deactivate student' : 'Reactivate student'}
                          variant={student.is_active ? 'danger' : 'ghost'}
                          onClick={() => setStatusTarget(student)}
                        >
                          {student.is_active ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </IconButton>
                        <IconButton
                          label="Delete student permanently"
                          variant="danger"
                          onClick={() => setDeleteTarget(student)}
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

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          <span>
            Showing {filteredStudents.length} of {students?.length ?? 0}
          </span>
          <ButtonLink to="/admin/assignments" variant="ghost" size="sm">
            View assignments
          </ButtonLink>
        </div>
      </Panel>

      <StudentDialog
        open={createOpen || Boolean(editingStudent)}
        student={editingStudent}
        onClose={() => {
          setCreateOpen(false)
          setEditingStudent(null)
        }}
        onSaved={reload}
      />

      <ResetPasswordDialog
        open={Boolean(resetStudent)}
        student={resetStudent}
        onClose={() => setResetStudent(null)}
      />

      <AssignTestDialog
        open={assignState.open}
        onClose={() =>
          setAssignState((current) => ({ ...current, open: false }))
        }
        initialStudentIds={assignInitialIds}
        lockStudents={assignState.lock}
        onAssigned={reload}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        onConfirm={handleStatusChange}
        loading={statusUpdating}
        tone={statusTarget?.is_active ? 'danger' : 'primary'}
        title={
          statusTarget?.is_active ? 'Deactivate student?' : 'Reactivate student?'
        }
        description={
          statusTarget?.is_active
            ? `${statusTarget.full_name} will not be able to sign in. Existing assignments and results are retained.`
            : `${statusTarget?.full_name} will be able to sign in and resume assigned assessments.`
        }
        confirmLabel={statusTarget?.is_active ? 'Deactivate' : 'Reactivate'}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        tone="danger"
        title="Delete this student permanently?"
        description={`${deleteTarget?.full_name ?? 'This student'} will be removed from the directory and their login will stop working. Their assignments, attempts and results are deleted too. This cannot be undone — deactivate instead if you need to keep the results.`}
        confirmLabel="Delete permanently"
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        loading={bulkDeleteBusy}
        tone="danger"
        title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'student' : 'students'} permanently?`}
        description="The selected accounts will be removed along with all of their assignments, attempts and results. This cannot be undone — deactivate instead if you need to keep the results."
        confirmLabel={`Delete ${selectedIds.size}`}
      />
    </div>
  )
}
