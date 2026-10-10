import { describe, it, expect } from 'vitest'
import {
  qualify, compareWithAgent, parseLeadWeeks, parseBudgetRupees,
  type QualificationInput,
} from '../src/lib/qualification'
import { detectPricingLeak, splitTurns } from '../src/lib/pricing-leak'

/**
 * These fixtures are the real September 2026 enquiries from
 * data/september-2026-enquiries.txt, with the outcome the front desk actually
 * reached. They are the best test data available: a human already decided each
 * one, so the rubric in code can be checked against a real answer rather than
 * against my opinion of what it should say.
 */

describe('the five criteria, against real September calls', () => {
  it('T01 Kothrud 3BHK, March timeline, owner and spouse — qualified', () => {
    const r = qualify({
      locality: 'Kothrud', property_type: '3BHK', carpet_area_sqft: 1400,
      scope: 'Redo the whole thing — kitchen, living room, both bedrooms',
      timeline_target: '6 months', decision_maker: 'caller_and_partner',
      budget_volunteered: null,
    })
    expect(r.verdict).toBe('qualified')
    expect(r.failed).toEqual([])
  })

  it('T03 Nashik home office — declined on service area', () => {
    const r = qualify({
      locality: 'Nashik', property_type: 'home office and study',
      scope: 'Redo my home office and study', timeline_target: '3 months',
      decision_maker: 'caller',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('service_area')
    expect(r.declineReason).toMatch(/outside Pune/i)
  })

  it('T04 "just want suggestions on colours" — declined, not a real project', () => {
    const r = qualify({
      locality: 'Baner', scope: 'Just want suggestions on colours, furniture arrangement',
      timeline_target: 'flexible', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('real_project')
  })

  it('T07 living room and kitchen before Diwali, three weeks — declined on timeline', () => {
    const r = qualify({
      locality: 'Kothrud', scope: 'Living room and kitchen',
      timeline_target: '3 weeks', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('timeline')
    expect(r.declineReason).toMatch(/under 6/i)
  })

  it('T10 Kharadi 1BHK with a volunteered 1–1.5 lakh — declined on budget', () => {
    const r = qualify({
      locality: 'Kharadi', property_type: '1BHK', carpet_area_sqft: 550,
      scope: 'Kitchen and one bedroom', timeline_target: '4 months',
      decision_maker: 'caller', budget_volunteered: '1 to 1.5 lakh maximum',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('budget')
  })

  it('T11 rented flat in Baner, no structural changes — qualified', () => {
    // The rubric says a rented apartment does not disqualify.
    const r = qualify({
      locality: 'Baner', property_type: '2BHK',
      scope: 'Design the living room, bedroom and kitchen — no structural changes, design and fittings',
      timeline_target: '4 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('qualified')
  })

  it('T13 Aundh 3BHK where the caller pushed twice on price — still qualified', () => {
    // Asking for pricing explicitly does not disqualify.
    const r = qualify({
      locality: 'Aundh', property_type: '3BHK', carpet_area_sqft: 1100,
      scope: 'Kitchen, wardrobes in both bedrooms, living room',
      timeline_target: '3 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('qualified')
  })

  it('T14 son enquiring for parents who will attend — qualified, not declined', () => {
    const r = qualify({
      locality: 'Hadapsar', property_type: '3BHK', scope: 'Proper design, new possession',
      timeline_target: '4 months', decision_maker: 'researching_for_others',
      transcript: 'Caller: Yes, they would come. I am just calling to see if it is worth pursuing.',
    })
    expect(r.verdict).toBe('qualified')
    expect(r.failed).toEqual([])
  })

  it('T14 variant: researching for others with no confirmation — a question, not a decline', () => {
    const r = qualify({
      locality: 'Hadapsar', property_type: '3BHK', scope: 'Proper design',
      timeline_target: '4 months', decision_maker: 'researching_for_others',
    })
    // Rubric: unclear on criterion 5 means treat as qualified and note it.
    expect(r.verdict).toBe('qualified')
    expect(r.unclear).toContain('decision_maker')
  })

  it('T15 Undri possession in six weeks — qualified, at the edge', () => {
    const r = qualify({
      locality: 'Undri', property_type: '2BHK', carpet_area_sqft: 875,
      scope: 'Full home — kitchen, wardrobes, living room',
      timeline_target: '6 weeks', decision_maker: 'caller_and_partner',
    })
    expect(r.verdict).not.toBe('declined')
  })

  it('T18 a 180 sq ft coworking pod — declined, below minimum commercial scope', () => {
    const r = qualify({
      locality: 'Kothrud', property_type: 'coworking pod', carpet_area_sqft: 180,
      scope: 'Make the pod look nice — lighting, desk, storage',
      timeline_target: '2 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('real_project')
    expect(r.declineReason).toMatch(/below/i)
  })

  it('T19 a restaurant in Koregaon Park — declined, out of scope entirely', () => {
    const r = qualify({
      locality: 'Koregaon Park', property_type: 'restaurant',
      scope: 'Design the interiors for a restaurant I am opening',
      timeline_target: '4 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('real_project')
  })

  it('T06 an 800 sq ft Baner office — qualified, inside the commercial band', () => {
    const r = qualify({
      locality: 'Baner', property_type: 'office', carpet_area_sqft: 800,
      scope: 'Workstations for 20, a cabin, a meeting room, a break area. Bare shell fitout',
      timeline_target: '3 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('qualified')
  })

  it('F03 Talegaon Dabhade web form — declined on service area despite a good budget', () => {
    const r = qualify({
      locality: 'Talegaon Dabhade, near Pune', property_type: '3BHK independent house',
      carpet_area_sqft: 1400, scope: 'Everything from scratch',
      timeline_target: '3-4 months', decision_maker: 'caller',
      budget_volunteered: '₹ 15–20 lakh for the full home',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('service_area')
  })

  it('F08 Wakad, guests in three weeks, 4–5 lakh — two failures, declined', () => {
    const r = qualify({
      locality: 'Wakad', property_type: '2BHK', carpet_area_sqft: 875,
      scope: 'Living room and kitchen presentable before guests arrive',
      timeline_target: '3 weeks maximum', decision_maker: 'caller',
      budget_volunteered: '₹ 4–5 lakh',
    })
    expect(r.verdict).toBe('declined')
    expect(r.failed).toContain('timeline')
  })

  it('F04 a near-empty form asking the cost — cannot decide, asks a question', () => {
    const r = qualify({
      locality: 'Pune', scope: 'I want to know the cost of interior design',
      timeline_target: 'as soon as possible',
    })
    expect(r.verdict).toBe('needs_question')
    expect(r.unclear).toContain('service_area')   // "Pune" is not a locality
  })

  it('F05 a 2,200 sq ft Hinjewadi office — qualified', () => {
    const r = qualify({
      locality: 'Hinjewadi Phase 1', property_type: 'office', carpet_area_sqft: 2200,
      scope: 'Workstations for 55, four cabins, a boardroom, meeting rooms, lounge, pantry',
      timeline_target: '4 months', decision_maker: 'caller',
      budget_volunteered: '₹ 60–80 lakh all-in',
    })
    expect(r.verdict).toBe('qualified')
  })
})

describe('what must never disqualify', () => {
  const base: QualificationInput = {
    locality: 'Baner', property_type: '2BHK', carpet_area_sqft: 900,
    scope: 'Full home interiors with execution', timeline_target: '4 months',
    decision_maker: 'caller',
  }

  it.each([
    ['a single room with execution', { scope: 'Master bedroom only, complete redesign with execution' }],
    ['a rented apartment', { scope: 'Full interiors, rented flat, no structural changes' }],
    ['not knowing what they want', { scope: 'Not sure yet what we want, need design and execution' }],
    ['being uncertain about materials', { scope: 'Full home, uncertain about materials and style' }],
  ])('%s is still qualified', (_label, override) => {
    expect(qualify({ ...base, ...override }).verdict).not.toBe('declined')
  })

  it('a missing budget is a pass, not even a note', () => {
    const r = qualify(base)
    expect(r.unclear).not.toContain('budget')
    expect(r.failed).not.toContain('budget')
  })
})

describe('the boundary rules', () => {
  it('two failures decline', () => {
    const r = qualify({
      locality: 'Lonavala', scope: 'Just want advice on colours',
      timeline_target: '6 months', decision_maker: 'caller',
    })
    expect(r.failed.length).toBeGreaterThanOrEqual(2)
    expect(r.verdict).toBe('declined')
  })

  it('an unrecognised locality asks a question rather than declining', () => {
    const r = qualify({
      locality: 'Katraj', property_type: '3BHK', scope: 'Full home interiors',
      timeline_target: '5 months', decision_maker: 'caller',
    })
    expect(r.verdict).toBe('needs_question')
    expect(r.failed).not.toContain('service_area')
  })

  it('never throws on an entirely empty input', () => {
    expect(() => qualify({})).not.toThrow()
    expect(qualify({}).verdict).toBe('needs_question')
  })
})

describe('parsing helpers', () => {
  it.each([
    ['3 weeks', 3], ['6 weeks', 6], ['4 months', 17.38], ['2 months', 8.69],
  ])('parseLeadWeeks(%s)', (input, expected) => {
    expect(parseLeadWeeks(input)).toBeCloseTo(expected, 1)
  })

  it.each(['as soon as possible', 'flexible', 'no rush', 'before Diwali', 'by March', ''])(
    'parseLeadWeeks returns null for "%s" rather than guessing zero', (input) => {
      expect(parseLeadWeeks(input)).toBeNull()
    })

  it.each([
    ['1 to 1.5 lakh maximum', 100000],
    ['₹ 15–20 lakh for the full home', 1500000],
    ['around 12 lakh', 1200000],
    ['₹ 60–80 lakh all-in', 6000000],
    ['1 crore', 10000000],
  ])('parseBudgetRupees(%s) takes the lower bound', (input, expected) => {
    expect(parseBudgetRupees(input)).toBe(expected)
  })

  it('parseBudgetRupees gives up rather than inventing a number', () => {
    expect(parseBudgetRupees('reasonable')).toBeNull()
    expect(parseBudgetRupees('Prefer not to mention')).toBeNull()
    expect(parseBudgetRupees(null)).toBeNull()
  })
})

describe('agreeing and disagreeing with the agent', () => {
  it('says nothing when both agree', () => {
    const ours = qualify({
      locality: 'Baner', scope: 'Full home interiors with execution',
      timeline_target: '4 months', decision_maker: 'caller',
    })
    expect(compareWithAgent(ours, 'qualified').agrees).toBe(true)
    expect(compareWithAgent(ours, 'qualified').note).toBeNull()
  })

  it('flags an agent that qualified a lead the rubric declines', () => {
    const ours = qualify({
      locality: 'Lonavala', scope: 'Full home interiors',
      timeline_target: '4 months', decision_maker: 'caller',
    })
    const comparison = compareWithAgent(ours, 'qualified')
    expect(comparison.agrees).toBe(false)
    expect(comparison.note).toContain('service_area')
  })

  it('flags an agent that declined a lead the rubric would have qualified', () => {
    const ours = qualify({
      locality: 'Kothrud', scope: 'Full home interiors with execution',
      timeline_target: '5 months', decision_maker: 'caller',
    })
    expect(compareWithAgent(ours, 'declined').agrees).toBe(false)
  })

  it('does not second-guess an escalation', () => {
    const ours = qualify({ locality: 'Lonavala', scope: 'advice only' })
    expect(compareWithAgent(ours, 'escalated').agrees).toBe(true)
  })
})

/* ------------------------------------------------------------------ */

describe('pricing leak detection, independent of what the agent reports', () => {
  it('passes a clean deflection — the real T02 exchange', () => {
    const transcript = [
      'Caller: can you tell me roughly how much something like that would cost?',
      'Agent: Our pricing depends on the materials and the scope — the best way to get a clear picture is a consultation with one of our designers.',
      'Caller: Yes, but can you give me a rough ballpark first? Even a range?',
      'Agent: I genuinely cannot — it varies quite a bit based on materials. Giving you a number without seeing the site would be misleading.',
    ].join('\n')
    expect(detectPricingLeak(transcript, false).verdict).toBe('clean')
  })

  it('catches a per-sq-ft rate the agent did not report', () => {
    const transcript = [
      'Caller: roughly what does it cost?',
      'Agent: For a standard specification we are usually 1,800 to 2,400 per sq ft.',
    ].join('\n')
    const finding = detectPricingLeak(transcript, false)
    expect(finding.verdict).toBe('leaked')
    expect(finding.reasons.join()).toContain('agent_said:per_square_foot_rate')
  })

  it.each([
    'Agent: It will cost around 12 lakh for a flat that size.',
    'Agent: Our rates start at 1800 per square foot.',
    'Agent: For a 2BHK it is typically 10 to 14 lakh.',
    'Agent: The ballpark is about ₹15,00,000.',
  ])('catches "%s"', (line) => {
    expect(detectPricingLeak(`Caller: how much?\n${line}`, false).verdict).toBe('leaked')
  })

  it('does NOT count a caller volunteering their own budget', () => {
    // This is the budget field doing its job. Counting it would make the one
    // number that must read zero into noise.
    const transcript = [
      'Caller: My budget is 1 to 1.5 lakh maximum for everything. Is that possible?',
      'Agent: I appreciate you sharing that. For a kitchen and a bedroom with full execution that would be significantly below what a project of that scope would cost with us.',
      'Caller: Even for one bedroom?',
      'Agent: Even for one room. I would not want to bring you to a consultation if the numbers do not align.',
    ].join('\n')
    expect(detectPricingLeak(transcript, false).verdict).toBe('clean')
  })

  it('reports unattributed rather than guessing when there are no speaker labels', () => {
    const finding = detectPricingLeak('it would be around 2400 per sq ft for premium', false)
    expect(finding.verdict).toBe('unattributed')
    expect(finding.evidence.length).toBeGreaterThan(0)
  })

  it('always believes the agent when it admits a leak', () => {
    expect(detectPricingLeak('Agent: no numbers were said at all', true).verdict).toBe('leaked')
    expect(detectPricingLeak(null, true).verdict).toBe('leaked')
  })

  it('is clean on an empty or missing transcript', () => {
    expect(detectPricingLeak(null, false).verdict).toBe('clean')
    expect(detectPricingLeak('', false).verdict).toBe('clean')
  })

  it('does not mistake areas, room counts or timelines for prices', () => {
    const transcript = [
      'Agent: How big is the apartment?',
      'Caller: About 1,400 sq ft carpet. It is a 3BHK.',
      'Agent: And your timeline? Execution takes 8 to 16 weeks.',
    ].join('\n')
    expect(detectPricingLeak(transcript, false).verdict).toBe('clean')
  })

  it('splits speaker turns from the shapes these platforms emit', () => {
    expect(splitTurns('Agent: hello\nCaller: hi').map((t) => t.speaker))
      .toEqual(['agent', 'caller'])
    expect(splitTurns('[Agent] hello\n[Caller] hi').map((t) => t.speaker))
      .toEqual(['agent', 'caller'])
    expect(splitTurns('Front Desk: hello').map((t) => t.speaker)).toEqual(['unknown'])
  })
})
