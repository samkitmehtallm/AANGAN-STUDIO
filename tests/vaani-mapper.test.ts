import { describe, it, expect } from 'vitest'
import {
  mapVaaniPayload, coercePhone, coerceTimestamp, coerceDuration, coerceBool,
  coerceInt, splitPropertyAndArea, normalizeSource,
} from '../src/lib/vaani'

const NOW = new Date('2026-10-10T12:00:00.000Z')

/** A clean, fully-populated call using Vaani's exact field names. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    call_id: 'vaani_call_0001',
    received_at: '2026-10-09T05:30:00.000Z',
    answered_at: '2026-10-09T05:30:04.000Z',
    duration_sec: 212,
    recording_url: 'https://cdn.vaani.ai/rec/0001.mp3',
    language: 'english',
    telephony_cost_inr: 3.1,
    voice_agent_cost_inr: 9.4,
    'Caller name': 'Rhea Kulkarni',
    'Callback number': '98765 43210',
    'Locality': 'Baner',
    'Property type and area': '3BHK, 1250 sqft',
    'Scope of work': 'Full home interiors including modular kitchen',
    'Current state of site': 'builder handover',
    'Timeline': 'Start in 6 weeks',
    'Decision maker': 'caller and partner',
    'How they found Aangan': 'referral - Meera Joshi',
    'Budget if volunteered': null,
    'Consultation booked': 'yes',
    'Times price was asked': 0,
    'Price revealed by agent': 'no',
    'Call outcome': 'qualified',
    ...overrides,
  }
}

describe('a valid payload', () => {
  const { lead, flags } = mapVaaniPayload(validPayload(), { now: NOW })

  it('maps every field the brief names', () => {
    expect(lead.vaani_call_id).toBe('vaani_call_0001')
    expect(lead.name).toBe('Rhea Kulkarni')
    expect(lead.phone).toBe('+919876543210')
    expect(lead.locality).toBe('Baner')
    expect(lead.service_area).toBe('in_area')
    expect(lead.property_type).toBe('3BHK')
    expect(lead.carpet_area_sqft).toBe(1250)
    expect(lead.scope).toContain('modular kitchen')
    expect(lead.current_state).toBe('builder_handover')
    expect(lead.timeline_target).toBe('Start in 6 weeks')
    expect(lead.decision_maker).toBe('caller_and_partner')
    expect(lead.referral_source).toBe('referral')
    expect(lead.referral_name).toBe('Meera Joshi')
    expect(lead.consultation_booked).toBe(true)
    expect(lead.pricing_asked_count).toBe(0)
    expect(lead.pricing_leaked).toBe(false)
    expect(lead.result).toBe('qualified')
    expect(lead.channel).toBe('phone')
  })

  it('keeps received_at as the ring, not the answer', () => {
    expect(lead.received_at).toBe('2026-10-09T05:30:00.000Z')
    expect(lead.answered_at).toBe('2026-10-09T05:30:04.000Z')
  })

  it('raises no flags and needs no review', () => {
    expect(flags).toEqual([])
    expect(lead.needs_review).toBe(false)
  })

  it('keeps the raw payload verbatim', () => {
    expect(lead.raw_payload).toMatchObject({ call_id: 'vaani_call_0001' })
  })
})

describe('budget', () => {
  it('treats a missing budget as normal, not as a defect', () => {
    const { lead, flags } = mapVaaniPayload(validPayload(), { now: NOW })
    expect(lead.budget_volunteered).toBeNull()
    expect(flags.join()).not.toContain('budget')
    expect(lead.needs_review).toBe(false)
  })

  it('records a volunteered budget when the caller offers one', () => {
    const { lead } = mapVaaniPayload(
      validPayload({ 'Budget if volunteered': 'around 12 lakh' }), { now: NOW })
    expect(lead.budget_volunteered).toBe('around 12 lakh')
  })
})

describe('missing and junk fields', () => {
  it('never throws, whatever arrives', () => {
    const horrors: unknown[] = [
      null, undefined, {}, [], 'a string', 42, true,
      { 'Caller name': { nested: 'object' }, 'Callback number': ['array'] },
      { 'Call outcome': 12345, 'Times price was asked': 'banana' },
      { received_at: 'not a date', answered_at: '0000-00-00' },
      { 'Locality': 999, 'Property type and area': false },
      JSON.parse('{"a":{"b":{"c":{"d":1}}}}'),
    ]
    for (const payload of horrors) {
      expect(() => mapVaaniPayload(payload, { now: NOW })).not.toThrow()
      const { lead } = mapVaaniPayload(payload, { now: NOW })
      expect(typeof lead.vaani_call_id).toBe('string')
      expect(lead.vaani_call_id.length).toBeGreaterThan(0)
      expect(lead.received_at).toBeTruthy()
    }
  })

  it('produces a writable row from a completely empty payload', () => {
    const { lead, flags } = mapVaaniPayload({}, { now: NOW })
    expect(lead.received_at).toBe(NOW.toISOString())
    expect(lead.result).toBe('incomplete')
    expect(lead.service_area).toBe('unknown')
    expect(lead.needs_review).toBe(true)
    expect(flags).toContain('missing_call_id')
    expect(flags).toContain('missing_call_outcome')
  })

  it('flags an unparseable callback number but keeps the lead', () => {
    const { lead, flags } = mapVaaniPayload(
      validPayload({ 'Callback number': 'not a number at all' }), { now: NOW })
    expect(lead.phone).toBeNull()
    expect(flags).toContain('unparseable_callback_number')
    expect(lead.needs_review).toBe(true)
    expect(lead.name).toBe('Rhea Kulkarni')  // the rest still maps
  })

  it('falls back to the answer time when there is no ring time, and says so', () => {
    const p = validPayload()
    delete (p as Record<string, unknown>).received_at
    const { lead, flags } = mapVaaniPayload(p, { now: NOW })
    expect(lead.received_at).toBe('2026-10-09T05:30:04.000Z')
    expect(flags).toContain('received_at_fallback_to_answered')
  })

  it('treats agent placeholder strings as missing, not as values', () => {
    const { lead } = mapVaaniPayload(
      validPayload({ 'Caller name': 'not provided', 'Scope of work': 'N/A' }), { now: NOW })
    expect(lead.name).toBeNull()
    expect(lead.scope).toBeNull()
  })
})

describe('service area is resolved during mapping', () => {
  it.each([
    ['Baner', 'in_area', false],
    ['Talegaon, near Pune', 'out_of_area', false],
    ['Timbuktu', 'unknown', true],
  ])('%s -> %s', (locality, area, review) => {
    const { lead } = mapVaaniPayload(validPayload({ Locality: locality }), { now: NOW })
    expect(lead.service_area).toBe(area)
    expect(lead.needs_review).toBe(review)
  })

  it('never writes in_area for an unrecognised locality', () => {
    const { lead } = mapVaaniPayload(validPayload({ Locality: 'Mars' }), { now: NOW })
    expect(lead.service_area).toBe('unknown')
  })
})

describe('the pricing guardrail', () => {
  it('records a push that did not leak', () => {
    const { lead } = mapVaaniPayload(validPayload({
      'Times price was asked': 3, 'Price revealed by agent': 'no',
    }), { now: NOW })
    expect(lead.pricing_asked_count).toBe(3)
    expect(lead.pricing_leaked).toBe(false)
    expect(lead.outcome_after_push).toBe('booked')
  })

  it('records a leak and forces review', () => {
    const { lead } = mapVaaniPayload(validPayload({
      'Times price was asked': 2, 'Price revealed by agent': 'yes',
    }), { now: NOW })
    expect(lead.pricing_leaked).toBe(true)
    expect(lead.needs_review).toBe(true)
  })

  it('treats an unreadable answer to "price revealed" as a leak', () => {
    const { lead, flags } = mapVaaniPayload(validPayload({
      'Price revealed by agent': 'the agent mentioned a ballpark',
    }), { now: NOW })
    expect(lead.pricing_leaked).toBe(true)
    expect(flags).toContain('unrecognised_price_revealed_treated_as_leak')
  })

  it('leaves outcome_after_push null when price was never asked', () => {
    const { lead } = mapVaaniPayload(validPayload(), { now: NOW })
    expect(lead.outcome_after_push).toBeNull()
  })
})

describe('coercions', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['  9876543210  ', '+919876543210'],
  ])('coercePhone(%s)', (input, expected) => {
    expect(coercePhone(input)).toBe(expected)
  })

  it.each(['', '   ', 'abcd', '123', null, undefined, {}, []])(
    'coercePhone rejects %s', (input) => {
      expect(coercePhone(input as unknown)).toBeNull()
    })

  it.each([
    ['212', 212], [212, 212], ['3:32', 212], ['3m 32s', 212], ['3 min', 180],
  ])('coerceDuration(%s) = %s', (input, expected) => {
    expect(coerceDuration(input as unknown)).toBe(expected)
  })

  it.each([
    ['yes', true], ['Yes', true], ['TRUE', true], ['1', true], [1, true], [true, true],
    ['no', false], ['false', false], ['0', false], [0, false], [false, false],
  ])('coerceBool(%s) = %s', (input, expected) => {
    expect(coerceBool(input as unknown)).toBe(expected)
  })

  it('coerceBool returns null for things that are neither', () => {
    expect(coerceBool('maybe')).toBeNull()
    expect(coerceBool({})).toBeNull()
  })

  it('coerceTimestamp rejects nonsense but accepts epoch and ISO', () => {
    expect(coerceTimestamp('2026-10-09T05:30:00Z')).toBe('2026-10-09T05:30:00.000Z')
    expect(coerceTimestamp(1760000000)).toMatch(/^20\d\d-/)
    expect(coerceTimestamp('not a date')).toBeNull()
    expect(coerceTimestamp('1823-01-01')).toBeNull()
  })

  it('coerceInt digs a number out of a string', () => {
    expect(coerceInt('asked 3 times')).toBe(3)
    expect(coerceInt('banana')).toBeNull()
  })
})

describe('property type and area', () => {
  it.each([
    ['3BHK, 1250 sqft', '3BHK', 1250],
    ['2 BHK apartment 980 sq ft', '2 BHK apartment', 980],
    ['Duplex villa, 3,400 square feet', 'Duplex villa', 3400],
    ['4BHK', '4BHK', null],
  ])('%s', (input, type, area) => {
    const r = splitPropertyAndArea(input)
    expect(r.property_type).toBe(type)
    expect(r.carpet_area_sqft).toBe(area)
  })

  it('never reads a BHK count as a square footage', () => {
    expect(splitPropertyAndArea('4 BHK').carpet_area_sqft).toBeNull()
  })

  it('rejects an implausible area', () => {
    expect(splitPropertyAndArea('3BHK, 9999999 sqft').carpet_area_sqft).toBeNull()
  })
})

describe('how they found Aangan', () => {
  it.each([
    ['referral - Meera Joshi', 'referral', 'Meera Joshi'],
    ['referred by Anil Deshpande', 'referral', 'Anil Deshpande'],
    ['Referral (Priya)', 'referral', 'Priya'],
    ['instagram', 'instagram', null],
    ['Google search', 'google', null],
    ['LinkedIn', 'linkedin', null],
    ['our builder', 'builder', null],
    ['saw it in a magazine', 'press', null],
  ])('%s', (input, source, name) => {
    const r = normalizeSource(input)
    expect(r.source).toBe(source)
    expect(r.name).toBe(name)
  })

  it('files anything unrecognised as other and keeps the words', () => {
    const r = normalizeSource('a hoarding near the highway')
    expect(r.source).toBe('other')
    expect(r.name).toBe('a hoarding near the highway')
  })
})

describe('nested payload shapes', () => {
  it('finds fields inside an extracted_fields container', () => {
    const { lead } = mapVaaniPayload({
      call_id: 'x1',
      extracted_fields: { 'Caller name': 'Nikhil Rao', Locality: 'Kharadi' },
    }, { now: NOW })
    expect(lead.name).toBe('Nikhil Rao')
    expect(lead.service_area).toBe('in_area')
  })

  it('prefers a top-level value over a nested one', () => {
    const { lead } = mapVaaniPayload({
      call_id: 'x2', Locality: 'Baner',
      extracted: { Locality: 'Lonavala' },
    }, { now: NOW })
    expect(lead.locality).toBe('Baner')
  })
})
