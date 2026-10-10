/**
 * Independent pricing-leak detection.
 *
 * The webhook has been trusting one field: Vaani's own "Price revealed by
 * agent". That is the agent grading its own homework. Rule 5 says a leak is an
 * incident rather than a metric, and an incident you only hear about from the
 * party that caused it is one you will eventually miss.
 *
 * So this scans the transcript for the figures in docs/pricing-guide.md and the
 * phrasings that guide forbids, and can raise a leak the agent reported as
 * clean. It cannot lower one: if Vaani says a price was revealed, it was.
 *
 * The hard part is attribution. A caller saying "my budget is about 12 lakh" is
 * not a leak - it is the budget field working as designed. Only the agent's own
 * turns count. When the transcript carries no speaker labels and a figure is
 * present, this reports `unattributed` rather than guessing: that sets
 * needs_review, not pricing_leaked. A detector that cries wolf would make the
 * number that must read zero into a number nobody reads.
 */

export type LeakVerdict = 'clean' | 'leaked' | 'unattributed'

export interface LeakFinding {
  verdict: LeakVerdict
  /** The matched text, trimmed, for the incident email. Never the whole turn. */
  evidence: string[]
  /** Which rule fired, for the audit trail. */
  reasons: string[]
}

/** Speaker labels that mean the studio is talking. */
const AGENT_LABELS = /^(agent|assistant|ai|bot|meera|aangan|studio|system)\b/i
/** Speaker labels that mean the caller is talking. */
const CALLER_LABELS = /^(caller|customer|client|user|human|speaker ?[b2])\b/i

/**
 * Figures and phrasings the guide forbids.
 *
 * Deliberately narrow: a bare number is not a leak, a number attached to money
 * or to area is. "3BHK", "1400 sq ft" and "6 weeks" must never match.
 */
