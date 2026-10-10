/**
 * The numbers behind the dashboard.
 *
 * Pure functions over an array of lead rows, so every band on the dashboard
 * is testable without a database and the digest and the dashboard can never
 * drift apart by computing the same figure two different ways.
 */
import { localHour, OPEN_HOUR, CLOSE_HOUR, OFFICE_TZ } from './office-hours'

export interface LeadRow {
  lead_id: string
  received_at: string
  answered_at?: string | null
  first_response_sec?: number | null
  result: string
  service_area?: string | null
  decline_reason?: string | null
  consultation_booked?: boolean | null
  became_project?: boolean | null
  handoff_sent_at?: string | null
  claimed_at?: string | null
  claimed_by?: string | null
  pricing_asked_count?: number | null
  pricing_leaked?: boolean | null
  outcome_after_push?: string | null
  review_verdict?: string | null
  needs_review?: boolean | null
  total_cost_inr?: number | string | null
  name?: string | null
  locality?: string | null
  property_type?: string | null
  carpet_area_sqft?: number | null
  scope?: string | null
  current_state?: string | null
  timeline_target?: string | null
  decision_maker?: string | null
  referral_source?: string | null
  referral_name?: string | null
  budget_volunteered?: string | null
  escalation_reason?: string | null
  vaani_call_id?: string | null
  channel?: string | null
  language?: string | null
  duration_sec?: number | null
  criteria_failed?: string[] | null
  criteria_unclear?: string[] | null
}

/** Nearest-rank percentile. With no data the honest answer is null, not zero. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

function responseTimes(leads: LeadRow[]): number[] {
  return leads
    .map((l) => l.first_response_sec)
    .filter((v): v is number => typeof v === 'number' && v >= 0)
}

export interface Summary {
  total: number
  qualified: number
  declined: number
  escalated: number
  incomplete: number
  consultations: number
  becameProjects: number
  medianFirstResponse: number | null
  p90FirstResponse: number | null
  pctUnderFiveMin: number | null
  outsideOfficeHours: number
  pctOutsideOfficeHours: number | null
  pricingPushes: number
  pricingLeaks: number
  pushesThatConverted: number
  reviewed: number
  reviewDisagreements: number
  needsReview: number
  claimedWithin30: number
  pctClaimedWithin30: number | null
  handedOff: number
  unclaimed: number
  totalCost: number
  costPerQualified: number | null
  costPerConsultation: number | null
}

export function summarise(leads: LeadRow[], tz = OFFICE_TZ): Summary {
  const times = responseTimes(leads)
  const qualified = leads.filter((l) => l.result === 'qualified').length
  const consultations = leads.filter((l) => l.consultation_booked === true).length

  const handedOff = leads.filter((l) => l.handoff_sent_at)
  const claimedWithin30 = handedOff.filter((l) => {
    if (!l.claimed_at || !l.handoff_sent_at) return false
    const delta = new Date(l.claimed_at).getTime() - new Date(l.handoff_sent_at).getTime()
    return delta >= 0 && delta <= 30 * 60 * 1000
  }).length

  const outside = leads.filter((l) => {
    const hour = localHour(new Date(l.received_at), tz)
    return hour < OPEN_HOUR || hour >= CLOSE_HOUR
  }).length

  const totalCost = leads.reduce((sum, l) => sum + Number(l.total_cost_inr ?? 0), 0)
  const reviewed = leads.filter((l) => l.review_verdict != null).length
  const disagreements = leads.filter(
    (l) => l.review_verdict != null && l.review_verdict !== 'agree'
  ).length

  const pct = (part: number, whole: number): number | null =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 10

  return {
    total: leads.length,
    qualified,
    declined: leads.filter((l) => l.result === 'declined').length,
    escalated: leads.filter((l) => l.result === 'escalated').length,
    incomplete: leads.filter((l) => l.result === 'incomplete').length,
    consultations,
    becameProjects: leads.filter((l) => l.became_project === true).length,
    medianFirstResponse: median(times),
    p90FirstResponse: percentile(times, 90),
    pctUnderFiveMin: times.length === 0
      ? null
      : Math.round((times.filter((t) => t <= 300).length / times.length) * 1000) / 10,
    outsideOfficeHours: outside,
    pctOutsideOfficeHours: pct(outside, leads.length),
    pricingPushes: leads.filter((l) => (l.pricing_asked_count ?? 0) > 0).length,
    pricingLeaks: leads.filter((l) => l.pricing_leaked === true).length,
    pushesThatConverted: leads.filter(
      (l) => (l.pricing_asked_count ?? 0) > 0 && l.consultation_booked === true
    ).length,
    reviewed,
    reviewDisagreements: disagreements,
    needsReview: leads.filter((l) => l.needs_review === true).length,
    claimedWithin30,
    pctClaimedWithin30: pct(claimedWithin30, handedOff.length),
    handedOff: handedOff.length,
    unclaimed: handedOff.filter((l) => !l.claimed_at).length,
    totalCost: Math.round(totalCost * 100) / 100,
    costPerQualified: qualified === 0 ? null : Math.round((totalCost / qualified) * 100) / 100,
    costPerConsultation: consultations === 0
      ? null : Math.round((totalCost / consultations) * 100) / 100,
  }
}

/** Enquiries by hour of day, in the studio timezone. Always 24 buckets. */
export function byHourOfDay(leads: LeadRow[], tz = OFFICE_TZ): Array<{
  hour: number; count: number; inOfficeHours: boolean
}> {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour, count: 0, inOfficeHours: hour >= OPEN_HOUR && hour < CLOSE_HOUR,
  }))
  for (const lead of leads) {
    const hour = localHour(new Date(lead.received_at), tz)
    if (hour >= 0 && hour < 24) buckets[hour].count += 1
  }
  return buckets
}

