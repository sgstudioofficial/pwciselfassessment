import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCheck, Send, Users } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Alert, EmptyState, LoadingState } from '../ui/Feedback'
import { Field, Input, SearchInput, Select } from '../ui/Form'
import { Avatar } from '../ui/Misc'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { callRpc } from '../../lib/rpc'
import { formatMinutes, formatNumber, fromDateTimeLocal } from '../../lib/format'
import type { Profile, Test } from '../../lib/types'
import { cn } from '../../lib/cn'

const studentFields = 'id, full_name, username, department, batch, is_active'

export function AssignTestDialog({
  open,
  onClose,
  initialStudentIds,
  lockStudents = false,
  onAssigned,
}: {
  open: boolean
  onClose: () => void
  initialStudentIds?: string[]
  lockStudents?: boolean
  onAssigned?: () => void
}) {
  const toast = useToast()
  const [tests, setTests] = useState<Test[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTestId, setSelectedTestId] = useState('')
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [batch, setBatch] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [attemptLimit, setAttemptLimit] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setError(null)
    setSearch('')
    setDepartment('')
    setBatch('')
    setDueAt('')
    setAttemptLimit('')
    setSelectedTestId('')
    setSelectedStudentIds(
      new Set(initialStudentIds?.length ? initialStudentIds : []),
    )

    Promise.all([
      supabase
        .from('tests')
        .select('*')
        .eq('status', 'published')
        .order('title'),
      supabase
        .from('profiles')
        .select(studentFields)
        .eq('role', 'student')
        .eq('is_active', true)
        .order('full_name'),
    ])
      .then(([testsResult, studentsResult]) => {
        if (cancelled) return
        if (testsResult.error) throw testsResult.error
        if (studentsResult.error) throw studentsResult.error
        setTests((testsResult.data ?? []) as Test[])
        setStudents((studentsResult.data ?? []) as Profile[])
      })
      .catch((loadFailure: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(loadFailure))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, initialStudentIds])

  const selectedTest = tests.find((test) => test.id === selectedTestId) ?? null

  const departments = useMemo(
    () =>
      Array.from(
        new Set(students.map((student) => student.department).filter(Boolean)),
      ).sort() as string[],
    [students],
  )
  const batches = useMemo(
    () =>
      Array.from(
        new Set(students.map((student) => student.batch).filter(Boolean)),
      ).sort() as string[],
    [students],
  )

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase()
    return students.filter((student) => {
      if (department && student.department !== department) return false
      if (batch && student.batch !== batch) return false
      if (!term) return true
      return (
        student.full_name.toLowerCase().includes(term) ||
        (student.username ?? '').toLowerCase().includes(term)
      )
    })
  }, [students, search, department, batch])

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedStudentIds((current) => {
      const allSelected = filteredStudents.every((student) => current.has(student.id))
      const next = new Set(current)
      for (const student of filteredStudents) {
        if (allSelected) next.delete(student.id)
        else next.add(student.id)
      }
      return next
    })
  }

  const handleAssign = async () => {
    setError(null)
    if (!selectedTestId) return setError('Choose a published test.')
    if (selectedStudentIds.size === 0) return setError('Select at least one student.')

    const dueIso = dueAt ? fromDateTimeLocal(dueAt) : null
    if (dueAt && !dueIso) return setError('Enter a valid deadline.')
    if (dueIso && new Date(dueIso).getTime() <= Date.now()) {
      return setError('The deadline must be in the future.')
    }

    const limit = attemptLimit ? Number(attemptLimit) : null
    if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
      return setError('Attempt limit must be a whole number between 1 and 20.')
    }

    setSubmitting(true)
    try {
      const inserted = await callRpc<number>('assign_test', {
        p_test_id: selectedTestId,
        p_student_ids: Array.from(selectedStudentIds),
        p_due_at: dueIso,
        p_attempt_limit: limit,
      })
      if (inserted > 0) {
        toast.success(
          'Assessment assigned',
          `${inserted} ${inserted === 1 ? 'student' : 'students'} can now access the test.`,
        )
      } else {
        toast.info(
          'No new assignments',
          'The selected students already have this test assigned.',
        )
      }
      onAssigned?.()
      onClose()
    } catch (assignError) {
      setError(getErrorMessage(assignError))
    } finally {
      setSubmitting(false)
    }
  }

  const allFilteredSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((student) => selectedStudentIds.has(student.id))

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Assign an assessment"
      description="Only published tests can be assigned. Assignments are stored per student and validated on the server."
      size="2xl"
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
            <Users className="h-3.5 w-3.5" />
            {selectedStudentIds.size} selected
          </span>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            loading={submitting}
            leftIcon={!submitting ? <Send className="h-4 w-4" /> : undefined}
            disabled={loading || tests.length === 0}
          >
            Assign test
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Loading tests and students…" className="py-10" />
      ) : loadError ? (
        <Alert tone="danger">{loadError}</Alert>
      ) : tests.length === 0 ? (
        <EmptyState
          title="No published tests"
          description="Publish at least one test before assigning it to students."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Test" htmlFor="assign-test" required className="sm:col-span-2">
              <Select
                id="assign-test"
                value={selectedTestId}
                onChange={(event) => setSelectedTestId(event.target.value)}
              >
                <option value="">Select a published test…</option>
                {tests.map((test) => (
                  <option key={test.id} value={test.id}>
                    {test.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Deadline (optional)"
              htmlFor="assign-due"
              hint="After this, students cannot start or continue."
            >
              <Input
                id="assign-due"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
              />
            </Field>
          </div>

          {selectedTest ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-xs text-brand-900">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                {formatMinutes(selectedTest.duration_minutes)}
              </span>
              <span>{formatNumber(selectedTest.max_marks)} marks total</span>
              <span>Pass: {formatNumber(selectedTest.passing_marks)}</span>
              <span>
                {selectedTest.attempt_limit}{' '}
                {selectedTest.attempt_limit === 1 ? 'attempt' : 'attempts'} allowed
              </span>
            </div>
          ) : null}

          <Field
            label="Attempt limit override"
            htmlFor="assign-limit"
            hint="Leave blank to use the test default."
          >
            <Input
              id="assign-limit"
              type="number"
              min={1}
              max={20}
              value={attemptLimit}
              onChange={(event) => setAttemptLimit(event.target.value)}
              placeholder={selectedTest ? String(selectedTest.attempt_limit) : 'Test default'}
              className="max-w-[180px]"
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">Students</p>
              {!lockStudents ? (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {allFilteredSelected ? 'Clear shown' : 'Select all shown'}
                </button>
              ) : (
                <span className="text-xs text-slate-400">Selection fixed</span>
              )}
            </div>

            {!lockStudents ? (
              <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_150px_150px]">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Search by name or username…"
                />
                <Select
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  aria-label="Filter by department"
                >
                  <option value="">All departments</option>
                  {departments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
                <Select
                  value={batch}
                  onChange={(event) => setBatch(event.target.value)}
                  aria-label="Filter by batch"
                >
                  <option value="">All batches</option>
                  {batches.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
              {filteredStudents.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  No active students match this view.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredStudents.map((student) => {
                    const checked = selectedStudentIds.has(student.id)
                    return (
                      <li key={student.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition',
                            checked ? 'bg-brand-50/60' : 'hover:bg-slate-50',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStudent(student.id)}
                            disabled={lockStudents}
                            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                          />
                          <Avatar name={student.full_name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {student.full_name}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              @{student.username}
                              {student.department ? ` · ${student.department}` : ''}
                              {student.batch ? ` · ${student.batch}` : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      )}
    </Modal>
  )
}