const PRICE_PATTERNS: Array<[RegExp, string]> = [
  // "₹2,400 per sq ft", "2400 per square foot", "1800 rupees a sq ft"
  [/(?:₹|rs\.?|inr|rupees?)?\s*[\d,]{3,}\s*(?:rupees?)?\s*(?:per|a|\/)\s*(?:sq\.?\s*(?:ft|feet)|square\s*(?:ft|feet|foot)|sft)/i,
    'per_square_foot_rate'],
  // "₹8 lakh", "3.5 lakhs", "12 lakh rupees"
  [/(?:₹|rs\.?|inr|rupees?)\s*[\d.,]+\s*(?:lakh|lac|crore|k\b)/i, 'rupee_figure'],
  [/\b[\d.,]+\s*(?:lakh|lac|crore)s?\b/i, 'lakh_figure'],
  // A bare rupee amount of four digits or more: "₹1,800", "Rs 250000"
  [/(?:₹|rs\.?\s|inr\s)\s*[\d,]{4,}/i, 'rupee_figure'],
  // The exact phrasings the guide names
  [/\bit(?:'| i)?ll cost (?:you )?(?:around|about|roughly|approximately)\b/i, 'forbidden_phrase'],
  [/\bour rates? (?:start|begin)s? (?:at|from)\b/i, 'forbidden_phrase'],
  [/\bfor a \d\s*bhk it(?:'| i)?s (?:typically|usually|around|about)\b/i, 'forbidden_phrase'],
  [/\b(?:starts?|starting) (?:at|from) (?:₹|rs\.?|inr|rupees?)?\s*[\d,]{3,}/i, 'forbidden_phrase'],
  [/\bballpark (?:is|of|would be|figure is)\b/i, 'forbidden_phrase'],
]

/**
 * The approved deflection. Its presence is not proof of innocence, but a turn
 * that is only the deflection cannot also be a leak.
 */
const DEFLECTION =
  /pricing depends on the site|your designer will walk you through|depends on the (?:site|materials|scope)/i

interface Turn {
  speaker: 'agent' | 'caller' | 'unknown'
  text: string
}

/**
 * Splits a transcript into attributed turns.
 *
 * Handles the shapes these platforms actually emit:
 *   "Agent: ...\nCaller: ..."
 *   "[Agent] ...\n[Caller] ..."
 *   "AGENT - ..."
 * and gives up honestly on anything else.
 */
export function splitTurns(transcript: string): Turn[] {
  const lines = transcript.split(/\r?\n/)
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '') continue

    // Strip a leading bracket or dash wrapper before looking for a label.
    const unwrapped = line.replace(/^[[(<]\s*/, '')
    // Either "Agent: text" or "[Agent] text" - the closing bracket is itself a
    // sufficient separator, so the colon is optional when one is present.
    const labelMatch =
      unwrapped.match(/^([A-Za-z][A-Za-z0-9 _-]{0,24})\s*[\]>)]\s*[:–—-]?\s*(.*)$/) ??
      unwrapped.match(/^([A-Za-z][A-Za-z0-9 _-]{0,24})\s*[:–—-]\s*(.*)$/)

    if (labelMatch) {
      const [, label, rest] = labelMatch
      const speaker: Turn['speaker'] =
        AGENT_LABELS.test(label.trim()) ? 'agent'
        : CALLER_LABELS.test(label.trim()) ? 'caller'
        : 'unknown'
      if (speaker !== 'unknown') {
        current = { speaker, text: rest }
        turns.push(current)
        continue
      }
    }

    if (current) {
      current.text += ` ${line}`
    } else {
      current = { speaker: 'unknown', text: line }
      turns.push(current)
    }
  }

  return turns
}

function findPrices(text: string): Array<{ match: string; reason: string }> {
  const hits: Array<{ match: string; reason: string }> = []
  for (const [pattern, reason] of PRICE_PATTERNS) {
    const match = text.match(pattern)
    if (match) hits.push({ match: match[0].trim(), reason })
  }
  return hits
}

/**
 * @param transcript the call transcript, or null when none was captured
 * @param reportedLeak what Vaani said about itself
 */
export function detectPricingLeak(
  transcript: string | null | undefined,
  reportedLeak = false
): LeakFinding {
  // The agent's own admission is always believed. We only ever add leaks.
  if (reportedLeak) {
    return { verdict: 'leaked', evidence: [], reasons: ['reported_by_agent'] }
  }
  if (typeof transcript !== 'string' || transcript.trim() === '') {
    return { verdict: 'clean', evidence: [], reasons: [] }
  }

  const turns = splitTurns(transcript)
  const attributed = turns.some((t) => t.speaker !== 'unknown')

  const evidence: string[] = []
  const reasons = new Set<string>()
  let callerOnly = true

  for (const turn of turns) {
    const hits = findPrices(turn.text)
    if (hits.length === 0) continue

    // A turn that is purely the approved deflection is not a leak even if it
    // happens to contain a figure the caller just said back to it.
    if (turn.speaker === 'agent' && DEFLECTION.test(turn.text) && hits.every(
      (h) => h.reason !== 'per_square_foot_rate' && h.reason !== 'forbidden_phrase'
    )) {
      continue
    }

    if (turn.speaker === 'agent') {
      callerOnly = false
      for (const hit of hits) {
        evidence.push(hit.match)
        reasons.add(`agent_said:${hit.reason}`)
      }
    } else if (turn.speaker === 'unknown' && !attributed) {
      for (const hit of hits) {
        evidence.push(hit.match)
        reasons.add(`unattributed:${hit.reason}`)
      }
      callerOnly = false
    }
  }

  if (evidence.length === 0) {
    return { verdict: 'clean', evidence: [], reasons: [] }
  }

  // Figures that only ever appeared in the caller's mouth are a budget, not a
  // leak, and must not be counted as one.
  if (callerOnly) {
    return { verdict: 'clean', evidence: [], reasons: ['caller_volunteered_only'] }
  }

  return {
    verdict: attributed ? 'leaked' : 'unattributed',
    evidence: [...new Set(evidence)].slice(0, 5),
    reasons: [...reasons],
  }
}
