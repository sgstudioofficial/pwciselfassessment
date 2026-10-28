import { describe, expect, it } from 'vitest'
import {
  UNLIMITED_ATTEMPT_LIMIT,
  formatAttemptLimit,
  formatAttemptLimitCount,
  isUnlimitedAttempts,
} from '../../src/lib/attempts'

describe('attempt limits', () => {
  it('treats the sentinel as unlimited', () => {
    expect(UNLIMITED_ATTEMPT_LIMIT).toBe(1_000_000_000)
    expect(isUnlimitedAttempts(UNLIMITED_ATTEMPT_LIMIT)).toBe(true)
    expect(isUnlimitedAttempts(1_000_000_001)).toBe(true)
    expect(isUnlimitedAttempts(20)).toBe(false)
    expect(isUnlimitedAttempts(null)).toBe(false)
    expect(isUnlimitedAttempts(undefined)).toBe(false)
  })

  it('labels limits for the UI', () => {
    expect(formatAttemptLimit(1)).toBe('1 attempt')
    expect(formatAttemptLimit(3)).toBe('3 attempts')
    expect(formatAttemptLimit(UNLIMITED_ATTEMPT_LIMIT)).toBe('Unlimited')
    expect(formatAttemptLimit(null)).toBe('—')
    expect(formatAttemptLimit(null, 'Test default')).toBe('Test default')
  })

  it('formats counters such as "3 / Unlimited"', () => {
    expect(formatAttemptLimitCount(20)).toBe('20')
    expect(formatAttemptLimitCount(UNLIMITED_ATTEMPT_LIMIT)).toBe('Unlimited')
    expect(formatAttemptLimitCount(null, '')).toBe('')
  })
})
