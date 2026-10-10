import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed one-click links for the handoff email.
 *
 * Email cannot POST, so Claim and Can't-take-it are links. A bare
 * /api/claim?lead=<uuid>&designer=<name> link would let anyone who forwards
 * the email claim a lead as anyone. So each link carries an HMAC over the
 * action, the lead and the designer, and the route refuses anything it did
 * not sign itself.
 *
 * Tokens do not expire: a handoff email can legitimately be acted on hours
 * later, and an expired claim link would mean a lead nobody can pick up.
 * Rotating CLAIM_LINK_SECRET invalidates every outstanding link at once.
 */
/**
 * 'ack' is the escalation's "I'm calling now". It is not a claim - nobody
 * claims a problem call - but it stops the 15-minute watchdog, because the
 * thing the watchdog is watching for is nobody picking it up.
 */
export type LinkAction = 'claim' | 'pass' | 'ack'

function secret(): string {
  const s = process.env.CLAIM_LINK_SECRET
  if (!s || s.trim() === '') {
    throw new Error('Missing required environment variable: CLAIM_LINK_SECRET')
  }
  return s
}

function payloadOf(action: LinkAction, leadId: string, designer: string): string {
  return `${action}:${leadId}:${designer}`
}

export function signLinkToken(
  action: LinkAction, leadId: string, designer: string, key = secret()
): string {
  const mac = createHmac('sha256', key)
    .update(payloadOf(action, leadId, designer), 'utf8')
    .digest('base64url')
  // The payload travels with the signature so the route needs no lookup table.
  return `${Buffer.from(payloadOf(action, leadId, designer), 'utf8').toString('base64url')}.${mac}`
}

export interface VerifiedToken {
  action: LinkAction
  leadId: string
  designer: string
}

export function verifyLinkToken(token: string | null | undefined, key = secret()): VerifiedToken | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, mac] = parts

  let decoded: string
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const segments = decoded.split(':')
  if (segments.length < 3) return null
  const action = segments[0]
  const leadId = segments[1]
  const designer = segments.slice(2).join(':')
  if (action !== 'claim' && action !== 'pass' && action !== 'ack') return null

  const expected = createHmac('sha256', key).update(decoded, 'utf8').digest('base64url')
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null

  return { action, leadId, designer }
}
