import { Check, Flag, Images, X } from 'lucide-react'
import { Badge } from '../ui/Misc'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Form'
import { QuestionTypeBadge } from '../StatusBadge'
import { OptionContent } from '../OptionContent'
import { publicImageUrl } from '../../lib/supabase'
import type { AttemptFeedback, AttemptQuestion } from '../../lib/types'
import type { AnswerDraft } from '../../lib/attempt'
import { isAnswered } from '../../lib/attempt'
import {
  gridAnswerText,
  gridPair,
  gridPairMap,
  gridSelection,
  parseGridPair,
} from '../../lib/grid'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/format'

export function QuestionCard({
  question,
  sectionTitle,
  index,
  total,
  answer,
  disabled,
  feedback,
  checking = false,
  checkEnabled = false,
  autoCheck = false,
  onChange,
  onCheck,
  onFlag,
}: {
  question: AttemptQuestion
  sectionTitle: string
  index: number
  total: number
  answer: AnswerDraft
  disabled: boolean
  feedback?: AttemptFeedback | null
  checking?: boolean
  checkEnabled?: boolean
  autoCheck?: boolean
  onChange: (next: Partial<AnswerDraft>) => void
  onCheck?: () => void
  onFlag: () => void
}) {
  const isMultiple = question.question_type === 'multiple_select'
  const isShortAnswer = question.question_type === 'short_answer'
  const isGrid = question.question_type === 'grid'
  const gridRows = question.rows ?? []
  const currentAnswered = isAnswered(question, answer)
  const checked = Boolean(feedback)
  const correct = feedback?.is_correct === true
  const locked = disabled || correct || checking
  const showCheckButton =
    checkEnabled && !correct && (isMultiple || isShortAnswer || isGrid)

  const toggleOption = (optionId: string) => {
    if (locked) return
    if (isMultiple) {
      const selected = answer.selected.includes(optionId)
        ? answer.selected.filter((id) => id !== optionId)
        : [...answer.selected, optionId]
      onChange({ selected })
    } else {
      onChange({ selected: [optionId] })
      if (autoCheck) onCheck?.()
    }
  }

  const selectGridCell = (rowId: string, optionId: string) => {
    if (locked) return
    const selected = answer.selected.filter(
      (pair) => parseGridPair(pair)?.rowId !== rowId,
    )
    onChange({ selected: [...selected, gridPair(rowId, optionId)] })
  }

  const correctAnswerText = isGrid
    ? gridAnswerText(
        gridRows,
        question.options,
        feedback?.correct_options ?? [],
      )
    : (feedback?.correct_options ?? [])
        .map((optionId) => {
          const optionIndex = question.options.findIndex(
            (option) => option.id === optionId,
          )
          const option = question.options[optionIndex]
          if (!option) return null
          const letter = String.fromCharCode(65 + optionIndex)
          return `${letter}. ${option.text.trim() || 'Image option'}`
        })
        .filter(Boolean)
        .join(' · ')

  const correctGridMap = correct
    ? gridPairMap(feedback?.correct_options ?? [])
    : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">
            {sectionTitle}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Question {index + 1}{' '}
              <span className="font-normal text-slate-400">of {total}</span>
            </h2>
            <QuestionTypeBadge type={question.question_type} />
            <Badge tone="slate">{formatNumber(question.marks)} marks</Badge>
            {question.is_required ? <Badge tone="rose">Required</Badge> : null}
            {checked ? (
              <Badge tone={feedback?.is_correct ? 'green' : 'rose'}>
                {feedback?.is_correct ? 'Correct' : 'Incorrect'}
              </Badge>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onFlag}
          disabled={disabled}
          aria-pressed={answer.flagged}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
            answer.flagged
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800',
          )}
        >
          <Flag
            className={cn('h-3.5 w-3.5', answer.flagged && 'fill-amber-500 text-amber-500')}
          />
          {answer.flagged ? 'Flagged for review' : 'Flag for review'}
        </button>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <p className="whitespace-pre-wrap text-base font-medium leading-7 text-slate-900">
          {question.prompt}
        </p>

        {question.image_path ? (
          <div className="mt-4">
            <a
              href={publicImageUrl(question.image_path) ?? '#'}
              target="_blank"
              rel="noreferrer"
              title="Open image full size"
              className="inline-block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <img
                src={publicImageUrl(question.image_path) ?? ''}
                alt="Question illustration"
                className="max-h-80 rounded-xl border border-slate-200 object-contain"
              />
            </a>
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
              <Images className="h-3 w-3" />
              Question image · click to open full size
            </p>
          </div>
        ) : null}

        <div className="mt-5">
          {isShortAnswer ? (
            <div>
              <label
                htmlFor={`answer-${question.id}`}
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Your answer
              </label>
              <Textarea
                id={`answer-${question.id}`}
                value={answer.text}
                onChange={(event) => onChange({ text: event.target.value })}
                rows={7}
                maxLength={10000}
                disabled={locked}
                placeholder="Type your answer here…"
                className="min-h-[150px] text-base leading-7"
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {correct
                    ? 'Correct — this answer is locked.'
                    : checked
                      ? 'Not quite — change your answer and check again.'
                      : 'Saved automatically as you type.'}
                </span>
                <span>{answer.text.length.toLocaleString()} / 10,000</span>
              </div>
            </div>
          ) : isGrid ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Choose one answer for each row
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[440px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Item
                      </th>
                      {question.options.map((option, optionIndex) => (
                        <th
                          key={option.id}
                          className="border-b border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-700"
                        >
                          <OptionContent
                            option={option}
                            label={String.fromCharCode(65 + optionIndex)}
                            className="items-center text-center"
                            imageClassName="max-h-16"
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row, rowIndex) => {
                      const selectedOption = gridSelection(answer.selected, row.id)
                      return (
                        <tr key={row.id}>
                          <th
                            scope="row"
                            className="border-b border-slate-100 px-3 py-2.5 text-left text-sm font-medium leading-6 text-slate-800"
                          >
                            <span className="mr-1.5 text-xs font-semibold text-slate-400">
                              {String.fromCharCode(97 + rowIndex)})
                            </span>
                            {row.text}
                          </th>
                          {question.options.map((option, optionIndex) => {
                            const selected = selectedOption === option.id
                            const isCorrect =
                              checked &&
                              correctGridMap?.get(row.id) === option.id
                            const isWrong = checked && selected && !isCorrect
                            return (
                              <td
                                key={option.id}
                                className={cn(
                                  'border-b border-l border-slate-100 px-2 py-2 text-center',
                                  isCorrect && 'bg-emerald-50',
                                  isWrong && 'bg-rose-50',
                                )}
                              >
                                <label
                                  className={cn(
                                    'inline-flex items-center justify-center',
                                    locked ? 'cursor-default' : 'cursor-pointer',
                                  )}
                                >
                                  <input
                                    type="radio"
                                    name={`grid-${question.id}-${row.id}`}
                                    checked={selected}
                                    onChange={() =>
                                      selectGridCell(row.id, option.id)
                                    }
                                    disabled={locked}
                                    className="peer sr-only"
                                  />
                                  <span
                                    className={cn(
                                      'flex h-6 w-6 items-center justify-center rounded-full border transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1',
                                      isCorrect
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : isWrong
                                          ? 'border-rose-500 bg-rose-500 text-white'
                                          : selected
                                            ? 'border-brand-600 bg-brand-600 text-white'
                                            : 'border-slate-300 bg-white',
                                    )}
                                  >
                                    {selected ? (
                                      isWrong ? (
                                        <X className="h-3.5 w-3.5" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )
                                    ) : isCorrect ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : null}
                                  </span>
                                  <span className="sr-only">
                                    {row.text} —{' '}
                                    {option.text.trim() ||
                                      `Column ${optionIndex + 1}`}
                                  </span>
                                </label>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {isMultiple ? 'Select all that apply' : 'Select one answer'}
              </p>
              {question.options.map((option, optionIndex) => {
                const selected = answer.selected.includes(option.id)
                const isCorrectOption =
                  correct && feedback?.correct_options.includes(option.id)
                const isWrongSelection = checked && selected && !isCorrectOption
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleOption(option.id)}
                    disabled={locked}
                    aria-pressed={selected}
                    className={cn(
                      'flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition',
                      isCorrectOption
                        ? 'border-emerald-400 bg-emerald-50/80 ring-1 ring-emerald-400'
                        : isWrongSelection
                          ? 'border-rose-300 bg-rose-50/80 ring-1 ring-rose-300'
                          : selected
                            ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-400'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      locked && 'cursor-default',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center border transition',
                        isMultiple ? 'rounded-md' : 'rounded-full',
                        isCorrectOption
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : isWrongSelection
                            ? 'border-rose-500 bg-rose-500 text-white'
                            : selected
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-slate-300 bg-white',
                      )}
                    >
                      {isCorrectOption || isWrongSelection ? (
                        isCorrectOption ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )
                      ) : selected ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : null}
                    </span>
                    <OptionContent
                      option={option}
                      label={String.fromCharCode(65 + optionIndex)}
                      className="flex-1 text-sm leading-6 text-slate-800"
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      {String.fromCharCode(65 + optionIndex)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {showCheckButton ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={onCheck}
              loading={checking}
              disabled={!currentAnswered || checking}
            >
              {checked ? 'Check again' : 'Check answer'}
            </Button>
            <span className="text-xs text-slate-400">
              {checked
                ? 'Change your answer and check again — only a correct answer is locked.'
                : 'You can check as many times as you need.'}
            </span>
          </div>
        ) : null}

        {autoCheck && checking && !correct ? (
          <p className="mt-3 text-xs text-slate-400">Checking your answer…</p>
        ) : null}

        {feedback ? (
          <div
            className={cn(
              'mt-5 rounded-xl border p-4',
              feedback.is_correct
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-rose-200 bg-rose-50',
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white',
                  feedback.is_correct ? 'bg-emerald-600' : 'bg-rose-500',
                )}
              >
                {feedback.is_correct ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    feedback.is_correct ? 'text-emerald-900' : 'text-rose-900',
                  )}
                >
                  {feedback.is_correct ? 'Correct' : 'Incorrect'} ·{' '}
                  {formatNumber(feedback.awarded_marks ?? 0)} /{' '}
                  {formatNumber(feedback.marks)} marks
                </p>

                {isShortAnswer && feedback.answer_key ? (
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    Expected answer:{' '}
                    <span className="font-semibold">{feedback.answer_key}</span>
                  </p>
                ) : null}

                {!isShortAnswer && correctAnswerText ? (
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    Correct answer:{' '}
                    <span className="font-semibold">{correctAnswerText}</span>
                  </p>
                ) : null}

                {feedback.explanation ? (
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    {feedback.explanation}
                  </p>
                ) : null}

                {!feedback.is_correct ? (
                  <p className="mt-2 text-xs leading-5 text-slate-600">
                    Change your answer and check again.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {currentAnswered && !correct ? (
          <button
            type="button"
            onClick={() => onChange(isShortAnswer ? { text: '' } : { selected: [] })}
            disabled={disabled}
            className="mt-4 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-700 hover:underline"
          >
            Clear response
          </button>
        ) : null}
      </div>
    </div>
  )
}
