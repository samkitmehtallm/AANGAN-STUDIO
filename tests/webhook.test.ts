import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'
import { computeSignature } from '../src/lib/signature'

const SECRET = 'webhook-test-secret'
let db: FakeSupabase
const sentEmails: Array<{ to: string[]; subject: string; text: string; html: string }> = []

// The route pulls its client and its transport from modules, so the seams are
// there rather than in the handler's signature.
vi.mock('../src/lib/supabase', () => ({
  getSupabase: () => db,
  MissingEnvError: class extends Error {},
}))

/** Set to make the next send blow up, standing in for a mail outage. */
let emailFailsOnce = false

vi.mock('../src/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/email')>()
  return {
    ...actual,
    emailConfigured: () => true,
    recipients: (name: string) => [`${name.toLowerCase()}@aangan.test`],
    sendEmail: async (args: { to: string | string[]; subject: string; text: string; html: string }) => {
      if (emailFailsOnce) {
        emailFailsOnce = false
        throw new Error('resend is down')
      }
      const to = Array.isArray(args.to) ? args.to : [args.to]
      sentEmails.push({ to, subject: args.subject, text: args.text, html: args.html })
      return { ok: true, dryRun: false, to, subject: args.subject }
    },
  }
})

const { POST, GET } = await import('../src/app/api/vaani/webhook/route')

