import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  FileText,
  KeyRound,
  Layers,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { PageHeader, Badge, Panel } from '../../components/ui/Misc'
import { Button, ButtonLink, IconButton } from '../../components/ui/Button'
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback'
import { Field, Input, Textarea, Toggle } from '../../components/ui/Form'
import { ConfirmDialog } from '../../components/ui/Modal'
import { QuestionTypeBadge, TestStatusBadge } from '../../components/StatusBadge'
import { SectionDialog } from '../../components/admin/SectionDialog'
import { QuestionEditorModal } from '../../components/admin/QuestionEditorModal'
import { TestPreviewModal } from '../../components/admin/TestPreviewModal'
import { useAsyncData } from '../../hooks/useAsyncData'
import { callRpc } from '../../lib/rpc'
import { fromDateTimeLocal, formatNumber, toDateTimeLocal } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { publicImageUrl, supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import type {
  Question,
  Section,
  TestStatus,
  TestWithStructure,
} from '../../lib/types'

type Loaded = {
  test: TestWithStructure
  hasAttempts: boolean
}

type MetaState = {
  title: string
  description: string
  instructions: string
  duration: string
  passingMarks: string
  attemptLimit: string
  startAt: string
  endAt: string
  showResults: boolean
}

export function TestBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()

  const { data, loading, error, reload } = useAsyncData<Loaded>(async () => {
    if (!id) throw new Error('Test not found.')
    const { data: test, error: testError } = await supabase
      .from('tests')
      .select('*, sections(*, questions(*))')
      .eq('id', id)
      .maybeSingle()
    if (testError) throw testError
    if (!test) throw new Error('This test could not be found.')

    const { count, error: attemptError } = await supabase
      .from('attempts')
      .select('id', { count: 'exact', head: true })
      .eq('test_id', id)
    if (attemptError) throw attemptError

    const typed = test as TestWithStructure
    return {
      hasAttempts: (count ?? 0) > 0,
      test: {
        ...typed,
        sections: [...(typed.sections ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((section) => ({
            ...section,
            questions: [...(section.questions ?? [])].sort(
              (a, b) => a.position - b.position,
            ),
          })),
      },
    }
  }, [id])

  const [meta, setMeta] = useState<MetaState>({
    title: '',
    description: '',
    instructions: '',
    duration: '',
    passingMarks: '0',
    attemptLimit: '1',
    startAt: '',
    endAt: '',
    showResults: false,
  })
  const [sections, setSections] = useState<Loaded['test']['sections']>([])
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [sectionDialog, setSectionDialog] = useState<{
    open: boolean
    section: Section | null
  }>({ open: false, section: null })
  const [questionDialog, setQuestionDialog] = useState<{
    open: boolean
    sectionId: string
    question: Question | null
  }>({ open: false, sectionId: '', question: null })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteSection, setDeleteSection] = useState<Section | null>(null)
  const [deleteQuestion, setDeleteQuestion] = useState<{
    question: Question
    sectionId: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const initializedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!data) return
    setSections(data.test.sections)
    if (initializedRef.current !== data.test.id) {
      initializedRef.current = data.test.id
      const test = data.test
      setMeta({
        title: test.title,
        description: test.description ?? '',
        instructions: test.instructions ?? '',
        duration: test.duration_minutes ? String(test.duration_minutes) : '',
        passingMarks: String(test.passing_marks),
        attemptLimit: String(test.attempt_limit),
        startAt: toDateTimeLocal(test.start_at),
        endAt: toDateTimeLocal(test.end_at),
        showResults: test.show_results,
      })
    }
  }, [data])

  const hasAttempts = data?.hasAttempts ?? false
  const test = data?.test ?? null
  const locked = hasAttempts

  const computedMax = useMemo(
    () =>
      sections.reduce(
        (total, section) =>
          total +
          section.questions.reduce((sum, question) => sum + Number(question.marks), 0),
        0,
      ),
    [sections],
  )
  const questionCount = sections.reduce(
    (total, section) => total + section.questions.length,
    0,
  )

  const validateMeta = (): string | null => {
    if (!meta.title.trim()) return 'Give the test a title.'
    if (meta.title.trim().length > 200) return 'Titles are limited to 200 characters.'
    if (meta.duration) {
      const duration = Number(meta.duration)
      if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        return 'Duration must be a whole number of minutes between 1 and 1440.'
      }
    }
    const passing = Number(meta.passingMarks)
    if (!Number.isFinite(passing) || passing < 0) return 'Passing marks cannot be negative.'
    if (passing > computedMax) {
      return `Passing marks (${passing}) cannot exceed the total marks (${computedMax}).`
    }
    const limit = Number(meta.attemptLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return 'Attempt limit must be between 1 and 20.'
    }
    const start = fromDateTimeLocal(meta.startAt)
    const end = fromDateTimeLocal(meta.endAt)
    if (start && end && new Date(end) <= new Date(start)) {
      return 'The end date must be after the start date.'
    }
    return null
  }

  const saveMeta = async (silent = false): Promise<boolean> => {
    if (!id || !test) return false
    const validation = validateMeta()
    if (validation) {
      setMetaError(validation)
      if (!silent) toast.error('Check the test settings', validation)
      return false
    }

    setMetaError(null)
    setSavingMeta(true)
    try {
      const { error: updateError } = await supabase
        .from('tests')
        .update({
          title: meta.title.trim(),
          description: meta.description.trim() || null,
          instructions: meta.instructions.trim() || null,
          duration_minutes: meta.duration ? Number(meta.duration) : null,
          passing_marks: Number(meta.passingMarks),
          attempt_limit: Number(meta.attemptLimit),
          start_at: fromDateTimeLocal(meta.startAt),
          end_at: fromDateTimeLocal(meta.endAt),
          show_results: meta.showResults,
        })
        .eq('id', id)
      if (updateError) throw updateError
      if (!silent) toast.success('Test settings saved')
      await reload()
      return true
    } catch (saveError) {
      const message = getErrorMessage(saveError)
      setMetaError(message)
      if (!silent) toast.error('Could not save test settings', message)
      return false
    } finally {
      setSavingMeta(false)
    }
  }

  const handleMetaSubmit = (event: FormEvent) => {
    event.preventDefault()
    void saveMeta()
  }

  const changeStatus = async (status: TestStatus) => {
    if (!id) return
    setStatusBusy(true)
    try {
      if (status === 'published') {
        const saved = await saveMeta(true)
        if (!saved) {
          toast.error(
            'Test not published',
            'Fix the test settings before publishing.',
          )
          return
        }
      }
      await callRpc<TestStatus>('set_test_status', {
        p_test_id: id,
        p_status: status,
      })
      toast.success(
        status === 'published'
          ? 'Test published'
          : status === 'archived'
            ? 'Test archived'
            : 'Test unpublished',
        status === 'published'
          ? 'It can now be assigned to students.'
          : status === 'archived'
            ? 'The test is hidden from new assignments.'
            : 'It is no longer available to students.',
      )
      setArchiveOpen(false)
      await reload()
    } catch (statusError) {
      toast.error('Could not change test status', getErrorMessage(statusError))
    } finally {
      setStatusBusy(false)
    }
  }

  const handleSectionSaved = async () => {
    await reload()
  }

  const handleQuestionSaved = async () => {
    await reload()
  }

  const moveSection = async (index: number, direction: -1 | 1) => {
    if (!id || locked) return
    const target = index + direction
    if (target < 0 || target >= sections.length) return

    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    const reindexed = next.map((section, position) => ({ ...section, position }))
    setSections(reindexed)

    try {
      await callRpc('reorder_sections', {
        p_test_id: id,
        p_section_ids: reindexed.map((section) => section.id),
      })
    } catch (reorderError) {
      toast.error('Could not reorder sections', getErrorMessage(reorderError))
      await reload()
    }
  }

  const moveQuestion = async (
    sectionId: string,
    index: number,
    direction: -1 | 1,
  ) => {
    if (locked) return
    const section = sections.find((item) => item.id === sectionId)
    if (!section) return
    const target = index + direction
    if (target < 0 || target >= section.questions.length) return

    const nextQuestions = [...section.questions]
    ;[nextQuestions[index], nextQuestions[target]] = [
      nextQuestions[target],
      nextQuestions[index],
    ]
    const reindexed = nextQuestions.map((question, position) => ({
      ...question,
      position,
    }))
    setSections((current) =>
      current.map((item) =>
        item.id === sectionId ? { ...item, questions: reindexed } : item,
      ),
    )

    try {
      await callRpc('reorder_questions', {
        p_section_id: sectionId,
        p_question_ids: reindexed.map((question) => question.id),
      })
    } catch (reorderError) {
      toast.error('Could not reorder questions', getErrorMessage(reorderError))
      await reload()
    }
  }

  const confirmDeleteSection = async () => {
    if (!deleteSection) return
    setDeleting(true)
    try {
      const { error: deleteError } = await supabase
        .from('sections')
        .delete()
        .eq('id', deleteSection.id)
      if (deleteError) throw deleteError
      toast.success('Section deleted')
      setDeleteSection(null)
      await reload()
    } catch (deleteError) {
      toast.error('Could not delete section', getErrorMessage(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  const confirmDeleteQuestion = async () => {
    if (!deleteQuestion) return
    setDeleting(true)
    try {
      const { error: deleteError } = await supabase
        .from('questions')
        .delete()
        .eq('id', deleteQuestion.question.id)
      if (deleteError) throw deleteError
      toast.success('Question deleted')
      setDeleteQuestion(null)
      await reload()
    } catch (deleteError) {
      toast.error('Could not delete question', getErrorMessage(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  const previewTest = useMemo(() => {
    if (!test) return null
    return {
      ...test,
      title: meta.title,
      description: meta.description || null,
      instructions: meta.instructions || null,
      duration_minutes: meta.duration ? Number(meta.duration) : null,
      max_marks: computedMax,
      passing_marks: Number(meta.passingMarks) || 0,
      attempt_limit: Number(meta.attemptLimit) || 1,
      start_at: fromDateTimeLocal(meta.startAt),
      end_at: fromDateTimeLocal(meta.endAt),
      show_results: meta.showResults,
      sections,
    }
  }, [test, meta, computedMax, sections])

  // Only replace the page with the loader on the first load. Reloads after a
  // save keep the builder mounted so the scroll position is preserved.
  const hasCurrentTest = Boolean(test && test.id === id)

  if (loading && !hasCurrentTest) {
    return (
      <div>
        <PageHeader backTo="/admin/tests" backLabel="Tests" title="Loading test…" />
        <LoadingState label="Loading test builder…" />
      </div>
    )
  }

  if (error || !test) {
    return (
      <div>
        <PageHeader backTo="/admin/tests" backLabel="Tests" title="Test" />
        <ErrorState message={error ?? 'Test not found.'} onRetry={reload} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        backTo="/admin/tests"
        backLabel="All tests"
        eyebrow="Test builder"
        title={meta.title || 'Untitled test'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TestStatusBadge status={test.status} />
            <span className="text-xs text-slate-400">
              {formatNumber(computedMax)} marks · {sections.length} sections ·{' '}
              {questionCount} questions
            </span>
          </span>
        }
        actions={
          <>
            <ButtonLink
              to={`/admin/tests/${test.id}/keys`}
              variant="outline"
              leftIcon={<KeyRound className="h-4 w-4" />}
            >
              Answer keys
            </ButtonLink>
            <Button
              variant="outline"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            {test.status === 'published' ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void changeStatus('draft')}
                  loading={statusBusy}
                >
                  Unpublish
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setArchiveOpen(true)}
                  disabled={statusBusy}
                >
                  Archive
                </Button>
              </>
            ) : test.status === 'archived' ? (
              <Button
                variant="outline"
                onClick={() => void changeStatus('draft')}
                loading={statusBusy}
              >
                Restore to draft
              </Button>
            ) : (
              <Button
                onClick={() => void changeStatus('published')}
                loading={statusBusy}
                disabled={sections.length === 0 || questionCount === 0}
              >
                Publish test
              </Button>
            )}
          </>
        }
      />

      {locked ? (
        <Alert
          tone="warning"
          icon={<Lock className="h-4 w-4" />}
          title="This test has attempts and is content-locked"
          className="mb-6"
        >
          Questions, sections, timing and attempt limits can no longer change, so
          submitted history stays trustworthy. Duplicate the test from the tests list
          to create an editable copy.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel
            title="Sections & questions"
            description="Order is respected exactly as shown. Students see sections in order."
            actions={
              <Button
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setSectionDialog({ open: true, section: null })}
                disabled={locked}
              >
                Add section
              </Button>
            }
            bodyClassName="p-4 sm:p-5"
          >
            {sections.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="Start with a section"
                description="Sections group questions — for example “Policies”, “Safety” or “Customer service”."
                action={
                  <Button
                    size="sm"
                    onClick={() => setSectionDialog({ open: true, section: null })}
                    disabled={locked}
                  >
                    Add the first section
                  </Button>
                }
                className="border-0"
              />
            ) : (
              <div className="space-y-4">
                {sections.map((section, sectionIndex) => {
                  const sectionMarks = section.questions.reduce(
                    (total, question) => total + Number(question.marks),
                    0,
                  )
                  return (
                    <div
                      key={section.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                    >
                      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
                            {sectionIndex + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">
                              {section.title}
                            </p>
                            {section.description ? (
                              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
                                {section.description}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-slate-400">
                              {section.questions.length}{' '}
                              {section.questions.length === 1 ? 'question' : 'questions'} ·{' '}
                              {formatNumber(sectionMarks)} marks
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 pl-9 sm:pl-0">
                          <IconButton
                            label="Move section up"
                            size="sm"
                            onClick={() => void moveSection(sectionIndex, -1)}
                            disabled={locked || sectionIndex === 0}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Move section down"
                            size="sm"
                            onClick={() => void moveSection(sectionIndex, 1)}
                            disabled={locked || sectionIndex === sections.length - 1}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Edit section"
                            size="sm"
                            onClick={() => setSectionDialog({ open: true, section })}
                            disabled={locked}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Delete section"
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleteSection(section)}
                            disabled={locked}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {section.questions.map((question, questionIndex) => (
                          <div
                            key={question.id}
                            className="flex flex-col gap-2 px-4 py-3 transition hover:bg-slate-50/50 sm:flex-row sm:items-center"
                          >
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <span className="mt-0.5 w-6 shrink-0 text-xs font-semibold text-slate-400">
                                {questionIndex + 1}.
                              </span>
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-medium leading-5 text-slate-800">
                                  {question.prompt}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <QuestionTypeBadge type={question.question_type} />
                                  <Badge tone="slate">
                                    {formatNumber(question.marks)} marks
                                  </Badge>
                                  {question.is_required ? (
                                    <Badge tone="rose">Required</Badge>
                                  ) : null}
                                  {question.image_path ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                      <FileText className="h-3 w-3" />
                                      Image
                                    </span>
                                  ) : null}
                                  {question.image_path ? (
                                    <img
                                      src={publicImageUrl(question.image_path) ?? ''}
                                      alt=""
                                      className="h-6 w-6 rounded object-cover"
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 pl-9 sm:pl-0">
                              <IconButton
                                label="Move question up"
                                size="sm"
                                onClick={() =>
                                  void moveQuestion(section.id, questionIndex, -1)
                                }
                                disabled={locked || questionIndex === 0}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton
                                label="Move question down"
                                size="sm"
                                onClick={() =>
                                  void moveQuestion(section.id, questionIndex, 1)
                                }
                                disabled={
                                  locked ||
                                  questionIndex === section.questions.length - 1
                                }
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton
                                label="Edit question"
                                size="sm"
                                onClick={() =>
                                  setQuestionDialog({
                                    open: true,
                                    sectionId: section.id,
                                    question,
                                  })
                                }
                                disabled={locked}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </IconButton>
                              <IconButton
                                label="Delete question"
                                size="sm"
                                variant="danger"
                                onClick={() =>
                                  setDeleteQuestion({
                                    question,
                                    sectionId: section.id,
                                  })
                                }
                                disabled={locked}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconButton>
                            </div>
                          </div>
                        ))}
                        {section.questions.length === 0 ? (
                          <p className="px-4 py-4 text-xs italic text-slate-400">
                            No questions in this section yet.
                          </p>
                        ) : null}
                      </div>

                      <div className="border-t border-slate-100 px-4 py-2.5">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setQuestionDialog({
                              open: true,
                              sectionId: section.id,
                              question: null,
                            })
                          }
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add question
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Test summary">
            <dl className="space-y-2.5 text-sm">
              <SummaryRow label="Status" value={<TestStatusBadge status={test.status} />} />
              <SummaryRow label="Total marks" value={formatNumber(computedMax)} />
              <SummaryRow label="Sections" value={sections.length} />
              <SummaryRow label="Questions" value={questionCount} />
              <SummaryRow
                label="Attempts"
                value={data?.hasAttempts ? 'Recorded' : 'None yet'}
              />
            </dl>
            {computedMax === 0 ? (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Add questions with marks before publishing.
              </p>
            ) : null}
          </Panel>

          <form onSubmit={handleMetaSubmit}>
            <Panel
              title="Test settings"
              description="Saved separately from structural changes."
              actions={
                <Button
                  type="submit"
                  size="sm"
                  loading={savingMeta}
                  leftIcon={!savingMeta ? <Save className="h-3.5 w-3.5" /> : undefined}
                >
                  Save
                </Button>
              }
            >
              <div className="space-y-4">
                <Field label="Title" htmlFor="test-title" required>
                  <Input
                    id="test-title"
                    value={meta.title}
                    onChange={(event) =>
                      setMeta((current) => ({ ...current, title: event.target.value }))
                    }
                    maxLength={200}
                    disabled={savingMeta}
                  />
                </Field>

                <Field label="Description" htmlFor="test-description">
                  <Textarea
                    id="test-description"
                    value={meta.description}
                    onChange={(event) =>
                      setMeta((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Short summary shown on the student dashboard…"
                    disabled={savingMeta}
                  />
                </Field>

                <Field
                  label="Instructions"
                  htmlFor="test-instructions"
                  hint="Shown on the instructions screen before starting."
                >
                  <Textarea
                    id="test-instructions"
                    value={meta.instructions}
                    onChange={(event) =>
                      setMeta((current) => ({
                        ...current,
                        instructions: event.target.value,
                      }))
                    }
                    rows={4}
                    placeholder="Rules, expectations and anything students should know…"
                    disabled={savingMeta}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Duration (min)" htmlFor="test-duration">
                    <Input
                      id="test-duration"
                      type="number"
                      min={1}
                      max={1440}
                      value={meta.duration}
                      onChange={(event) =>
                        setMeta((current) => ({
                          ...current,
                          duration: event.target.value,
                        }))
                      }
                      placeholder="Untimed"
                      disabled={savingMeta || locked}
                    />
                  </Field>
                  <Field label="Attempt limit" htmlFor="test-attempts">
                    <Input
                      id="test-attempts"
                      type="number"
                      min={1}
                      max={20}
                      value={meta.attemptLimit}
                      onChange={(event) =>
                        setMeta((current) => ({
                          ...current,
                          attemptLimit: event.target.value,
                        }))
                      }
                      disabled={savingMeta || locked}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Passing marks" htmlFor="test-passing">
                    <Input
                      id="test-passing"
                      type="number"
                      min={0}
                      step={0.5}
                      max={computedMax}
                      value={meta.passingMarks}
                      onChange={(event) =>
                        setMeta((current) => ({
                          ...current,
                          passingMarks: event.target.value,
                        }))
                      }
                      disabled={savingMeta || locked}
                    />
                  </Field>
                  <Field label="Total marks" htmlFor="test-total" hint="Calculated">
                    <Input
                      id="test-total"
                      value={formatNumber(computedMax)}
                      readOnly
                      disabled
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Opens" htmlFor="test-start">
                    <Input
                      id="test-start"
                      type="datetime-local"
                      value={meta.startAt}
                      onChange={(event) =>
                        setMeta((current) => ({
                          ...current,
                          startAt: event.target.value,
                        }))
                      }
                      disabled={savingMeta || locked}
                    />
                  </Field>
                  <Field label="Closes" htmlFor="test-end">
                    <Input
                      id="test-end"
                      type="datetime-local"
                      value={meta.endAt}
                      onChange={(event) =>
                        setMeta((current) => ({
                          ...current,
                          endAt: event.target.value,
                        }))
                      }
                      disabled={savingMeta || locked}
                    />
                  </Field>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <Toggle
                    checked={meta.showResults}
                    onChange={(checked) =>
                      setMeta((current) => ({ ...current, showResults: checked }))
                    }
                    label="Show results to students"
                    description="Scores, correct answers and explanations appear after submission."
                    disabled={savingMeta}
                  />
                </div>

                {metaError ? <Alert tone="danger">{metaError}</Alert> : null}
              </div>
            </Panel>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500 shadow-soft">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-slate-700">
              <MoreHorizontal className="h-4 w-4" />
              Publishing checklist
            </div>
            <ul className="space-y-1">
              <li>{sections.length > 0 ? '✓' : '○'} At least one section</li>
              <li>{questionCount > 0 ? '✓' : '○'} At least one question</li>
              <li>{computedMax > 0 ? '✓' : '○'} Total marks above zero</li>
              <li>
                {Number(meta.passingMarks) <= computedMax ? '✓' : '○'} Passing marks
                within total
              </li>
            </ul>
          </div>
        </div>
      </div>

      <SectionDialog
        open={sectionDialog.open}
        section={sectionDialog.section}
        testId={test.id}
        nextPosition={sections.length}
        onClose={() => setSectionDialog({ open: false, section: null })}
        onSaved={handleSectionSaved}
      />

      <QuestionEditorModal
        open={questionDialog.open}
        sectionId={questionDialog.sectionId}
        question={questionDialog.question}
        nextPosition={
          sections.find((section) => section.id === questionDialog.sectionId)?.questions
            .length ?? 0
        }
        onClose={() =>
          setQuestionDialog({ open: false, sectionId: '', question: null })
        }
        onSaved={handleQuestionSaved}
      />

      <TestPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        test={previewTest}
      />

      <ConfirmDialog
        open={Boolean(deleteSection)}
        onClose={() => setDeleteSection(null)}
        onConfirm={confirmDeleteSection}
        loading={deleting}
        title="Delete this section?"
        description={`Deleting “${deleteSection?.title ?? ''}” also deletes its questions. This cannot be undone.`}
        confirmLabel="Delete section"
      />

      <ConfirmDialog
        open={Boolean(deleteQuestion)}
        onClose={() => setDeleteQuestion(null)}
        onConfirm={confirmDeleteQuestion}
        loading={deleting}
        title="Delete this question?"
        description="The question, its options and its answer key will be removed. This cannot be undone."
        confirmLabel="Delete question"
      />

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => void changeStatus('archived')}
        loading={statusBusy}
        title="Archive this test?"
        description="Students can no longer start it and it cannot receive new assignments. Existing results are preserved."
        confirmLabel="Archive test"
      />
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{value}</dd>
    </div>
  )
}
