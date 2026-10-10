import { timingSafeEqual } from 'node:crypto'

/**
 * Bearer-token auth for the scheduled endpoints.
 *
 * On Vercel Hobby only daily cron is allowed, so the 30-minute sweep is driven
 * by an external scheduler hitting this URL. That makes the URL public, and a
 * public URL that can send email to the whole studio needs a door on it.
 *
 * Vercel's own cron invocations carry the same CRON_SECRET as a bearer token,
 * so one check covers both callers.
 */
export function authorizeCron(request: Request): { ok: boolean; reason?: string } {
  const expected = process.env.CRON_SECRET
  if (!expected || expected.trim() === '') {
    // Refuse rather than run open. An unauthenticated sweep is a free email
    // cannon pointed at the studio.
    return { ok: false, reason: 'cron_secret_not_configured' }
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.replace(/^Bearer\s+/i, '').trim()
  if (provided === '') return { ok: false, reason: 'missing_bearer_token' }
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_token' }

  const match = timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  return match ? { ok: true } : { ok: false, reason: 'bad_token' }
}
