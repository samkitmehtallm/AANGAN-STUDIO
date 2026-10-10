import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Alert de-duplication.
 *
 * alert_log exists so no alert fires twice. The unique index on
 * (lead_id, kind) makes the database the arbiter rather than application
 * memory: two concurrent sweeps both try to insert, one gets a 23505, and
 * exactly one email goes out.
 *
 * Reposts are the deliberate exception. An unclaimed lead should nag more than
 * once, so its kind carries the repost number.
 */
export type AlertKind =
  | 'handoff'
  | 'escalation'
  | 'pricing_leak'
  | 'escalation_unacked'
  | 'slow_response'
  | `unclaimed_repost_${number}`

const UNIQUE_VIOLATION = '23505'

/**
 * Claims the right to send one alert. Returns false when someone already has.
 * Writing the log BEFORE sending is deliberate: a duplicate notification is a
 * nuisance, a missed one is a lost lead, and we would rather the log say we
 * sent something we did not than let two sweeps both send.
 */
export async function claimAlert(
  supabase: SupabaseClient,
  leadId: string | null,
  kind: AlertKind,
  detail: Record<string, unknown> = {}
): Promise<boolean> {
  const { error } = await supabase
    .from('alert_log')
    .insert({ lead_id: leadId, kind, detail })

  if (!error) return true
  if (error.code === UNIQUE_VIOLATION) return false

  // Any other failure: log it and allow the send. A duplicate email beats
  // silence when the alert is "a designer revealed a price".
  console.error('[alerts:claim-failed]', kind, leadId, error.message)
  return true
}

export async function alreadySent(
  supabase: SupabaseClient, leadId: string, kind: AlertKind
): Promise<boolean> {
  const { data, error } = await supabase
    .from('alert_log').select('id').eq('lead_id', leadId).eq('kind', kind).limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

export async function recordAlertOutcome(
  supabase: SupabaseClient, leadId: string | null, kind: AlertKind,
  detail: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('alert_log').update({ detail }).eq('lead_id', leadId).eq('kind', kind)
  if (error) console.error('[alerts:outcome-failed]', kind, error.message)
}