export function declineReasons(leads: LeadRow[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    if (lead.result !== 'declined') continue
    const reason = (lead.decline_reason ?? 'unspecified').trim() || 'unspecified'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
}

/** Response-time buckets, for the response-health band. */
export function responseBuckets(leads: LeadRow[]): Array<{ label: string; count: number }> {
  const times = responseTimes(leads)
  const bucket = (test: (t: number) => boolean) => times.filter(test).length
  return [
    { label: 'under 30s', count: bucket((t) => t < 30) },
    { label: '30s–2 min', count: bucket((t) => t >= 30 && t < 120) },
    { label: '2–5 min', count: bucket((t) => t >= 120 && t < 300) },
    { label: '5–30 min', count: bucket((t) => t >= 300 && t < 1800) },
    { label: 'over 30 min', count: bucket((t) => t >= 1800) },
  ]
}

export function dailyCounts(leads: LeadRow[], tz = OFFICE_TZ): Array<{
  date: string; total: number; qualified: number
}> {
  const map = new Map<string, { total: number; qualified: number }>()
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  for (const lead of leads) {
    const date = formatter.format(new Date(lead.received_at))
    const entry = map.get(date) ?? { total: 0, qualified: 0 }
    entry.total += 1
    if (lead.result === 'qualified') entry.qualified += 1
    map.set(date, entry)
  }
  return [...map.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The alert strip at the top of the dashboard. */
export interface DashboardAlert {
  severity: 'incident' | 'warning' | 'info'
  message: string
  href?: string
}

export function dashboardAlerts(leads: LeadRow[], now = new Date()): DashboardAlert[] {
  const alerts: DashboardAlert[] = []

  const leaks = leads.filter((l) => l.pricing_leaked === true)
  if (leaks.length > 0) {
    alerts.push({
      severity: 'incident',
      message: `${leaks.length} call${leaks.length === 1 ? '' : 's'} where the agent revealed a price. This number must read zero.`,
      href: '/dashboard/leads?filter=pricing_leaked',
    })
  }

  const staleUnclaimed = leads.filter((l) =>
    l.handoff_sent_at && !l.claimed_at &&
    now.getTime() - new Date(l.handoff_sent_at).getTime() > 30 * 60 * 1000
  )
  if (staleUnclaimed.length > 0) {
    alerts.push({
      severity: 'warning',
      message: `${staleUnclaimed.length} enquir${staleUnclaimed.length === 1 ? 'y has' : 'ies have'} been unclaimed for over 30 minutes.`,
      href: '/dashboard/leads?filter=unclaimed',
    })
  }

  const unackedEscalations = leads.filter((l) =>
    l.result === 'escalated' && !l.claimed_at &&
    l.handoff_sent_at &&
    now.getTime() - new Date(l.handoff_sent_at).getTime() > 15 * 60 * 1000
  )
  if (unackedEscalations.length > 0) {
    alerts.push({
      severity: 'warning',
      message: `${unackedEscalations.length} escalation${unackedEscalations.length === 1 ? '' : 's'} unacknowledged for over 15 minutes.`,
      href: '/dashboard/leads?filter=escalated',
    })
  }

  const needsReview = leads.filter((l) => l.needs_review === true && l.review_verdict == null)
  if (needsReview.length > 0) {
    alerts.push({
      severity: 'info',
      message: `${needsReview.length} lead${needsReview.length === 1 ? '' : 's'} flagged for a human to look at.`,
      href: '/dashboard/leads?filter=needs_review',
    })
  }

  return alerts
}

/**
 * This period against the one before it, by channel.
 *
 * The founder's question is not "how many enquiries" but "are we getting more
 * or fewer, and through which door". A single total answers neither, so each
 * channel is shown against its own previous period rather than against the
 * others.
 */
export interface ChannelComparison {
  channel: string
  label: string
  current: number
  previous: number
  /** Percentage change, or null when the previous period had nothing to divide by. */
  changePct: number | null
}

const CHANNEL_LABELS: Record<string, string> = {
  phone: 'Phone', whatsapp: 'WhatsApp', web_form: 'Web form',
}

export function compareChannels(
  leads: LeadRow[], windowDays: number, now = new Date()
): ChannelComparison[] {
  const ms = windowDays * 86400_000
  const currentFrom = now.getTime() - ms
  const previousFrom = currentFrom - ms

  const counts = new Map<string, { current: number; previous: number }>()
  for (const key of ['phone', 'whatsapp', 'web_form']) {
    counts.set(key, { current: 0, previous: 0 })
  }

  for (const lead of leads) {
    const at = new Date(lead.received_at).getTime()
    const channel = lead.channel ?? 'phone'
    if (!counts.has(channel)) counts.set(channel, { current: 0, previous: 0 })
    const entry = counts.get(channel)!
    if (at >= currentFrom) entry.current += 1
    else if (at >= previousFrom) entry.previous += 1
  }

  return [...counts.entries()].map(([channel, v]) => ({
    channel,
    label: CHANNEL_LABELS[channel] ?? channel,
    current: v.current,
    previous: v.previous,
    changePct: v.previous === 0 ? null : Math.round(((v.current - v.previous) / v.previous) * 100),
  }))
}
