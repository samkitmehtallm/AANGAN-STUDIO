import { describe, it, expect } from 'vitest'
import {
  resolveServiceArea,
  normalizeLocality,
  IN_AREA_LOCALITIES,
  OUT_OF_AREA_LOCALITIES,
} from '../src/lib/service-area'

describe('in-area localities', () => {
  for (const name of IN_AREA_LOCALITIES) {
    it(`resolves ${name} as in_area`, () => {
      const r = resolveServiceArea(name)
      expect(r.area).toBe('in_area')
      expect(r.canonical).toBe(name)
      expect(r.needsReview).toBe(false)
    })
  }
})

describe('out-of-area localities', () => {
  for (const name of OUT_OF_AREA_LOCALITIES) {
    it(`resolves ${name} as out_of_area`, () => {
      expect(resolveServiceArea(name).area).toBe('out_of_area')
    })
  }
})

describe('unknown localities', () => {
  const unrecognised = ['Timbuktu', 'Sector 7', 'Katraj', 'Pune', 'asdfgh', '12345']
  for (const name of unrecognised) {
    it(`resolves "${name}" as unknown and flags it`, () => {
      const r = resolveServiceArea(name)
      expect(r.area).toBe('unknown')
      expect(r.canonical).toBeNull()
      expect(r.needsReview).toBe(true)
    })
  }

  it('NEVER defaults an unrecognised locality to in_area', () => {
    // The single most expensive wrong answer this module could give.
    const samples = [
      'Timbuktu', '', '   ', null, undefined, 42, {}, [], 'Pune', 'Maharashtra',
      'somewhere near the airport', 'ghfkjdshgkjfd',
    ]
    for (const s of samples) {
      expect(resolveServiceArea(s as unknown).area).not.toBe('in_area')
    }
  })
})

describe('missing and junk input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace only', '   \n\t  '],
    ['a number', 42],
    ['an object', { locality: 'Baner' }],
    ['an array', ['Baner']],
    ['a boolean', true],
  ])('%s resolves to unknown without throwing', (_label, value) => {
    const r = resolveServiceArea(value as unknown)
    expect(r.area).toBe('unknown')
    expect(r.needsReview).toBe(true)
  })
})

describe('case and whitespace', () => {
  it.each([
    'baner', 'BANER', 'BaNeR', '  Baner  ', '\tBaner\n', 'Baner.', 'Baner,',
  ])('"%s" is Baner', (input) => {
    const r = resolveServiceArea(input)
    expect(r.area).toBe('in_area')
    expect(r.canonical).toBe('Baner')
  })

  it.each([
    'Koregaon Park', 'koregaon  park', 'KOREGAON-PARK', ' koregaon park ',
  ])('"%s" is Koregaon Park', (input) => {
    expect(resolveServiceArea(input).canonical).toBe('Koregaon Park')
  })

  it('normalizes punctuation and separators to single spaces', () => {
    expect(normalizeLocality('  Pimple--Saudagar,  ')).toBe('pimple saudagar')
  })
})

describe('OUT is evaluated before IN', () => {
  it('"Talegaon, near Pune" is out_of_area', () => {
    const r = resolveServiceArea('Talegaon, near Pune')
    expect(r.area).toBe('out_of_area')
    expect(r.canonical).toBe('Talegaon')
  })

  it.each([
    'Talegaon near Pune',
    'talegaon, pune',
    'Lonavala (weekend home), Pune district',
    'Nashik - moving to Pune later',
  ])('"%s" is out_of_area', (input) => {
    expect(resolveServiceArea(input).area).toBe('out_of_area')
  })

  it('out-of-area wins even when an in-area name is also present, and flags it', () => {
    const r = resolveServiceArea('Mumbai client, site in Baner')
    expect(r.area).toBe('out_of_area')
    expect(r.needsReview).toBe(true)
    expect(r.notes.join()).toContain('locality_mixed')
  })
})

describe('pairs that get misheard on a phone line', () => {
  it('Pimple Saudagar and Pimple Nilakh stay distinct', () => {
    expect(resolveServiceArea('Pimple Saudagar').canonical).toBe('Pimple Saudagar')
    expect(resolveServiceArea('Pimple Nilakh').canonical).toBe('Pimple Nilakh')
    expect(resolveServiceArea('pimple saudagar').canonical).not.toBe('Pimple Nilakh')
    expect(resolveServiceArea('pimple nilakh').canonical).not.toBe('Pimple Saudagar')
  })

  it('a bare "Pimple" is unknown, not a coin flip between the two', () => {
    const r = resolveServiceArea('Pimple')
    expect(r.area).toBe('unknown')
    expect(r.needsReview).toBe(true)
  })

  it('Kondhwa and Kothrud stay distinct', () => {
    expect(resolveServiceArea('Kondhwa').canonical).toBe('Kondhwa')
    expect(resolveServiceArea('Kothrud').canonical).toBe('Kothrud')
    expect(resolveServiceArea('kondhwa').canonical).not.toBe('Kothrud')
    expect(resolveServiceArea('kothrud').canonical).not.toBe('Kondhwa')
  })

  it('Wakad and Warje stay distinct', () => {
    expect(resolveServiceArea('Wakad').canonical).toBe('Wakad')
    expect(resolveServiceArea('Warje').canonical).toBe('Warje')
    expect(resolveServiceArea('wakad').canonical).not.toBe('Warje')
    expect(resolveServiceArea('warje').canonical).not.toBe('Wakad')
  })

  it('common misspellings still land on the right locality', () => {
    expect(resolveServiceArea('Hinjawadi').canonical).toBe('Hinjewadi')
    expect(resolveServiceArea('Kondwa').canonical).toBe('Kondhwa')
    expect(resolveServiceArea('Vakad').canonical).toBe('Wakad')
    expect(resolveServiceArea('Erandawane').canonical).toBe('Erandwane')
  })

  it('does not fuzzy-match one in-area locality onto another', () => {
    // If this ever starts passing by edit distance, a Warje lead gets filed
    // under Wakad and nobody finds out.
    for (const [a, b] of [['Wakad', 'Warje'], ['Kondhwa', 'Kothrud'],
                          ['Pimple Saudagar', 'Pimple Nilakh']]) {
      expect(resolveServiceArea(a).canonical).not.toBe(b)
    }
  })
})

describe('locality embedded in a sentence', () => {
  it.each([
    ['3BHK in Baner, builder handover', 'Baner', 'in_area'],
    ['flat at NIBM road', 'NIBM', 'in_area'],
    ['villa in Lonavala', 'Lonavala', 'out_of_area'],
  ])('"%s" -> %s', (input, canonical, area) => {
    const r = resolveServiceArea(input)
    expect(r.canonical).toBe(canonical)
    expect(r.area).toBe(area)
  })
})
