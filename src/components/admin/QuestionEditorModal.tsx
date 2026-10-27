import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlignLeft,
  CircleDot,
  Grid3x3,
  ImagePlus,
  ListChecks,
  Loader2,
  Plus,
  ToggleLeft,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, IconButton } from '../ui/Button'
import { Alert } from '../ui/Feedback'
import { Field, Input, Select, Textarea, Toggle } from '../ui/Form'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { publicImageUrl, supabase } from '../../lib/supabase'
import type {
  GridRow,
  Question,
  QuestionOption,
  QuestionType,
} from '../../lib/types'
import {
  gridCorrectOption,
  gridKeysForRows,
  gridPair,
  parseGridPair,
} from '../../lib/grid'
import { cn } from '../../lib/cn'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_GRID_ROWS = 15
const MAX_GRID_COLUMNS = 15
const MAX_CHOICE_OPTIONS = 30

const typeCards: {
  type: QuestionType
  label: string
  description: string
  icon: typeof CircleDot
}[] = [
  {
    type: 'single_choice',
    label: 'Single choice',
    description: 'One correct option',
    icon: CircleDot,
  },
  {
    type: 'multiple_select',
    label: 'Multiple select',
    description: 'One or more correct',
    icon: ListChecks,
  },
  {
    type: 'true_false',
    label: 'True / false',
    description: 'A binary answer',
    icon: ToggleLeft,
  },
  {
    type: 'short_answer',
    label: 'Short answer',
    description: 'Manually graded',
    icon: AlignLeft,
  },
  {
    type: 'grid',
    label: 'Grid',
    description: 'Rows × columns',
    icon: Grid3x3,
  },
]

function newOption(text = '', imagePath: string | null = null): QuestionOption {
  return { id: crypto.randomUUID(), text, image_path: imagePath }
}

function choiceDefaults(): QuestionOption[] {
  return [newOption(), newOption()]
}

function columnDefaults(): QuestionOption[] {
  return [newOption('Column 1'), newOption('Column 2')]
}

function gridRowDefaults(): GridRow[] {
  return [
    { id: crypto.randomUUID(), text: '' },
    { id: crypto.randomUUID(), text: '' },
  ]
}

