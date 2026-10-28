// =============================================================================
// admin-students
// Privileged student account operations. Requires a signed-in admin and the
// service-role key, which lives only in this function's environment.
//
// Actions: create_student | reset_password | set_status
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  errorResponse,
  jsonResponse,
  preflight,
} from '../_shared/http.ts'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/
// Mirrors isValidEmail() in src/lib/email.ts. GoTrue rejects consecutive dots,
// trailing dots and hyphen-leading domain labels, so catch them before the call.
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function randomFrom(charset: string): string {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return charset[value[0] % charset.length]
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*-_'
  const all = upper + lower + digits + symbols
  const chars = [
    randomFrom(upper),
    randomFrom(lower),
    randomFrom(digits),
    randomFrom(symbols),
  ]
  while (chars.length < 16) chars.push(randomFrom(all))

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    const j = value[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function studentEmailDomain(): string | null {
  const domain = (Deno.env.get('STUDENT_EMAIL_DOMAIN') ?? 'students.example.com')
    .trim()
    .toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('admin-students: missing Supabase environment variables')
    return errorResponse(req, 'Server is not configured.', 500)
  }

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return errorResponse(req, 'Authentication required.', 401)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) {
    return errorResponse(req, 'Authentication required.', 401)
  }

  const { data: caller, error: callerError } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (callerError) {
    console.error('admin-students: caller lookup failed', callerError.message)
    return errorResponse(req, 'Authorization check failed.', 500)
  }
  if (!caller || caller.role !== 'admin' || !caller.is_active) {
    return errorResponse(req, 'Administrator access required.', 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse(req, 'Invalid request body.', 400)
  }

  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'create_student') {
    const username =
      typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    const fullName =
      typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const department = optionalText(body.department, 80)
    const batch = optionalText(body.batch, 80)
    const requestedPassword =
      typeof body.password === 'string' && body.password.length > 0
        ? body.password
        : null
    const inputEmail =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const domain = studentEmailDomain()

    if (!USERNAME_PATTERN.test(username)) {
      return errorResponse(
        req,
        'Username must be 3–32 characters: lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.',
        422,
      )
    }
    if (fullName.length < 1 || fullName.length > 120) {
      return errorResponse(req, 'Full name is required (maximum 120 characters).', 422)
    }
    if (requestedPassword && (requestedPassword.length < 10 || requestedPassword.length > 72)) {
      return errorResponse(req, 'Temporary password must be 10–72 characters.', 422)
    }
    if (inputEmail && !EMAIL_PATTERN.test(inputEmail)) {
      return errorResponse(req, 'Enter a valid email address.', 422)
    }
    if (!inputEmail && !domain) {
      return errorResponse(req, 'Student email domain is misconfigured.', 500)
    }

    const email = inputEmail || `${username}@${domain}`

    const { data: existingUsername } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()
    if (existingUsername) {
      return errorResponse(req, 'That username is already taken.', 409)
    }

    const temporaryPassword = requestedPassword ?? generatePassword()

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { username, full_name: fullName },
    })

    if (createError || !created.user) {
      const message = createError?.message ?? 'Could not create the account.'
      if (/already|exists|duplicate/i.test(message)) {
        return errorResponse(
          req,
          'An account with that username or email already exists.',
          409,
        )
      }
      if (/unable to validate email/i.test(message)) {
        return errorResponse(req, 'Enter a valid email address.', 422)
      }
      if (/password/i.test(message)) {
        return errorResponse(
          req,
          'Supabase rejected that password. Choose a different one, or leave the field blank to generate one.',
          422,
        )
      }
      console.error('admin-students: createUser failed', email, message)
      return errorResponse(req, 'Could not create the account.', 500)
    }

    const { error: profileError } = await admin
      .from('profiles')
      .update({
        username,
        full_name: fullName,
        email,
        department: department ?? null,
        batch: batch ?? null,
        role: 'student',
        is_active: true,
        must_change_password: true,
      })
      .eq('id', created.user.id)

    if (profileError) {
      console.error('admin-students: profile update failed', profileError.message)
      await admin.auth.admin.deleteUser(created.user.id)
      if (/duplicate|unique/i.test(profileError.message)) {
        return errorResponse(req, 'That username is already taken.', 409)
      }
      return errorResponse(req, 'Could not finish creating the account.', 500)
    }

    return jsonResponse(
      req,
      {
        student: {
          id: created.user.id,
          username,
          full_name: fullName,
          email,
          department: department ?? null,
          batch: batch ?? null,
          is_active: true,
        },
        temporary_password: temporaryPassword,
      },
      201,
    )
  }

  if (action === 'reset_password') {
    const studentId = typeof body.student_id === 'string' ? body.student_id : ''
    if (!UUID_PATTERN.test(studentId)) {
      return errorResponse(req, 'Invalid student.', 422)
    }

    const { data: student } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', studentId)
      .maybeSingle()
    if (!student || student.role !== 'student') {
      return errorResponse(req, 'Student not found.', 404)
    }

    const requestedPassword =
      typeof body.password === 'string' && body.password.length > 0
        ? body.password
        : null
    if (requestedPassword && (requestedPassword.length < 10 || requestedPassword.length > 72)) {
      return errorResponse(req, 'Temporary password must be 10–72 characters.', 422)
    }

    const temporaryPassword = requestedPassword ?? generatePassword()
    const { error: updateError } = await admin.auth.admin.updateUserById(studentId, {
      password: temporaryPassword,
    })
    if (updateError) {
      console.error('admin-students: password update failed', updateError.message)
      return errorResponse(req, 'Could not reset the password.', 500)
    }

    await admin
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', studentId)

    return jsonResponse(req, {
      temporary_password: temporaryPassword,
      must_change_password: true,
    })
  }

  if (action === 'set_status') {
    const studentId = typeof body.student_id === 'string' ? body.student_id : ''
    const isActive = body.is_active
    if (!UUID_PATTERN.test(studentId) || typeof isActive !== 'boolean') {
      return errorResponse(req, 'Invalid student status request.', 422)
    }

    const { data: student } = await admin
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', studentId)
      .maybeSingle()
    if (!student || student.role !== 'student') {
      return errorResponse(req, 'Student not found.', 404)
    }

    // Banning invalidates refresh tokens; RLS and the API additionally check
    // is_active, so an existing short-lived access token cannot read new data
    // after the profile flag is cleared.
    const { error: banError } = await admin.auth.admin.updateUserById(studentId, {
      ban_duration: isActive ? 'none' : '876000h',
    })
    if (banError) {
      console.error('admin-students: status update failed', banError.message)
      return errorResponse(req, 'Could not update the account status.', 500)
    }

    const { error: profileError } = await admin
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', studentId)
    if (profileError) {
      console.error('admin-students: profile status update failed', profileError.message)
      return errorResponse(req, 'Could not update the account status.', 500)
    }

    return jsonResponse(req, { student_id: studentId, is_active: isActive })
  }

  if (action === 'delete_student') {
    const studentId = typeof body.student_id === 'string' ? body.student_id : ''
    if (!UUID_PATTERN.test(studentId)) {
      return errorResponse(req, 'Invalid student.', 422)
    }

    const { data: student } = await admin
      .from('profiles')
      .select('id, role, full_name, username')
      .eq('id', studentId)
      .maybeSingle()
    if (!student || student.role !== 'student') {
      return errorResponse(req, 'Student not found.', 404)
    }

    // Deleting the Auth user cascades to the profile and from there to
    // assignments, attempts and responses. This is intentionally permanent.
    const { error: deleteError } = await admin.auth.admin.deleteUser(studentId)
    if (deleteError) {
      console.error('admin-students: delete user failed', deleteError.message)
      return errorResponse(req, 'Could not delete the account.', 500)
    }

    return jsonResponse(req, {
      deleted: true,
      student_id: studentId,
      username: student.username,
    })
  }

  return errorResponse(req, 'Unknown action.', 400)
})
