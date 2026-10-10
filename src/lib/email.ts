/**
 * Email transport (Resend).
 *
 * Built lazily and tolerantly. With no RESEND_API_KEY the app runs in dry-run:
 * it renders the exact message, records that the handoff happened, and sends
 * nothing. That is the right default for a system whose first rule is that the
 * lead exists even when the notification channel does not.
 *
 * send() never throws. A dead mail provider must not take the webhook down
 * with it - the row is already written by the time we get here.
 */
export interface SendResult {
  ok: boolean
  dryRun: boolean
  id?: string
  error?: string
  to: string[]
  subject: string
}

export interface SendArgs {
  to: string | string[]
  subject: string
  html: string
  text: string
  replyTo?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim() !== '')
}

export function recipients(name: 'HANDOFF_TO' | 'ESCALATION_TO' | 'FOUNDER_TO'): string[] {
  const raw = process.env[name] ?? ''
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const to = (Array.isArray(args.to) ? args.to : [args.to]).filter((t) => t && t.trim() !== '')
  const base = { to, subject: args.subject }

  if (to.length === 0) {
    return { ...base, ok: false, dryRun: true, error: 'no_recipients_configured' }
  }
  if (!emailConfigured()) {
    // Dry-run. Log the whole thing so it is provable from the Vercel logs that
    // the right card would have gone to the right people.
    console.info('[email:dry-run]', JSON.stringify({
      to, subject: args.subject, text: args.text,
    }))
    return { ...base, ok: true, dryRun: true }
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Aangan Enquiries <onboarding@resend.dev>',
        to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error('[email:failed]', response.status, body.slice(0, 500))
      return { ...base, ok: false, dryRun: false, error: `http_${response.status}` }
    }
    const json = (await response.json().catch(() => ({}))) as { id?: string }
    return { ...base, ok: true, dryRun: false, id: json.id }
  } catch (error) {
    // Never rethrow. The lead is already safe in Postgres.
    console.error('[email:error]', error)
    return {
      ...base, ok: false, dryRun: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    }
  }
}
