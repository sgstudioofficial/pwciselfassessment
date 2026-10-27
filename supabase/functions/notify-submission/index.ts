// =============================================================================
// notify-submission
// Secure extension point for submission notifications.
//
// This function is called by a Supabase Database Webhook on public.attempts
// (UPDATE, when submitted_at becomes non-null) or by any trusted server.
// It authenticates the caller with a shared secret, loads the attempt using the
// service role, and logs a normalized notification payload.
//
// The final delivery step is intentionally left as an explicit integration
// point (for example a transactional email provider). Wire it in one place in
// `deliverNotification` so no provider credentials ever reach the browser.
//
// Required secrets:
//   NOTIFY_WEBHOOK_SECRET   random 32+ character string
//   SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (provided by Supabase)
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  errorResponse,
  jsonResponse,
  preflight,
} from '../_shared/http.ts'

type NotificationPayload = {
  event: 'attempt_submitted'
  attempt_id: string
  test_title: string
  student_name: string
  submitted_at: string
  score: number | null
  max_marks: number
  pending_manual: number
}

async function deliverNotification(
  payload: NotificationPayload,
): Promise<void> {
  // Integration point. Add a transactional email provider here and send the
  // payload to the administrator address stored in Edge Function secrets.
  // Never send student answers or answer keys in an email.
  console.log('submission-notification', JSON.stringify(payload))
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') {
    return errorResponse(req, 'Method not allowed.', 405)
  }

  const expectedSecret = Deno.env.get('NOTIFY_WEBHOOK_SECRET')
  const suppliedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || expectedSecret.length < 24) {
    console.error('notify-submission: NOTIFY_WEBHOOK_SECRET is missing or too weak')
    return errorResponse(req, 'Webhook is not configured.', 500)
  }
  if (!suppliedSecret || suppliedSecret !== expectedSecret) {
    return errorResponse(req, 'Unauthorized webhook call.', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(req, 'Server is not configured.', 500)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse(req, 'Invalid request body.', 400)
  }

  const record = body.record as Record<string, unknown> | undefined
  const attemptId =
    typeof body.attempt_id === 'string'
      ? body.attempt_id
      : typeof record?.id === 'string'
        ? record.id
        : ''

  if (!attemptId) {
    return errorResponse(req, 'Missing attempt id.', 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: attempt, error } = await admin
    .from('attempts')
    .select('id, status, submitted_at, score, max_marks, student_id, test_id')
    .eq('id', attemptId)
    .maybeSingle()

  if (error) {
    console.error('notify-submission: attempt lookup failed', error.message)
    return errorResponse(req, 'Lookup failed.', 500)
  }
  if (!attempt) return errorResponse(req, 'Attempt not found.', 404)
  if (!attempt.submitted_at || attempt.status === 'in_progress') {
    return jsonResponse(req, { ok: true, skipped: 'not_submitted' })
  }

  const [{ data: profile }, { data: test }, { count: pending }] = await Promise.all([
    admin
      .from('profiles')
      .select('full_name')
      .eq('id', attempt.student_id)
      .maybeSingle(),
    admin
      .from('tests')
      .select('title')
      .eq('id', attempt.test_id)
      .maybeSingle(),
    admin
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('attempt_id', attempt.id)
      .is('awarded_marks', null),
  ])

  const payload: NotificationPayload = {
    event: 'attempt_submitted',
    attempt_id: attempt.id,
    test_title: test?.title ?? 'Assessment',
    student_name: profile?.full_name ?? 'A student',
    submitted_at: attempt.submitted_at,
    score: attempt.score,
    max_marks: Number(attempt.max_marks),
    pending_manual: pending ?? 0,
  }

  await deliverNotification(payload)

  return jsonResponse(req, { ok: true })
})
