import { getSupabase } from './supabase'
import type { LeadRow } from './metrics'

/**
 * Reads for the dashboard.
 *
 * All of these run on the server with the service-role key. The anon key is
 * never used and the leads table has no RLS policies, so a phone number cannot
 * be fetched from a browser even by someone who knows the project URL.
 */

export const LIST_COLUMNS =
  'lead_id, vaani_call_id, received_at, answered_at, first_response_sec, result, ' +
  'name, locality, service_area, property_type, carpet_area_sqft, scope, ' +
  'current_state, timeline_target, decision_maker, referral_source, referral_name, ' +
  'budget_volunteered, decline_reason, escalation_reason, consultation_booked, ' +
  'became_project, handoff_sent_at, claimed_at, claimed_by, pricing_asked_count, ' +
  'pricing_leaked, outcome_after_push, total_cost_inr, review_verdict, needs_review, ' +
  'channel, language, duration_sec'

export interface LeadsQuery {
  sinceDays?: number
  filter?: string | null
  limit?: number
}

export async function fetchLeads(query: LeadsQuery = {}): Promise<LeadRow[]> {
  const supabase = getSupabase()
  const since = new Date(Date.now() - (query.sinceDays ?? 60) * 86400_000).toISOString()

  let builder = supabase
    .from('leads')
    .select(LIST_COLUMNS)
    .is('deleted_at', null)                 // rule 6: nothing is ever hard-deleted
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(query.limit ?? 1000)

  switch (query.filter) {
    case 'pricing_leaked': builder = builder.eq('pricing_leaked', true); break
    case 'unclaimed': builder = builder.is('claimed_at', null).not('handoff_sent_at', 'is', null); break
    case 'needs_review': builder = builder.eq('needs_review', true); break
    case 'escalated': builder = builder.eq('result', 'escalated'); break
    case 'qualified': builder = builder.eq('result', 'qualified'); break
    case 'declined': builder = builder.eq('result', 'declined'); break
    case 'incomplete': builder = builder.eq('result', 'incomplete'); break
    case 'out_of_area': builder = builder.eq('service_area', 'out_of_area'); break
    case 'unknown_area': builder = builder.eq('service_area', 'unknown'); break
    case 'booked': builder = builder.eq('consultation_booked', true); break
    default: break
  }

  const { data, error } = await builder
  if (error) throw new Error(`Could not load leads: ${error.message}`)
  return (data ?? []) as unknown as LeadRow[]
}

/** The record page. This is the only place the phone number is read. */
export async function fetchLead(leadId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('leads').select('*').eq('lead_id', leadId).maybeSingle()
  if (error) throw new Error(`Could not load lead: ${error.message}`)
  return data
}

export async function fetchAlertsForLead(leadId: string) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('alert_log').select('*').eq('lead_id', leadId).order('sent_at', { ascending: true })
  return data ?? []
}
