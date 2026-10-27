import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Eye,
  Lock,
  Trophy,
} from 'lucide-react'
import { PageHeader, Panel, Badge } from '../../components/ui/Misc'
import { ButtonLink } from '../../components/ui/Button'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
} from '../../components/ui/Feedback'
import { AttemptStatusBadge } from '../../components/StatusBadge'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import {
  formatDateTime,
  formatNumber,
  formatScore,
  formatTimeTaken,
} from '../../lib/format'
import type { MyResultsData } from '../../lib/types'

export function StudentResultsPage() {
  const { data, loading, error, reload } = useAsyncData<MyResultsData>(
    () => callRpc<MyResultsData>('get_my_results'),
    [],
  )

  const results = useMemo(() => data?.results ?? [], [data])
  const visible = results.filter((result) => result.show_results)
  const gradedVisible = visible.filter(
    (result) => result.status === 'graded' && result.score != null,
  )
  const average =
    gradedVisible.length > 0
      ? Math.round(
          (gradedVisible.reduce(
            (total, result) =>
              total + (result.max_marks > 0 ? (result.score ?? 0) / result.max_marks : 0),
            0,
          ) /
            gradedVisible.length) *
            100,
        )
      : null
  const best =
    gradedVisible.length > 0
      ? Math.max(
          ...gradedVisible.map((result) =>
            result.max_marks > 0 ? ((result.score ?? 0) / result.max_marks) * 100 : 0,
          ),
        )
      : null
  const pending = results.filter((result) => result.status === 'submitted').length

  return (
    <div>
      <PageHeader
        eyebrow="Your progress"
        title="My results"
        description="Every submitted attempt, with scores where your administrator has enabled result visibility."
        actions={
          <ButtonLink
            to="/student"
            variant="outline"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Dashboard
          </ButtonLink>
        }
      />

      {loading ? (
        <LoadingState label="Loading your results…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              label="Submitted attempts"
              value={results.length}
              icon={<ClipboardCheck className="h-4 w-4" />}
              tone="brand"
            />
            <StatCard
              label="Average score"
              value={average == null ? '—' : `${average}%`}
              hint="Visible graded attempts"
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <StatCard
              label="Best score"
              value={best == null ? '—' : `${Math.round(best)}%`}
              hint="Across graded attempts"
              icon={<Trophy className="h-4 w-4" />}
              tone="emerald"
            />
            <StatCard
              label="Awaiting review"
              value={pending}
              hint="Short answers being graded"
            />
          </div>

          <Panel className="mt-6" bodyClassName="p-0">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Attempt history</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Newest submissions first. Results marked hidden are controlled by your
                administrator.
              </p>
            </div>

            {results.length === 0 ? (
              <EmptyState
                icon={<BarChart3 className="h-5 w-5" />}
                title="No completed assessments"
                description="Submit an assigned assessment to see your results here."
                action={
                  <ButtonLink to="/student" variant="outline">
                    View assignments
                  </ButtonLink>
                }
                className="rounded-none border-0"
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((result) => {
                  const hidden = !result.show_results
                  const passed =
                    result.status === 'graded' && result.score != null
                      ? result.score >= result.passing_marks
                      : null
                  return (
                    <li
                      key={result.attempt_id}
                      className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {result.test_title}
                          </h3>
                          <AttemptStatusBadge status={result.status} />
                          {result.needs_grading ? (
                            <Badge tone="amber">Awaiting review</Badge>
                          ) : passed == null ? null : passed ? (
                            <Badge tone="green">Passed</Badge>
                          ) : (
                            <Badge tone="rose">Not passed</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Attempt #{result.attempt_number} · Submitted{' '}
                          {formatDateTime(result.submitted_at)} ·{' '}
                          {formatTimeTaken(result.time_taken_seconds)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-6 sm:justify-end">
                        <div className="text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Score
                          </p>
                          {hidden ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                              <Lock className="h-3.5 w-3.5" />
                              Hidden
                            </span>
                          ) : (
                            <p className="text-sm font-semibold text-slate-900">
                              {result.score == null
                                ? 'Pending'
                                : formatScore(result.score, result.max_marks)}
                              <span className="ml-1 text-xs font-normal text-slate-400">
                                / {formatNumber(result.max_marks)}
                              </span>
                            </p>
                          )}
                        </div>
                        {hidden ? (
                          <span className="text-xs text-slate-400">
                            Results disabled
                          </span>
                        ) : (
                          <Link
                            to={`/student/results/${result.attempt_id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </Link>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          {results.some((result) => !result.show_results) ? (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5" />
              Some results are hidden by your administrator. Contact them if you need
              feedback.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
