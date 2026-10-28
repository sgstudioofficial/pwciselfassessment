/**
 * "Unlimited" is stored as a very large positive limit rather than NULL or 0.
 *
 * Every attempt check in the database compares `used < limit`, so a billion
 * attempts behaves like no limit at all while keeping the column a plain
 * integer. The same constant is enforced by the CHECK constraints in
 * supabase/migrations/20261028170200_unlimited_attempts.sql.
 */
export const UNLIMITED_ATTEMPT_LIMIT = 1_000_000_000

export function isUnlimitedAttempts(limit: number | null | undefined): boolean {
  return limit != null && limit >= UNLIMITED_ATTEMPT_LIMIT
}

/**
 * Human label for an attempt limit. Pass a fallback for the "no limit known"
 * case (a test without a default, for example).
 */
export function formatAttemptLimit(
  limit: number | null | undefined,
  fallback = '—',
): string {
  if (limit == null) return fallback
  if (isUnlimitedAttempts(limit)) return 'Unlimited'
  return `${limit} ${limit === 1 ? 'attempt' : 'attempts'}`
}

/** Number-only variant used inside "3 / 20" style counters. */
export function formatAttemptLimitCount(
  limit: number | null | undefined,
  fallback = '—',
): string {
  if (limit == null) return fallback
  if (isUnlimitedAttempts(limit)) return 'Unlimited'
  return String(limit)
}
