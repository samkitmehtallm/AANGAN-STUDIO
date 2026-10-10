import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { authorizeCron } from '@/lib/cron-auth'
import { claimAlert } from '@/lib/alerts'
import { sendEmail, recipients } from '@/lib/email'
import { baseUrl } from '@/lib/notify'
import { formatAge } from '@/lib/office-hours'
import { summarise } from '@/lib/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The daily digest.
 *
 * Slow responses are reported here rather than alerted on individually: a
 * slow response is a pattern worth reading once a day, not an interruption.
 * Pricing leaks are not in here at all - those fired the moment they happened.
 *
 * Deduped on a kind that carries the date, so running it twice on the same day
 * sends one email.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = authorizeCron(request)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 })
  }

  const now = new Date()
  const supabase = getSupabase()
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .gte('received_at', since)
    .is('deleted_at', null)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const leads = data ?? []
  const stats = summarise(leads)
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.OFFICE_TZ ?? 'Asia/Kolkata',
  }).format(now)

  // lead_id is null for a digest, which is why the unique index is
  // NULLS NOT DISTINCT - otherwise every digest row would be unique and the
  // digest could fire on every call.
  const first = await claimAlert(supabase, null, `daily_digest_${dateKey}` as `unclaimed_repost_${number}`, {
    date: dateKey, lead_count: leads.length,
  })
  if (!first) {
    return NextResponse.json({ ok: true, skipped: 'already_sent_today', date: dateKey })
  }

  const slow = leads
    .filter((l) => (l.first_response_sec ?? 0) > 300)
    .sort((a, b) => (b.first_response_sec ?? 0) - (a.first_response_sec ?? 0))

  const unclaimed = leads.filter((l) => l.handoff_sent_at && !l.claimed_at)

  const lines = [
    `Aangan Studio — enquiries in the last 24 hours`,
    ``,
    `Enquiries: ${leads.length}`,
    `Qualified: ${stats.qualified}   Declined: ${stats.declined}   Escalated: ${stats.escalated}`,
    `Consultations booked: ${stats.consultations}`,
    ``,
    `Median first response: ${stats.medianFirstResponse === null ? 'n/a' : formatAge(stats.medianFirstResponse)}`,
    `p90 first response:    ${stats.p90FirstResponse === null ? 'n/a' : formatAge(stats.p90FirstResponse)}`,
    `Under 5 minutes:       ${stats.pctUnderFiveMin === null ? 'n/a' : `${stats.pctUnderFiveMin}%`}`,
    ``,
    `Pricing pushes: ${stats.pricingPushes}   Numbers revealed: ${stats.pricingLeaks}`,
    stats.pricingLeaks > 0
      ? `  ^ this must read zero. Open the dashboard.`
      : `  (this is where it should stay)`,
    ``,
    slow.length === 0
      ? `No responses slower than 5 minutes.`
      : `Slower than 5 minutes (${slow.length}):\n` +
        slow.slice(0, 10).map((l) =>
          `  - ${l.name ?? 'unnamed'} — ${formatAge(l.first_response_sec ?? 0)}`).join('\n'),
    ``,
    unclaimed.length === 0
      ? `Nothing unclaimed.`
      : `Still unclaimed (${unclaimed.length}):\n` +
        unclaimed.slice(0, 10).map((l) =>
          `  - ${l.name ?? 'unnamed'}, ${l.locality ?? 'locality unknown'}`).join('\n'),
    ``,
    `Dashboard: ${baseUrl()}/dashboard`,
  ]

  const text = lines.join('\n')
  const sent = await sendEmail({
    to: recipients('FOUNDER_TO'),
    subject: `Aangan daily — ${leads.length} enquiries, ${stats.qualified} qualified` +
             (stats.pricingLeaks > 0 ? `, ${stats.pricingLeaks} PRICING LEAK` : ''),
    text,
    html: `<pre style="font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#111827">${
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`,
  })

  return NextResponse.json({
    ok: true, date: dateKey, lead_count: leads.length,
    slow_count: slow.length, unclaimed_count: unclaimed.length,
    email: { ok: sent.ok, dryRun: sent.dryRun, error: sent.error ?? null },
  })
}

export const POST = GET
