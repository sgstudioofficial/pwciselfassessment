/**
 * Reads the `session_id` claim from a Supabase access token.
 *
 * Auth issues a new session id on every sign-in, so two devices signed into the
 * same account carry different ids. The newest id is stored on the profile and
 * the older browser signs itself out when it notices the mismatch.
 */
export function readSessionId(
  accessToken: string | null | undefined,
): string | null {
  if (!accessToken) return null
  const payload = accessToken.split('.')[1]
  if (!payload) return null

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof claims.session_id === 'string' ? claims.session_id : null
  } catch {
    return null
  }
}
