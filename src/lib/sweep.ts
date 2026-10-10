/**
 * The unclaimed sweep and the escalation watchdog.
 *
 * Pure decision functions first, I/O second, so the timer rules can be tested
 * against a clock we control rather than by waiting thirty minutes.
 *
 * Two rules from the brief:
 *   - unclaimed past 30 minutes DURING OFFICE HOURS reposts with its age
 *   - an escalation unacknowledged for 15 minutes alerts
 *
 * "During office hours" governs the repost, not the ageing. A lead that
 * arrives at 2am keeps getting older all night and reposts at 10am carrying
 * its true eight-hour age - it does not reset, and it does not wake anyone.
 */
import { isOfficeHours } from './office-hours'

export const UNCLAIMED_AFTER_SEC = 30 * 60
export const ESCALATION_UNACKED_AFTER_SEC = 15 * 60
/** Reposts repeat on this cadence, capped, so a stale lead nags but not forever. */
export const REPOST_INTERVAL_SEC = 30 * 60
export const MAX_REPOSTS = 4

export interface SweepCandidate {
  lead_id: string
  handoff_sent_at: string | null
  claimed_at: string | null
  result: string
  reviewed_at?: string | null
}

export interface RepostDecision {
  shouldRepost: boolean
  /** Age since handoff, in seconds. Shown on the card. */
  ageSeconds: number
  /** 1 for the first repost, 2 for the second. Keys the alert_log row. */
  repostNumber: number
  reason: string
}

export function decideRepost(
  lead: SweepCandidate, now: Date, tz?: string
): RepostDecision {
  const none = (reason: string, ageSeconds = 0): RepostDecision => ({
    shouldRepost: false, ageSeconds, repostNumber: 0, reason,
  })

  if (lead.claimed_at !== null) return none('already_claimed')
  if (lead.handoff_sent_at === null) return none('never_handed_off')

  const handoffAt = new Date(lead.handoff_sent_at)
  if (Number.isNaN(handoffAt.getTime())) return none('unreadable_handoff_time')

  const ageSeconds = Math.floor((now.getTime() - handoffAt.getTime()) / 1000)
  if (ageSeconds < UNCLAIMED_AFTER_SEC) return none('not_old_enough', ageSeconds)

  // The nag happens when someone is at a desk to act on it.
  if (!isOfficeHours(now, tz)) return none('outside_office_hours', ageSeconds)

  const repostNumber = Math.min(
    Math.floor(ageSeconds / REPOST_INTERVAL_SEC), MAX_REPOSTS
  )
  if (repostNumber < 1) return none('not_old_enough', ageSeconds)
  if (repostNumber > MAX_REPOSTS) return none('repost_limit_reached', ageSeconds)

  return { shouldRepost: true, ageSeconds, repostNumber, reason: 'unclaimed' }
}

export interface EscalationDecision {
  shouldAlert: boolean
  ageSeconds: number
  reason: string
}

export function decideEscalationAlert(
  lead: SweepCandidate, now: Date
): EscalationDecision {
  if (lead.result !== 'escalated') {
    return { shouldAlert: false, ageSeconds: 0, reason: 'not_an_escalation' }
  }
  // Acknowledged means a human touched it: claimed or reviewed.
  if (lead.claimed_at !== null || (lead.reviewed_at ?? null) !== null) {
    return { shouldAlert: false, ageSeconds: 0, reason: 'acknowledged' }
  }
  if (lead.handoff_sent_at === null) {
    return { shouldAlert: false, ageSeconds: 0, reason: 'never_sent' }
  }

  const ageSeconds = Math.floor(
    (now.getTime() - new Date(lead.handoff_sent_at).getTime()) / 1000
  )
  if (ageSeconds < ESCALATION_UNACKED_AFTER_SEC) {
    return { shouldAlert: false, ageSeconds, reason: 'not_old_enough' }
  }
  // An escalation is woken for at any hour. It is already the exception.
  return { shouldAlert: true, ageSeconds, reason: 'unacknowledged' }
}

export const SLOW_RESPONSE_SEC = 300
/** Two slow responses in one day stops being a pattern and becomes a fault. */
export const SLOW_RESPONSES_BEFORE_IMMEDIATE = 2

export interface SlowResponseDecision {
  slowToday: number
  /** Report it in tomorrow's digest and move on. */
  digestOnly: boolean
  /** Wake the founder now. */
  immediate: boolean
}

/**
 * A single slow response is noise - a caller who did not pick up, a network
 * hiccup - and belongs in the daily digest. Two in one day is the agent or the
 * telephony leg actually failing, and waiting until tomorrow to mention it
 * wastes a day of enquiries.
 */
export function decideSlowResponseAlert(
  leadsToday: Array<{ first_response_sec?: number | null }>
): SlowResponseDecision {
  const slowToday = leadsToday.filter(
    (l) => typeof l.first_response_sec === 'number' && l.first_response_sec > SLOW_RESPONSE_SEC
  ).length

  return {
    slowToday,
    digestOnly: slowToday > 0 && slowToday < SLOW_RESPONSES_BEFORE_IMMEDIATE,
    immediate: slowToday >= SLOW_RESPONSES_BEFORE_IMMEDIATE,
  }
}
