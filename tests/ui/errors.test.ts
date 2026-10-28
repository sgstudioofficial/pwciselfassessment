import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '../../src/lib/errors'

describe('error messages', () => {
  it('explains an unreachable Edge Function instead of echoing supabase-js', () => {
    const message = getErrorMessage(
      new Error('Failed to send a request to the Edge Function'),
    )
    expect(message).toContain('server function')
    expect(message).toContain('ALLOWED_ORIGIN')
    expect(message).not.toMatch(/failed to send a request/i)
  })

  it('keeps the server message when the function answered with an error', () => {
    expect(getErrorMessage(new Error('That username is already taken.'))).toBe(
      'That username is already taken.',
    )
    expect(getErrorMessage(new Error('Invalid login credentials'))).toBe(
      'Incorrect email or password.',
    )
  })
})
