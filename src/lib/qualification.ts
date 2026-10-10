/**
 * The five criteria, re-derived in code.
 *
 * The agent on Vaani already decided. This module decides again, from the rubric
 * in docs/qualification-rubric.md, and the webhook records both. The point is
 * not to overrule the agent on every call - it is that a model's opinion must
 * never SILENTLY override a rule. When the two disagree, the lead is flagged and
 * a human reads it.
 *
 * Nikhil's rubric, exactly:
 *   1. Real project - design and execution, not advice
 *   2. In our service area
 *   3. Realistic timeline - site available within 8-10 weeks, nothing under 6
 *   4. Right budget band, but ONLY if volunteered and clearly misaligned
 *   5. Decision-maker on the call, or properly represented
 *
 * And the three rules at the boundary, which matter more than the criteria:
 *   - unclear on 1, 2 or 3  -> ask one direct question (that is the agent's job,
 *                              so here it means: do not decline, flag unclear)
 *   - unclear on 4 or 5     -> treat as qualified, note the uncertainty
 *   - two or more FAIL      -> decline
 *
 * What explicitly does not disqualify: asking about price, calling out of hours,
 * a single room, a rented flat, or not yet knowing what they want.
 */
import rubric from '../config/qualification.json'
import { resolveServiceArea } from './service-area'

export type CriterionKey =
  | 'real_project' | 'service_area' | 'timeline' | 'budget' | 'decision_maker'

export type CriterionVerdict = 'pass' | 'fail' | 'unclear'

export interface CriterionResult {
  key: CriterionKey
  verdict: CriterionVerdict
  /** Plain-English reason, shown to a human on the record page. */
  note: string
}

export interface QualificationInput {
  locality?: string | null
  scope?: string | null
  property_type?: string | null
  carpet_area_sqft?: number | null
  timeline_target?: string | null
  site_available_from?: string | null
  decision_maker?: string | null
  budget_volunteered?: string | null
  transcript?: string | null
}

export interface QualificationResult {
  /** What this module would have decided, independent of the agent. */
  verdict: 'qualified' | 'declined' | 'needs_question'
  criteria: CriterionResult[]
  failed: CriterionKey[]
  unclear: CriterionKey[]
  /** Set when the result is declined, in the rubric's own words. */
  declineReason: string | null
}

const config = rubric as unknown as {
  timeline: { minimum_lead_weeks: number; comfortable_lead_weeks: number }
  commercial: { min_sqft: number; max_sqft: number }
  out_of_scope_work: Array<{ key: string; label: string; patterns: string[] }>
  decision_maker: { sufficient: string[]; insufficient: string[] }
  budget: Record<string, number>
  soft_criteria: string[]
  hard_criteria: string[]
}

const lower = (v: unknown): string =>
  typeof v === 'string' ? v.toLowerCase() : ''

/* ------------------------------------------------------------------ */
/* 1. a real project                                                   */
/* ------------------------------------------------------------------ */

/**
 * True when the matched phrase is being ruled OUT rather than asked for.
 *
 * "no structural changes" and "we won't break walls" are the September log's
 * most common way of saying a project is in scope - the caller is reassuring
 * the studio. Reading them as architectural work declines precisely the leads
 * the rubric says to take: T11, the rented Baner flat, says "no structural
 * changes, just design and fittings" and is a textbook qualified lead.
 */
