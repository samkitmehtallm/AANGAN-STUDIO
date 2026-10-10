import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { localHour } from '../src/lib/office-hours'

/**
 * The seed has to make the dashboard convincing. These assertions are the
 * definition of convincing from the brief, checked against what the generator
 * actually produces rather than against what it intends.
 */
const sql = execFileSync(process.execPath, ['scripts/seed.mjs', '--sql'], {
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
})

/** Parse the generated INSERT back into rows, so we test the real output. */
function parseRows() {
  const columns = sql.match(/insert into leads \(([^)]+)\) values/)![1]
    .split(',').map((c) => c.trim())
  const body = sql.slice(sql.indexOf('values') + 6)
  const rows: Array<Record<string, string>> = []

  for (const line of body.split('\n')) {
    const trimmed = line.trim().replace(/[,;]$/, '')
    if (!trimmed.startsWith('(')) continue
    const inner = trimmed.slice(1, -1)
    const values: string[] = []
    let current = '', depth = 0, inString = false
    for (let i = 0; i < inner.length; i += 1) {
      const char = inner[i]
      if (char === "'" && inner[i - 1] !== '\\') {
        if (inString && inner[i + 1] === "'") { current += "''"; i += 1; continue }
        inString = !inString
      }
      if (!inString && char === '(') depth += 1
      if (!inString && char === ')') depth -= 1
      if (!inString && depth === 0 && char === ',') { values.push(current.trim()); current = ''; continue }
      current += char
    }
    values.push(current.trim())
    const row: Record<string, string> = {}
    columns.forEach((column, index) => { row[column] = values[index] })
    rows.push(row)
  }
  return rows
}

const rows = parseRows()
const unquote = (v: string) => v === 'null' ? null : v.replace(/^'|'$/g, '')
const count = (predicate: (r: Record<string, string>) => boolean) => rows.filter(predicate).length

describe('the seed', () => {
  it('produces about 120 leads', () => {
    expect(rows.length).toBe(120)
  })

  it('only ever deletes rows it created', () => {
    // A delete without the seed- prefix would be a delete of real enquiries.
    const deletes = sql.split('\n').filter((l) => l.startsWith('delete'))
    expect(deletes.length).toBeGreaterThan(0)
    for (const statement of deletes) {
      expect(statement).toContain("vaani_call_id like 'seed-%'")
    }
  })

  it('RULE 5: pricing_leaked is false on every single row', () => {
    expect(count((r) => r.pricing_leaked !== 'false')).toBe(0)
  })

  it('spreads across 60 days', () => {
    const dates = rows.map((r) => unquote(r.received_at)!.slice(0, 10))
    const unique = new Set(dates)
    expect(unique.size).toBeGreaterThan(40)
  })

  it('puts about a third outside office hours', () => {
    const outside = count((r) => {
      const hour = localHour(new Date(unquote(r.received_at)!))
      return hour < 10 || hour >= 19
    })
    const pct = (outside / rows.length) * 100
    expect(pct).toBeGreaterThan(24)
    expect(pct).toBeLessThan(42)
  })

  it('answers most calls in under 30 seconds', () => {
    const fast = count((r) => {
      const received = new Date(unquote(r.received_at)!).getTime()
      const answered = new Date(unquote(r.answered_at)!).getTime()
      return (answered - received) / 1000 < 30
    })
    expect(fast / rows.length).toBeGreaterThan(0.85)
  })

  it('includes a handful of slow outliers, so the p90 differs from the median', () => {
    const slow = count((r) => {
      const received = new Date(unquote(r.received_at)!).getTime()
      const answered = new Date(unquote(r.answered_at)!).getTime()
      return (answered - received) / 1000 > 240
    })
    expect(slow).toBeGreaterThanOrEqual(2)
    expect(slow).toBeLessThanOrEqual(18)
  })

  it('has a believable outcome split', () => {
    const qualified = count((r) => r.result === "'qualified'")
    const declined = count((r) => r.result === "'declined'")
    const escalated = count((r) => r.result === "'escalated'")
    expect(qualified / rows.length).toBeGreaterThan(0.45)
    expect(qualified / rows.length).toBeLessThan(0.75)
    expect(declined).toBeGreaterThan(10)
    expect(escalated).toBeGreaterThan(2)
  })

  it('clusters decline reasons on service area and scope', () => {
    const reasons = rows
      .filter((r) => r.result === "'declined'")
      .map((r) => unquote(r.decline_reason))
    const area = reasons.filter((x) => x === 'outside service area').length
    const scope = reasons.filter((x) => x === 'scope too small').length
    expect(area).toBeGreaterThan(5)
    expect(scope).toBeGreaterThan(2)
    expect(area + scope).toBeGreaterThan(reasons.length * 0.5)
  })

  it('includes pricing pushes that still converted', () => {
    const pushedAndBooked = count(
      (r) => Number(r.pricing_asked_count) > 0 && r.consultation_booked === 'true'
    )
    expect(pushedAndBooked).toBeGreaterThan(5)
  })

  it('never places an out-of-area locality in service area', () => {
    const wrong = rows.filter((r) => {
      const locality = unquote(r.locality)
      return ['Talegaon', 'Lonavala', 'Nashik', 'Mumbai', 'Satara', 'Alibaug'].includes(locality ?? '')
        && r.service_area !== "'out_of_area'"
    })
    expect(wrong).toHaveLength(0)
  })

  it('leaves budget null on most rows, because the agent never asks', () => {
    const withBudget = count((r) => r.budget_volunteered !== 'null')
    expect(withBudget / rows.length).toBeLessThan(0.3)
  })

  it('uses many different callers and localities', () => {
    // The previous seed had one name and two localities, which read as fake
    // the moment anyone looked at the list.
    expect(new Set(rows.map((r) => r.name)).size).toBeGreaterThan(60)
    expect(new Set(rows.map((r) => r.locality)).size).toBeGreaterThan(15)
  })

  it('is deterministic', () => {
    const again = execFileSync(process.execPath, ['scripts/seed.mjs', '--sql'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    })
    expect(again).toBe(sql)
  })
})
