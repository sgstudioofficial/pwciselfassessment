/**
 * Supabase Auth is stricter than a simple `x@y.z` check: it rejects addresses
 * with consecutive dots, a trailing dot, or a domain label that starts with a
 * hyphen. Those reach GoTrue and come back as
 * "Unable to validate email address: invalid format", so screen them here to
 * keep the message actionable.
 *
 * Keep in sync with EMAIL_PATTERN in
 * supabase/functions/admin-students/index.ts (the function cannot import src).
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed)
}