const NEGATORS = /\b(?:no|not|never|without|avoid|except|excluding|don'?t|doesn'?t|won'?t|wont|aren'?t|isn'?t)\b[^.!?;]{0,24}$/i

function isNegated(haystack: string, matchIndex: number): boolean {
  return NEGATORS.test(haystack.slice(Math.max(0, matchIndex - 40), matchIndex))
}

function checkRealProject(input: QualificationInput): CriterionResult {
  const haystack = [input.scope, input.property_type, input.transcript]
    .map(lower).join(' \n ')

  if (haystack.trim() === '') {
    return { key: 'real_project', verdict: 'unclear', note: 'No scope was captured.' }
  }

  for (const rule of config.out_of_scope_work) {
    for (const pattern of rule.patterns) {
      const at = haystack.indexOf(pattern)
      if (at >= 0 && !isNegated(haystack, at)) {
        return {
          key: 'real_project', verdict: 'fail',
          note: `Reads as ${rule.label} ("${pattern}"), which is outside what the studio takes on.`,
        }
      }
    }
  }

  // Commercial size bounds. A 180 sq ft pod is below the floor; anything over
  // 3,000 sq ft is past the ceiling.
  const commercial = /office|clinic|studio|workstation|cabin|fitout|coworking|commercial/
    .test(haystack)
  if (commercial && typeof input.carpet_area_sqft === 'number') {
    if (input.carpet_area_sqft < config.commercial.min_sqft) {
      return {
        key: 'real_project', verdict: 'fail',
        note: `Commercial space of ${input.carpet_area_sqft} sq ft is below the ${config.commercial.min_sqft} sq ft minimum scope.`,
      }
    }
    if (input.carpet_area_sqft > config.commercial.max_sqft) {
      return {
        key: 'real_project', verdict: 'fail',
        note: `Commercial space of ${input.carpet_area_sqft} sq ft is beyond the ${config.commercial.max_sqft} sq ft ceiling.`,
      }
    }
  }

  return { key: 'real_project', verdict: 'pass', note: 'Design and execution within scope.' }
}

/* ------------------------------------------------------------------ */
/* 2. service area                                                     */
/* ------------------------------------------------------------------ */

function checkServiceArea(input: QualificationInput): CriterionResult {
  const area = resolveServiceArea(input.locality)
  if (area.area === 'in_area') {
    return { key: 'service_area', verdict: 'pass', note: `${area.canonical} is in the service area.` }
  }
  if (area.area === 'out_of_area') {
    return {
      key: 'service_area', verdict: 'fail',
      note: `${area.canonical} is outside Pune and PCMC - no vendor network there.`,
    }
  }
  // Never a fail. "I could not place this" is a question, not a decline.
  return {
    key: 'service_area', verdict: 'unclear',
    note: input.locality
      ? `"${input.locality}" was not recognised. Confirm before deciding.`
      : 'No locality was captured.',
  }
}

/* ------------------------------------------------------------------ */
/* 3. timeline                                                         */
/* ------------------------------------------------------------------ */

const WEEK_WORDS: Array<[RegExp, number]> = [
  [/(\d+)\s*weeks?/i, 1],
  [/(\d+)\s*months?/i, 4.345],
  [/(\d+)\s*days?/i, 1 / 7],
]

/** Pulls a lead time in weeks out of free text. Returns null when it cannot. */
export function parseLeadWeeks(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const t = text.toLowerCase()

  // "as soon as possible" / "immediately" is not a deadline, it is enthusiasm.
  // It must not be read as zero weeks and auto-declined.
  if (/asap|as soon as possible|immediately|right away|flexible|no rush|no specific|whenever/.test(t)) {
    return null
  }

  for (const [pattern, multiplier] of WEEK_WORDS) {
    const match = t.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value * multiplier
    }
  }

  // "before Diwali", "by March" - a named deadline we cannot resolve to weeks
  // without a calendar. Unclear, never a fail.
  return null
}

function checkTimeline(input: QualificationInput): CriterionResult {
  const text = [input.timeline_target, input.site_available_from]
    .filter(Boolean).join(' ')
  const weeks = parseLeadWeeks(text)

  if (weeks === null) {
    if (text.trim() === '') {
      return { key: 'timeline', verdict: 'unclear', note: 'No timeline was captured.' }
    }
    return {
      key: 'timeline', verdict: 'unclear',
      note: `"${text}" could not be resolved to a lead time. Confirm on the call.`,
    }
  }

  if (weeks < config.timeline.minimum_lead_weeks) {
    return {
      key: 'timeline', verdict: 'fail',
      note: `Needs completion in about ${Math.round(weeks)} weeks. Design alone is 3-4 weeks and nothing can be ready in under ${config.timeline.minimum_lead_weeks}.`,
    }
  }
  if (weeks < config.timeline.comfortable_lead_weeks) {
    return {
      key: 'timeline', verdict: 'unclear',
      note: `About ${Math.round(weeks)} weeks is tight but possible. Worth confirming site readiness.`,
    }
  }
  return { key: 'timeline', verdict: 'pass', note: `About ${Math.round(weeks)} weeks of lead time.` }
}

/* ------------------------------------------------------------------ */
/* 4. budget - only ever acts on a volunteered number                  */
/* ------------------------------------------------------------------ */

/** "12 lakh", "₹1-1.5 lakh", "15-20 lakh", "60,000" -> rupees, lowest bound. */
export function parseBudgetRupees(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const t = text.toLowerCase().replace(/,/g, '')

  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*\d+(?:\.\d+)?\s*)?(lakh|lac|crore)/)
  if (lakh) {
    const value = Number(lakh[1])
    if (!Number.isFinite(value)) return null
    return lakh[2] === 'crore' ? value * 10_000_000 : value * 100_000
  }

  const plain = t.match(/(?:₹|rs\.?|inr)?\s*(\d{5,})/)
  if (plain) {
    const value = Number(plain[1])
    return Number.isFinite(value) ? value : null
  }
  return null
}

function scopeFloor(input: QualificationInput): number {
  const haystack = [input.scope, input.property_type].map(lower).join(' ')
  if (/office|clinic|commercial|workstation|fitout/.test(haystack)) {
    return config.budget.commercial_floor
  }
  if (/full home|whole|entire|complete|end.to.end|turnkey|all rooms/.test(haystack)) {
    return config.budget.full_home_floor
  }
  if (/only|single room|one room|just the|master bedroom|living room only/.test(haystack)) {
    return config.budget.single_room_floor
  }
  return config.budget.partial_home_floor
}

