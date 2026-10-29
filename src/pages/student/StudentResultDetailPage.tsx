import { useParams } from 'react-router-dom'
import { Check, Lock, Trophy, X } from 'lucide-react'
import { PageHeader, Panel, Badge, MetaItem } from '../../components/ui/Misc'
import { Alert, ErrorState, LoadingState } from '../../components/ui/Feedback'
import { OptionContent } from '../../components/OptionContent'
import { GridAnswerTable } from '../../components/GridAnswerTable'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import { publicImageUrl } from '../../lib/supabase'
import {
  formatDateTime,
  formatNumber,
  formatTimeTaken,
} from '../../lib/format'
import type { AttemptReview, ReviewQuestion } from '../../lib/types'
import { cn } from '../../lib/cn'

export function StudentResultDetailPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const { data, loading, error, reload } = useAsyncData<AttemptReview>(
    async () => {
      if (!attemptId) throw new Error('Result not found.')
      return callRpc<AttemptReview>('get_attempt_review', {
        p_attempt_id: attemptId,
      })
    },
    [attemptId],
  )

  if (loading) {
    return (
      <div>
        <PageHeader
          backTo="/student/results"
          backLabel="My results"
          title="Loading result…"
        />
        <LoadingState label="Loading your feedback…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader backTo="/student/results" backLabel="My results" title="Result" />
        <ErrorState message={error ?? 'Result not found.'} onRetry={reload} />
      </div>
    )
  }

  if (!data.allowed) {
    return (
      <div>
        <PageHeader
          backTo="/student/results"
          backLabel="My results"
          eyebrow="Submitted assessment"
          title={data.test.title}
          description={`Attempt #${data.attempt.attempt_number} · ${formatDateTime(data.attempt.submitted_at)}`}
        />
        <div className="mx-auto max-w-lg">
          <Panel>
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <Lock className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                Results are hidden for this assessment
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Your submission was recorded successfully, but your administrator has
                not enabled detailed results for this test. Contact them if you need
                feedback.
              </p>
              <div className="mt-5">
                <Badge tone="green">Submitted</Badge>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    )
  }

  const { attempt, test, sections = [], totals } = data
  const percent =
    attempt.max_marks && attempt.max_marks > 0
      ? Math.round(((attempt.score ?? 0) / attempt.max_marks) * 100)
      : 0
  const pending = totals?.pending_manual ?? 0

  return (
    <div>
      <PageHeader
        backTo="/student/results"
        backLabel="My results"
        eyebrow="Assessment feedback"
        title={test.title}
        description={`Attempt #${attempt.attempt_number} · submitted ${formatDateTime(attempt.submitted_at)}`}
      />

      {pending > 0 ? (
        <Alert tone="warning" title="Some answers are still being reviewed" className="mb-5">
          Your objective score is complete. Short-answer questions are graded manually,
          so your final total may change.
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
              Your result
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-slate-900">
              {formatNumber(attempt.score ?? 0)}
              <span className="text-lg font-medium text-slate-400">
                {' '}/ {formatNumber(attempt.max_marks ?? totals?.max_marks)}
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-500">{percent}% of total marks</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pending > 0 ? (
              <Badge tone="amber">Provisional</Badge>
            ) : totals?.passed ? (
              <Badge tone="green">
                <Trophy className="mr-0.5 h-3 w-3" />
                Passed
              </Badge>
            ) : (
              <Badge tone="rose">Not passed</Badge>
            )}
            <Badge tone="slate">
              Passing: {formatNumber(test.passing_marks ?? 0)}
            </Badge>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-4">
          <MetaItem label="Submitted" value={formatDateTime(attempt.submitted_at)} />
          <MetaItem label="Time taken" value={formatTimeTaken(attempt.time_taken_seconds ?? null)} />
          <MetaItem label="Total marks" value={formatNumber(attempt.max_marks)} />
          <MetaItem
            label="Pending review"
            value={
              pending > 0
                ? `${pending} ${pending === 1 ? 'answer' : 'answers'}`
                : 'Complete'
            }
          />
        </dl>
      </div>

      <div className="mt-6 space-y-5">
        {sections.map((section, sectionIndex) => (
          <Panel
            key={section.id}
            title={
              <span className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-semibold text-white">
                  {sectionIndex + 1}
                </span>
                {section.title}
              </span>
            }
            description={section.description ?? undefined}
            actions={
              <Badge tone="brand">
                {formatNumber(section.score)} / {formatNumber(section.max_marks)}
              </Badge>
            }
            bodyClassName="p-4 sm:p-5"
          >
            <div className="space-y-4">
              {section.questions.map((question, questionIndex) => (
                <ReviewCard
                  key={question.id}
                  question={question}
                  index={questionIndex}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Scores and answer keys are visible because your administrator enabled results
        for this assessment.
      </p>
    </div>
  )
}

function ReviewCard({ question, index }: { question: ReviewQuestion; index: number }) {
  const response = question.response
  const awaiting =
    question.question_type === 'short_answer' && response?.awarded_marks == null

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">Q{index + 1}</span>
        <Badge tone="slate">
          {formatNumber(response?.awarded_marks ?? 0)} / {formatNumber(question.marks)}{' '}
          marks
        </Badge>
        {awaiting ? (
          <Badge tone="amber">Awaiting review</Badge>
        ) : response?.is_correct ? (
          <Badge tone="green">Correct</Badge>
        ) : question.question_type === 'short_answer' ? (
          <Badge tone="slate">Manually graded</Badge>
        ) : (
          <Badge tone="rose">Incorrect</Badge>
        )}
      </div>

      <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900">
        {question.prompt}
      </p>
      {question.image_path ? (
        <img
          src={publicImageUrl(question.image_path) ?? ''}
          alt="Question illustration"
          className="mt-3 max-h-56 rounded-lg border border-slate-200 object-contain"
        />
      ) : null}

      {question.question_type === 'short_answer' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Your answer
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
              {response?.text_answer?.trim() || (
                <span className="italic text-slate-400">No answer submitted</span>
              )}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Model answer
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {question.answer_key || 'No model answer provided.'}
            </p>
            {question.answer_aliases?.length ? (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Also accepted: {question.answer_aliases.join(' · ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : question.question_type === 'grid' ? (
        <GridAnswerTable
          rows={question.rows ?? []}
          columns={question.options}
          selected={response?.selected_options ?? []}
          correct={question.correct_options}
          selectedLabel="Your answer"
          className="mt-3"
        />
      ) : (
        <div className="mt-3 space-y-1.5">
          {question.options.map((option, optionIndex) => {
            const selected = response?.selected_options?.includes(option.id) ?? false
            const correct = question.correct_options.includes(option.id)
            return (
              <div
                key={option.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
                  selected && correct && 'border-emerald-300 bg-emerald-50 text-emerald-900',
                  selected && !correct && 'border-rose-300 bg-rose-50 text-rose-900',
                  !selected && correct &&
                    'border-dashed border-emerald-300 text-emerald-800',
                  !selected && !correct && 'border-slate-200 text-slate-600',
                )}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {selected ? (
                    correct ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 shrink-0" />
                    )
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <OptionContent
                    option={option}
                    label={String.fromCharCode(65 + optionIndex)}
                    className="min-w-0"
                    imageClassName="max-h-28"
                  />
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {selected ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                      Your answer
                    </span>
                  ) : null}
                  {correct ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      Correct
                    </span>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {question.explanation ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <span className="font-semibold">Explanation: </span>
          {question.explanation}
        </p>
      ) : null}
    </div>
  )
}
