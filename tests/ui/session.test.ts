import { describe, expect, it } from 'vitest'
import { readSessionId } from '../../src/lib/session'

function makeToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`
}

describe('readSessionId', () => {
  it('reads the session_id claim from an access token', () => {
    const token = makeToken({
      sub: '273cf0ec-d048-4ecc-aa00-2fea74554b7e',
      session_id: '9f3c1c62-4f0e-4a1d-8a2b-7c5d6e7f8a90',
    })
    expect(readSessionId(token)).toBe('9f3c1c62-4f0e-4a1d-8a2b-7c5d6e7f8a90')
  })

  it('returns null when the token has no session_id claim', () => {
    expect(readSessionId(makeToken({ sub: 'user' }))).toBeNull()
    expect(readSessionId(makeToken({ session_id: 42 }))).toBeNull()
  })

  it('returns null for missing or malformed tokens', () => {
    expect(readSessionId(null)).toBeNull()
    expect(readSessionId(undefined)).toBeNull()
    expect(readSessionId('')).toBeNull()
    expect(readSessionId('not-a-jwt')).toBeNull()
    expect(readSessionId('header.%%%.signature')).toBeNull()
  })
})
