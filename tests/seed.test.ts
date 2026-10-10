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

  it('spreads across both months', () => {
    const dates = rows.map((r) => unquote(r.received_at)!.slice(0, 10))
    expect(new Set(dates).size).toBeGreaterThan(30)
  })

  it('carries the 40 real September enquiries alongside the generated ones', () => {
    const september = rows.filter((r) => r.vaani_call_id.includes('seed-sep-'))
    const october = rows.filter((r) => r.vaani_call_id.includes('seed-oct-'))
    expect(september).toHaveLength(40)
    expect(october.length).toBeGreaterThan(60)
  })

  it('keeps all three channels, because the real log has all three', () => {
    const channels = new Set(rows.map((r) => unquote(r.channel)))
    expect(channels).toContain('phone')
    expect(channels).toContain('whatsapp')
    expect(channels).toContain('web_form')
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

  const responseSec = (r: Record<string, string>): number | null => {
    if (r.answered_at === 'null') return null
    const received = new Date(unquote(r.received_at)!).getTime()
    const answered = new Date(unquote(r.answered_at)!).getTime()
    return (answered - received) / 1000
  }
  const september = () => rows.filter((r) => r.vaani_call_id.includes('seed-sep-'))
  const october = () => rows.filter((r) => r.vaani_call_id.includes('seed-oct-'))

  it('the before period is slow, which is the entire argument', () => {
    // The studio quotes ~48% with no response inside 48 hours across a full
    // month of ~200 enquiries. This 40-enquiry log is the studio's own curated
    // sample and is kinder than that: about an eighth went past 48 hours.
    // The figure asserted here is the one the log actually supports - over
    // 12 hours, or never answered at all - because bending real data to fit a
    // headline number would make every other figure on the dashboard suspect.
    const before = september()
    const overHalfADay = before.filter((r) => {
      const sec = responseSec(r)
      return sec === null || sec > 12 * 3600
    }).length
    const pct = (overHalfADay / before.length) * 100
    expect(pct).toBeGreaterThan(30)
    expect(pct).toBeLessThan(60)
  })

  it('still has enquiries that waited more than two days', () => {
    const overTwoDays = september().filter((r) => {
      const sec = responseSec(r)
      return sec === null || sec > 48 * 3600
    })
    expect(overTwoDays.length).toBeGreaterThanOrEqual(4)
  })

  it('the after period answers almost everything in under 30 seconds', () => {
    const after = october()
    const fast = after.filter((r) => {
      const sec = responseSec(r)
      return sec !== null && sec < 30
    }).length
    expect(fast / after.length).toBeGreaterThan(0.85)
  })

  it('the after period still has outliers, so p90 differs from the median', () => {
    const slow = october().filter((r) => (responseSec(r) ?? 0) > 240).length
    expect(slow).toBeGreaterThanOrEqual(2)
    expect(slow).toBeLessThanOrEqual(18)
  })

  it('the step change between the two periods is unmistakable', () => {
    const med = (xs: number[]) => {
      const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    const beforeMedian = med(september().map((r) => responseSec(r) ?? Infinity))
    const afterMedian = med(october().map((r) => responseSec(r) ?? Infinity))
    expect(afterMedian).toBeLessThan(60)
    expect(beforeMedian).toBeGreaterThan(afterMedian * 10)
  })

  it('records the one call nobody answered', () => {
    // 9 September, 10:47pm. No voicemail, call-back unanswered. It is in the
    // log because a lead that was never answered still happened.
    const unanswered = september().filter((r) => r.answered_at === 'null')
    expect(unanswered.length).toBeGreaterThanOrEqual(1)
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
    expect(new Set(rows.map((r) => r.name)).size).toBeGreaterThan(50)
    expect(new Set(rows.map((r) => r.locality)).size).toBeGreaterThan(15)
  })

  it('is deterministic', () => {
    const again = execFileSync(process.execPath, ['scripts/seed.mjs', '--sql'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    })
    expect(again).toBe(sql)
  })
})
