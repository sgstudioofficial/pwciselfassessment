import { gridKeysForRows, gridPair, gridPairMap } from './grid'
import type { Question, QuestionOption } from './types'

/**
 * Answer keys are edited in a few places (the question modal and the bulk key
 * page). This module keeps the encoding, completeness rules and change
 * detection in one place so both surfaces agree with what grading expects.
 */
export type KeyDraft = {
  /** Option ids for choice questions, `row:column` pairs for grids. */
  correct: string[]
  /** Expected text for short answers; empty for every other type. */
  answerKey: string
}

export function draftFromQuestion(question: Question): KeyDraft {
  return {
    correct: question.correct_options ?? [],
    answerKey: question.answer_key ?? '',
  }
}

/** The key the importer wrote: first option, "true", or the first column. */
export function placeholderKey(question: Question): string[] {
  if (question.question_type === 'short_answer') return []
  if (question.question_type === 'grid') {
    const first = question.options[0]?.id ?? ''
    return question.grid_rows.map((row) => gridPair(row.id, first))
  }
  const first = question.options[0]?.id
  return first ? [first] : []
}

export function isPlaceholderKey(question: Question, draft: KeyDraft): boolean {
  const placeholder = placeholderKey(question)
  if (question.question_type === 'short_answer') return draft.answerKey.trim() === ''
  return sameIds(placeholder, draft.correct)
}

/**
 * A key is complete when grading can actually decide something. Choice
 * questions always have a value (possibly the placeholder), grids need every
 * row, and short answers need text.
 */
export function isKeyComplete(question: Question, draft: KeyDraft): boolean {
  if (question.question_type === 'short_answer') {
    return draft.answerKey.trim() !== ''
  }
  if (question.question_type === 'grid') {
    const columns = gridPairMap(draft.correct)
    return question.grid_rows.every((row) => {
      const column = columns.get(row.id)
      return Boolean(column) && question.options.some((option) => option.id === column)
    })
  }
  if (question.question_type === 'multiple_select') return draft.correct.length > 0
  return draft.correct.length === 1
}

/** Stable identity of a key, used to tie "reviewed" marks to its content. */
export function keyFingerprint(question: Question, draft: KeyDraft): string {
  if (question.question_type === 'short_answer') {
    return `short|${normalize(draft.answerKey)}`
  }
  return `${question.question_type}|${[...draft.correct].sort().join(',')}`
}

/** Single-key shortcut per option, e.g. "a" for the first option. */
export function optionHotkeys(options: QuestionOption[]): Map<string, string> {
  const map = new Map<string, string>()
  options.forEach((option, index) => {
    const preferred = /^[a-z0-9]$/i.test(option.id) ? option.id.toLowerCase() : null
    const fallback =
      index < 26 ? String.fromCharCode('a'.charCodeAt(0) + index) : null
    const key = preferred && !map.has(preferred) ? preferred : fallback
    if (key && !map.has(key)) map.set(key, option.id)
  })
  return map
}

export function optionLetter(index: number): string {
  return index < 26 ? String.fromCharCode('A'.charCodeAt(0) + index) : String(index + 1)
}

/** Pick (single/true-false) or toggle (multiple select) one option. */
export function applyOption(
  question: Question,
  draft: KeyDraft,
  optionId: string,
): KeyDraft {
  if (question.question_type === 'multiple_select') {
    const next = draft.correct.includes(optionId)
      ? draft.correct.filter((id) => id !== optionId)
      : [...draft.correct, optionId]
    return { ...draft, correct: next }
  }
  if (question.question_type === 'single_choice' || question.question_type === 'true_false') {
    return { ...draft, correct: [optionId] }
  }
  return draft
}

/** Set the correct column for one grid row, keeping the other rows intact. */
export function applyGridRow(
  question: Question,
  draft: KeyDraft,
  rowId: string,
  optionId: string,
): KeyDraft {
  const columns = gridPairMap(draft.correct)
  columns.set(rowId, optionId)
  return {
    ...draft,
    correct: question.grid_rows.map((row) =>
      gridPair(row.id, columns.get(row.id) ?? ''),
    ),
  }
}

/** The column selected for one grid row, or "" when unset. */
export function gridColumn(question: Question, draft: KeyDraft, rowId: string): string {
  const columns = gridPairMap(draft.correct)
  const column = columns.get(rowId) ?? ''
  return question.options.some((option) => option.id === column) ? column : ''
}

/** Columns keyed by row, ready for the per-row selects. */
export function gridColumns(question: Question, draft: KeyDraft): Map<string, string> {
  const columns = gridPairMap(draft.correct)
  return new Map(
    question.grid_rows.map((row) => {
      const column = columns.get(row.id) ?? ''
      const valid = question.options.some((option) => option.id === column)
      return [row.id, valid ? column : ''] as const
    }),
  )
}

export function sameDraft(a: KeyDraft, b: KeyDraft, question: Question): boolean {
  return keyFingerprint(question, a) === keyFingerprint(question, b)
}

/** Only the columns grading reads, so unrelated question data is never touched. */
export function keyPatch(
  question: Question,
  draft: KeyDraft,
): { correct_options: string[]; answer_key: string | null } {
  if (question.question_type === 'short_answer') {
    return { correct_options: [], answer_key: draft.answerKey.trim() || null }
  }
  if (question.question_type === 'grid') {
    return {
      correct_options: gridKeysForRows(question.grid_rows, draft.correct),
      answer_key: null,
    }
  }
  return { correct_options: draft.correct, answer_key: null }
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}