export function QuestionEditorModal({
  open,
  onClose,
  sectionId,
  question,
  nextPosition,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sectionId: string
  question: Question | null
  nextPosition: number
  onSaved: (question: Question) => void
}) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const optionFileInputRef = useRef<HTMLInputElement>(null)
  const optionUploadTargetRef = useRef<string | null>(null)

  const [type, setType] = useState<QuestionType>('single_choice')
  const [prompt, setPrompt] = useState('')
  const [marks, setMarks] = useState('1')
  const [isRequired, setIsRequired] = useState(true)
  const [options, setOptions] = useState<QuestionOption[]>(choiceDefaults)
  const [rows, setRows] = useState<GridRow[]>([])
  const [correctOptions, setCorrectOptions] = useState<string[]>([])
  const [answerKey, setAnswerKey] = useState('')
  const [explanation, setExplanation] = useState('')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadingOptionId, setUploadingOptionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Grids share one column list; choice questions can be long tick lists.
  const optionLimit = type === 'grid' ? MAX_GRID_COLUMNS : MAX_CHOICE_OPTIONS

  useEffect(() => {
    if (!open) return
    const initialType = question?.question_type ?? 'single_choice'
    let initialOptions: QuestionOption[]
    if (initialType === 'short_answer') {
      initialOptions = []
    } else if (initialType === 'true_false') {
      initialOptions = [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ]
    } else if (question?.options?.length) {
      initialOptions = question.options
    } else {
      initialOptions = initialType === 'grid' ? columnDefaults() : choiceDefaults()
    }

    const initialRows: GridRow[] =
      initialType === 'grid'
        ? question?.grid_rows?.length
          ? question.grid_rows
          : gridRowDefaults()
        : []

    let initialCorrect: string[]
    if (question?.correct_options?.length) {
      initialCorrect = question.correct_options
    } else if (initialType === 'multiple_select') {
      initialCorrect = []
    } else if (initialType === 'grid') {
      // Default every row to the first column.
      initialCorrect = initialRows.map((row) =>
        gridPair(row.id, initialOptions[0]?.id ?? ''),
      )
    } else {
      initialCorrect = initialOptions[0] ? [initialOptions[0].id] : []
    }

    setType(initialType)
    setPrompt(question?.prompt ?? '')
    setMarks(question ? String(question.marks) : '1')
    setIsRequired(question?.is_required ?? true)
    setOptions(initialOptions)
    setRows(initialRows)
    setCorrectOptions(initialCorrect)
    setAnswerKey(question?.answer_key ?? '')
    setExplanation(question?.explanation ?? '')
    setImagePath(question?.image_path ?? null)
    setError(null)
    setSaving(false)
    setUploading(false)
    setUploadingOptionId(null)
    optionUploadTargetRef.current = null
  }, [open, question])

  const handleTypeChange = (nextType: QuestionType) => {
    if (nextType === type) return
    setError(null)
    setType(nextType)

    if (nextType === 'grid') {
      const nextRows = gridRowDefaults()
      const columns = columnDefaults()
      setRows(nextRows)
      setOptions(columns)
      setCorrectOptions(nextRows.map((row) => gridPair(row.id, columns[0].id)))
      return
    }

    setRows([])

    if (nextType === 'true_false') {
      setOptions([
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ])
      setCorrectOptions(['true'])
    } else if (nextType === 'short_answer') {
      setOptions([])
      setCorrectOptions([])
    } else if (
      type === 'true_false' ||
      type === 'short_answer' ||
      type === 'grid'
    ) {
      const defaults = choiceDefaults()
      setOptions(defaults)
      setCorrectOptions(nextType === 'multiple_select' ? [] : [defaults[0].id])
    } else if (nextType === 'single_choice' && correctOptions.length > 1) {
      setCorrectOptions(correctOptions.slice(0, 1))
    }
  }

  const updateRowText = (id: string, text: string) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, text } : row)),
    )
  }

  const addRow = () => {
    if (rows.length >= MAX_GRID_ROWS) return
    const row: GridRow = { id: crypto.randomUUID(), text: '' }
    setRows((current) => [...current, row])
    setCorrectOptions((current) => [
      ...current,
      gridPair(row.id, options[0]?.id ?? ''),
    ])
  }

  const removeRow = (id: string) => {
    if (rows.length <= 1) return
    setRows((current) => current.filter((row) => row.id !== id))
    setCorrectOptions((current) =>
      current.filter((pair) => parseGridPair(pair)?.rowId !== id),
    )
  }

  const setRowCorrect = (rowId: string, optionId: string) => {
    setCorrectOptions((current) => [
      ...current.filter((pair) => parseGridPair(pair)?.rowId !== rowId),
      gridPair(rowId, optionId),
    ])
  }

  const rowCorrectOption = (rowId: string): string =>
    gridCorrectOption(correctOptions, rowId) ?? ''

  const updateOptionText = (id: string, text: string) => {
    setOptions((current) =>
      current.map((option) => (option.id === id ? { ...option, text } : option)),
    )
  }

  const addOption = () => {
    if (options.length >= optionLimit) return
    setOptions((current) => [...current, newOption()])
  }

  const removeOption = (id: string) => {
    if (options.length <= 2) return
    const removed = options.find((option) => option.id === id)
    const remaining = options.filter((option) => option.id !== id)
    setOptions(remaining)
    if (type === 'grid') {
      // Re-point any row that used the removed column to the first column.
      setCorrectOptions((current) =>
        rows.map((row) => {
          const pair = current.find(
            (item) => parseGridPair(item)?.rowId === row.id,
          )
          const optionId = pair ? parseGridPair(pair)?.optionId : null
          if (optionId && optionId !== id) return pair as string
          return gridPair(row.id, remaining[0].id)
        }),
      )
    } else {
      setCorrectOptions((current) => current.filter((optionId) => optionId !== id))
    }
    if (removed?.image_path) {
      void supabase.storage.from('question-images').remove([removed.image_path])
    }
  }

  const toggleCorrect = (id: string) => {
    if (type === 'multiple_select') {
      setCorrectOptions((current) =>
        current.includes(id)
          ? current.filter((optionId) => optionId !== id)
          : [...current, id],
      )
    } else {
      setCorrectOptions([id])
    }
  }

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setError(null)

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Upload a PNG, JPG, WebP or GIF image.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Images must be 5 MB or smaller.')
      return
    }

    setUploading(true)
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${sectionId}/${crypto.randomUUID()}.${extension}`
      const previous = imagePath
      const { error: uploadError } = await supabase.storage
        .from('question-images')
        .upload(path, file, { cacheControl: '3600', contentType: file.type })
      if (uploadError) throw uploadError

      if (previous) {
        await supabase.storage.from('question-images').remove([previous])
      }
      setImagePath(path)
      toast.success('Image uploaded')
    } catch (uploadError) {
      setError(getErrorMessage(uploadError))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = async () => {
    if (!imagePath) return
    const path = imagePath
    setImagePath(null)
    await supabase.storage.from('question-images').remove([path])
  }

  const openOptionImagePicker = (optionId: string) => {
    optionUploadTargetRef.current = optionId
    optionFileInputRef.current?.click()
  }

  const handleOptionUpload = async (file: File | undefined) => {
    const optionId = optionUploadTargetRef.current
    if (!file || !optionId) return
    setError(null)

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Upload a PNG, JPG, WebP or GIF image.')
      if (optionFileInputRef.current) optionFileInputRef.current.value = ''
      optionUploadTargetRef.current = null
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Images must be 5 MB or smaller.')
      if (optionFileInputRef.current) optionFileInputRef.current.value = ''
      optionUploadTargetRef.current = null
      return
    }

    setUploadingOptionId(optionId)
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${sectionId}/${crypto.randomUUID()}.${extension}`
      const previous =
        options.find((option) => option.id === optionId)?.image_path ?? null
      const { error: uploadError } = await supabase.storage
        .from('question-images')
        .upload(path, file, { cacheControl: '3600', contentType: file.type })
      if (uploadError) throw uploadError

      if (previous) {
        await supabase.storage.from('question-images').remove([previous])
      }
      setOptions((current) =>
        current.map((option) =>
          option.id === optionId ? { ...option, image_path: path } : option,
        ),
      )
      toast.success('Option image uploaded')
    } catch (uploadError) {
      setError(getErrorMessage(uploadError))
    } finally {
      setUploadingOptionId(null)
      optionUploadTargetRef.current = null
      if (optionFileInputRef.current) optionFileInputRef.current.value = ''
    }
  }

  const removeOptionImage = async (optionId: string) => {
    const target = options.find((option) => option.id === optionId)
    if (!target?.image_path) return
    const path = target.image_path
    setOptions((current) =>
      current.map((option) =>
        option.id === optionId ? { ...option, image_path: null } : option,
      ),
    )
    await supabase.storage.from('question-images').remove([path])
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!prompt.trim()) return setError('Enter the question text.')
    const marksValue = Number(marks)
    if (!Number.isFinite(marksValue) || marksValue <= 0 || marksValue > 100) {
      return setError('Marks must be between 0.01 and 100.')
    }

    if (type === 'grid') {
      if (rows.length === 0) return setError('Add at least one row.')
      if (rows.some((row) => !row.text.trim())) {
        return setError('Every row needs text.')
      }
      const rowTexts = rows.map((row) => row.text.trim().toLowerCase())
      if (new Set(rowTexts).size !== rowTexts.length) {
        return setError('Rows must be different from each other.')
      }
      if (options.length < 2) return setError('Add at least two columns.')
      if (options.some((option) => !option.text.trim() && !option.image_path)) {
        return setError('Every column needs text, an image, or both.')
      }
      const columnTexts = options
        .map((option) => option.text.trim().toLowerCase())
        .filter(Boolean)
      if (new Set(columnTexts).size !== columnTexts.length) {
        return setError('Columns must be different from each other.')
      }
      const missingKey = rows.some((row) => {
        const optionId = rowCorrectOption(row.id)
        return (
          !optionId ||
          !options.some((option) => option.id === optionId) ||
          !parseGridPair(gridPair(row.id, optionId))
        )
      })
      if (missingKey) {
        return setError('Choose the correct column for every row.')
      }
    } else if (type !== 'short_answer') {
      if (options.length < 2) return setError('Add at least two answer options.')
      if (options.some((option) => !option.text.trim() && !option.image_path)) {
        return setError('Every answer option needs text, an image, or both.')
      }
      const optionTexts = options
        .map((option) => option.text.trim().toLowerCase())
        .filter(Boolean)
      if (new Set(optionTexts).size !== optionTexts.length) {
        return setError('Answer options must be different from each other.')
      }
      if (correctOptions.length === 0) {
        return setError('Select the correct answer.')
      }
      if (type !== 'multiple_select' && correctOptions.length !== 1) {
        return setError('Select exactly one correct answer.')
      }
      if (
        type === 'multiple_select' &&
        correctOptions.length === options.length
      ) {
        return setError('Leave at least one option incorrect.')
      }
    }

    const gridCorrect =
      type === 'grid' ? gridKeysForRows(rows, correctOptions) : []

    setSaving(true)
    try {
      const payload = {
        section_id: sectionId,
        question_type: type,
        prompt: prompt.trim(),
        image_path: imagePath,
        marks: marksValue,
        is_required: isRequired,
        options: type === 'short_answer' ? [] : options.map((option) => ({
          id: option.id,
          text: option.text.trim(),
          image_path: option.image_path ?? null,
        })),
        correct_options:
          type === 'short_answer'
            ? []
            : type === 'grid'
              ? gridCorrect
              : correctOptions,
        grid_rows:
          type === 'grid'
            ? rows.map((row) => ({ id: row.id, text: row.text.trim() }))
            : [],
        answer_key: type === 'short_answer' ? answerKey.trim() || null : null,
        explanation: explanation.trim() || null,
        position: question?.position ?? nextPosition,
      }

      if (question) {
        const { data, error: updateError } = await supabase
          .from('questions')
          .update(payload)
          .eq('id', question.id)
          .select('*')
          .single()
        if (updateError) throw updateError
        toast.success('Question updated')
        onSaved(data as Question)
      } else {
        const { data, error: insertError } = await supabase
          .from('questions')
          .insert(payload)
          .select('*')
          .single()
        if (insertError) throw insertError
        toast.success('Question added')
        onSaved(data as Question)
      }
      onClose()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const previewUrl = publicImageUrl(imagePath)

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={question ? 'Edit question' : 'Add a question'}
      description="Answers are stored securely. Students only receive the question and options."
      size="2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="question-form"
            loading={saving}
            leftIcon={!saving ? <Plus className="h-4 w-4" /> : undefined}
          >
            {question ? 'Save question' : 'Add question'}
          </Button>
        </>
      }
    >
      <form id="question-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Question type</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {typeCards.map((card) => {
              const Icon = card.icon
              const active = type === card.type
              return (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => handleTypeChange(card.type)}
                  disabled={saving}
                  className={cn(
                    'rounded-xl border p-3 text-left transition',
                    active
                      ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                  aria-pressed={active}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      active ? 'text-brand-700' : 'text-slate-400',
                    )}
                  />
                  <span className="mt-2 block text-xs font-semibold text-slate-900">
                    {card.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
                    {card.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <Field
          label="Question text"
          htmlFor="question-prompt"
          required
          hint="Be specific. This is exactly what the student sees."
        >
          <Textarea
            id="question-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Type the question…"
            rows={3}
            maxLength={4000}
            disabled={saving}
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marks" htmlFor="question-marks" required>
            <Input
              id="question-marks"
              type="number"
              min={0.01}
              max={100}
              step={0.5}
              value={marks}
              onChange={(event) => setMarks(event.target.value)}
              disabled={saving}
            />
          </Field>
          <div className="flex items-end pb-1">
            <div className="w-full rounded-xl border border-slate-200 p-3">
              <Toggle
                checked={isRequired}
                onChange={setIsRequired}
                label="Required question"
                description="Students are warned if they skip it."
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            Question image <span className="font-normal text-slate-400">(optional)</span>
          </p>
          {previewUrl ? (
            <div className="relative inline-block">
              <img
                src={previewUrl}
                alt="Question illustration preview"
                className="max-h-48 rounded-xl border border-slate-200 object-contain"
              />
              <IconButton
                label="Remove image"
                variant="danger"
                size="sm"
                onClick={removeImage}
                className="absolute right-2 top-2 bg-white shadow-sm"
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || saving || uploadingOptionId !== null}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-7 text-sm text-slate-500 transition hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60"
            >
              {uploading ? (
                <span>Uploading…</span>
              ) : (
                <>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
                    <Upload className="h-4 w-4" />
                  </span>
                  <span className="font-medium text-slate-700">Upload an image</span>
                  <span className="text-xs">PNG, JPG, WebP or GIF · max 5 MB</span>
                </>
              )}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={(event) => void handleUpload(event.target.files?.[0])}
            className="sr-only"
            tabIndex={-1}
          />
        </div>

        {type === 'short_answer' ? (
          <Field
            label="Model answer"
            htmlFor="question-answer-key"
            hint="Guidance for manual grading. Students see it only after submission, if results are enabled."
          >
            <Textarea
              id="question-answer-key"
              value={answerKey}
              onChange={(event) => setAnswerKey(event.target.value)}
              placeholder="Expected answer or key points…"
              rows={3}
              disabled={saving}
            />
          </Field>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">
                {type === 'grid' ? 'Grid columns' : 'Answer options'}{' '}
                {type !== 'grid' ? (
                  <span className="font-normal text-slate-400">
                    ({type === 'multiple_select' ? 'select all correct' : 'select the correct one'})
                  </span>
                ) : null}
              </p>
              <span className="text-xs text-slate-400">{options.length} / {optionLimit}</span>
            </div>
            <p className="mb-2 text-xs text-slate-400">
              {type === 'grid'
                ? 'Students choose one column for each row.'
                : 'Each option can have text, an image, or both.'}
            </p>
            <div className="space-y-2">
              {options.map((option, index) => {
                const isCorrect =
                  type !== 'grid' && correctOptions.includes(option.id)
                const fixed = type === 'true_false'
                const isUploading = uploadingOptionId === option.id
                const preview = publicImageUrl(option.image_path)
                const itemLabel = type === 'grid' ? 'column' : 'option'
                return (
                  <div
                    key={option.id}
                    className={cn(
                      'rounded-xl border transition',
                      isCorrect
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : 'border-slate-200 bg-white',
                    )}
                  >
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      {type !== 'grid' ? (
                        <input
                          type={type === 'multiple_select' ? 'checkbox' : 'radio'}
                          name="correct-option"
                          checked={isCorrect}
                          onChange={() => toggleCorrect(option.id)}
                          disabled={saving}
                          aria-label={`Mark option ${index + 1} as correct`}
                          className="h-4 w-4 shrink-0 accent-emerald-600"
                        />
                      ) : null}
                      <Input
                        value={option.text}
                        onChange={(event) => updateOptionText(option.id, event.target.value)}
                        placeholder={
                          option.image_path
                            ? `${type === 'grid' ? 'Column' : 'Option'} ${index + 1} caption (optional)`
                            : `${type === 'grid' ? 'Column' : 'Option'} ${index + 1}`
                        }
                        aria-label={`${type === 'grid' ? 'Column' : 'Option'} ${index + 1} text`}
                        disabled={saving || fixed}
                        className="border-0 bg-transparent shadow-none focus:ring-0"
                      />
                      {!fixed ? (
                        <IconButton
                          label={
                            option.image_path
                              ? `Replace image for ${itemLabel} ${index + 1}`
                              : `Add image to ${itemLabel} ${index + 1}`
                          }
                          size="sm"
                          variant={option.image_path ? 'soft' : 'ghost'}
                          onClick={() => openOptionImagePicker(option.id)}
                          disabled={saving || uploading || uploadingOptionId !== null}
                        >
                          {isUploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ImagePlus className="h-3.5 w-3.5" />
                          )}
                        </IconButton>
                      ) : null}
                      {!fixed ? (
                        <IconButton
                          label={`Remove ${itemLabel}`}
                          size="sm"
                          variant="danger"
                          onClick={() => removeOption(option.id)}
                          disabled={saving || options.length <= 2}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      ) : null}
                    </div>
                    {preview ? (
                      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
                        <img
                          src={preview}
                          alt={`${itemLabel} ${index + 1} preview`}
                          className="max-h-24 rounded-lg border border-slate-200 bg-white object-contain"
                        />
                        <IconButton
                          label={`Remove image from ${itemLabel} ${index + 1}`}
                          size="sm"
                          variant="danger"
                          onClick={() => void removeOptionImage(option.id)}
                          disabled={saving}
                        >
                          <X className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <input
              ref={optionFileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={(event) => void handleOptionUpload(event.target.files?.[0])}
              className="sr-only"
              tabIndex={-1}
            />
            {type !== 'true_false' ? (
              <button
                type="button"
                onClick={addOption}
                disabled={saving || options.length >= optionLimit}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                {type === 'grid' ? 'Add column' : 'Add option'}
              </button>
            ) : null}
          </div>
        )}

        {type === 'grid' ? (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Grid rows</p>
                <span className="text-xs text-slate-400">{rows.length} / {MAX_GRID_ROWS}</span>
              </div>
              <p className="mb-2 text-xs text-slate-400">
                Each row is one statement the student rates against the columns.
              </p>
              <div className="space-y-2">
                {rows.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-2.5">
                    <span className="w-6 shrink-0 text-xs font-semibold text-slate-400">
                      {String.fromCharCode(97 + index)})
                    </span>
                    <Input
                      value={row.text}
                      onChange={(event) => updateRowText(row.id, event.target.value)}
                      placeholder={`Row ${index + 1}`}
                      aria-label={`Row ${index + 1} text`}
                      disabled={saving}
                    />
                    <IconButton
                      label={`Remove row ${index + 1}`}
                      size="sm"
                      variant="danger"
                      onClick={() => removeRow(row.id)}
                      disabled={saving || rows.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addRow}
                disabled={saving || rows.length >= MAX_GRID_ROWS}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </button>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">
                Correct column for each row
              </p>
              <p className="mb-2 text-xs text-slate-400">
                A grid scores full marks only when every row matches.
              </p>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                {rows.map((row, index) => (
                  <div key={row.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      <span className="mr-1.5 text-xs font-semibold text-slate-400">
                        {String.fromCharCode(97 + index)})
                      </span>
                      {row.text.trim() || `Row ${index + 1}`}
                    </span>
                    <Select
                      value={rowCorrectOption(row.id)}
                      onChange={(event) => setRowCorrect(row.id, event.target.value)}
                      disabled={saving}
                      aria-label={`Correct column for row ${index + 1}`}
                      className="h-9 w-44 shrink-0"
                    >
                      {options.map((option, optionIndex) => (
                        <option key={option.id} value={option.id}>
                          {option.text.trim() || `Column ${optionIndex + 1}`}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <Field
          label="Explanation (optional)"
          htmlFor="question-explanation"
          hint="Shown in results to help the student learn from their answer."
        >
          <Textarea
            id="question-explanation"
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            placeholder="Why is this the correct answer?"
            rows={2}
            disabled={saving}
          />
        </Field>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <ImagePlus className="h-4 w-4 shrink-0 text-slate-400" />
          Short-answer questions are never auto-graded. Blank answers receive zero;
          non-blank responses appear in the admin grading queue.
        </div>
      </form>
    </Modal>
  )
}
