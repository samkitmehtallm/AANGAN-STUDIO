/**
 * Turning a written lead into messages.
 *
 * Everything in here runs AFTER the row exists (rule 1). Every function
 * swallows its own failures: a mail outage must never propagate back into the
 * webhook and turn a saved lead into a 500 that Vaani will retry.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderHandoffCard, type CardLead } from './handoff-card'
import { sendEmail, recipients } from './email'
import { signLinkToken } from './tokens'
import { claimAlert, type AlertKind } from './alerts'
import { routeLead, type RoutingDecision } from './routing'
import { formatLocal } from './office-hours'

export function baseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  ).replace(/\/$/, '')
}

function claimLinks(leadId: string): { claimUrl: string; passUrl: string } | null {
  try {
    const base = baseUrl()
    return {
      claimUrl: `${base}/api/claim/${signLinkToken('claim', leadId, 'designer')}`,
      passUrl: `${base}/api/claim/${signLinkToken('pass', leadId, 'designer')}`,
    }
  } catch (error) {
    // CLAIM_LINK_SECRET is missing. Send the card without buttons rather than
    // not sending it at all - the Open record link still works.
    console.error('[notify:claim-links]', error)
    return null
  }
}

export interface NotifyResult {
  routed: RoutingDecision
  handoffSent: boolean
  escalationSent: boolean
  pricingAlertSent: boolean
  duplicateSuppressed: boolean
  errors: string[]
}

export async function notifyForLead(
  supabase: SupabaseClient, lead: CardLead & { result: string; service_area: CardLead['service_area'] }
): Promise<NotifyResult> {
  const routed = routeLead(lead)
  const result: NotifyResult = {
    routed, handoffSent: false, escalationSent: false,
    pricingAlertSent: false, duplicateSuppressed: false, errors: [],
  }

  /* --- the pricing incident, independent of routing (rule 5) ------- */
  if (routed.pricingIncident) {
    try {
      if (await claimAlert(supabase, lead.lead_id, 'pricing_leak', { result: lead.result })) {
        const card = renderHandoffCard(lead, { baseUrl: baseUrl(), kind: 'handoff' })
        const sent = await sendEmail({
          to: recipients('FOUNDER_TO'),
          subject: `PRICING LEAK — the agent revealed a price to ${lead.name ?? 'a caller'}`,
          text:
            `The voice agent revealed a price on a call. This is an incident, not a metric.\n\n` +
            `Caller asked about price ${lead.pricing_asked_count ?? 0} time(s).\n` +
            `Call received ${formatLocal(new Date(lead.received_at))}.\n\n` +
            card.text,
          html: card.html,
        })
        result.pricingAlertSent = sent.ok
        if (!sent.ok && sent.error) result.errors.push(`pricing_alert:${sent.error}`)
      } else {
        result.duplicateSuppressed = true
      }
    } catch (error) {
      result.errors.push(`pricing_alert:${String(error)}`)
    }
  }

  /* --- the handoff ------------------------------------------------- */
  try {
    if (routed.destination === 'designers') {
      if (await claimAlert(supabase, lead.lead_id, 'handoff', { reason: routed.reason })) {
        const links = routed.claimable ? claimLinks(lead.lead_id) : null
        const card = renderHandoffCard(lead, {
          baseUrl: baseUrl(), kind: 'handoff',
          claimUrl: links?.claimUrl, passUrl: links?.passUrl,
        })
        const sent = await sendEmail({
          to: recipients('HANDOFF_TO'),
          subject: card.subject, html: card.html, text: card.text,
        })
        result.handoffSent = sent.ok
        if (!sent.ok && sent.error) result.errors.push(`handoff:${sent.error}`)
        await stampHandoff(supabase, lead.lead_id)
      } else {
        result.duplicateSuppressed = true
      }
    } else if (routed.destination === 'escalation') {
      const kind: AlertKind = 'escalation'
      if (await claimAlert(supabase, lead.lead_id, kind, { reason: routed.reason })) {
        // No claim link. Nobody claims a problem call; a human reads it.
        const card = renderHandoffCard(lead, { baseUrl: baseUrl(), kind: 'escalation' })
        const sent = await sendEmail({
          to: recipients('ESCALATION_TO'),
          subject: card.subject, html: card.html, text: card.text,
        })
        result.escalationSent = sent.ok
        if (!sent.ok && sent.error) result.errors.push(`escalation:${sent.error}`)
        await stampHandoff(supabase, lead.lead_id)
      } else {
        result.duplicateSuppressed = true
      }
    }
  } catch (error) {
    result.errors.push(`handoff:${String(error)}`)
  }

  return result
}

async function stampHandoff(supabase: SupabaseClient, leadId: string): Promise<void> {
  // Only stamp the first time, so the 30-minute sweep measures age from the
  // original handoff rather than from the most recent repost.
  const { error } = await supabase
    .from('leads')
    .update({ handoff_sent_at: new Date().toISOString() })
    .eq('lead_id', leadId)
    .is('handoff_sent_at', null)
  if (error) console.error('[notify:stamp-handoff]', error.message)
}
