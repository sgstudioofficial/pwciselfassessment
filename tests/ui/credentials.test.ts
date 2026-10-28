import { describe, expect, it } from 'vitest'
import {
  buildCredentialMessage,
  buildMailtoUrl,
  isInternalStudentEmail,
  publicSiteUrl,
} from '../../src/lib/credentials'

const details = {
  fullName: 'Amina Yusuf',
  username: 'ayusuf',
  password: 'Temp!Pass123',
}

describe('credential message', () => {
  it('includes the credentials, the site and the sign-in steps', () => {
    const message = buildCredentialMessage(details, 'https://pwci.example.org/')

    expect(message.subject).toMatch(/sign-in details/i)
    expect(message.body).toContain('Hi Amina Yusuf,')
    expect(message.body).toContain('Username: ayusuf')
    expect(message.body).toContain('Temporary password: Temp!Pass123')
    expect(message.body).toContain('Website: https://pwci.example.org')
    expect(message.body).toContain('1. Open https://pwci.example.org in your browser.')
    expect(message.body).toContain('2. Choose "Student" on the sign-in screen.')
    expect(message.body).toContain('3. Enter your username and the temporary password')
    expect(message.body).toContain('4. You will be asked to choose a new password.')
  })

  it('builds a mailto link with an encoded body', () => {
    const message = buildCredentialMessage(details, 'https://pwci.example.org')
    const url = buildMailtoUrl(message, 'amina@example.com')

    expect(url.startsWith('mailto:amina@example.com?subject=')).toBe(true)
    expect(url).toContain('&body=')
    expect(url).toContain(encodeURIComponent('Username: ayusuf'))
    expect(url).toContain('%0A')
    expect(url).toContain(encodeURIComponent('Choose "Student"'))
  })

  it('uses the hosted site when opened from localhost', () => {
    expect(publicSiteUrl('http://localhost:5173')).toBe(
      'https://pwciselfassessment.vercel.app',
    )
    expect(publicSiteUrl('http://127.0.0.1:5173')).toBe(
      'https://pwciselfassessment.vercel.app',
    )
    expect(publicSiteUrl('https://pwciselfassessment.vercel.app')).toBe(
      'https://pwciselfassessment.vercel.app',
    )
  })

  it('recognises the internal student address', () => {
    expect(isInternalStudentEmail('ayusuf@students.example.com')).toBe(true)
    expect(isInternalStudentEmail('AYUSUF@STUDENTS.EXAMPLE.COM')).toBe(true)
    expect(isInternalStudentEmail('amina@example.com')).toBe(false)
    expect(isInternalStudentEmail(null)).toBe(false)
  })
})
