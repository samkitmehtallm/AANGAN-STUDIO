import { describe, it, expect } from 'vitest'
import { routeLead } from '../src/lib/routing'
import {
  decideRepost, decideEscalationAlert,
  UNCLAIMED_AFTER_SEC, MAX_REPOSTS,
} from '../src/lib/sweep'
import { isOfficeHours, localHour, formatAge } from '../src/lib/office-hours'

describe('routing', () => {
  it('sends a qualified lead to the designers, claimable', () => {
    const r = routeLead({ result: 'qualified', service_area: 'in_area' })
    expect(r.destination).toBe('designers')
    expect(r.claimable).toBe(true)
  })

  it('sends an escalation to the escalation chat, not claimable', () => {
    const r = routeLead({ result: 'escalated', service_area: 'in_area' })
    expect(r.destination).toBe('escalation')
    expect(r.claimable).toBe(false)
  })

  it('notifies nobody for a clean decline', () => {
    expect(routeLead({ result: 'declined', service_area: 'out_of_area' }).destination).toBe('none')
  })

  it('escalates a decline the gate could not place', () => {
    // Declining on "I don't know" is how a Kothrud project gets turned away
    // because the line was bad.
    const r = routeLead({ result: 'declined', service_area: 'unknown' })
    expect(r.destination).toBe('escalation')
    expect(r.reason).toBe('declined_on_unknown_locality')
  })

  it('drops a clean incomplete call but keeps a flagged one', () => {
    expect(routeLead({ result: 'incomplete', service_area: 'in_area' }).destination).toBe('none')
    expect(routeLead({ result: 'incomplete', service_area: 'in_area', needs_review: true }).destination)
      .toBe('escalation')
  })

  it('never silently drops an unrecognised result', () => {
    const r = routeLead({ result: 'something_new', service_area: 'in_area' })
    expect(r.destination).toBe('escalation')
  })

  it('reports a pricing incident independently of where the lead goes', () => {
    for (const result of ['qualified', 'declined', 'escalated', 'incomplete']) {
      expect(routeLead({ result, service_area: 'in_area', pricing_leaked: true }).pricingIncident)
        .toBe(true)
    }
  })
})

describe('office hours are asked in the studio timezone', () => {
  it('11:00 IST on a Thursday is office hours', () => {
    // 05:30 UTC = 11:00 IST
    expect(isOfficeHours(new Date('2026-10-08T05:30:00Z'))).toBe(true)
  })

  it('03:00 IST is not, even though it is a weekday in UTC', () => {
    expect(isOfficeHours(new Date('2026-10-07T21:30:00Z'))).toBe(false)
  })

  it('09:30 IST is before opening and 19:30 IST is after closing', () => {
    expect(isOfficeHours(new Date('2026-10-08T04:00:00Z'))).toBe(false)
    expect(isOfficeHours(new Date('2026-10-08T14:00:00Z'))).toBe(false)
  })

  it('Sunday is closed', () => {
    expect(isOfficeHours(new Date('2026-10-11T06:00:00Z'))).toBe(false)
  })

  it('converts UTC to the right local hour', () => {
    expect(localHour(new Date('2026-10-08T05:30:00Z'))).toBe(11)
    expect(localHour(new Date('2026-10-08T18:30:00Z'))).toBe(0)
  })
})

