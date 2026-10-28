import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Image as ImageIcon, KeyRound, Save } from 'lucide-react'
import { Badge, PageHeader } from '../../components/ui/Misc'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback'
import { Input, SearchInput, Select } from '../../components/ui/Form'
import { Modal } from '../../components/ui/Modal'
import { QuestionTypeBadge } from '../../components/StatusBadge'
import { useAsyncData, useDocumentTitle } from '../../hooks/useAsyncData'
import { useToast } from '../../context/ToastContext'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/format'
import { publicImageUrl, supabase } from '../../lib/supabase'
import {
  applyGridRow,
  applyOption,
  draftFromQuestion,
  gridColumns,
  isKeyComplete,
  keyFingerprint,
  keyPatch,
  optionHotkeys,
  optionLetter,
  sameDraft,
} from '../../lib/answerKey'
import type { KeyDraft } from '../../lib/answerKey'
import type { Question, Section, TestWithStructure } from '../../lib/types'

type Loaded = {
  test: TestWithStructure
  sections: (Section & { questions: Question[] })[]
}

type ReviewFilter = 'pending' | 'all' | 'reviewed'

const DRAFT_PREFIX = 'pwci.answerKeys.draft.'
const REVIEW_PREFIX = 'pwci.answerKeys.reviewed.'

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or a full quota: editing still works, it just isn't restored.
  }
}

function dropKey(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clean up.
  }
}

