import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyLinkToken } from '@/lib/tokens'
import { claimLead, passLead, acknowledgeLead } from '@/lib/claim'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/claim/<signed token>
 *
 * Email cannot POST, so the Claim and Can't-take-it buttons are signed links.
 * The signature is the authorisation: a forwarded email cannot be used to
 * claim a lead as someone else, because the designer's identity is inside the
 * signed payload.
 *
 * The response is an HTML page rather than JSON - a designer tapping a button
 * in their mail client should land on something readable, including when they
 * lost the race.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await context.params
  const verified = verifyLinkToken(token)

  if (!verified) {
    return page(
      'Link not valid',
      'This claim link could not be verified. It may have been altered, or the ' +
      'signing secret may have been rotated. Open the dashboard and claim the lead there.',
      400
    )
  }

  const supabase = getSupabase()

  if (verified.action === 'pass') {
    const result = await passLead(supabase, verified.leadId, verified.designer)
    return result.ok
      ? page('Noted', 'You have been recorded as unavailable for this enquiry. It stays in the unclaimed queue for someone else.')
      : page('Could not record that', result.reason ?? 'Unknown error', 500)
  }

  if (verified.action === 'ack') {
    const ack = await acknowledgeLead(supabase, verified.leadId, verified.designer)
    if (ack.ok) {
      return page(
        'Noted — you are calling',
        'This escalation is marked as being handled, so it will stop chasing. ' +
        'Open the record for the number.',
        200, ack.leadId
      )
    }
    if (ack.reason === 'already_claimed') {
      return page('Already being handled',
        `${ack.claimedBy ?? 'Someone'} picked this up first.`, 200, ack.leadId)
    }
    return page('Could not record that', ack.reason ?? 'Unknown error', 500)
  }

  const result = await claimLead(supabase, verified.leadId, verified.designer)

  if (result.ok) {
    return page(
      'Claimed',
      `This enquiry is yours. Open the record for the callback number and call them now — ` +
      `an enquiry answered within the hour converts at about four times the rate of one answered the next day.`,
      200,
      result.leadId
    )
  }

  if (result.reason === 'already_claimed') {
    return page(
      'Already taken',
      `${result.claimedBy ?? 'Another designer'} claimed this one first. Nothing for you to do here.`,
      200,
      result.leadId
    )
  }

  return page('Could not claim', result.reason ?? 'Unknown error', 500)
}

function page(title: string, body: string, status = 200, leadId?: string): Response {
  const link = leadId
    ? `<p style="margin-top:22px"><a href="/dashboard/leads/${leadId}" style="color:#1d4ed8;font-weight:550;text-decoration:none">Open the record →</a></p>`
    : `<p style="margin-top:22px"><a href="/dashboard" style="color:#1d4ed8;font-weight:550;text-decoration:none">Open the dashboard →</a></p>`
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title} — Aangan Studio</title></head>
     <body style="margin:0;padding:48px 24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
       <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:30px">
         <h1 style="margin:0 0 10px;font-size:21px;color:#111827">${title}</h1>
         <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563">${body}</p>
         ${link}
       </div>
     </body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}
