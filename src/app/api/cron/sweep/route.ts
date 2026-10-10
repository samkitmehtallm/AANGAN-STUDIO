import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { authorizeCron } from '@/lib/cron-auth'
import { decideRepost, decideEscalationAlert } from '@/lib/sweep'
import { renderHandoffCard, type CardLead } from '@/lib/handoff-card'
import { sendEmail, recipients } from '@/lib/email'
import { signLinkToken } from '@/lib/tokens'
import { claimAlert } from '@/lib/alerts'
import { baseUrl } from '@/lib/notify'
import { formatAge } from '@/lib/office-hours'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CARD_COLUMNS =
  'lead_id, name, locality, service_area, property_type, carpet_area_sqft, scope, ' +
  'current_state, timeline_target, decision_maker, referral_source, referral_name, ' +
  'budget_volunteered, received_at, result, criteria_failed, criteria_unclear, ' +
  'decline_reason, escalation_reason, needs_review, pricing_asked_count, ' +
  'pricing_leaked, language, duration_sec, handoff_sent_at, claimed_at, reviewed_at'

/**
 * The 30-minute sweep.
 *
 * On Hobby this is called by an external scheduler; on Pro it can be a Vercel
 * cron. Either way it is idempotent: every send is guarded by alert_log, so
 * calling it twice in the same minute sends nothing twice.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = authorizeCron(request)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 })
  }

  const now = new Date()
  const supabase = getSupabase()

  // Only leads that were handed off and never claimed can be stale. The partial
  // index on (handoff_sent_at) where claimed_at is null serves exactly this.
  const { data, error } = await supabase
    .from('leads')
    .select(CARD_COLUMNS)
    .is('claimed_at', null)
    .is('deleted_at', null)
    .not('handoff_sent_at', 'is', null)
    .order('handoff_sent_at', { ascending: true })
    .limit(200)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const reposted: string[] = []
  const escalationsAlerted: string[] = []
  const skipped: Array<{ lead_id: string; reason: string }> = []

  for (const row of (data ?? []) as unknown as Array<CardLead & {
    handoff_sent_at: string | null; claimed_at: string | null; reviewed_at: string | null
  }>) {
    /* --- escalation watchdog, 15 minutes ------------------------- */
    const escalation = decideEscalationAlert(row, now)
    if (escalation.shouldAlert) {
      const claimed = await claimAlert(supabase, row.lead_id, 'escalation_unacked', {
        age_seconds: escalation.ageSeconds,
      })
      if (claimed) {
        const card = renderHandoffCard(row, { baseUrl: baseUrl(), kind: 'escalation' })
        await sendEmail({
          to: [...recipients('ESCALATION_TO'), ...recipients('FOUNDER_TO')],
          subject: `UNACKNOWLEDGED ESCALATION (${formatAge(escalation.ageSeconds)}) — ${row.name ?? 'caller'}`,
          html: card.html,
          text: `This escalation has sat unacknowledged for ${formatAge(escalation.ageSeconds)}.\n\n${card.text}`,
        })
        escalationsAlerted.push(row.lead_id)
      }
      continue
    }

    /* --- unclaimed repost, 30 minutes, office hours only --------- */
    const decision = decideRepost(row, now)
    if (!decision.shouldRepost) {
      skipped.push({ lead_id: row.lead_id, reason: decision.reason })
      continue
    }

    // The repost number is part of the alert kind, so a second nag is a
    // different row and is allowed, while the SAME nag can never fire twice.
    const kind = `unclaimed_repost_${decision.repostNumber}` as const
    const claimed = await claimAlert(supabase, row.lead_id, kind, {
      age_seconds: decision.ageSeconds,
    })
    if (!claimed) {
      skipped.push({ lead_id: row.lead_id, reason: 'already_reposted' })
      continue
    }

    let claimUrl: string | undefined
    let passUrl: string | undefined
    try {
      claimUrl = `${baseUrl()}/api/claim/${signLinkToken('claim', row.lead_id, 'designer')}`
      passUrl = `${baseUrl()}/api/claim/${signLinkToken('pass', row.lead_id, 'designer')}`
    } catch { /* no signing secret: send without buttons rather than not at all */ }

    const card = renderHandoffCard(row, {
      baseUrl: baseUrl(), kind: 'repost',
      ageSeconds: decision.ageSeconds, claimUrl, passUrl,
    })
    await sendEmail({
      to: recipients('HANDOFF_TO'),
      subject: card.subject, html: card.html, text: card.text,
    })
    reposted.push(row.lead_id)
  }

  return NextResponse.json({
    ok: true, ran_at: now.toISOString(),
    examined: data?.length ?? 0,
    reposted, escalations_alerted: escalationsAlerted,
    skipped: skipped.slice(0, 50),
  })
}

/** Some schedulers only send POST. Same work, same guard. */
export const POST = GET
