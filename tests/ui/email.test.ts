import { describe, expect, it } from 'vitest'
import { isValidEmail } from '../../src/lib/email'

describe('isValidEmail', () => {
  it('accepts addresses Supabase Auth accepts', () => {
    for (const value of [
      'student@example.com',
      'first.last+tag@sub.example.co.uk',
      'UPPER@EXAMPLE.COM',
      'a@b.io',
      '  padded@example.com  ',
    ]) {
      expect(isValidEmail(value), value).toBe(true)
    }
  })

  it('rejects the shapes GoTrue reports as "invalid format"', () => {
    for (const value of [
      'student@example..com',
      'student@example.com.',
      'student@-example.com',
      'student@example.com,',
      'student@example',
      'student name@example.com',
      '.student@example.com',
      '',
      '   ',
    ]) {
      expect(isValidEmail(value), value).toBe(false)
    }
  })

  it('rejects addresses longer than the 254 character limit', () => {
    const local = 'a'.repeat(250)
    expect(isValidEmail(`${local}@example.com`)).toBe(false)
  })
})