describe('the 30-minute repost timer', () => {
  const handoff = '2026-10-08T05:30:00Z'   // 11:00 IST, inside office hours
  const base = { lead_id: 'l1', handoff_sent_at: handoff, claimed_at: null, result: 'qualified' }

  it('does not repost before 30 minutes', () => {
    const d = decideRepost(base, new Date('2026-10-08T05:59:00Z'))
    expect(d.shouldRepost).toBe(false)
    expect(d.reason).toBe('not_old_enough')
  })

  it('reposts at exactly 30 minutes', () => {
    const d = decideRepost(base, new Date('2026-10-08T06:00:00Z'))
    expect(d.shouldRepost).toBe(true)
    expect(d.ageSeconds).toBe(UNCLAIMED_AFTER_SEC)
    expect(d.repostNumber).toBe(1)
  })

  it('carries the age so the card can lead with it', () => {
    const d = decideRepost(base, new Date('2026-10-08T06:15:00Z'))
    expect(d.ageSeconds).toBe(45 * 60)
    expect(formatAge(d.ageSeconds)).toBe('45 min')
  })

  it('never reposts a claimed lead', () => {
    const d = decideRepost(
      { ...base, claimed_at: '2026-10-08T05:35:00Z' },
      new Date('2026-10-08T07:00:00Z')
    )
    expect(d.shouldRepost).toBe(false)
    expect(d.reason).toBe('already_claimed')
  })

  it('never reposts a lead that was never handed off', () => {
    const d = decideRepost({ ...base, handoff_sent_at: null }, new Date('2026-10-08T07:00:00Z'))
    expect(d.shouldRepost).toBe(false)
    expect(d.reason).toBe('never_handed_off')
  })

  it('stays silent outside office hours', () => {
    // Handed off at 02:00 IST, checked at 03:00 IST. Old enough, wrong hour.
    const d = decideRepost(
      { ...base, handoff_sent_at: '2026-10-07T20:30:00Z' },
      new Date('2026-10-07T21:30:00Z')
    )
    expect(d.shouldRepost).toBe(false)
    expect(d.reason).toBe('outside_office_hours')
  })

  it('reposts an overnight lead at its true age once the office opens', () => {
    // Handed off 02:00 IST, swept at 10:05 IST the same day.
    const d = decideRepost(
      { ...base, handoff_sent_at: '2026-10-07T20:30:00Z' },
      new Date('2026-10-08T04:35:00Z')
    )
    expect(d.shouldRepost).toBe(true)
    expect(d.ageSeconds).toBe(8 * 3600 + 5 * 60)
    expect(formatAge(d.ageSeconds)).toBe('8h 5m')
  })

  it('numbers each repost so alert_log can keep them apart', () => {
    expect(decideRepost(base, new Date('2026-10-08T06:00:00Z')).repostNumber).toBe(1)
    expect(decideRepost(base, new Date('2026-10-08T06:30:00Z')).repostNumber).toBe(2)
    expect(decideRepost(base, new Date('2026-10-08T07:00:00Z')).repostNumber).toBe(3)
  })

  it('stops nagging after the cap', () => {
    const d = decideRepost(base, new Date('2026-10-08T11:00:00Z'))
    expect(d.repostNumber).toBe(MAX_REPOSTS)
  })

  it('survives an unreadable handoff timestamp', () => {
    const d = decideRepost({ ...base, handoff_sent_at: 'not a date' }, new Date())
    expect(d.shouldRepost).toBe(false)
    expect(d.reason).toBe('unreadable_handoff_time')
  })
})

describe('the 15-minute escalation watchdog', () => {
  const base = {
    lead_id: 'e1', handoff_sent_at: '2026-10-08T05:30:00Z',
    claimed_at: null, result: 'escalated', reviewed_at: null,
  }

  it('alerts after 15 unacknowledged minutes', () => {
    expect(decideEscalationAlert(base, new Date('2026-10-08T05:45:00Z')).shouldAlert).toBe(true)
  })

  it('stays quiet before 15 minutes', () => {
    expect(decideEscalationAlert(base, new Date('2026-10-08T05:40:00Z')).shouldAlert).toBe(false)
  })

  it('counts a claim as acknowledgement', () => {
    expect(decideEscalationAlert(
      { ...base, claimed_at: '2026-10-08T05:35:00Z' }, new Date('2026-10-08T06:00:00Z')
    ).shouldAlert).toBe(false)
  })

  it('counts a review as acknowledgement', () => {
    expect(decideEscalationAlert(
      { ...base, reviewed_at: '2026-10-08T05:35:00Z' }, new Date('2026-10-08T06:00:00Z')
    ).shouldAlert).toBe(false)
  })

  it('ignores leads that are not escalations', () => {
    expect(decideEscalationAlert({ ...base, result: 'qualified' }, new Date('2026-10-08T07:00:00Z'))
      .shouldAlert).toBe(false)
  })

  it('alerts outside office hours too - an escalation is already the exception', () => {
    expect(decideEscalationAlert(
      { ...base, handoff_sent_at: '2026-10-07T20:30:00Z' }, new Date('2026-10-07T21:00:00Z')
    ).shouldAlert).toBe(true)
  })
})

describe('age formatting', () => {
  it.each([
    [30, '30s'], [90, '1 min'], [45 * 60, '45 min'],
    [3600, '1h'], [3900, '1h 5m'], [86400 + 3600, '1d 1h'],
  ])('%s seconds reads as %s', (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected)
  })
})
