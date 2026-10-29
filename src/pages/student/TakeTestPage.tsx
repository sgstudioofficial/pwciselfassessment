import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  CloudOff,
  Flag,
  LayoutGrid,
  Loader2,
  Save,
  Send,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { Brand } from '../../components/layout/Brand'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Misc'
import { Alert, ErrorState, FullPageLoader } from '../../components/ui/Feedback'
import { Modal } from '../../components/ui/Modal'
import { QuestionCard } from '../../components/student/QuestionCard'
import { useToast } from '../../context/ToastContext'
import { callRpc } from '../../lib/rpc'
import { getErrorMessage } from '../../lib/errors'
import { formatDuration, formatNumber } from '../../lib/format'
import type {
  Attempt,
  AttemptFeedback,
  AttemptQuestion,
  AttemptState,
  AttemptStatus,
} from '../../lib/types'
import {
  emptyAnswerDraft,
  isAnswered,
  type AnswerDraft,
} from '../../lib/attempt'
import { cn } from '../../lib/cn'

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

type SubmittedInfo = {
  auto: boolean
  attemptId: string
  score: number | null
  maxMarks: number
  showResults: boolean
  pending: boolean
}

type QuestionEntry = {
  question: AttemptQuestion
  sectionTitle: string
}

type SaveResponseRow = {
  server_now: string
  attempt_status: AttemptStatus
}

