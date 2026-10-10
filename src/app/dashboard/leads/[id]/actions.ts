'use server'

import { revalidatePath } from 'next/cache'
import { getSupabase } from '@/lib/supabase'
import { claimLead } from '@/lib/claim'

/**
 * The human review.
 *
 * review_verdict is the only honest check on whether the agent is judging
 * calls the way the studio would. became_project closes the loop months later,
 * which is why it is a tri-state: null means "not known yet", not "no".
 */
export async function saveReview(formData: FormData): Promise<void> {
  const leadId = String(formData.get('lead_id') ?? '')
  if (leadId === '') return

  const verdictRaw = String(formData.get('review_verdict') ?? '')
  const verdict = ['agree', 'disagree_should_have_qualified', 'disagree_should_have_declined']
    .includes(verdictRaw) ? verdictRaw : null

  const projectRaw = String(formData.get('became_project') ?? '')
  const became_project = projectRaw === 'yes' ? true : projectRaw === 'no' ? false : null

  const note = String(formData.get('review_note') ?? '').trim()
  const reviewer = String(formData.get('reviewed_by') ?? '').trim()

  const supabase = getSupabase()
  await supabase
    .from('leads')
    .update({
      review_verdict: verdict,
      became_project,
      review_note: note === '' ? null : note,
      reviewed_by: reviewer === '' ? 'dashboard' : reviewer,
      reviewed_at: new Date().toISOString(),
      // Reviewing a lead is what clears the flag. Nothing else does.
      needs_review: false,
      updated_at: new Date().toISOString(),
    })
    .eq('lead_id', leadId)

  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath('/dashboard')
}

/** Claiming from the dashboard goes through exactly the same conditional update. */
export async function claimFromDashboard(formData: FormData): Promise<void> {
  const leadId = String(formData.get('lead_id') ?? '')
  const designer = String(formData.get('designer') ?? '').trim()
  if (leadId === '' || designer === '') return

  await claimLead(getSupabase(), leadId, designer)
  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath('/dashboard')
}
