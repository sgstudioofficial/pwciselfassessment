import type { GridRow, QuestionOption } from './types'

/**
 * Grid answers are stored as "<rowId>:<optionId>" pairs. These helpers keep the
 * encoding in one place for the editor, student view, results and CSV export.
 */
export function gridPair(rowId: string, optionId: string): string {
  return `${rowId}:${optionId}`
}

export function parseGridPair(
  pair: string,
): { rowId: string; optionId: string } | null {
  const index = pair.indexOf(':')
  if (index <= 0 || index === pair.length - 1) return null
  const optionId = pair.slice(index + 1)
  if (optionId.includes(':')) return null
  return { rowId: pair.slice(0, index), optionId }
}

/** The option a student picked for one row, if any. */
export function gridSelection(selected: string[], rowId: string): string | null {
  for (const pair of selected) {
    const parsed = parseGridPair(pair)
    if (parsed?.rowId === rowId) return parsed.optionId
  }
  return null
}

/** The column stored as the key for one row, if any. */
export function gridCorrectOption(
  pairs: string[],
  rowId: string,
): string | null {
  return gridPairMap(pairs).get(rowId) ?? null
}

/** Correct-answer pairs to save, one per row, in row order. */
export function gridKeysForRows(rows: GridRow[], pairs: string[]): string[] {
  const selected = gridPairMap(pairs)
  return rows.map((row) => gridPair(row.id, selected.get(row.id) ?? ''))
}

/** Map of rowId -> optionId for a set of pairs. */
export function gridPairMap(pairs: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of pairs) {
    const parsed = parseGridPair(pair)
    if (parsed) map.set(parsed.rowId, parsed.optionId)
  }
  return map
}

/** Human-readable "row — column" list used by CSV exports and feedback. */export function gridAnswerText(
  rows: GridRow[],
  columns: QuestionOption[],
  pairs: string[],
): string {
  const selected = gridPairMap(pairs)
  return rows
    .map((row) => {
      const option = columns.find((item) => item.id === selected.get(row.id))
      if (!option) return null
      return `${row.text.trim() || 'Row'} — ${option.text.trim() || 'Column'}`
    })
    .filter(Boolean)
    .join('; ')
}
