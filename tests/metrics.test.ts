import { describe, it, expect } from 'vitest'
import {
  summarise, byHourOfDay, declineReasons, percentile, median,
  responseBuckets, dashboardAlerts, compareChannels, type LeadRow,
} from '../src/lib/metrics'

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    lead_id: crypto.randomUUID(),
    received_at: '2026-10-08T05:30:00Z',   // 11:00 IST
    first_response_sec: 20,
    result: 'qualified',
    consultation_booked: false,
    pricing_asked_count: 0,
    pricing_leaked: false,
    total_cost_inr: 12,
    ...overrides,
  }
}

describe('percentile and median', () => {
  it('are null on no data rather than zero', () => {
    expect(median([])).toBeNull()
    expect(percentile([], 90)).toBeNull()
  })

  it('median of an odd and an even set', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(3)   // rounded mean of the middle pair
  })

  it('p90 by nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
    expect(percentile([42], 90)).toBe(42)
  })
})

describe('response health', () => {
  const leads = [
    lead({ first_response_sec: 5 }), lead({ first_response_sec: 12 }),
    lead({ first_response_sec: 20 }), lead({ first_response_sec: 28 }),
    lead({ first_response_sec: 3600 }),   // one slow outlier
  ]

  it('reports a median unmoved by the outlier', () => {
    expect(summarise(leads).medianFirstResponse).toBe(20)
  })

  it('reports a p90 that exposes it', () => {
    expect(summarise(leads).p90FirstResponse).toBe(3600)
  })

  it('reports the share under five minutes', () => {
    expect(summarise(leads).pctUnderFiveMin).toBe(80)
  })

  it('ignores leads that were never answered', () => {
    const withUnanswered = [...leads, lead({ first_response_sec: null })]
    expect(summarise(withUnanswered).medianFirstResponse).toBe(20)
  })

  it('buckets responses', () => {
    const buckets = responseBuckets(leads)
    expect(buckets.find((b) => b.label === 'under 30s')!.count).toBe(4)
    expect(buckets.find((b) => b.label === 'over 30 min')!.count).toBe(1)
  })
})

describe('hour of day', () => {
  it('always returns 24 buckets', () => {
    expect(byHourOfDay([])).toHaveLength(24)
  })

  it('places a call in the studio timezone, not UTC', () => {
    // 05:30 UTC is 11:00 IST. A UTC bucket would file it at 05:00 and the
    // out-of-hours share would be wrong.
    const buckets = byHourOfDay([lead({ received_at: '2026-10-08T05:30:00Z' })])
    expect(buckets[11].count).toBe(1)
    expect(buckets[5].count).toBe(0)
  })

  it('marks the 10am-7pm band', () => {
    const buckets = byHourOfDay([])
    expect(buckets[9].inOfficeHours).toBe(false)
    expect(buckets[10].inOfficeHours).toBe(true)
    expect(buckets[18].inOfficeHours).toBe(true)
    expect(buckets[19].inOfficeHours).toBe(false)
  })

  it('counts out-of-hours enquiries', () => {
    const leads = [
      lead({ received_at: '2026-10-07T20:30:00Z' }),  // 02:00 IST
      lead({ received_at: '2026-10-08T05:30:00Z' }),  // 11:00 IST
    ]
    const stats = summarise(leads)
    expect(stats.outsideOfficeHours).toBe(1)
    expect(stats.pctOutsideOfficeHours).toBe(50)
  })
})

describe('the funnel', () => {
  const leads = [
    lead({ result: 'qualified', consultation_booked: true }),
    lead({ result: 'qualified' }),
    lead({ result: 'declined', decline_reason: 'outside service area' }),
    lead({ result: 'declined', decline_reason: 'outside service area' }),
    lead({ result: 'declined', decline_reason: 'scope too small' }),
    lead({ result: 'escalated' }),
    lead({ result: 'incomplete' }),
  ]

  it('counts each outcome', () => {
    const s = summarise(leads)
    expect(s.qualified).toBe(2)
    expect(s.declined).toBe(3)
    expect(s.escalated).toBe(1)
    expect(s.incomplete).toBe(1)
    expect(s.consultations).toBe(1)
  })

  it('clusters decline reasons, commonest first', () => {
    const reasons = declineReasons(leads)
    expect(reasons[0]).toEqual({ reason: 'outside service area', count: 2 })
    expect(reasons[1]).toEqual({ reason: 'scope too small', count: 1 })
  })

  it('reports the share claimed within 30 minutes', () => {
    const handedOff = [
      lead({ handoff_sent_at: '2026-10-08T05:30:00Z', claimed_at: '2026-10-08T05:35:00Z' }),
      lead({ handoff_sent_at: '2026-10-08T05:30:00Z', claimed_at: '2026-10-08T06:30:00Z' }),
      lead({ handoff_sent_at: '2026-10-08T05:30:00Z', claimed_at: null }),
    ]
    const s = summarise(handedOff)
    expect(s.claimedWithin30).toBe(1)
    expect(s.pctClaimedWithin30).toBeCloseTo(33.3, 1)
    expect(s.unclaimed).toBe(1)
  })
})

