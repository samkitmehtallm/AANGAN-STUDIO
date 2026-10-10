import { describe, it, expect } from 'vitest'
import schema from './fixtures/vaani-live-schema.json'
import { mapVaaniPayload } from '../src/lib/vaani'

/**
 * The mapper, checked against the agent that will actually call it.
 *
 * tests/fixtures/vaani-live-schema.json was pulled from the live Vaani agent
 * (42022c05-…, "Aangan Studio — Front Desk") rather than written from the
 * brief. The brief and the console can drift; this is what is really deployed.
 *
 * If someone renames a field in the Vaani console, these tests fail and say
 * which one - which is much better than a silent null arriving in production
 * and a lead going out with half a card.
 */

const FIELDS = schema.fields as Array<{ name: string; values: string[]; nullable: boolean }>

/** Where each live field is expected to land on the row. */
const EXPECTED: Record<string, string> = {
  'Caller name': 'name',
  'Callback number': 'phone',
  'Locality': 'locality',
  'Property type and area': 'property_type',
  'Scope of work': 'scope',
  'Current state of site': 'current_state',
  'Timeline': 'timeline_target',
  'Decision maker': 'decision_maker',
  'How they found Aangan': 'referral_source',
  'Budget if volunteered': 'budget_volunteered',
  'Consultation booked': 'consultation_booked',
  'Times price was asked': 'pricing_asked_count',
  'Price revealed by agent': 'pricing_leaked',
  'Call outcome': 'result',
}

describe('the live agent schema', () => {
  it('still has the 14 fields the mapper was built for', () => {
    expect(FIELDS).toHaveLength(14)
  })

  it('has not renamed a field out from under the mapper', () => {
    const live = FIELDS.map((f) => f.name).sort()
    const expected = Object.keys(EXPECTED).sort()
    expect(live).toEqual(expected)
  })

  it.each(Object.entries(EXPECTED))(
    'maps the live field "%s" onto %s', (fieldName, column) => {
      const sample: Record<string, string> = {
        'Caller name': 'Rhea Kulkarni',
        'Callback number': '9876543210',
        'Locality': 'Baner',
        'Property type and area': '3BHK 1400 sq ft',
        'Scope of work': 'Kitchen, wardrobes and living room',
        'Current state of site': 'builder handover',
        'Timeline': 'Start in 3 months',
        'Decision maker': 'caller and partner',
        'How they found Aangan': 'referral',
        'Budget if volunteered': '15 lakh',
        'Consultation booked': 'Saturday 10:30am, site visit',
        'Times price was asked': '2',
        'Price revealed by agent': 'no',
        'Call outcome': 'qualified',
      }
      const { lead } = mapVaaniPayload({ call_id: 'live-schema', ...sample })
      const value = (lead as unknown as Record<string, unknown>)[column]
      expect(value).not.toBeNull()
      expect(value).not.toBeUndefined()
    })

  describe('every enum value the live agent can emit is understood', () => {
    const enumFields = FIELDS.filter((f) => f.values.length > 0)

    it('covers the five fields with fixed values', () => {
      expect(enumFields.map((f) => f.name).sort()).toEqual([
        'Call outcome', 'Current state of site', 'Decision maker',
        'How they found Aangan', 'Price revealed by agent',
      ])
    })

    for (const field of FIELDS.filter((f) => f.values.length > 0)) {
      for (const value of field.values) {
        it(`"${field.name}" = "${value}" maps to something real`, () => {
          const { lead } = mapVaaniPayload({
            call_id: `enum-${field.name}-${value}`,
            Locality: 'Baner',
            [field.name]: value,
          })
          const column = EXPECTED[field.name]
          const mapped = (lead as unknown as Record<string, unknown>)[column]

          // The point: no live enum value may fall through to the catch-all.
          if (field.name === 'Decision maker') expect(mapped).not.toBe('unknown')
          if (field.name === 'Current state of site') expect(mapped).not.toBe('unknown')
          if (field.name === 'Call outcome') {
            expect(['qualified', 'declined', 'escalated', 'incomplete']).toContain(mapped)
            if (value !== 'incomplete') expect(mapped).toBe(value)
          }
          if (field.name === 'How they found Aangan') expect(mapped).toBe(value)
        })
      }
    }
  })

  it('a full payload in the live shape produces a clean row', () => {
    const { lead, flags } = mapVaaniPayload({
      call_id: 'vaani_live_1',
      received_at: '2026-10-10T05:30:00.000Z',
      answered_at: '2026-10-10T05:30:03.000Z',
      'Caller name': 'Rhea Kulkarni',
      'Callback number': '9876543210',
      'Locality': 'Kothrud',
      'Property type and area': '3BHK 1400 sq ft',
      'Scope of work': 'Kitchen, wardrobes in both bedrooms and living room',
      'Current state of site': 'builder handover',
      'Timeline': 'Complete by March, site available now',
      'Decision maker': 'caller and partner',
      'How they found Aangan': 'referral',
      'Budget if volunteered': null,
      'Consultation booked': 'Saturday 10:30am, site visit',
      'Times price was asked': '0',
      'Price revealed by agent': 'no',
      'Call outcome': 'qualified',
    })

    expect(lead.name).toBe('Rhea Kulkarni')
    expect(lead.phone).toBe('+919876543210')
    expect(lead.service_area).toBe('in_area')
    expect(lead.property_type).toBe('3BHK')
    expect(lead.carpet_area_sqft).toBe(1400)
    expect(lead.decision_maker).toBe('caller_and_partner')
    expect(lead.consultation_booked).toBe(true)
    expect(lead.result).toBe('qualified')
    expect(lead.pricing_leaked).toBe(false)
    expect(lead.needs_review).toBe(false)
    expect(flags).toEqual([])
  })

  it('the "Callback number" prompt says digits only, and digits only still parse', () => {
    // The live prompt instructs the agent to output bare digits. That is the
    // shape most likely to arrive, so it is the shape most worth asserting.
    const { lead } = mapVaaniPayload({ call_id: 'digits', 'Callback number': '9876543210' })
    expect(lead.phone).toBe('+919876543210')
  })

  it('"Consultation booked" arrives as free text, not a boolean', () => {
    // The live prompt asks for "the exact agreed day and time", so the mapper
    // must read a sentence as true rather than expecting yes/no.
    const { lead } = mapVaaniPayload({
      call_id: 'consult', 'Consultation booked': 'Saturday 4 October, 10:30 AM, site visit',
    })
    expect(lead.consultation_booked).toBe(true)
  })
})
