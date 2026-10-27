import { Images, Timer, Trophy } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Feedback'
import { Badge } from '../ui/Misc'
import { QuestionTypeBadge } from '../StatusBadge'
import { OptionContent } from '../OptionContent'
import { GridAnswerTable } from '../GridAnswerTable'
import { publicImageUrl } from '../../lib/supabase'
import { formatMinutes, formatNumber } from '../../lib/format'
import type { Question, Section, Test } from '../../lib/types'

type PreviewTest = Omit<Test, 'sections'> & {
  sections: (Section & { questions: Question[] })[]
}

export function TestPreviewModal({
  open,
  onClose,
  test,
}: {
  open: boolean
  onClose: () => void
  test: PreviewTest | null
}) {
  if (!test) return null

  const computedMax = test.sections.reduce(
    (total, section) =>
      total + section.questions.reduce((sum, question) => sum + Number(question.marks), 0),
    0,
  )
  const questionCount = test.sections.reduce(
    (total, section) => total + section.questions.length,
    0,
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assessment preview"
      description="A student’s view, with correct answers highlighted for administrators."
      size="2xl"
      footer={<Button onClick={onClose}>Close preview</Button>}
    >
      <div className="space-y-5">
        <Alert tone="warning" title="Answer keys are visible here only">
          Students never see highlighted options, model answers or explanations
          before submitting — and only see them afterwards when results are enabled
          for this test.
        </Alert>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
              Assessment preview
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">
              {test.title || 'Untitled test'}
            </h2>
            {test.description ? (
              <p className="mt-2 text-sm leading-6 text-slate-600">{test.description}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="brand">{formatMinutes(test.duration_minutes)}</Badge>
              <Badge tone="slate">{formatNumber(computedMax)} marks</Badge>
              <Badge tone="slate">Pass: {formatNumber(test.passing_marks)}</Badge>
              <Badge tone="slate">
                {test.attempt_limit} {test.attempt_limit === 1 ? 'attempt' : 'attempts'}
              </Badge>
              <Badge tone={test.show_results ? 'green' : 'amber'}>
                {test.show_results ? 'Results visible after submit' : 'Results hidden'}
              </Badge>
            </div>
          </div>

          {test.instructions ? (
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Instructions
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {test.instructions}
              </p>
            </div>
          ) : null}

          <div className="space-y-6 p-5">
            {test.sections.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                This test has no sections yet.
              </p>
            ) : null}
            {test.sections.map((section, sectionIndex) => (
              <div key={section.id}>
                <div className="mb-3 flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                    {sectionIndex + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {section.title}
                    </h3>
                    {section.description ? (
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        {section.description}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 pl-8">
                  {section.questions.map((question, questionIndex) => (
                    <div
                      key={question.id}
                      className="rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">
                          Q{questionIndex + 1}
                        </span>
                        <QuestionTypeBadge type={question.question_type} />
                        <Badge tone="slate">{formatNumber(question.marks)} marks</Badge>
                        {question.is_required ? (
                          <Badge tone="rose">Required</Badge>
                        ) : (
                          <Badge tone="slate">Optional</Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-900">
                        {question.prompt}
                      </p>
                      {question.image_path ? (
                        <div className="mt-3">
                          <a
                            href={publicImageUrl(question.image_path) ?? '#'}
                            target="_blank"
                            rel="noreferrer"
                            title="Open image full size"
                            className="inline-block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                          >
                            <img
                              src={publicImageUrl(question.image_path) ?? ''}
                              alt="Question illustration"
                              className="max-h-64 rounded-lg border border-slate-200 object-contain"
                            />
                          </a>
                        </div>
                      ) : null}

                      {question.question_type === 'short_answer' ? (
                        <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Model answer
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                            {question.answer_key || 'No model answer provided.'}
                          </p>
                        </div>
                      ) : question.question_type === 'grid' ? (
                        <GridAnswerTable
                          rows={question.grid_rows ?? []}
                          columns={question.options}
                          correct={question.correct_options}
                          className="mt-3"
                        />
                      ) : (
                        <ul className="mt-3 space-y-1.5">
                          {question.options.map((option, optionIndex) => {
                            const correct = question.correct_options.includes(option.id)
                            return (
                              <li
                                key={option.id}
                                className={
                                  correct
                                    ? 'flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
                                    : 'flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700'
                                }
                              >
                                <OptionContent
                                  option={option}
                                  label={String.fromCharCode(65 + optionIndex)}
                                  className="min-w-0 flex-1"
                                  imageClassName="max-h-32"
                                />
                                {correct ? (
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                                    Correct
                                  </span>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {question.explanation ? (
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          <span className="font-semibold text-slate-600">Explanation: </span>
                          {question.explanation}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {section.questions.length === 0 ? (
                    <p className="text-xs italic text-slate-400">
                      No questions in this section yet.
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Images className="h-3.5 w-3.5" />
              {questionCount} questions
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              {formatMinutes(test.duration_minutes)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" />
              Pass at {formatNumber(test.passing_marks)}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
