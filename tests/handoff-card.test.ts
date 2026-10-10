import { describe, it, expect } from 'vitest'
import { renderHandoffCard, assertNoPhoneNumber, cardFlags, type CardLead } from '../src/lib/handoff-card'

const BASE = 'https://aangan.example.com'

function lead(overrides: Partial<CardLead> = {}): CardLead {
  return {
    lead_id: '11111111-2222-3333-4444-555555555555',
    name: 'Rhea Kulkarni',
    locality: 'Baner',
    service_area: 'in_area',
    property_type: '3BHK',
    carpet_area_sqft: 1250,
    scope: 'Full home interiors including modular kitchen',
    current_state: 'builder_handover',
    timeline_target: 'Start in 6 weeks',
    decision_maker: 'caller_and_partner',
    referral_source: 'referral',
    referral_name: 'Meera Joshi',
    budget_volunteered: null,
    received_at: '2026-10-09T05:30:00.000Z',
    result: 'qualified',
    criteria_failed: [],
    criteria_unclear: [],
    needs_review: false,
    pricing_asked_count: 0,
    pricing_leaked: false,
    language: 'english',
    duration_sec: 212,
    ...overrides,
  }
}

describe('the card carries what the brief asks for', () => {
  const card = renderHandoffCard(lead(), { baseUrl: BASE, claimUrl: `${BASE}/api/claim/abc`, passUrl: `${BASE}/api/claim/def` })

  it.each([
    ['name', 'Rhea Kulkarni'],
    ['locality', 'Baner'],
    ['property', '3BHK'],
    ['area', '1250 sqft'],
    ['scope', 'modular kitchen'],
    ['state of site', 'Builder handover'],
    ['timeline', 'Start in 6 weeks'],
    ['who decides', 'Caller and partner'],
    ['source', 'Meera Joshi'],
    ['budget', 'Not volunteered'],
  ])('includes the %s', (_label, value) => {
    expect(card.text).toContain(value)
  })

  it('shows the call time in the studio timezone', () => {
    // 05:30 UTC is 11:00 am in Pune. A designer must never read a UTC clock.
    expect(card.text).toMatch(/11:00\s*am/i)
  })

  it('offers Claim and Can\'t-take-it', () => {
    expect(card.text).toContain('Claim this lead')
    expect(card.text).toContain("Can't take it")
    expect(card.html).toContain(`${BASE}/api/claim/abc`)
  })

  it('links to the record for the number', () => {
    expect(card.text).toContain(`${BASE}/dashboard/leads/11111111-2222-3333-4444-555555555555`)
  })
})

describe('RULE 3: the card never contains a phone number', () => {
  it('has no number in a normal card', () => {
    const card = renderHandoffCard(lead(), { baseUrl: BASE, claimUrl: `${BASE}/api/claim/abc` })
    for (const part of [card.subject, card.text, card.html]) {
      expect(part).not.toMatch(/\+91/)
      expect(part).not.toContain('9876543210')
      expect(part).not.toMatch(/98765[\s-]?43210/)
    }
  })

  it('refuses to render when a number is hiding in a free-text field', () => {
    // This is the realistic leak: the agent transcribes "call me on 98765 43210"
    // into the scope note, and it rides out to a shared inbox inside the body.
    const cases: Array<Partial<CardLead>> = [
      { scope: 'Full home, call me on 9876543210' },
      { name: 'Rhea Kulkarni +91 98765 43210' },
      { timeline_target: 'call 098765-43210 after 6pm' },
      { locality: 'Baner, alt number 9876543210' },
      { referral_name: 'Meera Joshi (9876543210)' },
      { budget_volunteered: '12 lakh, whatsapp 919876543210' },
    ]
    for (const override of cases) {
      expect(() => renderHandoffCard(lead(override), { baseUrl: BASE }))
        .toThrow(/Rule 3 violation/)
    }
  })

  it('still renders cards whose numbers are legitimately short', () => {
    expect(() => renderHandoffCard(
      lead({ property_type: '3BHK', carpet_area_sqft: 1250, scope: '2 bathrooms, 4 wardrobes' }),
      { baseUrl: BASE, claimUrl: `${BASE}/api/claim/abc` }
    )).not.toThrow()
  })

  it('does not mistake signed links or uuids for numbers', () => {
    expect(() => renderHandoffCard(lead(), {
      baseUrl: BASE,
      claimUrl: `${BASE}/api/claim/Y2xhaW06MTExMTExMTEtMjIyMi0zMzMz.9876543210abcdef1234567890`,
    })).not.toThrow()
  })

  describe('assertNoPhoneNumber directly', () => {
    it.each([
      '9876543210',
      '+91 98765 43210',
      '+919876543210',
      '098765 43210',
      '98765-43210',
      'reach him on 9 8 7 6 5 4 3 2 1 0',
    ])('rejects "%s"', (text) => {
      expect(() => assertNoPhoneNumber(text)).toThrow(/Rule 3 violation/)
    })

    it.each([
      '1250 sqft',
      'Budget around 12 lakh',
      '3BHK, 2 baths',
      'Thu, 9 Oct, 11:00 am',
      'lead 11111111-2222-3333-4444-555555555555',
    ])('allows "%s"', (text) => {
      expect(() => assertNoPhoneNumber(text)).not.toThrow()
    })
  })
})

describe('escalation cards', () => {
  it('carry no Claim button', () => {
    const card = renderHandoffCard(
      lead({ result: 'escalated', escalation_reason: 'Caller asked for the founder by name' }),
      { baseUrl: BASE, kind: 'escalation' }
    )
    expect(card.text).not.toContain('Claim this lead')
    expect(card.html).not.toContain('/api/claim/')
    expect(card.subject).toContain('ESCALATION')
    expect(card.text).toContain('Caller asked for the founder by name')
  })
})

describe('reposts', () => {
  it('lead with the age', () => {
    const card = renderHandoffCard(lead(), {
      baseUrl: BASE, kind: 'repost', ageSeconds: 45 * 60, claimUrl: `${BASE}/api/claim/abc`,
    })
    expect(card.subject).toContain('UNCLAIMED')
    expect(card.subject).toContain('45 min')
    expect(card.text).toContain('STILL UNCLAIMED')
  })
})

describe('flags', () => {
  it('warns on an unknown locality', () => {
    expect(cardFlags(lead({ service_area: 'unknown', locality: 'Timbuktu' })).join())
      .toContain('not recognised')
  })

  it('calls a price leak an incident', () => {
    expect(cardFlags(lead({ pricing_leaked: true })).join()).toContain('incident')
  })

  it('notes repeated pricing pressure', () => {
    expect(cardFlags(lead({ pricing_asked_count: 3 })).join()).toContain('3 times')
  })

  it('says nothing when there is nothing to say', () => {
    expect(cardFlags(lead())).toEqual([])
  })
})

describe('missing fields', () => {
  it('renders a card for a lead where almost nothing was captured', () => {
    const sparse: CardLead = {
      lead_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: null, locality: null, service_area: 'unknown', property_type: null,
      carpet_area_sqft: null, scope: null, current_state: null, timeline_target: null,
      decision_maker: null, referral_source: null, referral_name: null,
      budget_volunteered: null, received_at: '2026-10-09T05:30:00.000Z', result: 'incomplete',
    }
    const card = renderHandoffCard(sparse, { baseUrl: BASE })
    expect(card.text).toContain('Caller name not captured')
    expect(card.subject).toBeTruthy()
  })
})
