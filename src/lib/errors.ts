type UnknownError = {
  message?: string
  details?: string
  hint?: string
  code?: string
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return friendly(error.message)
  if (error && typeof error === 'object') {
    const candidate = error as UnknownError
    if (candidate.message) return friendly(candidate.message)
    if (candidate.details) return friendly(candidate.details)
  }
  if (typeof error === 'string') return friendly(error)
  return 'Something went wrong. Please try again.'
}

function friendly(message: string): string {
  const normalized = message.trim()
  const mappings: { pattern: RegExp; replacement: string }[] = [
    {
      pattern: /invalid login credentials/i,
      replacement: 'Incorrect email or password.',
    },
    {
      pattern: /email not confirmed/i,
      replacement: 'This account has not been confirmed yet.',
    },
    {
      pattern: /user is banned/i,
      replacement: 'This account is deactivated. Contact your administrator.',
    },
    {
      pattern: /jwt expired|invalid jwt/i,
      replacement: 'Your session has expired. Please sign in again.',
    },
    {
      pattern: /duplicate key value.*profiles_username/i,
      replacement: 'That username is already taken.',
    },
    {
      pattern: /duplicate key value/i,
      replacement: 'That value already exists.',
    },
    {
      pattern: /row-level security|permission denied for table/i,
      replacement: 'You do not have permission to do that.',
    },
    {
      pattern: /new row violates check constraint/i,
      replacement: 'The data did not pass validation. Check the fields and try again.',
    },
    {
      pattern: /failed to fetch|networkerror|load failed/i,
      replacement:
        'Could not reach the server. Check your connection and try again.',
    },
  ]

  for (const mapping of mappings) {
    if (mapping.pattern.test(normalized)) return mapping.replacement
  }
  return normalized.replace(/^error:\s*/i, '')
}