function checkBudget(input: QualificationInput): CriterionResult {
  // The agent never asks. A missing budget is the normal case and is a pass,
  // not an unclear - flagging it would put a note on two thirds of all leads.
  if (!input.budget_volunteered || input.budget_volunteered.trim() === '') {
    return { key: 'budget', verdict: 'pass', note: 'Not volunteered, which is normal.' }
  }

  const rupees = parseBudgetRupees(input.budget_volunteered)
  if (rupees === null) {
    return {
      key: 'budget', verdict: 'unclear',
      note: `"${input.budget_volunteered}" could not be read as a number.`,
    }
  }

  const floor = scopeFloor(input)
  if (rupees < floor) {
    return {
      key: 'budget', verdict: 'fail',
      note: `Volunteered ${input.budget_volunteered}, clearly below what this scope costs. Address it on the call rather than at the consultation.`,
    }
  }
  return { key: 'budget', verdict: 'pass', note: `Volunteered ${input.budget_volunteered}, workable.` }
}

/* ------------------------------------------------------------------ */
/* 5. decision maker                                                   */
/* ------------------------------------------------------------------ */

function checkDecisionMaker(input: QualificationInput): CriterionResult {
  const value = input.decision_maker ?? 'unknown'

  if (config.decision_maker.sufficient.includes(value)) {
    return { key: 'decision_maker', verdict: 'pass', note: 'The decision sits with the caller.' }
  }

  if (config.decision_maker.insufficient.includes(value)) {
    // "Researching for others" is NOT sufficient on its own - but the rubric
    // says never to push on this one, and the September log has a caller whose
    // parents were the owners and who both attended. So: unclear, not fail.
    const attending = /will (?:come|attend|be there)|both will|they would come|at the consultation/
      .test(lower(input.transcript))
    if (attending) {
      return {
        key: 'decision_maker', verdict: 'pass',
        note: 'Researching for others, but the owners will attend the consultation.',
      }
    }
    return {
      key: 'decision_maker', verdict: 'unclear',
      note: 'Researching on behalf of someone else. Confirm the owners will attend - do not push.',
    }
  }

  return { key: 'decision_maker', verdict: 'unclear', note: 'Not established on the call.' }
}

/* ------------------------------------------------------------------ */
/* the rubric's own arithmetic                                         */
/* ------------------------------------------------------------------ */

export function qualify(input: QualificationInput): QualificationResult {
  const criteria: CriterionResult[] = [
    checkRealProject(input),
    checkServiceArea(input),
    checkTimeline(input),
    checkBudget(input),
    checkDecisionMaker(input),
  ]

  const failed = criteria.filter((c) => c.verdict === 'fail').map((c) => c.key)
  const unclear = criteria.filter((c) => c.verdict === 'unclear').map((c) => c.key)

  const hardFails = failed.filter((k) => config.hard_criteria.includes(k))
  const hardUnclear = unclear.filter((k) => config.hard_criteria.includes(k))

  // "Two or more criteria fail - decline gracefully."
  if (failed.length >= 2) {
    return {
      verdict: 'declined', criteria, failed, unclear,
      declineReason: criteria.filter((c) => c.verdict === 'fail').map((c) => c.note).join(' '),
    }
  }

  // One hard failure is enough on its own: out of area, not a real project, or
  // a timeline that cannot physically be met.
  if (hardFails.length === 1) {
    const reason = criteria.find((c) => c.key === hardFails[0])!.note
    return { verdict: 'declined', criteria, failed, unclear, declineReason: reason }
  }

  // A single soft failure - a volunteered budget well below the scope - is the
  // T10 case. The rubric says address it on the call, so it is a decline too,
  // but a gentler one.
  if (failed.length === 1) {
    const reason = criteria.find((c) => c.verdict === 'fail')!.note
    return { verdict: 'declined', criteria, failed, unclear, declineReason: reason }
  }

  // "Unclear on 1, 2 or 3: ask one direct question."
  if (hardUnclear.length > 0) {
    return { verdict: 'needs_question', criteria, failed, unclear, declineReason: null }
  }

  // "Unclear on 4 or 5: do not push. Treat as qualified and note it."
  return { verdict: 'qualified', criteria, failed, unclear, declineReason: null }
}

/**
 * Compares our verdict with the agent's.
 *
 * A disagreement is not an error - the agent heard the call and we only see
 * extracted fields. It is a flag, and it is the cheapest early warning the
 * studio has that the agent's rubric has drifted.
 */
export function compareWithAgent(
  ours: QualificationResult, agentResult: string
): { agrees: boolean; note: string | null } {
  const oursAsResult =
    ours.verdict === 'qualified' ? 'qualified'
    : ours.verdict === 'declined' ? 'declined'
    : null

  if (agentResult === 'escalated' || agentResult === 'incomplete') {
    return { agrees: true, note: null }   // not a qualification decision at all
  }
  if (oursAsResult === null) {
    return {
      agrees: true,
      note: `Rubric could not decide without one more question (unclear: ${ours.unclear.join(', ')}).`,
    }
  }
  if (oursAsResult === agentResult) return { agrees: true, note: null }

  return {
    agrees: false,
    note: `The agent said ${agentResult}; the rubric in code says ${oursAsResult}` +
      (ours.failed.length ? ` (failed: ${ours.failed.join(', ')})` : '') + '.',
  }
}
