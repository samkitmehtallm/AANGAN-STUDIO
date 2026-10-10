/**
 * Vaani payload -> leads row.
 *
 * The contract with this module is total: it never throws. Every field can
 * arrive missing, null, or as junk, and the only acceptable outcome is a row
 * that gets written. Anything we cannot read becomes null plus a flag, and a
 * human sorts it out later from the raw payload we kept verbatim.
 *
 * Vaani's extracted field names are human sentences with spaces and capitals.
 * We look for those first, then for the snake_case forms a future version of
 * their console might emit, and we look inside a handful of likely containers.
 */
import { resolveServiceArea, type AreaVerdict } from './service-area'

export type LeadResult = 'qualified' | 'declined' | 'escalated' | 'incomplete'
export type LeadState =
  | 'bare_shell' | 'builder_handover' | 'lived_in' | 'under_renovation' | 'unknown'
export type LeadDecider =
  | 'caller' | 'caller_and_partner' | 'represented' | 'researching_for_others' | 'unknown'
export type LeadLanguage = 'english' | 'hindi' | 'marathi' | 'mixed'
export type PushOutcome = 'booked' | 'lost' | 'undecided'

export interface MappedLead {
  vaani_call_id: string
  received_at: string
  answered_at: string | null
  channel: 'phone' | 'whatsapp' | 'web_form'
  duration_sec: number | null
  recording_url: string | null
  transcript_url: string | null
  transcript: string | null
  language: LeadLanguage | null
  name: string | null
  phone: string | null
  locality: string | null
  service_area: AreaVerdict
  property_type: string | null
  carpet_area_sqft: number | null
  scope: string | null
  current_state: LeadState
  timeline_target: string | null
  site_available_from: string | null
  decision_maker: LeadDecider
  referral_source: string | null
  referral_name: string | null
  budget_volunteered: string | null
  result: LeadResult
  criteria_failed: string[]
  criteria_unclear: string[]
  decline_reason: string | null
  escalation_reason: string | null
  agent_confidence: string | null
  consultation_booked: boolean
  consultation_at: string | null
  consultation_type: string | null
  pricing_asked_count: number
  pricing_leaked: boolean
  outcome_after_push: PushOutcome | null
  telephony_cost_inr: number
  voice_agent_cost_inr: number
  needs_review: boolean
  raw_payload: unknown
}

export interface MapOutcome {
  lead: MappedLead
  /** Human-readable notes about what could not be read. Also drives needs_review. */
  flags: string[]
}

/* ------------------------------------------------------------------ */
/* field lookup                                                        */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** "Caller name", "caller_name", "callerName" all collapse to "callername". */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Flattens the payload and the usual nesting spots into one lookup table.
 * Shallower keys win, so a top-level override beats a nested default.
 */
function buildIndex(payload: unknown): Map<string, unknown> {
  const index = new Map<string, unknown>()
  const containers: Array<Record<string, unknown>> = []
  if (isPlainObject(payload)) {
    containers.push(payload)
    for (const nest of [
      'extracted', 'extracted_fields', 'extractedFields', 'fields', 'data',
      'call', 'call_data', 'metadata', 'variables', 'analysis', 'summary',
      'collected', 'results',
    ]) {
      const child = payload[nest]
      if (isPlainObject(child)) containers.push(child)
    }
  }
  // Later containers must not clobber earlier ones.
  for (const container of containers) {
    for (const [k, v] of Object.entries(container)) {
      const key = keyOf(k)
      if (!index.has(key)) index.set(key, v)
    }
  }
  return index
}

function pick(index: Map<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const v = index.get(keyOf(name))
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

/* ------------------------------------------------------------------ */
/* coercions - each one returns null rather than throwing              */
/* ------------------------------------------------------------------ */

export function coerceText(v: unknown, maxLen = 2000): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    // Voice agents emit these when extraction failed. They are not names.
    if (/^(null|undefined|n\/?a|none|unknown|not provided|not specified|-+)$/i.test(t)) {
      return null
    }
    return t.slice(0, maxLen)
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const joined = v.filter((x) => typeof x === 'string' || typeof x === 'number')
      .join(', ').trim()
    return joined === '' ? null : joined.slice(0, maxLen)
  }
  return null
}

export function coerceInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

export function coerceMoney(v: unknown): number | null {
  const n = typeof v === 'number' ? v
    : typeof v === 'string' ? Number(v.replace(/[^0-9.\-]/g, ''))
    : NaN
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export function coerceBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['yes', 'y', 'true', '1', 'booked', 'confirmed', 'done'].includes(t)) return true
    if (['no', 'n', 'false', '0', 'not booked', 'declined', 'none'].includes(t)) return false
  }
  return null
}

