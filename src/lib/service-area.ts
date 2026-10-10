/**
 * Service-area gate.
 *
 * Rule 4: the answer comes from src/config/service-area.json and from this code.
 * No model is consulted at request time. The config is the only place a human
 * edits when the studio takes on a new locality.
 *
 * Two properties this module must never lose:
 *   - OUT is evaluated before IN, so "Talegaon, near Pune" can never be talked
 *     into in-area by an in-area word sitting elsewhere in the string.
 *   - An unrecognised locality resolves to `unknown`, never to `in_area`.
 *     Unknown is a flag for a human, not a decision.
 *
 * Matching is deliberately exact-on-word-boundaries. There is no fuzzy or
 * edit-distance matching: on a phone line "Wakad" and "Warje" are one phoneme
 * apart, as are "Pimple Saudagar" and "Pimple Nilakh", and a matcher loose
 * enough to bridge that gap is loose enough to put a lead in the wrong
 * locality silently. Ambiguity resolves to `unknown` and asks a human.
 */
import raw from '../config/service-area.json'

export type AreaVerdict = 'in_area' | 'out_of_area' | 'unknown'

export interface ServiceAreaResult {
  /** The gate decision. Never `in_area` by default. */
  area: AreaVerdict
  /** Canonical spelling of the matched locality, or null when unknown. */
  canonical: string | null
  /** The alias text that produced the match, for auditing. */
  matchedAlias: string | null
  /** True when a human should look at this: unknown, ambiguous, or mixed. */
  needsReview: boolean
  /** Machine-readable reason codes, appended to leads.criteria_unclear. */
  notes: string[]
}

interface Entry {
  canonical: string
  aliases: string[]
}

const config = raw as unknown as {
  version: number
  in_area: Entry[]
  out_of_area: Entry[]
}

export const SERVICE_AREA_VERSION = config.version
export const IN_AREA_LOCALITIES = config.in_area.map((e) => e.canonical)
export const OUT_OF_AREA_LOCALITIES = config.out_of_area.map((e) => e.canonical)

/**
 * Lowercase, strip accents and punctuation, collapse whitespace, and pad with
 * spaces so that word-boundary checks are a plain `includes` on " alias ".
 */
export function normalizeLocality(input: unknown): string {
  if (typeof input !== 'string') return ''
  const cleaned = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Anything that is not a letter or digit is a separator. This turns
    // "Pimple-Saudagar", "Pimple  Saudagar" and "pimple saudagar." into one form.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  return cleaned
}

interface Match {
  canonical: string
  alias: string
}

function findMatches(padded: string, entries: Entry[]): Match[] {
  const hits: Match[] = []
  for (const entry of entries) {
    let best: string | null = null
    for (const alias of entry.aliases) {
      const needle = ` ${normalizeLocality(alias)} `
      if (needle.trim() === '') continue
      if (padded.includes(needle)) {
        if (best === null || alias.length > best.length) best = alias
      }
    }
    if (best !== null) hits.push({ canonical: entry.canonical, alias: best })
  }
  return hits
}

/** Longest alias wins, so "Pimple Saudagar" beats a bare "Pimple" every time. */
function longest(matches: Match[]): Match {
  return matches.reduce((a, b) => (b.alias.length > a.alias.length ? b : a))
}

export function resolveServiceArea(locality: unknown): ServiceAreaResult {
  const normalized = normalizeLocality(locality)

  if (normalized === '') {
    return {
      area: 'unknown',
      canonical: null,
      matchedAlias: null,
      needsReview: true,
      notes: ['locality_missing'],
    }
  }

  const padded = ` ${normalized} `

  // OUT first. Always. An out-of-area word anywhere in the string wins over an
  // in-area word, because the failure we are protecting against is driving to
  // Lonavala, not declining a Baner job we could have taken.
  const outHits = findMatches(padded, config.out_of_area)
  const inHits = findMatches(padded, config.in_area)

  if (outHits.length > 0) {
    const hit = longest(outHits)
    const notes: string[] = []
    let needsReview = false
    if (inHits.length > 0) {
      // "Mumbai client, site in Baner". Out-of-area still wins the gate, but a
      // human is told, because this one is genuinely worth a second look.
      notes.push(
        `locality_mixed:${hit.canonical}+${longest(inHits).canonical}`
      )
      needsReview = true
    }
    return {
      area: 'out_of_area',
      canonical: hit.canonical,
      matchedAlias: hit.alias,
      needsReview,
      notes,
    }
  }

  if (inHits.length > 0) {
    const distinct = new Set(inHits.map((h) => h.canonical))
    const hit = longest(inHits)
    if (distinct.size > 1) {
      return {
        area: 'in_area',
        canonical: hit.canonical,
        matchedAlias: hit.alias,
        needsReview: true,
        notes: [`locality_ambiguous:${[...distinct].sort().join('|')}`],
      }
    }
    return {
      area: 'in_area',
      canonical: hit.canonical,
      matchedAlias: hit.alias,
      needsReview: false,
      notes: [],
    }
  }

  // Recognised by nobody. This is the branch that must never say in_area.
  return {
    area: 'unknown',
    canonical: null,
    matchedAlias: null,
    needsReview: true,
    notes: ['locality_unrecognised'],
  }
}
