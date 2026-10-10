import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { mapVaaniPayload } from '@/lib/vaani'
import { verifySignature, readSignatureHeader } from '@/lib/signature'
import { notifyForLead } from '@/lib/notify'
import type { CardLead } from '@/lib/handoff-card'

/** What the upsert returns: everything the card and the router need. */
type StoredLead = CardLead & {
  vaani_call_id: string
  handoff_sent_at: string | null
  claimed_at: string | null
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/vaani/webhook
 *
 * The order of operations here is the whole design:
 *
 *   1. verify the signature against the RAW body
 *   2. map the payload, coercing whatever we can and flagging the rest
 *   3. WRITE THE ROW  <- rule 1: if everything downstream is on fire, the
 *                        enquiry still exists
 *   4. only then notify anyone
 *
 * It returns 200 for anything it managed to store, including payloads that
 * were mostly junk, because a non-200 makes Vaani retry and a retry storm on
 * a malformed payload helps nobody. It returns non-200 only for a bad
 * signature (401) and for a storage failure (500) - the one case where a
 * retry is genuinely what we want.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now()

  // The raw text, before any parsing. Re-serialising a parsed object produces
  // different bytes and would fail every signature check.
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ ok: false, error: 'unreadable_body' }, { status: 400 })
  }

  /* --- 1. signature --------------------------------------------- */
  const allowUnsigned = process.env.VAANI_ALLOW_UNSIGNED === 'true'
  if (!allowUnsigned) {
    const signature = readSignatureHeader(request.headers)
    const verdict = verifySignature(rawBody, signature, process.env.VAANI_WEBHOOK_SECRET)
    if (!verdict.valid) {
      // Nothing is written and nothing is notified. An unsigned caller does not
      // get to put rows in this table.
      console.warn('[webhook:rejected]', verdict.reason)
      return NextResponse.json(
        { ok: false, error: 'invalid_signature', reason: verdict.reason },
        { status: 401 }
      )
    }
  }

  /* --- 2. parse and map ------------------------------------------ */
  let payload: unknown = null
  let parseFailed = false
  try {
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody)
  } catch {
    // Unparseable JSON from a correctly signed sender is still evidence that a
    // call happened. Keep the text so a human can look at it.
    parseFailed = true
    payload = { _unparseable_body: rawBody.slice(0, 20000) }
  }

  const { lead, flags } = mapVaaniPayload(payload)
  if (parseFailed) {
    lead.needs_review = true
    lead.criteria_unclear = [...new Set([...lead.criteria_unclear, 'unparseable_payload'])]
    flags.push('unparseable_payload')
  }

  /* --- 3. write, before anything else ---------------------------- */
  let stored: StoredLead
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('leads')
      .upsert(
        {
          ...lead,
          criteria_unclear: [...new Set([...lead.criteria_unclear, ...flags])],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vaani_call_id', ignoreDuplicates: false }
      )
      .select(
        'lead_id, vaani_call_id, name, locality, service_area, property_type, ' +
        'carpet_area_sqft, scope, current_state, timeline_target, decision_maker, ' +
        'referral_source, referral_name, budget_volunteered, received_at, result, ' +
        'criteria_failed, criteria_unclear, decline_reason, escalation_reason, ' +
        'needs_review, pricing_asked_count, pricing_leaked, language, duration_sec, ' +
        'handoff_sent_at, claimed_at'
      )
      .single()

    if (error) throw new Error(error.message)
    // PostgREST cannot infer a row type from a column string without generated
    // database types, so the shape is asserted here against the select above.
    stored = data as unknown as StoredLead
  } catch (error) {
    // A 500 here is correct: the lead is NOT saved, so we want the retry.
    console.error('[webhook:store-failed]', error)
    return NextResponse.json(
      { ok: false, error: 'storage_failed', detail: String(error) },
      { status: 500 }
    )
  }

  /* --- 4. notify, never fatally ---------------------------------- */
  // Idempotency has two halves. The upsert makes a retry free at the database.
  // This check makes it free at the mailbox: a lead that already went out does
  // not go out again just because Vaani resent the webhook.
  const alreadyHandedOff = stored.handoff_sent_at !== null
  let notify = null
  if (!alreadyHandedOff) {
    try {
      notify = await notifyForLead(getSupabase(), stored)
    } catch (error) {
      // Rule 1, restated: the lead is already safe. Notification failure is
      // logged and reported in the response body, not raised.
      console.error('[webhook:notify-failed]', error)
    }
  }

  return NextResponse.json({
    ok: true,
    lead_id: stored.lead_id,
    vaani_call_id: stored.vaani_call_id,
    duplicate: alreadyHandedOff,
    flags,
    needs_review: stored.needs_review,
    routed: notify?.routed.destination ?? (alreadyHandedOff ? 'already_sent' : 'none'),
    notification_errors: notify?.errors ?? [],
    took_ms: Date.now() - startedAt,
  })
}

/** A GET is a health check, not an enquiry. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    endpoint: 'vaani-webhook',
    method: 'POST',
    signature_required: process.env.VAANI_ALLOW_UNSIGNED !== 'true',
  })
}
