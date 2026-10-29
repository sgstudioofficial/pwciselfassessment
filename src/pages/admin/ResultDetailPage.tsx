import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  Download,
  Save,
  X,
} from 'lucide-react'
import { PageHeader, Panel, Avatar, Badge, MetaItem } from '../../components/ui/Misc'
import { Button } from '../../components/ui/Button'
import { Alert, ErrorState, LoadingState } from '../../components/ui/Feedback'
import { Input } from '../../components/ui/Form'
import { AttemptStatusBadge, QuestionTypeBadge } from '../../components/StatusBadge'
import { OptionContent } from '../../components/OptionContent'
import { GridAnswerTable } from '../../components/GridAnswerTable'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import { publicImageUrl } from '../../lib/supabase'
import { formatAttemptLimitCount } from '../../lib/attempts'
import { gridAnswerText } from '../../lib/grid'
import {
  formatDateTime,
  formatNumber,
  formatScore,
  formatTimeTaken,
} from '../../lib/format'
import { csvFilename, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errors'
import { useToast } from '../../context/ToastContext'
import type {
  AdminAttemptDetail,
  ReviewQuestion,
  ReviewSection,
} from '../../lib/types'
import { cn } from '../../lib/cn'

export function AdminResultDetailPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData<AdminAttemptDetail>(
    async () => {
      if (!attemptId) throw new Error('Result not found.')
      return callRpc<AdminAttemptDetail>('get_admin_attempt_detail', {
        p_attempt_id: attemptId,
      })
    },
    [attemptId],
  )

  const exportResponses = () => {
    if (!data) return
    const rows: (string | number)[][] = []
    for (const section of data.sections) {
      for (const question of section.questions) {
        rows.push([
          section.title,
          question.prompt,
          question.question_type,
          answerText(question),
          correctAnswerText(question),
          question.response?.awarded_marks ?? '',
          question.marks,
          question.response?.awarded_marks == null
            ? 'Needs grading'
            : question.response.is_correct
              ? 'Correct'
              : 'Incorrect',
        ])
      }
    }
    downloadCsv(
      csvFilename(
        `pwci-attempt-${data.student.username ?? data.attempt.id.slice(0, 8)}`,
      ),
      [
        'Section',
        'Question',
        'Type',
        'Student answer',
        'Correct answer',
        'Marks awarded',
        'Max marks',
        'Status',
      ],
      rows,
    )
    toast.success('Responses exported')
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          backTo="/admin/results"
          backLabel="Results"
          title="Loading result…"
        />
        <LoadingState label="Loading attempt and responses…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader backTo="/admin/results" backLabel="Results" title="Result" />
        <ErrorState message={error ?? 'Result not found.'} onRetry={reload} />
      </div>
    )
  }

  const { attempt, student, test, sections, totals } = data
  const pending = totals.pending_manual
  const percent =
    attempt.max_marks > 0
      ? Math.round(((attempt.score ?? 0) / attempt.max_marks) * 100)
      : 0

  return (
    <div>
      <PageHeader
        backTo="/admin/results"
        backLabel="All results"
        eyebrow="Attempt review"
        title={test.title}
        description={`${student.full_name} · attempt #${attempt.attempt_number} · ${formatDateTime(attempt.submitted_at)}`}
        actions={
          <Button
            variant="outline"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={exportResponses}
          >
            Export responses
          </Button>
        }
      />

      {pending > 0 ? (
        <Alert
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          title={`${pending} short-answer ${pending === 1 ? 'response needs' : 'responses need'} manual grading`}
          className="mb-6"
        >
          The total score is provisional until every short answer has marks.
        </Alert>
      ) : null}

      <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={student.full_name} size="xl" />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-slate-900">{student.full_name}</p>
              <p className="text-sm text-slate-500">@{student.username}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {[student.department, student.batch].filter(Boolean).join(' · ') ||
                  'No department'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="text-left sm:text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Total score
              </p>
              <p className="text-3xl font-bold tracking-tight text-slate-900">
                {formatNumber(attempt.score ?? 0)}
                <span className="text-base font-medium text-slate-400">
                  {' '}/ {formatNumber(attempt.max_marks)}
                </span>
              </p>
              <p className="text-xs text-slate-500">{percent}%</p>
            </div>
            <div className="flex flex-col items-start gap-1.5">
              {pending === 0 ? (
                totals.passed ? (
                  <Badge tone="green">Passed</Badge>
                ) : (
                  <Badge tone="rose">Not passed</Badge>
                )
              ) : (
                <Badge tone="amber">Provisional</Badge>
              )}
              <AttemptStatusBadge status={attempt.status} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-4">
          <MetaItem label="Submitted" value={formatDateTime(attempt.submitted_at)} />
          <MetaItem label="Time taken" value={formatTimeTaken(attempt.time_taken_seconds)} />
          <MetaItem label="Passing marks" value={formatNumber(test.passing_marks)} />
          <MetaItem
            label="Attempt"
            value={`#${attempt.attempt_number} of ${formatAttemptLimitCount(test.attempt_limit)}`}
          />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {sections.map((section, sectionIndex) => (
            <SectionReview
              key={section.id}
              section={section}
              sectionIndex={sectionIndex}
              attemptInProgress={attempt.status === 'in_progress'}
              onGraded={reload}
            />
          ))}
          {sections.length === 0 ? (
            <Panel>
              <p className="py-8 text-center text-sm text-slate-500">
                This attempt has no questions.
              </p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Score breakdown">
            <div className="space-y-3">
              {sections.map((section) => (
                <div key={section.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-slate-600">{section.title}</span>
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatNumber(section.score)} / {formatNumber(section.max_marks)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{
                        width: `${
                          section.max_marks > 0
                            ? Math.min(100, (section.score / section.max_marks) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">
                <span>Total</span>
                <span>
                  {formatScore(attempt.score, attempt.max_marks)}
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Candidate details">
            <dl className="space-y-3">
              <MetaItem label="Email" value={<span className="break-all">{student.email}</span>} />
              <MetaItem label="Username" value={`@${student.username}`} />
              <MetaItem label="Department" value={student.department ?? '—'} />
              <MetaItem label="Batch" value={student.batch ?? '—'} />
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function SectionReview({
  section,
  sectionIndex,
  attemptInProgress,
  onGraded,
}: {
  section: ReviewSection
  sectionIndex: number
  attemptInProgress: boolean
  onGraded: () => void
}) {
  return (
    <Panel
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
          <QuestionReview
            key={question.id}
            question={question}
            index={questionIndex}
            attemptInProgress={attemptInProgress}
            onGraded={onGraded}
          />
        ))}
      </div>
    </Panel>
  )
}

function QuestionReview({
  question,
  index,
  attemptInProgress,
  onGraded,
}: {
  question: ReviewQuestion
  index: number
  attemptInProgress: boolean
  onGraded: () => void
}) {
  const response = question.response
  const awaitingGrade =
    question.question_type === 'short_answer' && response?.awarded_marks == null

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">Q{index + 1}</span>
        <QuestionTypeBadge type={question.question_type} />
        <Badge tone="slate">
          {formatNumber(response?.awarded_marks ?? 0)} / {formatNumber(question.marks)}{' '}
          marks
        </Badge>
        {awaitingGrade ? (
          <Badge tone="amber">Needs grading</Badge>
        ) : response?.is_correct ? (
          <Badge tone="green">Correct</Badge>
        ) : question.question_type !== 'short_answer' ? (
          <Badge tone="rose">Incorrect</Badge>
        ) : null}
        {response?.is_flagged ? <Badge tone="purple">Flagged</Badge> : null}
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
          <AnswerBlock label="Student answer">
            {response?.text_answer?.trim() ? (
              <p className="whitespace-pre-wrap text-sm text-slate-800">
                {response.text_answer}
              </p>
            ) : (
              <p className="text-sm italic text-slate-400">No answer submitted</p>
            )}
          </AnswerBlock>
          <AnswerBlock label="Model answer">
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {question.answer_key || 'No model answer provided.'}
            </p>
            {question.answer_aliases?.length ? (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Also accepted: {question.answer_aliases.join(' · ')}
              </p>
            ) : null}
          </AnswerBlock>
        </div>
      ) : question.question_type === 'grid' ? (
        <GridAnswerTable
          rows={question.rows ?? []}
          columns={question.options}
          selected={response?.selected_options ?? []}
          correct={question.correct_options}
          selectedLabel="Student"
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
                  !selected && correct && 'border-dashed border-emerald-300 text-emerald-800',
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
                      Selected
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

      {question.question_type === 'short_answer' ? (
        <GradeControl
          question={question}
          responseId={response?.id ?? null}
          currentMarks={response?.awarded_marks ?? null}
          disabled={attemptInProgress}
          onGraded={onGraded}
        />
      ) : null}
    </div>
  )
}

function GradeControl({
  question,
  responseId,
  currentMarks,
  disabled,
  onGraded,
}: {
  question: ReviewQuestion
  responseId: string | null
  currentMarks: number | null
  disabled: boolean
  onGraded: () => void
}) {
  const toast = useToast()
  const [marks, setMarks] = useState(
    currentMarks != null ? String(currentMarks) : '',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMarks(currentMarks != null ? String(currentMarks) : '')
  }, [currentMarks])

  const save = async () => {
    if (!responseId) return
    const value = Number(marks)
    if (!Number.isFinite(value) || value < 0 || value > question.marks) {
      toast.error(
        'Invalid marks',
        `Enter a value between 0 and ${formatNumber(question.marks)}.`,
      )
      return
    }
    setSaving(true)
    try {
      await callRpc('grade_response', {
        p_response_id: responseId,
        p_awarded_marks: value,
      })
      toast.success('Marks saved', 'The attempt total has been recalculated.')
      onGraded()
    } catch (gradeError) {
      toast.error('Could not save marks', getErrorMessage(gradeError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label
          htmlFor={`grade-${responseId}`}
          className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
        >
          Award marks (0–{formatNumber(question.marks)})
        </label>
        <Input
          id={`grade-${responseId}`}
          type="number"
          min={0}
          max={question.marks}
          step={0.5}
          value={marks}
          onChange={(event) => setMarks(event.target.value)}
          disabled={disabled || saving || !responseId}
          className="mt-1 h-9 max-w-[160px]"
          placeholder="0"
        />
      </div>
      <Button
        size="sm"
        onClick={save}
        loading={saving}
        disabled={disabled || !responseId}
        leftIcon={!saving ? <Save className="h-3.5 w-3.5" /> : undefined}
      >
        Save marks
      </Button>
    </div>
  )
}

function AnswerBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function answerText(question: ReviewQuestion): string {
  const response = question.response
  if (!response) return ''
  if (question.question_type === 'short_answer') return response.text_answer ?? ''
  if (question.question_type === 'grid') {
    return gridAnswerText(
      question.rows ?? [],
      question.options,
      response.selected_options ?? [],
    )
  }
  return response.selected_options
    .map((id) => {
      const option = question.options.find((item) => item.id === id)
      if (!option) return id
      return option.text.trim() || 'Image option'
    })
    .join('; ')
}

function correctAnswerText(question: ReviewQuestion): string {
  if (question.question_type === 'short_answer') return question.answer_key ?? ''
  if (question.question_type === 'grid') {
    return gridAnswerText(
      question.rows ?? [],
      question.options,
      question.correct_options,
    )
  }
  return question.correct_options
    .map((id) => {
      const option = question.options.find((item) => item.id === id)
      if (!option) return id
      return option.text.trim() || 'Image option'
    })
    .join('; ')
}
