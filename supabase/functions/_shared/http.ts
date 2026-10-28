// Shared HTTP helpers for Meridian Edge Functions.

/**
 * `ALLOWED_ORIGIN` accepts a comma-separated list so a deployed site and the
 * local dev server can both call the functions:
 *
 *   ALLOWED_ORIGIN="https://assessments.example.com,http://localhost:5173"
 *
 * Unset (or `*`) allows every origin. When the list is set and the request
 * origin is not on it, no `Access-Control-Allow-Origin` header is returned, so
 * the browser blocks the call instead of silently receiving a wrong origin.
 */
function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGIN') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

function normalizeOrigin(value: string | null): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function corsHeaders(req: Request): Record<string, string> {
  const configured = allowedOrigins()
  const origin = normalizeOrigin(req.headers.get('origin'))

  let allowOrigin: string | null
  if (configured.length === 0 || configured.includes('*')) {
    allowOrigin = '*'
  } else {
    allowOrigin = configured.includes(origin) ? origin : null
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, x-application-name, x-supabase-api-version, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin
  return headers
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export function errorResponse(
  req: Request,
  message: string,
  status = 400,
  code?: string,
): Response {
  return jsonResponse(req, { error: message, code }, status)
}

export function preflight(req: Request): Response {
  // A 204 response must not carry a body; passing one throws in the Deno runtime.
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}
