import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mapVaaniPayload } from '../src/lib/vaani'

/**
 * The mapper writes its whole output object straight into `leads`. If it ever
 * produces a key that is not a column, every webhook returns 500 and the system
 * silently stops accepting calls.
 *
 * That is exactly what happened: `consultation_note` was added to the mapper
 * and not to the table. The whole suite stayed green, because the in-memory
 * test double is a plain object store that accepts any key. Production did not.
 *
 * So this test reads the real migration and checks the contract directly.
 */
const migration = readFileSync('supabase/migrations/0001_init.sql', 'utf8')

/** Column names from the `create table leads (...)` block. */
function columnsInMigration(): Set<string> {
  const start = migration.indexOf('create table leads (')
  const end = migration.indexOf('\n);', start)
  const body = migration.slice(start, end)

  const columns = new Set<string>()
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('--') || line.startsWith('create table')) continue
    const match = line.match(/^([a-z_][a-z0-9_]*)\s+/)
    if (!match) continue
    // Skip SQL keywords that can start a continuation line.
    if (['case', 'when', 'else', 'end', 'generated', 'stored', 'references'].includes(match[1])) {
      continue
    }
    columns.add(match[1])
  }
  return columns
}

describe('the mapper and the schema agree', () => {
  const columns = columnsInMigration()

  it('finds the real column list in the migration', () => {
    expect(columns.size).toBeGreaterThan(40)
    expect(columns.has('vaani_call_id')).toBe(true)
    expect(columns.has('consultation_note')).toBe(true)
  })

  it('every key the mapper writes is a real column', () => {
    const { lead } = mapVaaniPayload({
      call_id: 'schema-contract',
      'Caller name': 'Rhea Kulkarni',
      'Callback number': '9876543210',
      Locality: 'Baner',
      'Property type and area': '3BHK 1400 sq ft',
      'Consultation booked': 'Saturday 4 October, 10:30 AM, site visit',
      'Call outcome': 'qualified',
    })

    const unknown = Object.keys(lead).filter((k) => !columns.has(k))
    expect(unknown, `mapper writes column(s) that do not exist: ${unknown.join(', ')}`)
      .toEqual([])
  })

  it('holds for an empty payload too, where defaults fill every field', () => {
    const { lead } = mapVaaniPayload({})
    const unknown = Object.keys(lead).filter((k) => !columns.has(k))
    expect(unknown).toEqual([])
  })

  it('does not write to generated columns, which Postgres rejects', () => {
    const { lead } = mapVaaniPayload({ call_id: 'gen' })
    expect(Object.keys(lead)).not.toContain('first_response_sec')
    expect(Object.keys(lead)).not.toContain('total_cost_inr')
  })
})