/**
 * Duration. Accepts seconds as a number, "212", "3:32", "3m 32s".
 */
export function coerceDuration(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  if (t === '') return null
  const clock = t.match(/^(\d+):([0-5]?\d)$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const ms = t.match(/^(?:(\d+)\s*m(?:in)?[a-z]*)?\s*(?:(\d+)\s*s(?:ec)?[a-z]*)?$/)
  if (ms && (ms[1] || ms[2])) return Number(ms[1] ?? 0) * 60 + Number(ms[2] ?? 0)
  const n = coerceInt(t)
  return n !== null && n >= 0 ? n : null
}

/** ISO 8601 preferred; epoch seconds/millis accepted. Invalid -> null. */
export function coerceTimestamp(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Ten-digit values are seconds, thirteen are milliseconds.
    const ms = v > 1e11 ? v : v * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (/^\d{10}$/.test(t)) return new Date(Number(t) * 1000).toISOString()
  if (/^\d{13}$/.test(t)) return new Date(Number(t)).toISOString()
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  // Guard against a parse that technically succeeds but is nonsense.
  const year = d.getUTCFullYear()
  if (year < 2000 || year > 2100) return null
  return d.toISOString()
}

/**
 * Indian callback numbers. Returns E.164 when we are confident, the cleaned
 * digits when we are not, and null when there is nothing usable.
 */
export function coercePhone(v: unknown): string | null {
  const raw = coerceText(v, 40)
  if (raw === null) return null
  let digits = raw.replace(/[^\d+]/g, '')
  digits = digits.replace(/(?!^)\+/g, '')
  if (digits.startsWith('+')) {
    const rest = digits.slice(1)
    if (rest.length < 10 || rest.length > 15) return null
    return `+${rest}`
  }
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) {
    const ten = digits.slice(1)
    return /^[6-9]/.test(ten) ? `+91${ten}` : null
  }
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`
  return null
}

/* ------------------------------------------------------------------ */
/* enum mapping                                                        */
/* ------------------------------------------------------------------ */

function matchEnum<T extends string>(
  v: unknown,
  table: Array<[T, RegExp]>,
  fallback: T
): { value: T; matched: boolean } {
  const text = coerceText(v, 200)
  if (text === null) return { value: fallback, matched: false }
  for (const [value, pattern] of table) {
    if (pattern.test(text)) return { value, matched: true }
  }
  return { value: fallback, matched: false }
}

const RESULT_TABLE: Array<[LeadResult, RegExp]> = [
  ['qualified', /qualif|accept|pass(ed)?\b|good fit|booked/i],
  ['declined', /declin|reject|not a fit|unfit|out of area|no fit|turned down/i],
  ['escalated', /escalat|transfer|human|founder|complex/i],
  ['incomplete', /incomplete|dropped|hung ?up|abandon|no answer|partial/i],
]

const STATE_TABLE: Array<[LeadState, RegExp]> = [
  ['bare_shell', /bare ?shell|shell|empty|raw/i],
  ['builder_handover', /builder|handover|hand ?over|possession|new flat/i],
  ['under_renovation', /under ?renovation|renovat|ongoing work|being done/i],
  ['lived_in', /lived ?in|occupied|living|currently living|we live/i],
]

const DECIDER_TABLE: Array<[LeadDecider, RegExp]> = [
  ['caller_and_partner', /partner|spouse|wife|husband|both of us|caller and/i],
  ['researching_for_others', /research|for (?:my )?(?:parents|friend|others|someone)|on behalf/i],
  ['represented', /represent|agent|broker|pmc|architect|manager|builder rep/i],
  ['caller', /^caller$|\bmyself\b|\bme\b|self|i decide|i am the/i],
]

const LANGUAGE_TABLE: Array<[LeadLanguage, RegExp]> = [
  ['mixed', /mixed|hinglish|multi|both|code ?switch/i],
  ['marathi', /marathi|mr\b/i],
  ['hindi', /hindi|hi\b/i],
  ['english', /english|en\b/i],
]

const PUSH_TABLE: Array<[PushOutcome, RegExp]> = [
  ['booked', /book|convert|scheduled|agreed|yes/i],
  ['lost', /lost|drop|hung|refus|no\b|walked/i],
  ['undecided', /undecid|think|call back|later|maybe|unsure/i],
]

const SOURCE_PATTERNS: Array<[string, RegExp]> = [
  ['referral', /referr?al|refer(red)?|friend|word of mouth|recommend/i],
  ['instagram', /instagram|insta\b|ig\b|reels?/i],
  ['google', /google|search|seo|adwords/i],
  ['linkedin', /linked ?in/i],
  ['builder', /builder|developer|contractor/i],
  ['press', /press|magazine|article|news|publication/i],
  ['other', /other|misc/i],
]

export function normalizeSource(v: unknown): { source: string | null; name: string | null } {
  const text = coerceText(v, 300)
  if (text === null) return { source: null, name: null }
  let source: string | null = null
  for (const [value, pattern] of SOURCE_PATTERNS) {
    if (pattern.test(text)) { source = value; break }
  }
  if (source === null) return { source: 'other', name: text }

  if (source !== 'referral') return { source, name: null }

  // "referral - Meera Joshi", "referred by Meera Joshi", "referral (Meera)".
  const m = text.match(/(?:referr?al|referred)\s*(?:by|from|[-:(,])?\s*(.+)$/i)
  let name = m ? m[1] : null
  if (name) {
    name = name.replace(/[)\]]+$/, '').trim()
    if (name === '' || /^(by|from)$/i.test(name)) name = null
  }
  return { source: 'referral', name }
}

/**
 * "3BHK, 1250 sqft" -> { property_type: "3BHK", carpet_area_sqft: 1250 }
 * Area is only taken when a unit word is nearby, so "4 BHK" never becomes 4 sqft.
 */
export function splitPropertyAndArea(v: unknown): {
  property_type: string | null
  carpet_area_sqft: number | null
} {
  const text = coerceText(v, 300)
  if (text === null) return { property_type: null, carpet_area_sqft: null }

  const areaMatch = text.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*(?:ft|feet)|sqft|square\s*(?:ft|feet)|sft)/i
  )
  let area: number | null = null
  if (areaMatch) {
    const n = Number(areaMatch[1].replace(/,/g, ''))
    // Anything outside this band is a mis-transcription, not a flat.
    if (Number.isFinite(n) && n >= 100 && n <= 100000) area = Math.round(n)
  }

  let type = text
  if (areaMatch) type = text.replace(areaMatch[0], ' ')
  type = type.replace(/[,;/|]+/g, ' ').replace(/\s+/g, ' ').trim()
  type = type.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim()

  return {
    property_type: type === '' ? null : type.slice(0, 200),
    carpet_area_sqft: area,
  }
}

/* ------------------------------------------------------------------ */
/* the mapper                                                          */
/* ------------------------------------------------------------------ */

export interface MapOptions {
  /** Injected for deterministic tests. */
  now?: Date
  /** Used when the payload carries no call id at all. */
  fallbackCallId?: string
}

export function mapVaaniPayload(payload: unknown, options: MapOptions = {}): MapOutcome {
  const now = options.now ?? new Date()
  const flags: string[] = []
  const index = buildIndex(payload)

  /* --- identity ------------------------------------------------- */
  const callIdRaw = pick(index, 'vaani_call_id', 'call_id', 'callId', 'id',
    'conversation_id', 'session_id', 'Call ID')
  let vaani_call_id = coerceText(callIdRaw, 200)
  if (vaani_call_id === null) {
    // Without an id we cannot be idempotent. We still keep the lead - losing an
    // enquiry is worse than keeping a duplicate - but we mark it loudly.
    vaani_call_id = options.fallbackCallId ?? `unidentified-${now.toISOString()}`
    flags.push('missing_call_id')
  }

  /* --- call timing ---------------------------------------------- */
  // received_at is the RING, not the answer. If Vaani only gives us one
  // timestamp we must not quietly treat the answer as the ring: that would
  // report a first_response_sec of zero and hide the exact delay we exist to
  // measure.
  const ring = coerceTimestamp(pick(index, 'received_at', 'ring_at', 'ringing_at',
    'call_started_at', 'started_at', 'Call received at', 'Ring time', 'initiated_at'))
  const answered = coerceTimestamp(pick(index, 'answered_at', 'answer_at',
    'picked_up_at', 'Call answered at', 'connected_at'))

  let received_at: string
  if (ring !== null) {
    received_at = ring
  } else if (answered !== null) {
    received_at = answered
    flags.push('received_at_fallback_to_answered')
  } else {
    received_at = now.toISOString()
    flags.push('received_at_missing')
  }

  let answered_at = answered
  if (answered_at !== null && answered_at < received_at) {
    flags.push('answered_before_received')
    answered_at = received_at
  }

  const duration_sec = coerceDuration(pick(index, 'duration_sec', 'duration',
    'call_duration', 'Call duration', 'length_sec'))

  /* --- caller and project --------------------------------------- */
  const name = coerceText(pick(index, 'Caller name', 'caller_name', 'name', 'customer_name'), 200)
  if (name === null) flags.push('missing_caller_name')

  const phoneRaw = pick(index, 'Callback number', 'callback_number', 'phone',
    'caller_number', 'from_number', 'customer_phone', 'phone_number')
  const phone = coercePhone(phoneRaw)
  if (phone === null) {
    flags.push(phoneRaw === null ? 'missing_callback_number' : 'unparseable_callback_number')
  }

  const locality = coerceText(pick(index, 'Locality', 'locality', 'area', 'location'), 300)
  const areaResult = resolveServiceArea(locality)
  flags.push(...areaResult.notes)

  const property = splitPropertyAndArea(
    pick(index, 'Property type and area', 'property_type_and_area', 'property_type',
      'property', 'Property')
  )
  const explicitArea = coerceInt(pick(index, 'carpet_area_sqft', 'carpet_area', 'area_sqft'))
  const carpet_area_sqft = property.carpet_area_sqft ?? explicitArea

  const scope = coerceText(pick(index, 'Scope of work', 'scope_of_work', 'scope', 'work_scope'), 1000)

  const stateRaw = pick(index, 'Current state of site', 'current_state_of_site',
    'current_state', 'site_state', 'Site state')
  const state = matchEnum<LeadState>(stateRaw, STATE_TABLE, 'unknown')
  if (!state.matched && stateRaw !== null) flags.push('unrecognised_site_state')

  const timeline_target = coerceText(pick(index, 'Timeline', 'timeline',
    'timeline_target', 'target_timeline'), 300)
  const site_available_from = coerceText(pick(index, 'site_available_from',
    'Site available from', 'possession_date'), 200)

  const deciderRaw = pick(index, 'Decision maker', 'decision_maker', 'decider', 'who_decides')
  const decider = matchEnum<LeadDecider>(deciderRaw, DECIDER_TABLE, 'unknown')
  if (!decider.matched && deciderRaw !== null) flags.push('unrecognised_decision_maker')

  const sourceRaw = pick(index, 'How they found Aangan', 'how_they_found_aangan',
    'how_they_found_us', 'source', 'referral_source', 'lead_source')
  const { source: referral_source, name: referral_name } = normalizeSource(sourceRaw)

  // Budget is the one field where null is the expected answer, not a defect.
  // The agent never asks. It is recorded only when the caller volunteers it,
  // so a missing value is never flagged.
  const budget_volunteered = coerceText(pick(index, 'Budget if volunteered',
    'budget_if_volunteered', 'budget', 'budget_volunteered'), 300)

  /* --- the decision --------------------------------------------- */
  const resultRaw = pick(index, 'Call outcome', 'call_outcome', 'outcome', 'result', 'status')
  const resultMatch = matchEnum<LeadResult>(resultRaw, RESULT_TABLE, 'incomplete')
  if (!resultMatch.matched) {
    flags.push(resultRaw === null ? 'missing_call_outcome' : 'unrecognised_call_outcome')
  }
  const result = resultMatch.value

  const criteria_failed = toStringArray(pick(index, 'criteria_failed', 'Criteria failed', 'failed_criteria'))
  const criteria_unclear = toStringArray(pick(index, 'criteria_unclear', 'Criteria unclear', 'unclear_criteria'))
  const decline_reason = coerceText(pick(index, 'decline_reason', 'Decline reason', 'reason_declined'), 500)
  const escalation_reason = coerceText(pick(index, 'escalation_reason', 'Escalation reason', 'reason_escalated'), 500)
  const agent_confidence = coerceText(pick(index, 'agent_confidence', 'confidence'), 50)

  /* --- consultation --------------------------------------------- */
  const consultationRaw = pick(index, 'Consultation booked', 'consultation_booked', 'booked')
  const consultation_booked = coerceBool(consultationRaw) ?? false
  if (consultationRaw !== null && coerceBool(consultationRaw) === null) {
    flags.push('unrecognised_consultation_booked')
  }
  const consultation_at = coerceTimestamp(pick(index, 'consultation_at',
    'Consultation at', 'consultation_time', 'appointment_at'))
  const consultation_type = coerceText(pick(index, 'consultation_type',
    'Consultation type', 'appointment_type'), 100)

  /* --- the pricing guardrail ------------------------------------ */
  const pricingCountRaw = pick(index, 'Times price was asked', 'times_price_was_asked',
    'pricing_asked_count', 'price_asked_count')
  const pricingCount = coerceInt(pricingCountRaw)
  if (pricingCountRaw !== null && pricingCount === null) flags.push('unrecognised_pricing_count')
  const pricing_asked_count = pricingCount !== null && pricingCount >= 0 ? pricingCount : 0

  const leakedRaw = pick(index, 'Price revealed by agent', 'price_revealed_by_agent',
    'pricing_leaked', 'price_revealed')
  const leaked = coerceBool(leakedRaw)
  if (leakedRaw !== null && leaked === null) {
    // An unreadable answer to "did you reveal a price" is treated as yes.
    // Rule 5 says this is an incident, and an incident we cannot rule out is
    // one we look at.
    flags.push('unrecognised_price_revealed_treated_as_leak')
  }
  const pricing_leaked = leakedRaw === null ? false : (leaked ?? true)

  const pushRaw = pick(index, 'outcome_after_push', 'Outcome after push', 'post_push_outcome')
  const pushMatch = matchEnum<PushOutcome>(pushRaw, PUSH_TABLE, 'undecided')
  const outcome_after_push = pricing_asked_count > 0
    ? (pushRaw !== null && pushMatch.matched ? pushMatch.value
       : consultation_booked ? 'booked' : 'undecided')
    : null

  /* --- cost ------------------------------------------------------ */
  const telephony_cost_inr = coerceMoney(pick(index, 'telephony_cost_inr',
    'telephony_cost', 'Telephony cost')) ?? 0
  const voice_agent_cost_inr = coerceMoney(pick(index, 'voice_agent_cost_inr',
    'voice_agent_cost', 'agent_cost', 'Voice agent cost')) ?? 0

  /* --- misc ------------------------------------------------------ */
  const languageRaw = pick(index, 'language', 'Language', 'detected_language')
  const languageMatch = matchEnum<LeadLanguage>(languageRaw, LANGUAGE_TABLE, 'english')
  const language = languageRaw === null ? null
    : languageMatch.matched ? languageMatch.value : 'mixed'

  const recording_url = coerceUrl(pick(index, 'recording_url', 'Recording URL', 'recording'))
  const transcript_url = coerceUrl(pick(index, 'transcript_url', 'Transcript URL'))
  const transcript = coerceText(pick(index, 'transcript', 'Transcript', 'conversation'), 100000)

  const channelText = coerceText(pick(index, 'channel', 'Channel', 'medium'), 40)
  const channel: MappedLead['channel'] =
    channelText && /whats\s*app/i.test(channelText) ? 'whatsapp'
    : channelText && /web|form|site/i.test(channelText) ? 'web_form'
    : 'phone'

  const lead: MappedLead = {
    vaani_call_id,
    received_at,
    answered_at,
    channel,
    duration_sec,
    recording_url,
    transcript_url,
    transcript,
    language,
    name,
    phone,
    locality,
    service_area: areaResult.area,
    property_type: property.property_type,
    carpet_area_sqft,
    scope,
    current_state: state.value,
    timeline_target,
    site_available_from,
    decision_maker: decider.value,
    referral_source,
    referral_name,
    budget_volunteered,
    result,
    criteria_failed,
    criteria_unclear: [...new Set([...criteria_unclear, ...areaResult.notes])],
    decline_reason,
    escalation_reason,
    agent_confidence,
    consultation_booked,
    consultation_at,
    consultation_type,
    pricing_asked_count,
    pricing_leaked,
    outcome_after_push,
    telephony_cost_inr,
    voice_agent_cost_inr,
    needs_review: false,
    raw_payload: payload ?? null,
  }

  // A lead needs a human when we could not read something that matters, when
  // the gate could not place the locality, or when the agent revealed a price.
  const significant = flags.filter((f) => f !== 'locality_missing')
  lead.needs_review =
    significant.length > 0 ||
    areaResult.needsReview ||
    lead.service_area === 'unknown' ||
    lead.pricing_leaked

  return { lead, flags }
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => coerceText(x, 200)).filter((x): x is string => x !== null)
  }
  const text = coerceText(v, 1000)
  if (text === null) return []
  return text.split(/[;,|]/).map((s) => s.trim()).filter((s) => s !== '')
}

function coerceUrl(v: unknown): string | null {
  const text = coerceText(v, 2000)
  if (text === null) return null
  try {
    const u = new URL(text)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
