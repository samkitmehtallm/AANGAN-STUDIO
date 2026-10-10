#!/usr/bin/env node
/**
 * Replay realistic Vaani webhooks at a running instance.
 *
 * This is how the whole chain gets proved without waiting for a phone to ring:
 * it signs each payload exactly the way Vaani will, posts it, and prints what
 * came back - including whether a retry was recognised as a duplicate.
 *
 *   node --env-file=.env.local scripts/replay-vaani.mjs
 *   node --env-file=.env.local scripts/replay-vaani.mjs --url https://your-app.vercel.app
 *   node --env-file=.env.local scripts/replay-vaani.mjs --case leak
 *
 * Cases: qualified, out_of_area, unknown_locality, escalation, leak,
 *        junk, missing_fields, duplicate, all (default)
 */
import { createHmac } from 'node:crypto'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const baseUrl = flag('url', process.env.APP_BASE_URL ?? 'http://localhost:3000')
const secret = process.env.VAANI_WEBHOOK_SECRET
const only = flag('case', 'all')

if (!secret) {
  console.error('VAANI_WEBHOOK_SECRET is not set. The endpoint will reject every request.')
  process.exit(1)
}

const stamp = Date.now()
const ring = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString()

const base = (overrides) => ({
  call_id: `replay-${stamp}-${overrides.call_id ?? Math.random().toString(36).slice(2, 8)}`,
  received_at: ring(300),
  answered_at: ring(297),
  duration_sec: 214,
  recording_url: 'https://recordings.vaani.example/replay.mp3',
  language: 'english',
  telephony_cost_inr: 2.4,
  voice_agent_cost_inr: 10.6,
  'Caller name': 'Rhea Kulkarni',
  'Callback number': '98765 43210',
  'Locality': 'Baner',
  'Property type and area': '3BHK, 1250 sqft',
  'Scope of work': 'Full home interiors including modular kitchen',
  'Current state of site': 'builder handover',
  'Timeline': 'Start in 6 weeks',
  'Decision maker': 'caller and partner',
  'How they found Aangan': 'referral - Meera Joshi',
  'Budget if volunteered': null,
  'Consultation booked': 'yes',
  'Times price was asked': 0,
  'Price revealed by agent': 'no',
  'Call outcome': 'qualified',
  ...overrides,
})

const CASES = {
  qualified: { label: 'A clean qualified call', payload: base({ call_id: 'qualified' }) },

  out_of_area: {
    label: 'Talegaon, near Pune - must decline, must not be in-area',
    payload: base({
      call_id: 'outarea', Locality: 'Talegaon, near Pune',
      'Call outcome': 'declined', decline_reason: 'outside service area',
    }),
  },

  unknown_locality: {
    label: 'A locality nobody recognises - must be unknown and flagged',
    payload: base({ call_id: 'unknown', Locality: 'Somewhere near the old highway' }),
  },

  escalation: {
    label: 'Escalated - goes to the escalation address with no claim link',
    payload: base({
      call_id: 'escalated', 'Call outcome': 'escalated',
      escalation_reason: 'Caller asked for the founder by name',
    }),
  },

  leak: {
    label: 'The agent revealed a price - an incident, not a metric',
    payload: base({
      call_id: 'leak', 'Times price was asked': 3, 'Price revealed by agent': 'yes',
    }),
  },

  junk: {
    label: 'Every field is junk - must still store a row and return 200',
    payload: {
      call_id: `replay-${stamp}-junk`,
      'Caller name': { nested: 'object' },
      'Callback number': ['not', 'a', 'number'],
      'Locality': 12345,
      'Property type and area': false,
      'Times price was asked': 'banana',
      'Call outcome': 99,
      received_at: 'the day before yesterday',
    },
  },

  missing_fields: {
    label: 'Almost nothing captured - must store and flag',
    payload: { call_id: `replay-${stamp}-sparse`, 'Call outcome': 'incomplete' },
  },
}

function post(payload) {
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return fetch(`${baseUrl.replace(/\/$/, '')}/api/vaani/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vaani-signature': signature },
    body,
  })
}

async function run(label, payload) {
  const response = await post(payload)
  const json = await response.json().catch(() => ({}))
  const mark = response.ok ? '  ok ' : ' FAIL'
  console.log(`${mark}  ${String(response.status).padEnd(4)} ${label}`)
  if (json.lead_id) {
    console.log(`        lead ${json.lead_id}  routed:${json.routed}` +
      `${json.flags?.length ? `  flags:${json.flags.join(',')}` : ''}` +
      `${json.duplicate ? '  DUPLICATE' : ''}`)
  } else if (json.error) {
    console.log(`        ${json.error}${json.reason ? ` (${json.reason})` : ''}`)
  }
  return json
}

console.log(`Replaying Vaani webhooks at ${baseUrl}\n`)

const selected = only === 'all' ? Object.entries(CASES)
  : CASES[only] ? [[only, CASES[only]]] : null

if (!selected) {
  console.error(`Unknown case "${only}". Choose from: ${Object.keys(CASES).join(', ')}, duplicate, all`)
  process.exit(1)
}

for (const [, testCase] of selected) {
  await run(testCase.label, testCase.payload)
}

if (only === 'all' || only === 'duplicate') {
  console.log('\nIdempotency - the same call id twice:')
  const payload = base({ call_id: 'retry' })
  await run('first delivery', payload)
  await run('retry of the same call id (must be free)', payload)
}

console.log('\nA bad signature:')
const bad = await fetch(`${baseUrl.replace(/\/$/, '')}/api/vaani/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-vaani-signature': 'deadbeef'.repeat(8) },
  body: JSON.stringify(base({ call_id: 'forged' })),
})
console.log(`${bad.status === 401 ? '  ok ' : ' FAIL'}  ${bad.status}   rejected without writing anything`)
