// =============================================================================
// student-login
// Converts a student's username into their Auth email server-side, then signs
// in with the public anon key. The service-role key never leaves this function.
//
// Deploy with JWT verification disabled: supabase functions deploy student-login --no-verify-jwt
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  errorResponse,
  jsonResponse,
  preflight,
} from '../_shared/http.ts'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/
const GENERIC_ERROR = 'Incorrect username or password.'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error('student-login: missing Supabase environment variables')
    return errorResponse(req, 'Sign-in is not configured.', 500)
  }

  let body: { username?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorResponse(req, 'Invalid request body.', 400)
  }

  const username =
    typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!USERNAME_PATTERN.test(username) || password.length < 1 || password.length > 200) {
    await delay(200)
    return errorResponse(req, GENERIC_ERROR, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('username', username)
    .maybeSingle()

  if (profileError) {
    console.error('student-login: profile lookup failed', profileError.message)
    return errorResponse(req, 'Sign-in is temporarily unavailable.', 500)
  }

  if (!profile || profile.role !== 'student') {
    await delay(200)
    return errorResponse(req, GENERIC_ERROR, 401)
  }

  if (!profile.is_active) {
    return errorResponse(
      req,
      'This account is deactivated. Please contact your administrator.',
      403,
    )
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  })

  if (error || !data.session) {
    await delay(200)
    return errorResponse(req, GENERIC_ERROR, 401)
  }

  return jsonResponse(req, { session: data.session })
})
