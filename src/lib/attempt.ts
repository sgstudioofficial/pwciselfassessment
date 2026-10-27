import type { AttemptQuestion } from './types'
import { parseGridPair } from './grid'

export type AnswerDraft = {
  selected: string[]
  text: string
  flagged: boolean
}

export function emptyAnswerDraft(): AnswerDraft {
  return { selected: [], text: '', flagged: false }
}

export function isAnswered(question: AttemptQuestion, answer: AnswerDraft): boolean {
  if (question.question_type === 'grid') {
    const rows = question.rows ?? []
    if (rows.length === 0) return false
    const answeredRows = new Set(
      answer.selected
        .map((pair) => parseGridPair(pair)?.rowId)
        .filter((rowId): rowId is string => Boolean(rowId)),
    )
    return rows.every((row) => answeredRows.has(row.id))
  }
  if (question.question_type === 'short_answer') {
    return answer.text.trim().length > 0
  }
  return answer.selected.length > 0
}
