/**
 * An in-memory stand-in for the slice of PostgREST this app uses.
 *
 * It is deliberately strict about the two behaviours the tests exist to prove:
 *
 *   - upsert on a unique column updates in place instead of inserting again
 *   - update().eq().is('claimed_at', null) matches zero rows once claimed
 *
 * and about the one the alert table depends on: a second insert of the same
 * (lead_id, kind) raises 23505, the way a unique index does.
 */
export interface FakeRow { [key: string]: unknown }

export class FakeSupabase {
  leads: FakeRow[] = []
  alerts: FakeRow[] = []
  /** Set to make the next lead write fail, standing in for a database outage. */
  failLeadWrites = false
  /** Delay inside the claim update so two claims can be genuinely interleaved. */
  claimDelayMs = 0

  from(table: 'leads' | 'alert_log') {
    return new FakeQuery(this, table)
  }

  seedLead(row: FakeRow): FakeRow {
    const full: FakeRow = {
      lead_id: row.lead_id ?? crypto.randomUUID(),
      claimed_at: null, claimed_by: null, handoff_sent_at: null, passed_by: [],
      criteria_failed: [], criteria_unclear: [], needs_review: false,
      pricing_leaked: false, pricing_asked_count: 0, consultation_booked: false,
      ...row,
    }
    this.leads.push(full)
    return full
  }
}

type Filter = (row: FakeRow) => boolean

class FakeQuery {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: FakeRow | FakeRow[] | null = null
  private conflictColumn: string | null = null
  private wantSingle: 'single' | 'maybe' | null = null

  constructor(private db: FakeSupabase, private table: 'leads' | 'alert_log') {}

  private get rows(): FakeRow[] {
    return this.table === 'leads' ? this.db.leads : this.db.alerts
  }

  select(_columns?: string) { return this }
  eq(column: string, value: unknown) { this.filters.push((r) => r[column] === value); return this }
  is(column: string, value: null) {
    this.filters.push((r) => r[column] === value || r[column] === undefined)
    return this
  }
  gte(column: string, value: string) { this.filters.push((r) => String(r[column]) >= value); return this }
  lte(column: string, value: string) { this.filters.push((r) => String(r[column]) <= value); return this }
  lt(column: string, value: string) { this.filters.push((r) => String(r[column]) < value); return this }
  not(column: string, _op: string, value: unknown) { this.filters.push((r) => r[column] !== value); return this }
  order() { return this }
  limit(_n: number) { return this }
  single() { this.wantSingle = 'single'; return this.run() }
  maybeSingle() { this.wantSingle = 'maybe'; return this.run() }

  insert(payload: FakeRow | FakeRow[]) { this.op = 'insert'; this.payload = payload; return this }
  update(payload: FakeRow) { this.op = 'update'; this.payload = payload; return this }
  upsert(payload: FakeRow, options?: { onConflict?: string }) {
    this.op = 'upsert'
    this.payload = payload
    this.conflictColumn = options?.onConflict ?? null
    return this
  }

  private matching(): FakeRow[] {
    return this.rows.filter((row) => this.filters.every((f) => f(row)))
  }

  private async run(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
    if (this.db.failLeadWrites && this.table === 'leads' && this.op !== 'select') {
      return { data: null, error: { message: 'simulated database outage' } }
    }

    if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as FakeRow]
      if (this.table === 'alert_log') {
        for (const row of incoming) {
          const clash = this.db.alerts.some(
            (a) => a.lead_id === row.lead_id && a.kind === row.kind
          )
          if (clash) {
            return {
              data: null,
              error: { message: 'duplicate key value violates unique constraint', code: '23505' },
            }
          }
        }
      }
      for (const row of incoming) this.rows.push({ ...row })
      return { data: incoming, error: null }
    }

    if (this.op === 'upsert') {
      const row = this.payload as FakeRow
      const key = this.conflictColumn
      const existing = key ? this.rows.find((r) => r[key] === row[key]) : undefined
      if (existing) {
        // Only the supplied columns change, so claimed_at and the review
        // fields survive a retry. That is what makes retries free.
        Object.assign(existing, row)
        return { data: { ...existing }, error: null }
      }
      const created: FakeRow = {
        lead_id: crypto.randomUUID(),
        claimed_at: null, claimed_by: null, handoff_sent_at: null, passed_by: [],
        ...row,
      }
      this.rows.push(created)
      return { data: { ...created }, error: null }
    }

    if (this.op === 'update') {
      const targets = this.matching()
      if (this.db.claimDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.db.claimDelayMs))
      }
      // Re-evaluate after the delay. A real UPDATE ... WHERE claimed_at IS NULL
      // takes a row lock and sees the committed value, so the loser of a race
      // must match zero rows here too.
      const stillMatching = targets.filter((row) => this.filters.every((f) => f(row)))
      for (const row of stillMatching) Object.assign(row, this.payload as FakeRow)
      return { data: stillMatching.map((r) => ({ ...r })), error: null }
    }

    const found = this.matching()
    if (this.wantSingle === 'single') {
      return found.length === 1
        ? { data: { ...found[0] }, error: null }
        : { data: null, error: { message: 'no rows', code: 'PGRST116' } }
    }
    if (this.wantSingle === 'maybe') {
      return { data: found.length > 0 ? { ...found[0] } : null, error: null }
    }
    return { data: found.map((r) => ({ ...r })), error: null }
  }

  then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
    return this.run().then(resolve)
  }
}
