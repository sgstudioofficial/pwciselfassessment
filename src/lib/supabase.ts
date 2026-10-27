import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/**
 * False when the project has not been connected to a Supabase project yet.
 * The app shows setup instructions instead of failing with a blank screen.
 */
export const isSupabaseConfigured = Boolean(
  url &&
    anonKey &&
    /^https?:\/\//.test(url) &&
    !url.includes('your-project') &&
    !anonKey.includes('your-anon'),
)

export const supabase = createClient(
  isSupabaseConfigured ? url! : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? anonKey! : 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: { 'x-application-name': 'pwci-self-assessment-tool' },
    },
  },
)

export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl
}

type EdgeError = {
  context?: Response
  message?: string
}

/**
 * Invoke an Edge Function and surface the server's JSON error message rather
 * than the generic "non-2xx status code" from supabase-js.
 */
export async function invokeEdge<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    const edgeError = error as EdgeError
    let message = edgeError.message ?? 'The request failed.'
    if (edgeError.context instanceof Response) {
      try {
        const payload = (await edgeError.context.clone().json()) as {
          error?: string
        }
        if (payload.error) message = payload.error
      } catch {
        // Response body was not JSON; keep the original message.
      }
    }
    throw new Error(message)
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }

  return data as T
}
