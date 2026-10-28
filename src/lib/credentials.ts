/**
 * Ready-to-send sign-in instructions for a newly created student.
 *
 * Admins copy this message into email or chat. Keeping the text in one pure
 * function makes it testable and keeps the wording consistent with the sign-in
 * screen (the student tab, then the forced password change).
 */

/** Used when the app is opened from localhost, where students cannot reach it. */
const FALLBACK_SITE_URL = 'https://pwciselfassessment.vercel.app'

export interface CredentialDetails {
  fullName: string
  username: string
  password: string
}

export interface CredentialMessage {
  subject: string
  body: string
}

/**
 * The public address students should open. `VITE_PUBLIC_SITE_URL` wins, then
 * the current origin, except on localhost where the hosted site is used.
 */
export function publicSiteUrl(
  origin: string | undefined = typeof window === 'undefined'
    ? undefined
    : window.location.origin,
): string {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim().replace(/\/+$/, '')
  }
  if (!origin) return FALLBACK_SITE_URL
  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return FALLBACK_SITE_URL
    }
    return url.origin
  } catch {
    return FALLBACK_SITE_URL
  }
}

export function buildCredentialMessage(
  details: CredentialDetails,
  siteUrl: string = publicSiteUrl(),
): CredentialMessage {
  const site = siteUrl.replace(/\/+$/, '')
  const subject = 'Your PWCI Self Assessment sign-in details'

  const body = [
    `Hi ${details.fullName},`,
    '',
    'Your PWCI Self Assessment account is ready. Here is how to sign in.',
    '',
    `Website: ${site}`,
    `Username: ${details.username}`,
    `Temporary password: ${details.password}`,
    '',
    'Steps:',
    `1. Open ${site} in your browser.`,
    '2. Choose "Student" on the sign-in screen.',
    '3. Enter your username and the temporary password above.',
    '4. You will be asked to choose a new password. Pick one you will remember.',
    '',
    'The temporary password stops working once you set your own, so please keep',
    'this message private. If you lose it, ask your administrator for a reset.',
    '',
    '— PWCI Self Assessment',
  ].join('\n')

  return { subject, body }
}

/** A mailto: link with the message prefilled, ready for the admin's mail app. */
export function buildMailtoUrl(message: CredentialMessage, to: string): string {
  const query = [
    `subject=${encodeURIComponent(message.subject)}`,
    `body=${encodeURIComponent(message.body)}`,
  ].join('&')
  return `mailto:${to.trim()}?${query}`
}

/**
 * Students created without an email get an internal placeholder address
 * (`username@students.example.com`) that must not be mailed.
 */
export function isInternalStudentEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.trim().toLowerCase().endsWith('@students.example.com')
}
