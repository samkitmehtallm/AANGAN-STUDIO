import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Lazy Supabase client.
 *
 * Next's build step imports every route module to collect page data. A client
 * constructed at module scope would read process.env during `next build`, so a
 * missing variable would fail the BUILD rather than a single request. Build
 * failures are loud and total; a request-time failure is one 500 while the rest
 * of the app keeps serving. We want the second one.
 *
 * Nothing here runs until a request handler actually calls getSupabase().
 */
let cached: SupabaseClient | null = null

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`)
    this.name = 'MissingEnvError'
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') throw new MissingEnvError(name)
  return value
}

export function getSupabase(): SupabaseClient {
  if (cached) return cached
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'aangan-enquiry-system' } },
  })
  return cached
}

/** Test seam. Never called in production code paths. */
export function __resetSupabaseForTests(): void {
  cached = null
}
