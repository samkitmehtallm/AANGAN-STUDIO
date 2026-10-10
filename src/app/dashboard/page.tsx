import Link from 'next/link'
import { fetchLeads } from '@/lib/leads-repo'
import {
  summarise, byHourOfDay, declineReasons, responseBuckets, dashboardAlerts,
  compareChannels,
} from '@/lib/metrics'
import { formatAge } from '@/lib/office-hours'
import { Band, Stat, BarRow } from '@/components/primitives'
import { HourChart } from '@/components/hour-chart'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** The ranges the founder actually asks for, not an arbitrary date picker. */
const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
]
const DEFAULT_DAYS = 60

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await searchParams
  const requested = Number(days)
  const WINDOW_DAYS = RANGES.some((r) => r.days === requested) ? requested : DEFAULT_DAYS

  let all
  try {
    // Twice the window, so this period can be shown against the one before it.
    all = await fetchLeads({ sinceDays: WINDOW_DAYS, includePreviousPeriod: true })
  } catch (error) {
    return <ConfigError message={error instanceof Error ? error.message : String(error)} />
  }

  // Every headline figure is this period only; the older half exists purely
  // for the comparison below.
  const cutoff = Date.now() - WINDOW_DAYS * 86400_000
  const leads = all.filter((l) => new Date(l.received_at).getTime() >= cutoff)
  const channels = compareChannels(all, WINDOW_DAYS)

  const stats = summarise(leads)
  const hours = byHourOfDay(leads)
  const declines = declineReasons(leads)
  const buckets = responseBuckets(leads)
  const alerts = dashboardAlerts(leads)
  const maxDecline = Math.max(1, ...declines.map((d) => d.count))
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count))

  const money = (value: number | null) =>
    value === null ? '—' : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  return (
    <main className="mx-auto max-w-[1080px] px-6 py-9">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aangan Studio — enquiries</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {stats.total} enquiries in the last {WINDOW_DAYS} days.
            {' '}An enquiry answered within the hour converts at about four times the rate of one answered the next day.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)]">
            {RANGES.map((range) => {
              const active = range.days === WINDOW_DAYS
              return (
                <Link key={range.days} href={`/dashboard?days=${range.days}`}
                      className={`px-3 py-2 text-sm font-medium transition ${
                        active
                          ? 'bg-[var(--color-ink)] text-white'
                          : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-ground)]'
                      }`}>
                  {range.label}
                </Link>
              )
            })}
          </div>
          <Link href="/dashboard/leads"
                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--color-ground)]">
            All leads →
          </Link>
        </div>
      </header>

      {/* ---------------- alert strip ---------------- */}
      <div className="mb-7 space-y-2">
        {alerts.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
            Nothing needs attention. No leaked prices, nothing unclaimed past 30 minutes,
            no unacknowledged escalations.
          </div>
        ) : (
          alerts.map((alert, index) => {
            const style =
              alert.severity === 'incident' ? 'border-red-300 bg-red-50 text-red-900'
              : alert.severity === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
            return (
              <Link key={index} href={alert.href ?? '/dashboard/leads'}
                    className={`block rounded-lg border px-4 py-3 text-sm font-medium transition hover:brightness-[0.98] ${style}`}>
                {alert.severity === 'incident' ? '● ' : ''}{alert.message}
              </Link>
            )
          })
        )}
      </div>

      {/* ---------------- 0. volume, by channel, against last period ------- */}
      <Band title="Where enquiries came from"
            note={`This ${WINDOW_DAYS}-day window against the ${WINDOW_DAYS} days before it.`}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {channels.map((channel) => {
            const up = (channel.changePct ?? 0) > 0
            const flat = channel.changePct === 0 || channel.changePct === null
            return (
              <Stat key={channel.channel}
                    label={channel.label}
                    value={String(channel.current)}
                    tone={flat ? 'neutral' : up ? 'good' : 'warn'}
                    hint={
                      channel.changePct === null
                        ? channel.previous === 0 && channel.current === 0
                          ? 'none either period'
                          : 'nothing in the previous period'
                        : `${up ? '+' : ''}${channel.changePct}% vs ${channel.previous} before`
                    } />
            )
          })}
        </div>
        <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-faint)]">
          WhatsApp and the web form are not yet wired to the agent. Their figures are historical,
          from the September log, and will stay flat until those channels are connected.
        </p>
      </Band>

      {/* ---------------- 1. response health ---------------- */}
      <Band title="Response health"
            note="Time from the ring to the first response. The p90 is where the damage hides.">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Median first response"
                value={stats.medianFirstResponse === null ? '—' : formatAge(stats.medianFirstResponse)}
                tone={stats.medianFirstResponse !== null && stats.medianFirstResponse <= 60 ? 'good' : 'warn'}
                hint="half of callers heard back faster than this" />
          <Stat label="p90 first response"
                value={stats.p90FirstResponse === null ? '—' : formatAge(stats.p90FirstResponse)}
                tone={stats.p90FirstResponse !== null && stats.p90FirstResponse <= 300 ? 'good' : 'warn'}
                hint="the slowest one in ten" />
          <Stat label="Under 5 minutes"
                value={stats.pctUnderFiveMin === null ? '—' : `${stats.pctUnderFiveMin}%`}
                tone={(stats.pctUnderFiveMin ?? 0) >= 90 ? 'good' : 'warn'}
                hint="share answered inside five minutes" />
          <Stat label="Answered at all"
                value={`${stats.total - (stats.total - buckets.reduce((s, b) => s + b.count, 0))}/${stats.total}`}
                hint="every call the agent picked up" />
        </div>
        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          {buckets.map((bucket) => (
            <BarRow key={bucket.label} label={bucket.label} count={bucket.count} max={maxBucket}
                    tone={bucket.label === 'over 30 min' || bucket.label === '5–30 min' ? '#b45309' : '#1d4ed8'} />
          ))}
        </div>
      </Band>

      {/* ---------------- 2. when enquiries arrive ---------------- */}
      <Band title="When enquiries arrive"
            note="Hour of day, Asia/Kolkata. The shaded band is when the front desk is staffed.">
        <HourChart buckets={hours} outsidePct={stats.pctOutsideOfficeHours} />
      </Band>

      {/* ---------------- 3. the funnel ---------------- */}
      <Band title="The funnel" note={`${stats.handedOff} handed off · ${stats.unclaimed} still unclaimed`}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          <Stat label="Qualified" value={String(stats.qualified)} tone="good" href="/dashboard/leads?filter=qualified" />
          <Stat label="Declined" value={String(stats.declined)} href="/dashboard/leads?filter=declined" />
          <Stat label="Escalated" value={String(stats.escalated)} tone="warn" href="/dashboard/leads?filter=escalated" />
          <Stat label="Consultations booked" value={String(stats.consultations)} tone="good"
                href="/dashboard/leads?filter=booked"
                hint={stats.qualified > 0 ? `${Math.round((stats.consultations / stats.qualified) * 100)}% of qualified` : undefined} />
          <Stat label="Claimed in 30 min"
                value={stats.pctClaimedWithin30 === null ? '—' : `${stats.pctClaimedWithin30}%`}
                tone={(stats.pctClaimedWithin30 ?? 0) >= 80 ? 'good' : 'warn'}
                href="/dashboard/leads?filter=unclaimed" />
        </div>

        {declines.length > 0 ? (
          <div className="mt-6 border-t border-[var(--color-line)] pt-4">
            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
              Why calls were declined
            </h3>
            {declines.slice(0, 8).map((reason) => (
              <BarRow key={reason.reason} label={reason.reason} count={reason.count}
                      max={maxDecline} tone="#64748b" />
            ))}
          </div>
        ) : null}
      </Band>

      {/* ---------------- 4. agent quality ---------------- */}
      <Band title="Agent quality"
            note="Pricing is the guardrail. The number revealed must read zero.">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Pricing pushes" value={String(stats.pricingPushes)}
                hint="calls where the caller asked for a price" />
          <Stat label="Numbers revealed" value={String(stats.pricingLeaks)}
                tone={stats.pricingLeaks === 0 ? 'good' : 'bad'}
                href={stats.pricingLeaks > 0 ? '/dashboard/leads?filter=pricing_leaked' : undefined}
                hint={stats.pricingLeaks === 0 ? 'as it should be' : 'incident — open these now'} />
          <Stat label="Pushed and still booked" value={String(stats.pushesThatConverted)}
                tone="good"
                hint={stats.pricingPushes > 0
                  ? `${Math.round((stats.pushesThatConverted / stats.pricingPushes) * 100)}% of pushes held`
                  : undefined} />
          <Stat label="Review disagreements"
                value={`${stats.reviewDisagreements}/${stats.reviewed}`}
                tone={stats.reviewed > 0 && stats.reviewDisagreements / stats.reviewed > 0.15 ? 'warn' : 'neutral'}
                hint="humans who read the call and judged differently" />
        </div>
      </Band>

      {/* ---------------- 5. running cost ---------------- */}
      <Band title="Running cost" note={`Telephony and voice agent, last ${WINDOW_DAYS} days.`}>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Total spend" value={money(stats.totalCost)} />
          <Stat label="Cost per qualified lead" value={money(stats.costPerQualified)}
                hint="against a project worth ₹8–14 lakh" />
          <Stat label="Cost per consultation" value={money(stats.costPerConsultation)} />
          <Stat label="Cost per enquiry"
                value={money(stats.total === 0 ? null : Math.round((stats.totalCost / stats.total) * 100) / 100)} />
        </div>
      </Band>

      <footer className="mt-8 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Callback numbers are never shown on this page or in any notification. They live on the
        individual lead record. Nothing is ever hard-deleted.
      </footer>
    </main>
  )
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-xl font-semibold">The dashboard cannot reach the database</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        This is a configuration problem, not a code one. Check that
        {' '}<code className="rounded bg-[var(--color-ground)] px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and
        {' '}<code className="rounded bg-[var(--color-ground)] px-1 py-0.5 text-xs">SUPABASE_SERVICE_ROLE_KEY</code>
        {' '}are set in this environment.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-3 text-xs text-[var(--color-bad)]">
        {message}
      </pre>
    </main>
  )
}
