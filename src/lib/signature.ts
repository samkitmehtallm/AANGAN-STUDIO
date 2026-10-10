import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC-SHA256 verification for the Vaani webhook.
 *
 * Vaani signs the raw request body with the shared secret and sends the hex
 * digest in a header. We must verify against the RAW body text, not a
 * re-serialised object: JSON.stringify(JSON.parse(body)) is not byte-identical
 * to body, and that difference is enough to fail every signature.
 */
export const SIGNATURE_HEADERS = [
  'x-vaani-signature',
  'x-signature',
  'x-hub-signature-256',
] as const

export function computeSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/** Strips the "sha256=" prefix some senders use. Case-insensitive hex. */
function normalizeSignature(header: string): string {
  return header.trim().replace(/^sha256=/i, '').toLowerCase()
}

export function verifySignature(
  rawBody: string,
  headerValue: string | null | undefined,
  secret: string | undefined
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'no_secret_configured' }
  if (!headerValue) return { valid: false, reason: 'no_signature_header' }

  const provided = normalizeSignature(headerValue)
  const expected = computeSignature(rawBody, secret)

  // timingSafeEqual throws on length mismatch, so check length first - but
  // compare the full buffers once lengths agree, never a short-circuiting ===.
  if (provided.length !== expected.length) {
    return { valid: false, reason: 'signature_mismatch' }
  }
  const ok = timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
  return ok ? { valid: true } : { valid: false, reason: 'signature_mismatch' }
}

/** Pulls the signature out of whichever header Vaani happens to use. */
export function readSignatureHeader(headers: Headers): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name)
    if (value) return value
  }
  return null
}