export function AnswerKeysPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  useDocumentTitle('Answer keys')

  const { data, loading, error, reload } = useAsyncData<Loaded>(async () => {
    if (!id) throw new Error('Test not found.')
    const { data: test, error: testError } = await supabase
      .from('tests')
      .select('*, sections(*, questions(*))')
      .eq('id', id)
      .maybeSingle()
    if (testError) throw testError
    if (!test) throw new Error('This test could not be found.')

    const typed = test as TestWithStructure
    const sections = [...(typed.sections ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((section) => ({
        ...section,
        questions: [...(section.questions ?? [])].sort(
          (a, b) => a.position - b.position,
        ),
      }))
    return { test: typed, sections }
  }, [id])

  const sections = useMemo(() => data?.sections ?? [], [data])
  const allQuestions = useMemo(
    () => sections.flatMap((section) => section.questions),
    [sections],
  )

  // Keys edited on this page but not saved yet, plus the last saved values so
  // the page reflects writes without a full reload.
  const [drafts, setDrafts] = useState<Record<string, KeyDraft>>({})
  const [committed, setCommitted] = useState<Record<string, KeyDraft>>({})
  // question id -> fingerprint of the key that was actually reviewed.
  const [reviewed, setReviewed] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)
  const [restoredCount, setRestoredCount] = useState(0)
  const [saving, setSaving] = useState(false)

  const [filter, setFilter] = useState<ReviewFilter>('pending')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [figurePath, setFigurePath] = useState<string | null>(null)
  const scrollTargetRef = useRef<string | null>(null)

  const draftFor = useCallback(
    (question: Question): KeyDraft =>
      drafts[question.id] ?? committed[question.id] ?? draftFromQuestion(question),
    [drafts, committed],
  )

  const isReviewed = useCallback(
    (question: Question): boolean =>
      reviewed[question.id] === keyFingerprint(question, draftFor(question)),
    [reviewed, draftFor],
  )

  // Restore this browser's unsaved work once the questions are available.
  useEffect(() => {
    if (!data || !id || hydrated) return
    const storedDrafts = readJson<Record<string, KeyDraft>>(DRAFT_PREFIX + id)
    const storedReviews = readJson<Record<string, string>>(REVIEW_PREFIX + id)
    if (storedDrafts) setDrafts(storedDrafts)
    if (storedReviews) setReviewed(storedReviews)
    setRestoredCount(Object.keys(storedDrafts ?? {}).length)
    setHydrated(true)
  }, [data, id, hydrated])

  useEffect(() => {
    if (!hydrated || !id) return
    if (Object.keys(drafts).length) writeJson(DRAFT_PREFIX + id, drafts)
    else dropKey(DRAFT_PREFIX + id)
  }, [drafts, hydrated, id])

  useEffect(() => {
    if (!hydrated || !id) return
    writeJson(REVIEW_PREFIX + id, reviewed)
  }, [reviewed, hydrated, id])

  const dirtyCount = Object.keys(drafts).length

  useEffect(() => {
    if (!dirtyCount) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyCount])

  const handleChange = useCallback(
    (question: Question, next: KeyDraft) => {
      setDrafts((current) => {
        const base = committed[question.id] ?? draftFromQuestion(question)
        const copy = { ...current }
        if (sameDraft(next, base, question)) delete copy[question.id]
        else copy[question.id] = next
        return copy
      })
    },
    [committed],
  )

  const toggleReviewed = useCallback(
    (question: Question) => {
      const draft = draftFor(question)
      if (isReviewed(question)) {
        setReviewed((current) => {
          const next = { ...current }
          delete next[question.id]
          return next
        })
        return
      }
      if (!isKeyComplete(question, draft)) {
        toast.info('Set a key first', 'Short answers need an expected answer before they can be reviewed.')
        return
      }
      setReviewed((current) => ({
        ...current,
        [question.id]: keyFingerprint(question, draft),
      }))
    },
    [draftFor, isReviewed, toast],
  )

  const save = useCallback(async () => {
    const ids = Object.keys(drafts)
    if (!ids.length || saving) return
    setSaving(true)

    const byId = new Map(allQuestions.map((question) => [question.id, question]))
    const saved: Record<string, KeyDraft> = {}
    const failed: string[] = []

    for (let index = 0; index < ids.length; index += 6) {
      const chunk = ids.slice(index, index + 6)
      const results = await Promise.allSettled(
        chunk.map(async (questionId) => {
          const question = byId.get(questionId)
          if (!question) return
          const { error: updateError } = await supabase
            .from('questions')
            .update(keyPatch(question, drafts[questionId]))
            .eq('id', questionId)
          if (updateError) throw updateError
        }),
      )
      results.forEach((result, position) => {
        const questionId = chunk[position]
        if (result.status === 'fulfilled') saved[questionId] = drafts[questionId]
        else failed.push(questionId)
      })
    }

    setCommitted((current) => ({ ...current, ...saved }))
    setDrafts((current) => {
      const next = { ...current }
      for (const questionId of Object.keys(saved)) delete next[questionId]
      return next
    })
    setSaving(false)

    const savedCount = Object.keys(saved).length
    if (savedCount) {
      toast.success(
        `${savedCount} answer ${savedCount === 1 ? 'key' : 'keys'} saved`,
        'Grading uses these keys the next time an attempt is submitted.',
      )
    }
    if (failed.length) {
      toast.error(
        `${failed.length} ${failed.length === 1 ? 'key' : 'keys'} could not be saved`,
        'Your changes are kept in this browser — check the connection and try again.',
      )
    }
  }, [allQuestions, drafts, saving, toast])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allQuestions.filter((question) => {
      if (sectionFilter !== 'all' && question.section_id !== sectionFilter) {
        return false
      }
      if (filter === 'pending' && isReviewed(question)) return false
      if (filter === 'reviewed' && !isReviewed(question)) return false
      if (!needle) return true
      const haystack = [
        question.prompt,
        question.answer_key ?? '',
        ...question.options.map((option) => option.text),
        ...question.grid_rows.map((row) => row.text),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [allQuestions, filter, isReviewed, search, sectionFilter])

  const groups = useMemo(
    () =>
      sections
        .map((section, sectionIndex) => ({
          section,
          sectionIndex,
          questions: visible.filter(
            (question) => question.section_id === section.id,
          ),
        }))
        .filter((group) => group.questions.length > 0),
    [sections, visible],
  )

  // Keyboard shortcuts only apply to a card that is actually on screen, so a
  // reviewed card that just left the filter can never be edited unseen.
  const activeQuestion = useMemo(
    () => visible.find((question) => question.id === activeId) ?? null,
    [visible, activeId],
  )

  const reviewedCount = allQuestions.filter(isReviewed).length
  const total = allQuestions.length
  const percent = total ? Math.round((reviewedCount / total) * 100) : 0

  const focusNext = useCallback(
    (currentId: string) => {
      const index = visible.findIndex((question) => question.id === currentId)
      const next = visible[index + 1]
      if (!next) return
      scrollTargetRef.current = next.id
      setActiveId(next.id)
    },
    [visible],
  )

  // Scroll only when Enter moved the cursor, never when a card was clicked.
  useEffect(() => {
    const target = scrollTargetRef.current
    if (!target || target !== activeId) return
    scrollTargetRef.current = null
    document
      .getElementById(`key-question-${target}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.defaultPrevented) return

      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"]',
        )
      ) {
        return
      }
      if (!activeQuestion) return

      const key = event.key.toLowerCase()
      if (key === 'enter') {
        const draft = draftFor(activeQuestion)
        if (!isKeyComplete(activeQuestion, draft)) return
        event.preventDefault()
        setReviewed((current) => ({
          ...current,
          [activeQuestion.id]: keyFingerprint(activeQuestion, draft),
        }))
        focusNext(activeQuestion.id)
        return
      }

      const optionId = optionHotkeys(activeQuestion.options).get(key)
      if (optionId) {
        event.preventDefault()
        handleChange(
          activeQuestion,
          applyOption(activeQuestion, draftFor(activeQuestion), optionId),
        )
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeQuestion, draftFor, focusNext, handleChange, save])

  if (loading) {
    return (
      <div>
        <PageHeader backTo="/admin/tests" backLabel="Tests" title="Answer keys" />
        <LoadingState label="Loading questions…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader backTo="/admin/tests" backLabel="Tests" title="Answer keys" />
        <ErrorState message={error ?? 'Test not found.'} onRetry={reload} />
      </div>
    )
  }

  const { test } = data

  return (
    <div>
      <PageHeader
        backTo={`/admin/tests/${test.id}/edit`}
        backLabel="Back to builder"
        eyebrow="Answer keys"
        title={test.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">
              <KeyRound className="h-3 w-3" />
              {formatNumber(reviewedCount)} of {formatNumber(total)} reviewed
            </Badge>
            <span className="text-xs text-slate-400">
              {sections.length} sections · {formatNumber(total)} questions ·{' '}
              {formatNumber(test.max_marks)} marks
            </span>
          </span>
        }
        actions={
          <ButtonLink
            to={`/admin/tests/${test.id}/edit`}
            variant="outline"
            leftIcon={<KeyRound className="h-4 w-4" />}
          >
            Test builder
          </ButtonLink>
        }
      />

      <div className="sticky top-16 z-20 mb-5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-soft backdrop-blur lg:top-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-700">
                {formatNumber(reviewedCount)} / {formatNumber(total)} keys reviewed
              </span>
              <span className="text-slate-500">{percent}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirtyCount ? (
              <Badge tone="amber">{formatNumber(dirtyCount)} unsaved</Badge>
            ) : null}
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={!dirtyCount}
              leftIcon={<Save className="h-4 w-4" />}
            >
              {dirtyCount ? `Save ${formatNumber(dirtyCount)}` : 'Saved'}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                ['pending', `Not reviewed (${formatNumber(total - reviewedCount)})`],
                ['all', `All (${formatNumber(total)})`],
                ['reviewed', `Reviewed (${formatNumber(reviewedCount)})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-semibold transition',
                  filter === value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Select
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            aria-label="Filter by section"
            className="w-full py-1.5 text-xs sm:w-60"
          >
            <option value="all">All sections</option>
            {sections.map((section, index) => (
              <option key={section.id} value={section.id}>
                {index + 1}. {section.title}
              </option>
            ))}
          </Select>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search prompts and options…"
            label="Search questions"
            className="w-full sm:w-72"
          />
          <span className="hidden text-[11px] leading-5 text-slate-400 xl:block">
            Click a question, press A–D to set the key, Enter to confirm and move
            on. Ctrl+S saves.
          </span>
        </div>
      </div>

      {restoredCount ? (
        <Alert tone="info" className="mb-4" title="Unsaved changes restored">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              {formatNumber(restoredCount)} key{' '}
              {restoredCount === 1 ? 'change was' : 'changes were'} kept in this
              browser after the last visit.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDrafts({})
                setRestoredCount(0)
                if (id) dropKey(DRAFT_PREFIX + id)
              }}
            >
              Discard them
            </Button>
          </div>
        </Alert>
      ) : null}

      <Alert tone="warning" className="mb-4" title="These keys are placeholders">
        Every question currently points at the first option (or the first grid
        column), and short answers have no expected text. Choose the real answer
        and press <span className="font-semibold">Mark reviewed</span> so the
        counter reflects what a person has checked. Short answers are graded on a
        case- and whitespace-insensitive match of the whole text.
      </Alert>

      {groups.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-5 w-5" />}
          title={total === 0 ? 'This test has no questions yet' : 'Nothing matches'}
          description={
            total === 0
              ? 'Add questions in the test builder first, then set their keys here.'
              : 'No questions match the current filter and search.'
          }
          action={
            total === 0 ? (
              <ButtonLink to={`/admin/tests/${test.id}/edit`} size="sm">
                Open the test builder
              </ButtonLink>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilter('all')
                  setSectionFilter('all')
                  setSearch('')
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-7">
          {groups.map(({ section, sectionIndex, questions }) => {
            const sectionReviewed = section.questions.filter(isReviewed).length
            return (
              <section key={section.id} aria-label={section.title}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                      {sectionIndex + 1}
                    </span>
                    {section.title}
                  </h2>
                  <span className="text-xs text-slate-500">
                    {formatNumber(sectionReviewed)} /{' '}
                    {formatNumber(section.questions.length)} reviewed
                  </span>
                </div>
                <div className="space-y-2">
                  {questions.map((question) => (
                    <QuestionKeyCard
                      key={question.id}
                      question={question}
                      index={
                        section.questions.findIndex(
                          (item) => item.id === question.id,
                        ) + 1
                      }
                      draft={draftFor(question)}
                      reviewed={isReviewed(question)}
                      active={activeId === question.id}
                      onActivate={() => setActiveId(question.id)}
                      onChange={(next) => handleChange(question, next)}
                      onToggleReviewed={() => toggleReviewed(question)}
                      onConfirm={() => {
                        if (isReviewed(question)) return
                        toggleReviewed(question)
                        focusNext(question.id)
                      }}
                      onOpenFigure={setFigurePath}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <Modal
        open={Boolean(figurePath)}
        onClose={() => setFigurePath(null)}
        title="Question figure"
        description="Open the image in a new tab if you need to zoom further."
        size="xl"
      >
        {figurePath ? (
          <div className="space-y-3">
            <img
              src={publicImageUrl(figurePath) ?? ''}
              alt="Question figure"
              className="mx-auto max-w-full rounded-lg border border-slate-200"
            />
            <a
              href={publicImageUrl(figurePath) ?? '#'}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              Open full size in a new tab
            </a>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function QuestionKeyCard({
  question,
  index,
  draft,
  reviewed,
  active,
  onActivate,
  onChange,
  onToggleReviewed,
  onConfirm,
  onOpenFigure,
}: {
  question: Question
  index: number
  draft: KeyDraft
  reviewed: boolean
  active: boolean
  onActivate: () => void
  onChange: (next: KeyDraft) => void
  onToggleReviewed: () => void
  onConfirm: () => void
  onOpenFigure: (path: string) => void
}) {
  const complete = isKeyComplete(question, draft)

  return (
    <article
      id={`key-question-${question.id}`}
      tabIndex={-1}
      onClick={onActivate}
      className={cn(
        'scroll-mt-40 rounded-xl border bg-white p-3.5 transition sm:p-4',
        reviewed
          ? 'border-emerald-200 bg-emerald-50/30'
          : 'border-slate-200',
        active && 'border-brand-400 ring-2 ring-brand-500/25',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 w-7 shrink-0 text-right text-xs font-semibold text-slate-400">
            {index}.
          </span>
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800">
              {question.prompt}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <QuestionTypeBadge type={question.question_type} />
              <Badge tone="slate">{formatNumber(question.marks)} marks</Badge>
              {question.image_path ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenFigure(question.image_path as string)
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <ImageIcon className="h-3 w-3" />
                  View figure
                </button>
              ) : null}
            </div>

            {question.image_path ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenFigure(question.image_path as string)
                }}
                className="mt-2 block cursor-zoom-in"
                aria-label="Open question figure"
              >
                <img
                  src={publicImageUrl(question.image_path) ?? ''}
                  alt="Question figure"
                  className="max-h-40 w-auto rounded-lg border border-slate-200 bg-white object-contain"
                />
              </button>
            ) : null}

            <div className="mt-2.5">
              <KeyControl
                question={question}
                draft={draft}
                onChange={onChange}
                onConfirm={onConfirm}
                onOpenFigure={onOpenFigure}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleReviewed()
            }}
            disabled={!reviewed && !complete}
            title={
              reviewed
                ? 'Reviewed — click to undo'
                : complete
                  ? 'Mark this key reviewed (Enter)'
                  : 'Set a key first'
            }
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition',
              reviewed
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : complete
                  ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400',
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
        </div>
      </div>
    </article>
  )
}

function KeyControl({
  question,
  draft,
  onChange,
  onConfirm,
  onOpenFigure,
}: {
  question: Question
  draft: KeyDraft
  onChange: (next: KeyDraft) => void
  onConfirm: () => void
  onOpenFigure: (path: string) => void
}) {
  if (question.question_type === 'short_answer') {
    return (
      <div className="max-w-2xl">
        <Input
          value={draft.answerKey}
          onChange={(event) => onChange({ ...draft, answerKey: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onConfirm()
            }
          }}
          placeholder="Expected answer — graded on a case- and whitespace-insensitive match"
          aria-label="Expected answer"
          className="py-1.5 text-sm"
        />
      </div>
    )
  }

  if (question.question_type === 'grid') {
    const columns = gridColumns(question, draft)
    return (
      <div className="space-y-1.5">
        {question.grid_rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-1 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 sm:flex-row sm:items-center sm:gap-3"
          >
            <p className="min-w-0 flex-1 text-xs leading-5 text-slate-700">
              {row.text || `Row ${row.id}`}
            </p>
            <Select
              value={columns.get(row.id) ?? ''}
              onChange={(event) =>
                onChange(applyGridRow(question, draft, row.id, event.target.value))
              }
              aria-label={`Correct column for ${row.text || `row ${row.id}`}`}
              className="w-full py-1 text-xs sm:w-52"
            >
              <option value="">Choose…</option>
              {question.options.map((option, optionIndex) => (
                <option key={option.id} value={option.id}>
                  {optionLetter(optionIndex)} · {option.text || `Column ${option.id}`}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
    )
  }

  const multiple = question.question_type === 'multiple_select'
  const selected = new Set(draft.correct)

  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {question.options.map((option, optionIndex) => {
        const isSelected = selected.has(option.id)
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(applyOption(question, draft, option.id))}
            aria-pressed={isSelected}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-xs leading-5 transition',
              isSelected
                ? 'border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500/30'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] font-bold',
                multiple ? 'rounded' : 'rounded-full',
                isSelected
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-500',
              )}
            >
              {optionLetter(optionIndex)}
            </span>
            {option.image_path ? (
              <img
                src={publicImageUrl(option.image_path) ?? ''}
                alt={`Option ${optionLetter(optionIndex)}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenFigure(option.image_path as string)
                }}
                className="h-20 w-auto cursor-zoom-in rounded border border-slate-200 bg-white object-contain"
              />
            ) : null}
            {option.text ? (
              <span className="whitespace-pre-wrap">{option.text}</span>
            ) : option.image_path ? null : (
              <span className="italic text-slate-400">No text</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