export function TakeTestPage() {
  const { attemptId } = useParams<{ attemptId: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [state, setState] = useState<AttemptState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({})
  const [feedback, setFeedback] = useState<Record<string, AttemptFeedback>>({})
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [submitted, setSubmitted] = useState<SubmittedInfo | null>(null)
  const [clockExpired, setClockExpired] = useState(false)

  const stateRef = useRef<AttemptState | null>(null)
  const answersRef = useRef<Record<string, AnswerDraft>>({})
  const dirtyRef = useRef<Set<string>>(new Set())
  const failedRef = useRef<Set<string>>(new Set())
  const savingRef = useRef(0)
  const timersRef = useRef<Record<string, number>>({})
  const chainsRef = useRef<Record<string, Promise<void>>>({})
  const offsetRef = useRef(0)
  const submittedRef = useRef<SubmittedInfo | null>(null)
  const submittingRef = useRef(false)
  const saveErrorShownRef = useRef(false)
  const autoTriggeredRef = useRef(false)
  const submitRef = useRef<(auto: boolean) => Promise<void>>(async () => undefined)
  const checkingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const load = useCallback(async () => {
    if (!attemptId) {
      setLoadError('Attempt not found.')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const result = await callRpc<AttemptState>('get_attempt_state', {
        p_attempt_id: attemptId,
      })
      if (result.attempt.status !== 'in_progress') {
        navigate(`/student/results/${attemptId}`, { replace: true })
        return
      }

      const initial: Record<string, AnswerDraft> = {}
      const initialFeedback: Record<string, AttemptFeedback> = {}
      for (const section of result.sections) {
        for (const question of section.questions) {
          const response = result.responses.find(
            (item) => item.question_id === question.id,
          )
          initial[question.id] = {
            selected: response?.selected_options ?? [],
            text: response?.text_answer ?? '',
            flagged: response?.is_flagged ?? false,
          }
          if (response?.feedback) {
            initialFeedback[question.id] = response.feedback
          }
        }
      }
      answersRef.current = initial
      setAnswers(initial)
      setFeedback(initialFeedback)
      setChecking({})
      checkingRef.current = new Set()
      dirtyRef.current = new Set()
      failedRef.current = new Set()
      savingRef.current = 0
      setSaveStatus('saved')
      setState(result)
      setCurrentIndex(0)
      offsetRef.current = new Date(result.server_now).getTime() - Date.now()
      setRemaining(
        result.attempt.deadline_at
          ? Math.max(
              0,
              Math.ceil(
                (new Date(result.attempt.deadline_at).getTime() -
                  new Date(result.server_now).getTime()) /
                  1000,
              ),
            )
          : null,
      )
    } catch (loadFailure) {
      setLoadError(getErrorMessage(loadFailure))
    } finally {
      setLoading(false)
    }
  }, [attemptId, navigate])

  useEffect(() => {
    void load()
  }, [load])

  const clearTimers = useCallback(() => {
    for (const timer of Object.values(timersRef.current)) {
      window.clearTimeout(timer)
    }
    timersRef.current = {}
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const questionEntries = useMemo<QuestionEntry[]>(() => {
    if (!state) return []
    const entries: QuestionEntry[] = []
    for (const section of state.sections) {
      for (const question of section.questions) {
        entries.push({ question, sectionTitle: section.title })
      }
    }
    return entries
  }, [state])

  const totalQuestions = questionEntries.length
  const currentEntry = questionEntries[currentIndex] ?? null

  const answeredCount = questionEntries.filter((entry) =>
    isAnswered(
      entry.question,
      answers[entry.question.id] ?? emptyAnswerDraft(),
    ),
  ).length
  const flaggedCount = questionEntries.filter(
    (entry) => (answers[entry.question.id] ?? emptyAnswerDraft()).flagged,
  ).length
  const requiredUnanswered = questionEntries.filter(
    (entry) =>
      entry.question.is_required &&
      !isAnswered(
        entry.question,
        answers[entry.question.id] ?? emptyAnswerDraft(),
      ),
  ).length

  const refreshSaveStatus = useCallback(() => {
    if (savingRef.current > 0) setSaveStatus('saving')
    else if (failedRef.current.size > 0) setSaveStatus('error')
    else if (dirtyRef.current.size > 0) setSaveStatus('pending')
    else setSaveStatus('saved')
  }, [])

  const markAutoSubmitted = useCallback(() => {
    if (submittedRef.current || !attemptId) return
    const info: SubmittedInfo = {
      auto: true,
      attemptId,
      score: null,
      maxMarks: stateRef.current?.attempt.max_marks ?? 0,
      showResults: stateRef.current?.test.show_results ?? false,
      pending: false,
    }
    submittedRef.current = info
    setSubmitted(info)
    setRemaining(0)
    clearTimers()
    toast.info('Time is up', 'Your assessment has been submitted automatically.')
  }, [attemptId, clearTimers, toast])

  const saveQuestion = useCallback(
    async (questionId: string) => {
      if (!attemptId || submittedRef.current) return
      const draft = answersRef.current[questionId]
      if (!draft) return

      savingRef.current += 1
      refreshSaveStatus()

      try {
        const response = await callRpc<
          SaveResponseRow[] | SaveResponseRow
        >('save_response', {
          p_attempt_id: attemptId,
          p_question_id: questionId,
          p_selected_options: draft.selected,
          p_text_answer: draft.text.trim() ? draft.text : null,
          p_is_flagged: draft.flagged,
        })
        const row = Array.isArray(response) ? response[0] : response

        if (row?.server_now) {
          offsetRef.current = new Date(row.server_now).getTime() - Date.now()
        }
        if (row && row.attempt_status !== 'in_progress') {
          dirtyRef.current.delete(questionId)
          markAutoSubmitted()
          return
        }

        dirtyRef.current.delete(questionId)
        failedRef.current.delete(questionId)
      } catch (saveError) {
        failedRef.current.add(questionId)
        if (!saveErrorShownRef.current) {
          saveErrorShownRef.current = true
          toast.error(
            'Autosave failed',
            `${getErrorMessage(saveError)} Your answers stay in this tab and will retry when you continue.`,
          )
        }
      } finally {
        savingRef.current = Math.max(0, savingRef.current - 1)
        refreshSaveStatus()
      }
    },
    [attemptId, markAutoSubmitted, refreshSaveStatus, toast],
  )

  const enqueueSave = useCallback(
    (questionId: string): Promise<void> => {
      const previous = chainsRef.current[questionId] ?? Promise.resolve()
      const next = previous.then(() => saveQuestion(questionId))
      chainsRef.current[questionId] = next.catch(() => undefined)
      return next
    },
    [saveQuestion],
  )

  const scheduleSave = useCallback(
    (questionId: string, immediate = false) => {
      dirtyRef.current.add(questionId)
      refreshSaveStatus()
      if (timersRef.current[questionId]) {
        window.clearTimeout(timersRef.current[questionId])
      }
      const run = () => {
        delete timersRef.current[questionId]
        void enqueueSave(questionId)
      }
      if (immediate) run()
      else timersRef.current[questionId] = window.setTimeout(run, 700)
    },
    [enqueueSave, refreshSaveStatus],
  )

  const updateAnswer = useCallback(
    (questionId: string, patch: Partial<AnswerDraft>) => {
      if (submittedRef.current || submittingRef.current) return
      const current = answersRef.current[questionId] ?? emptyAnswerDraft()
      const answerChanged =
        (patch.selected !== undefined &&
          (patch.selected.length !== current.selected.length ||
            patch.selected.some((id) => !current.selected.includes(id)))) ||
        (patch.text !== undefined && patch.text !== current.text)

      if (answerChanged) {
        // A checked answer that is still wrong becomes editable again; drop the
        // red state so the student can check the new answer cleanly.
        setFeedback((currentFeedback) => {
          if (!currentFeedback[questionId]) return currentFeedback
          const nextFeedback = { ...currentFeedback }
          delete nextFeedback[questionId]
          return nextFeedback
        })
      }

      const next = {
        ...answersRef.current,
        [questionId]: { ...current, ...patch },
      }
      answersRef.current = next
      setAnswers(next)
      scheduleSave(questionId)
    },
    [scheduleSave],
  )

  const flushDirty = useCallback(async () => {
    const ids = Array.from(dirtyRef.current)
    await Promise.all(
      ids.map((id) => {
        if (timersRef.current[id]) {
          window.clearTimeout(timersRef.current[id])
          delete timersRef.current[id]
        }
        return enqueueSave(id)
      }),
    )
    return failedRef.current.size === 0
  }, [enqueueSave])

  const checkQuestion = useCallback(
    async (questionId: string) => {
      if (!attemptId || submittedRef.current || submittingRef.current) return
      if (feedback[questionId]?.is_correct) return
      if (checkingRef.current.has(questionId)) return
      checkingRef.current.add(questionId)

      if (timersRef.current[questionId]) {
        window.clearTimeout(timersRef.current[questionId])
        delete timersRef.current[questionId]
      }

      setChecking((current) => ({ ...current, [questionId]: true }))
      try {
        dirtyRef.current.add(questionId)
        await enqueueSave(questionId)
        if (failedRef.current.has(questionId)) {
          throw new Error('Your answer has not been saved yet.')
        }
        const result = await callRpc<AttemptFeedback>('check_response', {
          p_attempt_id: attemptId,
          p_question_id: questionId,
        })
        setFeedback((current) => ({ ...current, [questionId]: result }))
      } catch (checkError) {
        toast.error('Could not check this answer', getErrorMessage(checkError))
      } finally {
        checkingRef.current.delete(questionId)
        setChecking((current) => {
          const next = { ...current }
          delete next[questionId]
          return next
        })
      }
    },
    [attemptId, enqueueSave, feedback, toast],
  )

  const submitAttempt = useCallback(
    async (auto: boolean) => {
      if (!attemptId || submittingRef.current || submittedRef.current) return
      submittingRef.current = true
      setSubmitting(true)
      setConfirmOpen(false)

      try {
        const flushed = await flushDirty()
        if (!auto && !flushed) {
          toast.error(
            'Some answers are not saved yet',
            'Check your connection, allow autosave to finish, then submit again.',
          )
          return
        }
        if (submittedRef.current) return

        const attempt = await callRpc<Attempt>('submit_attempt', {
          p_attempt_id: attemptId,
        })
        const info: SubmittedInfo = {
          auto,
          attemptId,
          score: attempt.score,
          maxMarks: attempt.max_marks,
          showResults: stateRef.current?.test.show_results ?? false,
          pending: attempt.status === 'submitted',
        }
        submittedRef.current = info
        setSubmitted(info)
        setRemaining(0)
        clearTimers()
        toast.success(
          auto ? 'Time is up — assessment submitted' : 'Assessment submitted',
          auto
            ? 'Your responses were saved and submitted automatically.'
            : 'Your responses are now locked for review.',
        )
      } catch (submitError) {
        toast.error(
          auto ? 'Automatic submission failed' : 'Submission failed',
          `${getErrorMessage(submitError)} ${auto ? 'Your answers are saved; submit again below.' : ''}`,
        )
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    },
    [attemptId, clearTimers, flushDirty, toast],
  )

  useEffect(() => {
    submitRef.current = submitAttempt
  }, [submitAttempt])

  // Countdown and automatic submit at zero.
  useEffect(() => {
    if (!state || submitted || !state.attempt.deadline_at) return
    const deadlineMs = new Date(state.attempt.deadline_at).getTime()

    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((deadlineMs - (Date.now() + offsetRef.current)) / 1000),
      )
      setRemaining(seconds)
      if (seconds <= 0 && !autoTriggeredRef.current) {
        autoTriggeredRef.current = true
        setClockExpired(true)
        void submitRef.current(true)
      }
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [state, submitted])

  // Persist pending work when the tab is hidden and warn on unload.
  useEffect(() => {
    if (!state || submitted) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushDirty()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [state, submitted, flushDirty])

  const goTo = (index: number) => {
    const target = Math.max(0, Math.min(questionEntries.length - 1, index))
    if (target === currentIndex) return
    const currentId = currentEntry?.question.id
    if (currentId && dirtyRef.current.has(currentId)) {
      scheduleSave(currentId, true)
    }
    setCurrentIndex(target)
    setMobileNavOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return <FullPageLoader label="Preparing your assessment…" />
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex justify-center">
            <Brand />
          </div>
          <ErrorState
            title="Could not open this assessment"
            message={loadError}
            onRetry={load}
          />
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={() => navigate('/student')}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <SubmittedScreen
        info={submitted}
        testTitle={state?.test.title ?? 'Assessment'}
      />
    )
  }

  if (!state || !currentEntry) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-5 text-center">
        <p className="text-sm text-slate-600">
          This assessment has no questions to display.
        </p>
        <Button onClick={() => navigate('/student')}>Back to dashboard</Button>
      </div>
    )
  }

  const currentAnswer =
    answers[currentEntry.question.id] ?? emptyAnswerDraft()
  const currentFeedback = feedback[currentEntry.question.id] ?? null
  const currentChecking = Boolean(checking[currentEntry.question.id])
  const immediateFeedback = state.attempt.feedback_mode === 'immediate'
  const autoCheckCurrent =
    immediateFeedback &&
    currentFeedback?.is_correct !== true &&
    (currentEntry.question.question_type === 'single_choice' ||
      currentEntry.question.question_type === 'true_false')
  const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0
  const timerWarning =
    remaining != null && remaining <= 300 && remaining > 60
      ? 'amber'
      : remaining != null && remaining <= 60
        ? 'rose'
        : 'slate'

  const navigator = (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-6">
      {questionEntries.map((entry, index) => {
        const answer = answers[entry.question.id] ?? emptyAnswerDraft()
        const answered = isAnswered(entry.question, answer)
        const active = index === currentIndex
        return (
          <button
            key={entry.question.id}
            type="button"
            onClick={() => goTo(index)}
            aria-label={`Question ${index + 1}${answered ? ', answered' : ', unanswered'}${answer.flagged ? ', flagged' : ''}`}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'relative flex h-9 items-center justify-center rounded-lg border text-xs font-semibold transition',
              active
                ? 'border-ink-900 bg-ink-900 text-white shadow-sm'
                : answered
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100',
              !active && answer.flagged && 'border-amber-300 bg-amber-50 text-amber-800',
            )}
          >
            {index + 1}
            {answer.flagged ? (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
            ) : null}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 pb-24 sm:pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Brand compact />
            <div className="min-w-0 border-l border-slate-200 pl-3">
              <p className="truncate text-sm font-semibold text-slate-900">
                {state.test.title}
              </p>
              <SaveIndicator status={saveStatus} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums',
                timerWarning === 'rose'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : timerWarning === 'amber'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-white text-slate-700',
              )}
              aria-live="polite"
            >
              <Timer className="h-4 w-4" />
              {remaining == null ? 'Untimed' : formatDuration(remaining)}
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 lg:hidden"
              aria-label="All questions"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <Button
              size="md"
              onClick={() => setConfirmOpen(true)}
              loading={submitting}
              leftIcon={!submitting ? <Send className="h-4 w-4" /> : undefined}
              className="hidden sm:inline-flex"
            >
              Submit
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {clockExpired ? (
          <Alert
            tone="warning"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Time is up"
            className="mb-4"
          >
            Your time has ended. If automatic submission was interrupted, use the
            button below — all saved answers will be scored exactly as stored.
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void submitAttempt(true)}
              loading={submitting}
            >
              Submit now
            </Button>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div>
            <QuestionCard
              question={currentEntry.question}
              sectionTitle={currentEntry.sectionTitle}
              index={currentIndex}
              total={totalQuestions}
              answer={currentAnswer}
              disabled={submitting || clockExpired}
              feedback={currentFeedback}
              checking={currentChecking}
              checkEnabled={immediateFeedback && currentFeedback?.is_correct !== true}
              autoCheck={autoCheckCurrent}
              onCheck={() => void checkQuestion(currentEntry.question.id)}
              onChange={(patch) => updateAnswer(currentEntry.question.id, patch)}
              onFlag={() =>
                updateAnswer(currentEntry.question.id, {
                  flagged: !currentAnswer.flagged,
                })
              }
            />

            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => goTo(currentIndex - 1)}
                disabled={currentIndex === 0}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                Previous
              </Button>
              <span className="text-xs font-medium text-slate-400">
                {currentIndex + 1} / {totalQuestions}
              </span>
              {currentIndex === totalQuestions - 1 ? (
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={submitting}
                  rightIcon={<Send className="h-4 w-4" />}
                >
                  Review & submit
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => goTo(currentIndex + 1)}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  Next
                </Button>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Answers save automatically to your secure attempt.
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5" />
                {flaggedCount} flagged
              </span>
            </div>
          </div>

          <aside className="hidden space-y-4 lg:block">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Time remaining
                </p>
                <Clock3
                  className={cn(
                    'h-4 w-4',
                    timerWarning === 'rose'
                      ? 'text-rose-500'
                      : timerWarning === 'amber'
                        ? 'text-amber-500'
                        : 'text-slate-400',
                  )}
                />
              </div>
              <p
                className={cn(
                  'mt-1 text-3xl font-bold tabular-nums tracking-tight',
                  timerWarning === 'rose'
                    ? 'text-rose-600'
                    : timerWarning === 'amber'
                      ? 'text-amber-600'
                      : 'text-slate-900',
                )}
              >
                {remaining == null ? 'Untimed' : formatDuration(remaining)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Submits automatically at zero.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Progress
                </p>
                <span className="text-xs font-semibold text-slate-700">
                  {answeredCount} / {totalQuestions}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {answeredCount} answered
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-slate-300" />
                  {totalQuestions - answeredCount} unanswered
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  {flaggedCount} flagged
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  {requiredUnanswered} required left
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Questions
              </p>
              {navigator}
              <Button
                className="mt-4"
                fullWidth
                onClick={() => setConfirmOpen(true)}
                disabled={submitting}
                leftIcon={<Send className="h-4 w-4" />}
              >
                Submit assessment
              </Button>
            </div>
          </aside>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => goTo(currentIndex - 1)}
            disabled={currentIndex === 0}
            aria-label="Previous question"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
            fullWidth
            leftIcon={<Send className="h-4 w-4" />}
          >
            Submit assessment
          </Button>
          <Button
            variant="outline"
            onClick={() => goTo(currentIndex + 1)}
            disabled={currentIndex === totalQuestions - 1}
            aria-label="Next question"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={submitting ? () => undefined : () => setConfirmOpen(false)}
        title="Submit this assessment?"
        description="Once submitted, your answers are locked and no further changes are possible."
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Keep working
            </Button>
            <Button
              onClick={() => void submitAttempt(false)}
              loading={submitting}
              leftIcon={!submitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}
            >
              Submit for grading
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat label="Answered" value={answeredCount} tone="green" />
            <SummaryStat
              label="Unanswered"
              value={totalQuestions - answeredCount}
              tone="slate"
            />
            <SummaryStat label="Flagged" value={flaggedCount} tone="amber" />
          </div>

          {requiredUnanswered > 0 ? (
            <Alert tone="warning" title="Some required questions are unanswered">
              {requiredUnanswered}{' '}
              {requiredUnanswered === 1 ? 'required question has' : 'required questions have'}{' '}
              no answer and will score zero. You can return to them before submitting.
            </Alert>
          ) : (
            <Alert tone="success" title="All required questions answered">
              You can submit now or use the navigator to review flagged questions.
            </Alert>
          )}

          {state.attempt.deadline_at ? (
            <p className="text-xs text-slate-500">
              Time remaining:{' '}
              <span className="font-semibold text-slate-800">
                {remaining == null ? '—' : formatDuration(remaining)}
              </span>
              . The assessment submits automatically when the timer reaches zero.
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        title="All questions"
        description="Jump to any question. Green means answered, amber means flagged."
        size="md"
        footer={<Button onClick={() => setMobileNavOpen(false)}>Close</Button>}
      >
        <div className="rounded-xl border border-slate-200 p-4">{navigator}</div>
      </Modal>
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const config = {
    saved: {
      icon: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
      text: 'All answers saved',
      className: 'text-emerald-600',
    },
    saving: {
      icon: <Loader2 className="h-3 w-3 animate-spin text-brand-500" />,
      text: 'Saving…',
      className: 'text-slate-500',
    },
    pending: {
      icon: <Save className="h-3 w-3 text-slate-400" />,
      text: 'Saving changes…',
      className: 'text-slate-400',
    },
    error: {
      icon: <CloudOff className="h-3 w-3 text-rose-500" />,
      text: 'Save interrupted — keep editing to retry',
      className: 'text-rose-600',
    },
  }[status]

  return (
    <span className={cn('flex items-center gap-1 text-[10px] font-medium', config.className)}>
      {config.icon}
      {config.text}
    </span>
  )
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'green' | 'slate' | 'amber'
}) {
  const classes = {
    green: 'bg-emerald-50 text-emerald-800',
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-50 text-amber-800',
  }[tone]
  return (
    <div className={cn('rounded-xl px-3 py-2.5 text-center', classes)}>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>
    </div>
  )
}

function SubmittedScreen({
  info,
  testTitle,
}: {
  info: SubmittedInfo
  testTitle: string
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-soft sm:p-9">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
            Assessment submitted
          </h1>
          <p className="mt-1 text-sm text-slate-500">{testTitle}</p>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {info.auto
              ? 'Your time ended and your assessment was submitted automatically. '
              : 'Your responses are safely recorded. '}
            {info.showResults
              ? 'You can review your answers and score now.'
              : 'Your administrator has hidden detailed results for this assessment.'}
          </p>

          {info.showResults && info.score != null ? (
            <div className="mt-6 rounded-xl bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Your score
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                {formatNumber(info.score)}
                <span className="text-base font-medium text-slate-400">
                  {' '}/ {formatNumber(info.maxMarks)}
                </span>
              </p>
              {info.pending ? (
                <p className="mt-1 text-xs text-amber-600">
                  Provisional — short answers await manual review.
                </p>
              ) : null}
            </div>
          ) : info.showResults && info.pending ? (
            <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Short answers will be reviewed by your administrator before your final
              score is released.
            </div>
          ) : null}

          <div className="mt-7 space-y-2">
            {info.showResults ? (
              <Button
                fullWidth
                onClick={() =>
                  window.location.assign(`/student/results/${info.attemptId}`)
                }
                leftIcon={<ArrowRight className="h-4 w-4" />}
              >
                Review my result
              </Button>
            ) : null}
            <Button
              fullWidth
              variant="outline"
              onClick={() => window.location.assign('/student')}
            >
              Back to dashboard
            </Button>
          </div>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <Badge tone="green">Submitted</Badge>
            Attempt #{info.attemptId.slice(0, 8)}
          </p>
        </div>
      </div>
    </div>
  )
}
