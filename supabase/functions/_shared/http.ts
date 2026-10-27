// Shared HTTP helpers for Meridian Edge Functions.

export function corsHeaders(req: Request): Record<string, string> {
  const configured = Deno.env.get('ALLOWED_ORIGIN')?.trim()
  const origin = req.headers.get('origin')
  const allowOrigin = configured
    ? configured === origin
      ? configured
      : configured
    : '*'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, x-application-name, x-supabase-api-version, apikey, content-type, x-webhook-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
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
