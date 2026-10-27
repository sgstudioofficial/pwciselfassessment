import { describe, expect, it } from 'vitest'
import {
  applyGridRow,
  applyOption,
  draftFromQuestion,
  gridColumns,
  isKeyComplete,
  isPlaceholderKey,
  keyFingerprint,
  keyPatch,
  optionHotkeys,
  placeholderKey,
} from '../../src/lib/answerKey'
import type { Question } from '../../src/lib/types'

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    section_id: 's1',
    question_type: 'single_choice',
    prompt: 'Question?',
    image_path: null,
    marks: 1,
    is_required: true,
    options: [
      { id: 'a', text: 'First' },
      { id: 'b', text: 'Second' },
      { id: 'c', text: 'Third' },
    ],
    correct_options: ['a'],
    answer_key: null,
    explanation: null,
    grid_rows: [],
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const grid = makeQuestion({
  id: 'g1',
  question_type: 'grid',
  options: [
    { id: 'a', text: 'True' },
    { id: 'b', text: 'False' },
  ],
  grid_rows: [
    { id: 'a', text: 'Water-based mud' },
    { id: 'b', text: 'Oil-based mud' },
  ],
  correct_options: ['a:a', 'b:a'],
})

describe('answer key helpers', () => {
  it('recognises the importer placeholder for every question type', () => {
    expect(placeholderKey(makeQuestion({}))).toEqual(['a'])
    expect(isPlaceholderKey(makeQuestion({}), { correct: ['a'], answerKey: '' })).toBe(true)
    expect(isPlaceholderKey(makeQuestion({}), { correct: ['b'], answerKey: '' })).toBe(false)

    expect(placeholderKey(grid)).toEqual(['a:a', 'b:a'])
    expect(isPlaceholderKey(grid, { correct: ['a:a', 'b:a'], answerKey: '' })).toBe(true)
    expect(isPlaceholderKey(grid, { correct: ['a:b', 'b:a'], answerKey: '' })).toBe(false)

    expect(isPlaceholderKey(makeQuestion({ question_type: 'short_answer', options: [] }), { correct: [], answerKey: '  ' })).toBe(true)
  })

  it('picks one option for single choice and toggles for multiple select', () => {
    const single = makeQuestion({})
    expect(applyOption(single, { correct: ['a'], answerKey: '' }, 'c')).toEqual({
      correct: ['c'],
      answerKey: '',
    })

    const multi = makeQuestion({ question_type: 'multiple_select', correct_options: ['a'] })
    const first = applyOption(multi, { correct: ['a'], answerKey: '' }, 'c')
    expect(first.correct).toEqual(['a', 'c'])
    expect(applyOption(multi, first, 'a').correct).toEqual(['c'])
  })

  it('only counts a multiple select as complete once something is ticked', () => {
    const multi = makeQuestion({ question_type: 'multiple_select' })
    expect(isKeyComplete(multi, { correct: [], answerKey: '' })).toBe(false)
    expect(isKeyComplete(multi, { correct: ['b'], answerKey: '' })).toBe(true)
  })

  it('sets grid rows independently and requires every row', () => {
    const draft = draftFromQuestion(grid)
    const next = applyGridRow(grid, draft, 'b', 'b')
    expect(next.correct).toEqual(['a:a', 'b:b'])
    expect(gridColumns(grid, next).get('a')).toBe('a')
    expect(gridColumns(grid, next).get('b')).toBe('b')
    // Other rows keep their value when one row changes.
    expect(applyGridRow(grid, next, 'a', 'b').correct).toEqual(['a:b', 'b:b'])

    expect(isKeyComplete(grid, { correct: ['a:a', 'b:'], answerKey: '' })).toBe(false)
    expect(isKeyComplete(grid, { correct: ['a:a', 'b:b'], answerKey: '' })).toBe(true)
  })

  it('treats an unknown column as unset so the select never lies', () => {
    expect(gridColumns(grid, { correct: ['a:z', 'b:b'], answerKey: '' }).get('a')).toBe('')
  })

  it('writes only the grading columns', () => {
    expect(keyPatch(grid, { correct: ['a:b', 'b:a'], answerKey: '' })).toEqual({
      correct_options: ['a:b', 'b:a'],
      answer_key: null,
    })
    expect(
      keyPatch(makeQuestion({ question_type: 'short_answer', options: [] }), {
        correct: [],
        answerKey: '  1,250 psi  ',
      }),
    ).toEqual({ correct_options: [], answer_key: '1,250 psi' })
    expect(
      keyPatch(makeQuestion({}), { correct: ['b'], answerKey: '' }),
    ).toEqual({ correct_options: ['b'], answer_key: null })
  })

  it('fingerprints keys so reviews follow the exact key, not the row', () => {
    const multi = makeQuestion({ question_type: 'multiple_select' })
    expect(keyFingerprint(multi, { correct: ['b', 'a'], answerKey: '' })).toBe(
      keyFingerprint(multi, { correct: ['a', 'b'], answerKey: '' }),
    )
    const short = makeQuestion({ question_type: 'short_answer', options: [] })
    expect(keyFingerprint(short, { correct: [], answerKey: ' 300 PSI ' })).toBe(
      keyFingerprint(short, { correct: [], answerKey: '300 psi' }),
    )
  })

  it('maps letters to options even when option ids are not letters', () => {
    const letters = optionHotkeys([
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ])
    expect(letters.get('b')).toBe('b')

    const ids = optionHotkeys([
      { id: '11111111-1111-4111-8111-111111111111', text: 'A' },
      { id: '22222222-2222-4222-8222-222222222222', text: 'B' },
    ])
    expect(ids.get('a')).toBe('11111111-1111-4111-8111-111111111111')
    expect(ids.get('b')).toBe('22222222-2222-4222-8222-222222222222')
  })
})