describe('agent quality', () => {
  it('counts pricing pushes and the ones that still converted', () => {
    const leads = [
      lead({ pricing_asked_count: 2, consultation_booked: true }),
      lead({ pricing_asked_count: 3, consultation_booked: false }),
      lead({ pricing_asked_count: 0 }),
    ]
    const s = summarise(leads)
    expect(s.pricingPushes).toBe(2)
    expect(s.pushesThatConverted).toBe(1)
  })

  it('RULE 5: leaks are counted separately and should read zero', () => {
    expect(summarise([lead(), lead()]).pricingLeaks).toBe(0)
    expect(summarise([lead({ pricing_leaked: true })]).pricingLeaks).toBe(1)
  })

  it('counts review disagreements', () => {
    const leads = [
      lead({ review_verdict: 'agree' }),
      lead({ review_verdict: 'disagree_should_have_qualified' }),
      lead({ review_verdict: null }),
    ]
    const s = summarise(leads)
    expect(s.reviewed).toBe(2)
    expect(s.reviewDisagreements).toBe(1)
  })
})

describe('running cost', () => {
  it('totals spend and divides it the two ways that matter', () => {
    const leads = [
      lead({ result: 'qualified', consultation_booked: true, total_cost_inr: 10 }),
      lead({ result: 'qualified', total_cost_inr: 20 }),
      lead({ result: 'declined', total_cost_inr: 30 }),
    ]
    const s = summarise(leads)
    expect(s.totalCost).toBe(60)
    expect(s.costPerQualified).toBe(30)
    expect(s.costPerConsultation).toBe(60)
  })

  it('does not divide by zero', () => {
    const s = summarise([lead({ result: 'declined', total_cost_inr: 30 })])
    expect(s.costPerQualified).toBeNull()
    expect(s.costPerConsultation).toBeNull()
  })

  it('handles numeric strings from Postgres', () => {
    expect(summarise([lead({ total_cost_inr: '12.50' })]).totalCost).toBe(12.5)
  })
})

describe('empty data', () => {
  it('summarises nothing without throwing or inventing zeros', () => {
    const s = summarise([])
    expect(s.total).toBe(0)
    expect(s.medianFirstResponse).toBeNull()
    expect(s.pctUnderFiveMin).toBeNull()
    expect(s.costPerQualified).toBeNull()
  })
})

describe('the alert strip', () => {
  const now = new Date('2026-10-08T07:00:00Z')

  it('is empty when nothing is wrong', () => {
    expect(dashboardAlerts([lead()], now)).toEqual([])
  })

  it('leads with a pricing leak as an incident', () => {
    const alerts = dashboardAlerts([lead({ pricing_leaked: true })], now)
    expect(alerts[0].severity).toBe('incident')
    expect(alerts[0].message).toContain('must read zero')
  })

  it('warns about leads unclaimed over 30 minutes', () => {
    const alerts = dashboardAlerts(
      [lead({ handoff_sent_at: '2026-10-08T05:30:00Z', claimed_at: null })], now)
    expect(alerts.some((a) => a.message.includes('unclaimed'))).toBe(true)
  })

  it('warns about escalations unacknowledged over 15 minutes', () => {
    const alerts = dashboardAlerts(
      [lead({ result: 'escalated', handoff_sent_at: '2026-10-08T06:30:00Z', claimed_at: null })], now)
    expect(alerts.some((a) => a.message.includes('escalation'))).toBe(true)
  })

  it('puts the incident above the warnings', () => {
    const alerts = dashboardAlerts([
      lead({ handoff_sent_at: '2026-10-08T05:30:00Z', claimed_at: null }),
      lead({ pricing_leaked: true }),
    ], now)
    expect(alerts[0].severity).toBe('incident')
  })
})

describe('this period against the one before it', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86400_000).toISOString()

  it('counts each channel in its own current and previous window', () => {
    const rows = [
      lead({ channel: 'phone', received_at: daysAgo(5) }),
      lead({ channel: 'phone', received_at: daysAgo(10) }),
      lead({ channel: 'phone', received_at: daysAgo(40) }),   // previous period
      lead({ channel: 'whatsapp', received_at: daysAgo(3) }),
      lead({ channel: 'web_form', received_at: daysAgo(45) }), // previous period
    ]
    const result = compareChannels(rows, 30, now)
    const phone = result.find((c) => c.channel === 'phone')!
    expect(phone.current).toBe(2)
    expect(phone.previous).toBe(1)
    expect(phone.changePct).toBe(100)

    const web = result.find((c) => c.channel === 'web_form')!
    expect(web.current).toBe(0)
    expect(web.previous).toBe(1)
    expect(web.changePct).toBe(-100)
  })

  it('always reports all three channels, even at zero', () => {
    const result = compareChannels([], 30, now)
    expect(result.map((c) => c.channel).sort()).toEqual(['phone', 'web_form', 'whatsapp'])
  })

  it('reports null rather than dividing by a previous period of zero', () => {
    const rows = [lead({ channel: 'phone', received_at: daysAgo(2) })]
    const phone = compareChannels(rows, 30, now).find((c) => c.channel === 'phone')!
    expect(phone.previous).toBe(0)
    expect(phone.changePct).toBeNull()
  })
})
