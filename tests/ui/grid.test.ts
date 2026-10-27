import { describe, expect, it } from 'vitest'
import {
  gridAnswerText,
  gridCorrectOption,
  gridKeysForRows,
  gridPair,
  gridPairMap,
  gridSelection,
  parseGridPair,
} from '../../src/lib/grid'

const columns = [
  { id: 'a', text: 'True' },
  { id: 'b', text: 'False' },
]

const rows = [
  { id: 'a', text: 'Water-based mud' },
  { id: 'b', text: 'Oil-based mud' },
]

describe('grid answer encoding', () => {
  it('round-trips a row/column pair', () => {
    expect(gridPair('a', 'b')).toBe('a:b')
    expect(parseGridPair('a:b')).toEqual({ rowId: 'a', optionId: 'b' })
    expect(parseGridPair('a')).toBeNull()
    expect(parseGridPair('a:b:c')).toBeNull()
  })

  it('returns the stored column id for a row, not the whole pair', () => {
    const key = ['a:b', 'b:a']
    expect(gridCorrectOption(key, 'a')).toBe('b')
    expect(gridCorrectOption(key, 'b')).toBe('a')
    expect(gridCorrectOption(key, 'c')).toBeNull()
    // A column id is what the editor binds to its per-row select.
    expect(columns.some((column) => column.id === gridCorrectOption(key, 'a'))).toBe(true)
  })

  it('saves one pair per row without double-encoding the column', () => {
    const key = ['a:b', 'b:a']
    expect(gridKeysForRows(rows, key)).toEqual(['a:b', 'b:a'])
    // Saving an unchanged grid must be idempotent.
    expect(gridKeysForRows(rows, gridKeysForRows(rows, key))).toEqual(['a:b', 'b:a'])
    // A row with no key yet is stored as an empty column id, never "row:row:col".
    expect(gridKeysForRows(rows, ['a:b'])).toEqual(['a:b', 'b:'])
  })

  it('maps student selections and renders readable feedback', () => {
    expect(gridSelection(['a:b'], 'a')).toBe('b')
    expect(gridSelection(['a:b'], 'b')).toBeNull()
    expect(gridPairMap(['a:b', 'b:a']).get('b')).toBe('a')
    expect(gridAnswerText(rows, columns, ['a:b', 'b:a'])).toBe(
      'Water-based mud — False; Oil-based mud — True',
    )
  })
})
