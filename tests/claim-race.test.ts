import { describe, it, expect, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'
import { claimLead, passLead } from '../src/lib/claim'
import { signLinkToken, verifyLinkToken } from '../src/lib/tokens'
import type { SupabaseClient } from '@supabase/supabase-js'

const SECRET = 'test-claim-secret'

describe('two designers claiming at once', () => {
  let db: FakeSupabase
  let leadId: string

  beforeEach(() => {
    db = new FakeSupabase()
    leadId = String(db.seedLead({ lead_id: 'lead-1', name: 'Rhea Kulkarni' }).lead_id)
  })

  it('exactly one wins', async () => {
    db.claimDelayMs = 20   // force a genuine overlap
    const [a, b] = await Promise.all([
      claimLead(db as unknown as SupabaseClient, leadId, 'Aditi'),
      claimLead(db as unknown as SupabaseClient, leadId, 'Nikhil'),
    ])

    const winners = [a, b].filter((r) => r.ok)
    const losers = [a, b].filter((r) => !r.ok)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].reason).toBe('already_claimed')
  })

  it('the loser is told who holds it', async () => {
    db.claimDelayMs = 20
    const [a, b] = await Promise.all([
      claimLead(db as unknown as SupabaseClient, leadId, 'Aditi'),
      claimLead(db as unknown as SupabaseClient, leadId, 'Nikhil'),
    ])
    const winner = [a, b].find((r) => r.ok)!
    const loser = [a, b].find((r) => !r.ok)!
    expect(loser.claimedBy).toBe(winner.claimedBy)
  })

  it('the database ends up with exactly one owner', async () => {
    db.claimDelayMs = 20
    await Promise.all([
      claimLead(db as unknown as SupabaseClient, leadId, 'Aditi'),
      claimLead(db as unknown as SupabaseClient, leadId, 'Nikhil'),
    ])
    const row = db.leads.find((l) => l.lead_id === leadId)!
    expect(row.claimed_by).toBeTruthy()
    expect(['Aditi', 'Nikhil']).toContain(row.claimed_by)
    expect(row.claimed_at).toBeTruthy()
  })

  it('holds under a five-way pile-up', async () => {
    db.claimDelayMs = 15
    const names = ['Aditi', 'Nikhil', 'Rohan', 'Sneha', 'Varun']
    const results = await Promise.all(
      names.map((n) => claimLead(db as unknown as SupabaseClient, leadId, n))
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => r.reason === 'already_claimed')).toHaveLength(4)
  })

  it('a later claim on an already-claimed lead never overwrites the owner', async () => {
    await claimLead(db as unknown as SupabaseClient, leadId, 'Aditi')
    const second = await claimLead(db as unknown as SupabaseClient, leadId, 'Nikhil')
    expect(second.ok).toBe(false)
    expect(db.leads.find((l) => l.lead_id === leadId)!.claimed_by).toBe('Aditi')
  })

  it('reports not_found for a lead that does not exist', async () => {
    const result = await claimLead(db as unknown as SupabaseClient, 'no-such-lead', 'Aditi')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_found')
  })
})

describe('passing on a lead', () => {
  it('records the designer without claiming it for them', async () => {
    const db = new FakeSupabase()
    db.seedLead({ lead_id: 'lead-2' })
    const result = await passLead(db as unknown as SupabaseClient, 'lead-2', 'Aditi')
    expect(result.ok).toBe(true)
    const row = db.leads[0]
    expect(row.passed_by).toEqual(['Aditi'])
    expect(row.claimed_at).toBeNull()   // still in the queue, still ageing
  })

  it('does not record the same designer twice', async () => {
    const db = new FakeSupabase()
    db.seedLead({ lead_id: 'lead-3' })
    await passLead(db as unknown as SupabaseClient, 'lead-3', 'Aditi')
    await passLead(db as unknown as SupabaseClient, 'lead-3', 'Aditi')
    expect(db.leads[0].passed_by).toEqual(['Aditi'])
  })
})

describe('claim link tokens', () => {
  it('round-trips an action, a lead and a designer', () => {
    const token = signLinkToken('claim', 'lead-9', 'Aditi', SECRET)
    expect(verifyLinkToken(token, SECRET)).toEqual({
      action: 'claim', leadId: 'lead-9', designer: 'Aditi',
    })
  })

  it('rejects a token signed with a different secret', () => {
    const token = signLinkToken('claim', 'lead-9', 'Aditi', SECRET)
    expect(verifyLinkToken(token, 'some-other-secret')).toBeNull()
  })

  it('rejects a tampered lead id', () => {
    const token = signLinkToken('claim', 'lead-9', 'Aditi', SECRET)
    const [, mac] = token.split('.')
    const forged = `${Buffer.from('claim:lead-OTHER:Aditi').toString('base64url')}.${mac}`
    expect(verifyLinkToken(forged, SECRET)).toBeNull()
  })

  it.each([null, undefined, '', 'garbage', 'a.b.c', 'notbase64.notamac'])(
    'rejects %s', (token) => {
      expect(verifyLinkToken(token as string | null, SECRET)).toBeNull()
    })

  it('keeps claim and pass distinct', () => {
    const claim = signLinkToken('claim', 'lead-9', 'Aditi', SECRET)
    const pass = signLinkToken('pass', 'lead-9', 'Aditi', SECRET)
    expect(claim).not.toBe(pass)
    expect(verifyLinkToken(pass, SECRET)!.action).toBe('pass')
  })
})
