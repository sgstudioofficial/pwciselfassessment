import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Layers } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Feedback'
import { Field, Input, Textarea } from '../ui/Form'
import { useToast } from '../../context/ToastContext'
import { getErrorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Section } from '../../lib/types'

export function SectionDialog({
  open,
  onClose,
  section,
  testId,
  nextPosition,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  section: Section | null
  testId: string
  nextPosition: number
  onSaved: (section: Section) => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(section?.title ?? '')
    setDescription(section?.description ?? '')
    setError(null)
    setSaving(false)
  }, [open, section])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('Give this section a title.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        test_id: testId,
        title: title.trim(),
        description: description.trim() || null,
        position: section?.position ?? nextPosition,
      }

      if (section) {
        const { data, error: updateError } = await supabase
          .from('sections')
          .update(payload)
          .eq('id', section.id)
          .select('*')
          .single()
        if (updateError) throw updateError
        toast.success('Section updated')
        onSaved(data as Section)
      } else {
        const { data, error: insertError } = await supabase
          .from('sections')
          .insert(payload)
          .select('*')
          .single()
        if (insertError) throw insertError
        toast.success('Section added')
        onSaved(data as Section)
      }
      onClose()
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={section ? 'Edit section' : 'Add a section'}
      description="Sections group related questions. Students see them in this order."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="section-form"
            loading={saving}
            leftIcon={!saving ? <Layers className="h-4 w-4" /> : undefined}
          >
            {section ? 'Save section' : 'Add section'}
          </Button>
        </>
      }
    >
      <form id="section-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Section title" htmlFor="section-title" required>
          <Input
            id="section-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Company policies"
            maxLength={160}
            disabled={saving}
            autoFocus
          />
        </Field>
        <Field
          label="Description (optional)"
          htmlFor="section-description"
          hint="Shown above the section in the student assessment."
        >
          <Textarea
            id="section-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this section covers…"
            rows={3}
            disabled={saving}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Modal>
  )
}
