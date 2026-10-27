import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, Download, Eye, TrendingUp, Clock3 } from 'lucide-react'
import { PageHeader, Panel, Avatar, Badge } from '../../components/ui/Misc'
import { Button, IconLink } from '../../components/ui/Button'
import { SearchInput, Select } from '../../components/ui/Form'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
} from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { AttemptStatusBadge } from '../../components/StatusBadge'
import { useAsyncData } from '../../hooks/useAsyncData'
import { supabase } from '../../lib/supabase'
import {
  formatDateTime,
  formatScore,
  formatTimeTaken,
} from '../../lib/format'
import { csvFilename, downloadCsv } from '../../lib/csv'
import type { AttemptStatus, ResultListRow } from '../../lib/types'

type StatusFilter = 'all' | 'submitted' | 'graded'

export function AdminResultsPage() {
  const [searchParams] = useSearchParams()
  const { data: attempts, loading, error, reload } = useAsyncData<
    ResultListRow[]
  >(async () => {
    const { data, error: loadError } = await supabase
      .from('attempts')
      .select(
        '*, tests(id, title, passing_marks, show_results, attempt_limit), profiles!attempts_student_id_fkey(id, full_name, username, department, batch)',
      )
      .neq('status', 'in_progress')
      .order('submitted_at', { ascending: false })
    if (loadError) throw loadError
    return (data ?? []) as unknown as ResultListRow[]
  }, [])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    searchParams.get('filter') === 'pending' ? 'submitted' : 'all',
  )
  const [testFilter, setTestFilter] = useState('')

  const testOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const attempt of attempts ?? []) {
      if (attempt.tests) seen.set(attempt.tests.id, attempt.tests.title)
    }
    return Array.from(seen.entries())
  }, [attempts])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (attempts ?? []).filter((attempt) => {
      if (statusFilter !== 'all' && attempt.status !== statusFilter) return false
      if (testFilter && attempt.tests?.id !== testFilter) return false
      if (!term) return true
      return (
        (attempt.profiles?.full_name ?? '').toLowerCase().includes(term) ||
        (attempt.profiles?.username ?? '').toLowerCase().includes(term) ||
        (attempt.tests?.title ?? '').toLowerCase().includes(term)
      )
    })
  }, [attempts, search, statusFilter, testFilter])

  const allAttempts = attempts ?? []
  const pending = allAttempts.filter((attempt) => attempt.status === 'submitted').length
  const graded = allAttempts.filter((attempt) => attempt.status === 'graded')
  const passed = graded.filter(
    (attempt) =>
      attempt.tests != null && (attempt.score ?? 0) >= attempt.tests.passing_marks,
  ).length
  const passRate = graded.length > 0 ? Math.round((passed / graded.length) * 100) : null
  const averagePercent =
    graded.length > 0
      ? Math.round(
          (graded.reduce(
            (total, attempt) =>
              total + (attempt.max_marks > 0 ? (attempt.score ?? 0) / attempt.max_marks : 0),
            0,
          ) /
            graded.length) *
            100,
        )
      : null

  const exportCsv = () => {
    downloadCsv(
      csvFilename('pwci-results'),
      [
        'Student',
        'Username',
        'Department',
        'Batch',
        'Test',
        'Attempt',
        'Status',
        'Score',
        'Max marks',
        'Passing marks',
        'Passed',
        'Submitted at',
        'Time taken (seconds)',
      ],
      filtered.map((attempt) => [
        attempt.profiles?.full_name ?? '',
        attempt.profiles?.username ?? '',
        attempt.profiles?.department ?? '',
        attempt.profiles?.batch ?? '',
        attempt.tests?.title ?? '',
        attempt.attempt_number,
        attempt.status,
        attempt.score,
        attempt.max_marks,
        attempt.tests?.passing_marks ?? '',
        attempt.status === 'graded' && attempt.tests
          ? (attempt.score ?? 0) >= attempt.tests.passing_marks
            ? 'Yes'
            : 'No'
          : 'Pending',
        attempt.submitted_at ? formatDateTime(attempt.submitted_at) : '',
        attempt.time_taken_seconds ?? '',
      ]),
    )
  }

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All results' },
    { value: 'submitted', label: 'Needs grading' },
    { value: 'graded', label: 'Graded' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Results"
        description="Review every completed attempt, grade short answers and export reports."
        actions={
          <Button
            variant="outline"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            Export CSV
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Submitted attempts"
          value={allAttempts.length}
          icon={<BarChart3 className="h-4 w-4" />}
          tone="brand"
        />
        <StatCard
          label="Needs manual grading"
          value={pending}
          icon={<Clock3 className="h-4 w-4" />}
          tone={pending > 0 ? 'amber' : 'emerald'}
        />
        <StatCard
          label="Pass rate"
          value={passRate == null ? '—' : `${passRate}%`}
          hint={`${passed} of ${graded.length} graded attempts`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          label="Average score"
          value={averagePercent == null ? '—' : `${averagePercent}%`}
          hint="Across graded attempts"
        />
      </div>

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1.5">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={
                  statusFilter === option.value
                    ? 'rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white'
                    : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }
              >
                {option.label}
                {option.value === 'submitted' && pending > 0 ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700">
                    {pending}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:ml-auto">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search student or test…"
              className="sm:w-64"
            />
            <Select
              value={testFilter}
              onChange={(event) => setTestFilter(event.target.value)}
              aria-label="Filter by test"
              className="sm:w-52"
            >
              <option value="">All tests</option>
              {testOptions.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {loading ? (
          <LoadingState className="rounded-none border-0" label="Loading results…" />
        ) : error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title={allAttempts.length === 0 ? 'No submissions yet' : 'No matching results'}
            description={
              allAttempts.length === 0
                ? 'Completed student attempts will appear here automatically.'
                : 'Adjust the status, test or search filter.'
            }
            action={
              allAttempts.length === 0 ? undefined : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
                    setTestFilter('')
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
                <Th>Submitted</Th>
                <Th>Time taken</Th>
                <Th>Status</Th>
                <Th>Score</Th>
                <Th>Outcome</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.map((attempt) => {
                const test = attempt.tests
                const isGraded = attempt.status === 'graded'
                const isPassed =
                  isGraded && test ? (attempt.score ?? 0) >= test.passing_marks : null
                return (
                  <Tr key={attempt.id}>
                    <Td>
                      {attempt.profiles ? (
                        <Link
                          to={`/admin/students/${attempt.profiles.id}`}
                          className="group flex items-center gap-3"
                        >
                          <Avatar name={attempt.profiles.full_name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900 group-hover:text-brand-700">
                              {attempt.profiles.full_name}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              @{attempt.profiles.username}
                              {attempt.profiles.department
                                ? ` · ${attempt.profiles.department}`
                                : ''}
                            </span>
                          </span>
                        </Link>
                      ) : (
                        <span className="text-sm text-slate-500">Deleted student</span>
                      )}
                    </Td>
                    <Td className="max-w-[240px]">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {test?.title ?? 'Deleted test'}
                      </p>
                      <p className="text-xs text-slate-400">Attempt #{attempt.attempt_number}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDateTime(attempt.submitted_at)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {formatTimeTaken(attempt.time_taken_seconds)}
                    </Td>
                    <Td>
                      <AttemptStatusBadge status={attempt.status as AttemptStatus} />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatScore(attempt.score, attempt.max_marks)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {attempt.max_marks > 0
                          ? `${Math.round(((attempt.score ?? 0) / attempt.max_marks) * 100)}%`
                          : '—'}
                      </p>
                    </Td>
                    <Td>
                      {isPassed == null ? (
                        <Badge tone="amber">Pending</Badge>
                      ) : isPassed ? (
                        <Badge tone="green">Passed</Badge>
                      ) : (
                        <Badge tone="rose">Not passed</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end">
                        <IconLink to={`/admin/results/${attempt.id}`} label="View result">
                          <Eye className="h-4 w-4" />
                        </IconLink>
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
            Showing {filtered.length} of {allAttempts.length}
          </span>
          <span>{graded.length} graded attempts</span>
        </div>
      </Panel>
    </div>
  )
}
