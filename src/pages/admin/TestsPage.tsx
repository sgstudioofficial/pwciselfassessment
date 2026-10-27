import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive,
  ClipboardList,
  Copy,
  EyeOff,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { PageHeader, Panel, Badge } from '../../components/ui/Misc'
import { Button, IconButton, IconLink } from '../../components/ui/Button'
import { SearchInput, Field, Input, Textarea } from '../../components/ui/Form'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../components/ui/Feedback'
import { Table, TBody, Td, Th, THead, Tr } from '../../components/ui/Table'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { TestStatusBadge } from '../../components/StatusBadge'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { supabase } from '../../lib/supabase'
import { callRpc } from '../../lib/rpc'
import { getErrorMessage } from '../../lib/errors'
import { formatMinutes, formatNumber, formatRelative } from '../../lib/format'
import type { TestListRow, TestStatus } from '../../lib/types'
import { cn } from '../../lib/cn'

type StatusFilter = 'all' | TestStatus

export function AdminTestsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { data: tests, loading, error, reload } = useAsyncData<TestListRow[]>(
    async () => {
      const { data, error: loadError } = await supabase
        .from('tests')
        .select('*, sections(id, questions(id)), attempts(count)')
        .order('updated_at', { ascending: false })
      if (loadError) throw loadError
      return (data ?? []) as unknown as TestListRow[]
    },
    [],
  )

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<TestListRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TestListRow | null>(null)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const counts = useMemo(() => {
    const base = { all: tests?.length ?? 0, draft: 0, published: 0, archived: 0 }
    for (const test of tests ?? []) base[test.status] += 1
    return base
  }, [tests])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (tests ?? []).filter((test) => {
      if (statusFilter !== 'all' && test.status !== statusFilter) return false
      if (!term) return true
      return (
        test.title.toLowerCase().includes(term) ||
        (test.description ?? '').toLowerCase().includes(term)
      )
    })
  }, [tests, search, statusFilter])

  const openCreate = () => {
    setNewTitle('')
    setNewDescription('')
    setNewInstructions('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    setCreateError(null)
    if (!newTitle.trim()) {
      setCreateError('Give the test a title.')
      return
    }

    setCreating(true)
    try {
      const { data, error: createFailure } = await supabase
        .from('tests')
        .insert({
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          instructions: newInstructions.trim() || null,
          created_by: profile?.id ?? null,
          status: 'draft',
        })
        .select('id')
        .single()
      if (createFailure) throw createFailure

      toast.success('Draft test created', 'Add sections and questions next.')
      setCreateOpen(false)
      navigate(`/admin/tests/${data.id}/edit`)
    } catch (createFailure) {
      setCreateError(getErrorMessage(createFailure))
    } finally {
      setCreating(false)
    }
  }

  const changeStatus = async (test: TestListRow, status: TestStatus) => {
    setStatusBusyId(test.id)
    try {
      await callRpc<TestStatus>('set_test_status', {
        p_test_id: test.id,
        p_status: status,
      })
      toast.success(
        status === 'published'
          ? 'Test published'
          : status === 'archived'
            ? 'Test archived'
            : status === 'draft'
              ? 'Test moved to draft'
              : 'Test unpublished',
        status === 'published' ? 'You can now assign it to students.' : undefined,
      )
      setArchiveTarget(null)
      reload()
    } catch (statusError) {
      toast.error('Could not update test', getErrorMessage(statusError))
    } finally {
      setStatusBusyId(null)
    }
  }

  const duplicate = async (test: TestListRow) => {
    setDuplicatingId(test.id)
    try {
      const newId = await callRpc<string>('duplicate_test', { p_test_id: test.id })
      toast.success('Test duplicated', 'The copy is a draft with all questions copied.')
      navigate(`/admin/tests/${newId}/edit`)
    } catch (duplicateError) {
      toast.error('Could not duplicate test', getErrorMessage(duplicateError))
    } finally {
      setDuplicatingId(null)
    }
  }

  const removeTest = async (test: TestListRow) => {
    setDeleting(true)
    try {
      const imagePaths = await callRpc<string[]>('delete_test', {
        p_test_id: test.id,
      })
      if (imagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('question-images')
          .remove(imagePaths)
        if (storageError) {
          // The rows are already gone; a leftover object is harmless.
          console.warn('Could not remove question images:', storageError.message)
        }
      }
      toast.success('Test deleted', 'Its sections, questions and images were removed.')
      setDeleteTarget(null)
      reload()
    } catch (deleteError) {
      toast.error('Could not delete test', getErrorMessage(deleteError))
    } finally {
      setDeleting(false)
    }
  }

  const filters: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All tests', count: counts.all },
    { value: 'draft', label: 'Drafts', count: counts.draft },
    { value: 'published', label: 'Published', count: counts.published },
    { value: 'archived', label: 'Archived', count: counts.archived },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Content"
        title="Tests"
        description="Build assessments from sections and questions, then publish and assign them."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            New test
          </Button>
        }
      />

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  statusFilter === filter.value
                    ? 'bg-ink-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {filter.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px]',
                    statusFilter === filter.value
                      ? 'bg-white/15 text-white'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {filter.count}
                </span>
              </button>
            ))}
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search tests…"
            className="lg:w-72"
          />
        </div>

        {loading ? (
          <LoadingState className="rounded-none border-0" label="Loading tests…" />
        ) : error ? (
          <div className="p-5">
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-5 w-5" />}
            title={(tests ?? []).length === 0 ? 'No tests yet' : 'No tests match'}
            description={
              (tests ?? []).length === 0
                ? 'Create your first assessment, add sections and questions, then publish it.'
                : 'Try a different search term or status filter.'
            }
            action={
              (tests ?? []).length === 0 ? (
                <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  Create a test
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
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
                <Th>Test</Th>
                <Th>Status</Th>
                <Th>Structure</Th>
                <Th>Marks</Th>
                <Th>Duration</Th>
                <Th>Attempts</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.map((test) => {
                const sectionCount = test.sections?.length ?? 0
                const questionCount = (test.sections ?? []).reduce(
                  (total, section) => total + (section.questions?.length ?? 0),
                  0,
                )
                const attemptCount = test.attempts?.[0]?.count ?? 0
                return (
                  <Tr key={test.id}>
                    <Td className="max-w-[280px]">
                      <p className="truncate font-semibold text-slate-900">
                        {test.title}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
                        {test.description || 'No description'}
                      </p>
                    </Td>
                    <Td>
                      <TestStatusBadge status={test.status} />
                    </Td>
                    <Td>
                      <p className="text-xs text-slate-600">
                        {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {questionCount} {questionCount === 1 ? 'question' : 'questions'}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-sm font-medium text-slate-800">
                        {formatNumber(test.max_marks)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Pass {formatNumber(test.passing_marks)}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {formatMinutes(test.duration_minutes)}
                    </Td>
                    <Td>
                      <Badge tone={attemptCount > 0 ? 'brand' : 'slate'}>
                        {attemptCount}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">
                      {formatRelative(test.updated_at)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        <IconLink to={`/admin/tests/${test.id}/edit`} label="Edit test">
                          <Pencil className="h-4 w-4" />
                        </IconLink>
                        <IconButton
                          label="Duplicate test"
                          onClick={() => void duplicate(test)}
                          disabled={duplicatingId === test.id}
                        >
                          <Copy className="h-4 w-4" />
                        </IconButton>
                        {test.status === 'published' ? (
                          <IconButton
                            label="Unpublish test"
                            onClick={() => void changeStatus(test, 'draft')}
                            disabled={statusBusyId === test.id}
                          >
                            <EyeOff className="h-4 w-4" />
                          </IconButton>
                        ) : test.status === 'archived' ? (
                          <IconButton
                            label="Restore to draft"
                            onClick={() => void changeStatus(test, 'draft')}
                            disabled={statusBusyId === test.id}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            label="Publish test"
                            onClick={() => void changeStatus(test, 'published')}
                            disabled={statusBusyId === test.id}
                          >
                            <Upload className="h-4 w-4" />
                          </IconButton>
                        )}
                        {test.status !== 'archived' ? (
                          <IconButton
                            label="Archive test"
                            variant="danger"
                            onClick={() => setArchiveTarget(test)}
                            disabled={statusBusyId === test.id}
                          >
                            <Archive className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        {attemptCount === 0 ? (
                          <IconButton
                            label="Delete test"
                            variant="danger"
                            onClick={() => setDeleteTarget(test)}
                            disabled={deleting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      <Modal
        open={createOpen}
        onClose={creating ? () => undefined : () => setCreateOpen(false)}
        title="Create a test"
        description="Start with the basics. Sections, questions and rules come next in the builder."
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-test-form"
              loading={creating}
              leftIcon={!creating ? <Plus className="h-4 w-4" /> : undefined}
            >
              Create draft
            </Button>
          </>
        }
      >
        <form id="create-test-form" onSubmit={handleCreate} className="space-y-4" noValidate>
          <Field label="Test title" htmlFor="new-test-title" required>
            <Input
              id="new-test-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="e.g. Q1 Compliance Certification"
              maxLength={200}
              disabled={creating}
              autoFocus
            />
          </Field>
          <Field
            label="Description"
            htmlFor="new-test-description"
            hint="Shown on the student dashboard."
          >
            <Textarea
              id="new-test-description"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="What this assessment covers…"
              rows={2}
              disabled={creating}
            />
          </Field>
          <Field
            label="Instructions"
            htmlFor="new-test-instructions"
            hint="Shown before the student starts. You can edit this later."
          >
            <Textarea
              id="new-test-instructions"
              value={newInstructions}
              onChange={(event) => setNewInstructions(event.target.value)}
              placeholder="Read each question carefully. Your answers save automatically."
              rows={3}
              disabled={creating}
            />
          </Field>
          {createError ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {createError}
            </p>
          ) : null}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() =>
          archiveTarget ? void changeStatus(archiveTarget, 'archived') : undefined
        }
        loading={Boolean(archiveTarget && statusBusyId === archiveTarget.id)}
        title="Archive this test?"
        description={`“${archiveTarget?.title ?? ''}” will be hidden from students and cannot receive new assignments. Existing results are kept.`}
        confirmLabel="Archive test"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={deleting ? () => undefined : () => setDeleteTarget(null)}
        onConfirm={() => (deleteTarget ? void removeTest(deleteTarget) : undefined)}
        loading={deleting}
        title="Delete this test permanently?"
        description={`“${deleteTarget?.title ?? ''}” and all of its sections, questions and assignments will be deleted. This cannot be undone. Tests with student attempts cannot be deleted — archive those instead.`}
        confirmLabel="Delete test"
      />
    </div>
  )
}