function post(body: unknown, options: { signature?: string | null; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(body)
  const signature = options.signature === null
    ? null
    : options.signature ?? computeSignature(raw, SECRET)
  const headers = new Headers({ 'content-type': 'application/json' })
  if (signature !== null) headers.set('x-vaani-signature', signature)
  return POST(new Request('https://aangan.test/api/vaani/webhook', {
    method: 'POST', body: raw, headers,
  }))
}

function validCall(overrides: Record<string, unknown> = {}) {
  return {
    call_id: 'vaani_abc_123',
    received_at: '2026-10-09T05:30:00.000Z',
    answered_at: '2026-10-09T05:30:03.000Z',
    duration_sec: 240,
    'Caller name': 'Rhea Kulkarni',
    'Callback number': '9876543210',
    'Locality': 'Baner',
    'Property type and area': '3BHK, 1250 sqft',
    'Scope of work': 'Full home interiors',
    'Current state of site': 'builder handover',
    'Timeline': '6 weeks',
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

beforeEach(() => {
  db = new FakeSupabase()
  sentEmails.length = 0
  emailFailsOnce = false
  process.env.VAANI_WEBHOOK_SECRET = SECRET
  process.env.VAANI_ALLOW_UNSIGNED = 'false'
  process.env.CLAIM_LINK_SECRET = 'claim-secret'
  process.env.APP_BASE_URL = 'https://aangan.test'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => { vi.restoreAllMocks() })

describe('a valid call', () => {
  it('returns 200 and stores one lead', async () => {
    const response = await post(validCall())
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(db.leads).toHaveLength(1)
    expect(db.leads[0].name).toBe('Rhea Kulkarni')
    expect(db.leads[0].service_area).toBe('in_area')
  })

  it('keeps the phone number in the database', async () => {
    await post(validCall())
    expect(db.leads[0].phone).toBe('+919876543210')
  })

  it('sends the handoff to the designers', async () => {
    await post(validCall())
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toEqual(['handoff_to@aangan.test'])
    expect(sentEmails[0].subject).toContain('Rhea Kulkarni')
  })

  it('RULE 3: that email carries no phone number', async () => {
    await post(validCall())
    for (const email of sentEmails) {
      expect(email.text).not.toContain('9876543210')
      expect(email.html).not.toContain('9876543210')
      expect(email.subject).not.toContain('9876543210')
      expect(email.text).not.toMatch(/\+91/)
    }
  })

  it('keeps the raw payload', async () => {
    await post(validCall())
    expect(db.leads[0].raw_payload).toMatchObject({ call_id: 'vaani_abc_123' })
  })
})

describe('bad signature', () => {
  it('rejects a wrong signature with 401', async () => {
    const response = await post(validCall(), { signature: 'deadbeef'.repeat(8) })
    expect(response.status).toBe(401)
  })

  it('rejects a missing signature with 401', async () => {
    const response = await post(validCall(), { signature: null })
    expect(response.status).toBe(401)
  })

  it('writes nothing and notifies nobody when the signature is bad', async () => {
    await post(validCall(), { signature: 'deadbeef'.repeat(8) })
    expect(db.leads).toHaveLength(0)
    expect(sentEmails).toHaveLength(0)
  })

  it('rejects a body altered after signing', async () => {
    const original = JSON.stringify(validCall())
    const signature = computeSignature(original, SECRET)
    const tampered = original.replace('Baner', 'Lonavala')
    const response = await post(null, { raw: tampered, signature })
    expect(response.status).toBe(401)
  })

  it('accepts the sha256= prefix form', async () => {
    const raw = JSON.stringify(validCall())
    const response = await post(null, { raw, signature: `sha256=${computeSignature(raw, SECRET)}` })
    expect(response.status).toBe(200)
  })
})

describe('malformed payloads', () => {
  it('stores unparseable JSON rather than losing the call', async () => {
    const raw = '{this is not json'
    const response = await post(null, { raw })
    expect(response.status).toBe(200)
    expect(db.leads).toHaveLength(1)
    expect(db.leads[0].needs_review).toBe(true)
    expect(String(db.leads[0].criteria_unclear)).toContain('unparseable_payload')
  })

  it('never throws on any shape of junk', async () => {
    const horrors = ['null', '[]', '"a string"', '42', '{}', 'true', '{"a":']
    for (const raw of horrors) {
      const response = await post(null, { raw })
      expect([200, 500]).toContain(response.status)
      expect(response.status).not.toBe(400)
    }
    expect(db.leads.length).toBe(horrors.length)
  })

  it('stores an empty body as an incomplete lead', async () => {
    const response = await post(null, { raw: '' })
    expect(response.status).toBe(200)
    expect(db.leads[0].result).toBe('incomplete')
  })
})

describe('missing fields', () => {
  it('stores a lead with no name and no number, and flags it', async () => {
    const payload = validCall()
    delete (payload as Record<string, unknown>)['Caller name']
    delete (payload as Record<string, unknown>)['Callback number']
    const response = await post(payload)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(db.leads).toHaveLength(1)
    expect(db.leads[0].needs_review).toBe(true)
    expect(json.flags).toContain('missing_caller_name')
    expect(json.flags).toContain('missing_callback_number')
  })

  it('does not flag a missing budget', async () => {
    const response = await post(validCall())
    const json = await response.json()
    expect(json.flags.join()).not.toContain('budget')
    expect(db.leads[0].needs_review).toBe(false)
  })

  it('flags an unrecognised locality and never calls it in-area', async () => {
    await post(validCall({ Locality: 'Timbuktu' }))
    expect(db.leads[0].service_area).toBe('unknown')
    expect(db.leads[0].needs_review).toBe(true)
  })
})

describe('duplicate call id', () => {
  it('a retry creates no second row', async () => {
    await post(validCall())
    await post(validCall())
    expect(db.leads).toHaveLength(1)
  })

  it('a retry sends no second email', async () => {
    await post(validCall())
    const afterFirst = sentEmails.length
    await post(validCall())
    expect(sentEmails).toHaveLength(afterFirst)
  })

  it('a retry reports itself as a duplicate', async () => {
    await post(validCall())
    const json = await (await post(validCall())).json()
    expect(json.duplicate).toBe(true)
    expect(json.ok).toBe(true)
  })

  it('a retry does not unclaim a lead a designer already took', async () => {
    await post(validCall())
    db.leads[0].claimed_by = 'Aditi'
    db.leads[0].claimed_at = '2026-10-09T05:40:00.000Z'
    await post(validCall())
    expect(db.leads[0].claimed_by).toBe('Aditi')
  })

  it('three retries are still one lead and one email', async () => {
    await post(validCall()); await post(validCall()); await post(validCall())
    expect(db.leads).toHaveLength(1)
    expect(sentEmails).toHaveLength(1)
  })
})

describe('RULE 1: record before notify', () => {
  it('returns 500 and sends nothing when the database is down', async () => {
    db.failLeadWrites = true
    const response = await post(validCall())
    expect(response.status).toBe(500)      // 500 so Vaani retries
    expect(sentEmails).toHaveLength(0)
  })

  it('still stores the lead when email fails', async () => {
    emailFailsOnce = true
    const response = await post(validCall())
    expect(response.status).toBe(200)
    expect(db.leads).toHaveLength(1)       // the lead survives the outage
  })
})

describe('routing through the webhook', () => {
  it('sends an escalation to the escalation address with no Claim button', async () => {
    await post(validCall({
      call_id: 'esc_1', 'Call outcome': 'escalated',
      escalation_reason: 'Caller asked for the founder',
    }))
    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0].to).toEqual(['escalation_to@aangan.test'])
    // Nobody claims a problem call.
    expect(sentEmails[0].html).not.toContain('Claim this lead')
    expect(sentEmails[0].text).not.toContain("Can't take it")
  })

  it('an escalation offers "I\'m calling now" instead, which stops the watchdog', async () => {
    await post(validCall({
      call_id: 'esc_2', 'Call outcome': 'escalated',
      escalation_reason: 'Complaint about a past project',
    }))
    expect(sentEmails[0].html).toContain("I'm calling now")
    expect(sentEmails[0].text).toContain('/api/claim/')   // the signed ack link
  })

  it('emails nobody for a clean decline', async () => {
    await post(validCall({
      call_id: 'dec_1', 'Call outcome': 'declined', Locality: 'Lonavala',
      decline_reason: 'outside service area',
    }))
    expect(sentEmails).toHaveLength(0)
    expect(db.leads).toHaveLength(1)       // but the lead is still recorded
  })

  it('escalates a decline made on a locality nobody could place', async () => {
    await post(validCall({
      call_id: 'dec_2', 'Call outcome': 'declined', Locality: 'Timbuktu',
    }))
    expect(sentEmails[0].to).toEqual(['escalation_to@aangan.test'])
  })
})

describe('RULE 5: a pricing leak is an incident', () => {
  it('alerts the founder immediately', async () => {
    await post(validCall({
      call_id: 'leak_1', 'Times price was asked': 2, 'Price revealed by agent': 'yes',
    }))
    const founderMail = sentEmails.find((e) => e.to.includes('founder_to@aangan.test'))
    expect(founderMail).toBeTruthy()
    expect(founderMail!.subject).toContain('PRICING LEAK')
  })

  it('alerts once, not once per retry', async () => {
    await post(validCall({ call_id: 'leak_2', 'Price revealed by agent': 'yes' }))
    await post(validCall({ call_id: 'leak_2', 'Price revealed by agent': 'yes' }))
    const founderMails = sentEmails.filter((e) => e.to.includes('founder_to@aangan.test'))
    expect(founderMails).toHaveLength(1)
  })

  it('records the leak on the row', async () => {
    await post(validCall({ call_id: 'leak_3', 'Price revealed by agent': 'yes' }))
    expect(db.leads[0].pricing_leaked).toBe(true)
    expect(db.leads[0].needs_review).toBe(true)
  })

  it('a push that did not leak is a metric, not an incident', async () => {
    await post(validCall({
      call_id: 'push_1', 'Times price was asked': 3, 'Price revealed by agent': 'no',
    }))
    expect(db.leads[0].pricing_leaked).toBe(false)
    expect(sentEmails.filter((e) => e.subject.includes('PRICING LEAK'))).toHaveLength(0)
  })
})

describe('health check', () => {
  it('answers GET without touching the database', async () => {
    const json = await (await GET()).json()
    expect(json.ok).toBe(true)
    expect(db.leads).toHaveLength(0)
  })
})
