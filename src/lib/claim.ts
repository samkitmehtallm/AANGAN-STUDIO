import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Claiming a lead.
 *
 * Two designers open the same email at the same time and both tap Claim.
 * Exactly one must win, and the loser must be told plainly rather than
 * silently overwriting the winner.
 *
 * The guarantee is a single conditional UPDATE:
 *
 *   update leads set claimed_by = $1, claimed_at = now()
 *   where lead_id = $2 and claimed_at is null
 *
 * Postgres serialises the two writes on the row lock. The first commits and
 * the second finds claimed_at no longer null, matches zero rows, and loses.
 * There is no read-then-write, so there is no window between the check and
 * the write for the race to live in.
 */
export interface ClaimResult {
  ok: boolean
  leadId: string
  claimedBy?: string | null
  claimedAt?: string | null
  reason?: 'already_claimed' | 'not_found' | string
}

export async function claimLead(
  supabase: SupabaseClient, leadId: string, designer: string
): Promise<ClaimResult> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('leads')
    .update({ claimed_by: designer, claimed_at: now, updated_at: now })
    .eq('lead_id', leadId)
    .is('claimed_at', null)          // <- the whole race condition lives here
    .select('lead_id, claimed_by, claimed_at')

  if (error) {
    return { ok: false, leadId, reason: error.message }
  }

  if (data && data.length === 1) {
    return { ok: true, leadId, claimedBy: data[0].claimed_by, claimedAt: data[0].claimed_at }
  }

  // Zero rows updated. Either someone else holds it, or the lead is gone.
  const { data: existing } = await supabase
    .from('leads')
    .select('lead_id, claimed_by, claimed_at')
    .eq('lead_id', leadId)
    .maybeSingle()

  if (!existing) return { ok: false, leadId, reason: 'not_found' }

  return {
    ok: false, leadId, reason: 'already_claimed',
    claimedBy: existing.claimed_by, claimedAt: existing.claimed_at,
  }
}

/**
 * "Can't take it" records who stepped away without claiming the lead for them.
 * The lead stays unclaimed and keeps ageing toward the 30-minute repost, which
 * is the point: passing is not the same as handling.
 */
export async function passLead(
  supabase: SupabaseClient, leadId: string, designer: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase
    .from('leads').select('passed_by').eq('lead_id', leadId).maybeSingle()
  if (error) return { ok: false, reason: error.message }
  if (!data) return { ok: false, reason: 'not_found' }

  const passed = new Set<string>([...(data.passed_by ?? []), designer])
  const { error: updateError } = await supabase
    .from('leads')
    .update({ passed_by: [...passed], updated_at: new Date().toISOString() })
    .eq('lead_id', leadId)

  return updateError ? { ok: false, reason: updateError.message } : { ok: true }
}
