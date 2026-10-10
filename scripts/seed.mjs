#!/usr/bin/env node
/**
 * Seed ~120 enquiries over 60 days.
 *
 * The dashboard has to look convincing before a single real call exists, which
 * means the distributions have to be right, not just the row count:
 *
 *   - about a third arrive outside the 10am-7pm window
 *   - most first responses are under 30 seconds, with a handful of outliers
 *     slow enough to make the p90 tell a different story from the median
 *   - decline reasons cluster on service area and scope, the way real ones do
 *   - some callers pushed hard on price and booked anyway
 *   - pricing_leaked is false on every single row (rule 5)
 *
 * Two modes:
 *   node scripts/seed.mjs            write to Supabase (needs env vars)
 *   node scripts/seed.mjs --sql      print SQL to stdout and write nothing
 *
 * Seeded rows all carry a vaani_call_id beginning "seed-", so --reset removes
 * exactly those and can never touch a real lead.
 */
import { createClient } from '@supabase/supabase-js'
import { writeSync } from 'node:fs'

const SEED_PREFIX = 'seed-'
const COUNT = 120
const DAYS = 60
const TZ_OFFSET_MIN = 330      // Asia/Kolkata, UTC+5:30

/* --- deterministic PRNG so the same seed produces the same dashboard --- */
let state = 0x2f6e2b1
const rand = () => {
  state ^= state << 13; state >>>= 0
  state ^= state >> 17
  state ^= state << 5; state >>>= 0
  return state / 0x100000000
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const chance = (p) => rand() < p

const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [value, weight] of pairs) {
    r -= weight
    if (r <= 0) return value
  }
  return pairs[pairs.length - 1][0]
}

/* ------------------------------ vocabulary ------------------------------ */
const FIRST = ['Rhea', 'Aditya', 'Meera', 'Nikhil', 'Sneha', 'Rohan', 'Priya', 'Kunal',
  'Ananya', 'Vikram', 'Shalini', 'Arjun', 'Divya', 'Siddharth', 'Neha', 'Omkar',
  'Pallavi', 'Harsh', 'Ira', 'Tejas', 'Mitali', 'Sameer', 'Juhi', 'Abhay',
  'Radhika', 'Mandar', 'Swati', 'Girish', 'Aarti', 'Prasad']
const LAST = ['Kulkarni', 'Deshpande', 'Joshi', 'Patil', 'Shah', 'Iyer', 'Bhatt',
  'Nair', 'Gokhale', 'Sawant', 'Khanna', 'Rao', 'Mehta', 'Chavan', 'Pandit',
  'Agarwal', 'Bose', 'Kelkar', 'Shetty', 'Phadke']

const IN_AREA = ['Kothrud', 'Baner', 'Aundh', 'Wakad', 'Koregaon Park', 'Kalyani Nagar',
  'Viman Nagar', 'Hadapsar', 'Magarpatta', 'NIBM', 'Kondhwa', 'Undri', 'Shivane',
  'Warje', 'Erandwane', 'Deccan', 'Kharadi', 'Hinjewadi', 'Pimpri', 'Chinchwad',
  'Pimple Saudagar', 'Pimple Nilakh', 'Ravet']
const OUT_AREA = ['Talegaon', 'Lonavala', 'Nashik', 'Mumbai', 'Satara', 'Alibaug']
const UNKNOWN_AREA = ['Katraj', 'Sinhagad Road', 'Pashan', 'Bavdhan', 'near the airport']

const PROPERTY = [
  ['2BHK', 780, 1050], ['3BHK', 1100, 1650], ['4BHK', 1700, 2400],
  ['Duplex', 2200, 3400], ['Row house', 1800, 2800], ['Penthouse', 2600, 4200],
  ['1BHK', 450, 700], ['Bungalow', 3000, 5200],
]
const SCOPES = [
  'Full home interiors', 'Full home interiors including modular kitchen',
  'Modular kitchen and wardrobes', 'Living and dining only',
  'Kitchen renovation', 'Two bedrooms and a study', 'Master bedroom only',
  'Full home plus false ceiling and lighting', 'Wardrobes only',
  'Kids room and guest bedroom', 'Complete turnkey including civil work',
  'Just the kitchen counter', 'Balcony and terrace styling',
]
const SMALL_SCOPES = ['Wardrobes only', 'Just the kitchen counter', 'Master bedroom only',
  'Balcony and terrace styling']
const STATES = ['bare_shell', 'builder_handover', 'lived_in', 'under_renovation']
const TIMELINES = ['Start in 2 weeks', 'Start in 6 weeks', 'Start next month',
  'Possession in January, start after', 'Within 3 months', 'As soon as possible',
  'Flexible, sometime this year', 'Before Diwali']
const DECIDERS = ['caller', 'caller_and_partner', 'represented', 'researching_for_others']
const SOURCES = [['referral', 34], ['instagram', 26], ['google', 20], ['builder', 9],
  ['linkedin', 5], ['press', 4], ['other', 2]]
const DESIGNERS = ['Aditi', 'Nikhil', 'Rohan', 'Sneha']
const BUDGETS = ['around 10 lakh', 'about 12-14 lakh', 'under 8 lakh', 'roughly 15 lakh',
  '20 lakh plus', 'not more than 6 lakh']

const DECLINE_SERVICE_AREA = 'outside service area'
const DECLINE_SCOPE = 'scope too small'
const DECLINE_OTHER = ['timeline too tight', 'budget well below our minimum',
  'caller only wanted a quotation', 'looking for a contractor, not a design studio']

/* ------------------------------ generation ------------------------------ */

/** Local hour -> a UTC Date, so "arrived at 2am in Pune" means what it says. */
function atLocalHour(daysAgo, hour, minute) {
  const now = Date.now()
  const day = new Date(now - daysAgo * 86400_000)
  const utcMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  return new Date(utcMidnight + (hour * 60 + minute - TZ_OFFSET_MIN) * 60_000)
}

function makeLead(index) {
  const daysAgo = Math.floor(rand() * DAYS)

  // About a third arrive when nobody is at the desk. That is the whole case.
  const outOfHours = chance(0.33)
  const hour = outOfHours
    ? pick([0, 1, 6, 7, 8, 9, 19, 20, 21, 22, 22, 23, 23])
    : int(10, 18)
  const receivedAt = atLocalHour(daysAgo, hour, int(0, 59))

  // The agent answers in seconds. The handful of slow ones are what the p90
  // is for: without them the median would say everything is fine.
  const slow = chance(0.06)
  const firstResponse = slow ? int(240, 2400) : int(2, 28)
  const answeredAt = new Date(receivedAt.getTime() + firstResponse * 1000)

  // Locality drives most of the outcome, so decide it first.
  const areaRoll = rand()
  const area = areaRoll < 0.83 ? 'in_area' : areaRoll < 0.95 ? 'out_of_area' : 'unknown'
  const locality = area === 'in_area' ? pick(IN_AREA)
    : area === 'out_of_area' ? pick(OUT_AREA) : pick(UNKNOWN_AREA)

  const [propertyType, minArea, maxArea] = pick(PROPERTY)
  const scope = pick(SCOPES)
  const smallScope = SMALL_SCOPES.includes(scope)

  let result, declineReason = null, escalationReason = null
  if (area === 'out_of_area') {
    result = chance(0.9) ? 'declined' : 'escalated'
    declineReason = result === 'declined' ? DECLINE_SERVICE_AREA : null
    escalationReason = result === 'escalated' ? 'Outside service area but a referral from a past client' : null
  } else if (area === 'unknown') {
    // The gate could not place it, so a human decides. Never auto-declined.
    result = chance(0.6) ? 'escalated' : 'qualified'
    escalationReason = result === 'escalated' ? 'Locality not recognised - needs confirming' : null
  } else if (smallScope && chance(0.45)) {
    result = 'declined'
    declineReason = DECLINE_SCOPE
  } else {
    result = weighted([['qualified', 76], ['declined', 10], ['incomplete', 9], ['escalated', 5]])
    if (result === 'declined') declineReason = pick(DECLINE_OTHER)
    if (result === 'escalated') {
      escalationReason = pick(['Caller asked for the founder by name',
        'Complaint about a past project', 'Commercial project, not residential',
        'Caller became agitated about pricing'])
    }
  }

  // Pricing pressure. Some of these held and booked anyway - that is the
  // evidence the deflection is working rather than just costing conversions.
  const pricingAsked = weighted([[0, 62], [1, 18], [2, 11], [3, 6], [4, 3]])
  const qualified = result === 'qualified'
  const booked = qualified && (pricingAsked > 0 ? chance(0.62) : chance(0.68))

  const handedOff = result === 'qualified' || result === 'escalated'
  const handoffAt = handedOff ? new Date(answeredAt.getTime() + int(1, 6) * 1000) : null

  // Claiming only happens when someone is awake. An out-of-hours lead waits.
  let claimedAt = null, claimedBy = null
  if (handoffAt && result === 'qualified') {
    if (chance(0.88)) {
      const waitMinutes = outOfHours
        ? int(30, 600)                               // waited for the morning
        : weighted([[int(1, 8), 60], [int(9, 29), 28], [int(31, 180), 12]])
      claimedAt = new Date(handoffAt.getTime() + waitMinutes * 60_000)
      claimedBy = pick(DESIGNERS)
    }
  } else if (handoffAt && result === 'escalated' && chance(0.7)) {
    claimedAt = new Date(handoffAt.getTime() + int(2, 40) * 60_000)
    claimedBy = 'Sanjana'   // the founder picks up escalations
  }

  const needsReview = area === 'unknown' || (result === 'incomplete' && chance(0.3))
  const reviewed = chance(0.35) && result !== 'incomplete'

  const minutes = (answeredAt.getTime() - receivedAt.getTime()) / 60000
  const durationSec = result === 'incomplete' ? int(12, 70) : int(110, 430)

  return {
    vaani_call_id: `${SEED_PREFIX}${String(index).padStart(3, '0')}`,
    received_at: receivedAt.toISOString(),
    answered_at: answeredAt.toISOString(),
    channel: 'phone',
    duration_sec: durationSec,
    recording_url: `https://recordings.vaani.example/${SEED_PREFIX}${index}.mp3`,
    language: weighted([['english', 58], ['mixed', 24], ['marathi', 12], ['hindi', 6]]),
    name: result === 'incomplete' && chance(0.4) ? null : `${pick(FIRST)} ${pick(LAST)}`,
    phone: `+919${int(100000000, 899999999)}`,
    locality,
    service_area: area,
    property_type: propertyType,
    carpet_area_sqft: int(minArea, maxArea),
    scope: result === 'incomplete' && chance(0.5) ? null : scope,
    current_state: result === 'incomplete' ? 'unknown' : pick(STATES),
    timeline_target: result === 'incomplete' ? null : pick(TIMELINES),
    decision_maker: result === 'incomplete' ? 'unknown' : pick(DECIDERS),
    referral_source: weighted(SOURCES),
    budget_volunteered: chance(0.18) ? pick(BUDGETS) : null,   // rarely volunteered
    result,
    decline_reason: declineReason,
    escalation_reason: escalationReason,
    criteria_failed: declineReason === DECLINE_SERVICE_AREA ? ['service_area']
      : declineReason === DECLINE_SCOPE ? ['scope'] : [],
    criteria_unclear: area === 'unknown' ? ['locality_unrecognised'] : [],
    handoff_sent_at: handoffAt ? handoffAt.toISOString() : null,
    claimed_by: claimedBy,
    claimed_at: claimedAt ? claimedAt.toISOString() : null,
    consultation_booked: booked,
    consultation_at: booked
      ? new Date(receivedAt.getTime() + int(1, 9) * 86400_000).toISOString() : null,
    consultation_type: booked ? pick(['studio visit', 'site visit', 'video call']) : null,
    became_project: booked ? (chance(0.42) ? true : chance(0.5) ? false : null) : null,
    pricing_asked_count: pricingAsked,
    // Rule 5. Every row. No exceptions, including the ones that pushed four times.
    pricing_leaked: false,
    outcome_after_push: pricingAsked > 0
      ? (booked ? 'booked' : chance(0.45) ? 'undecided' : 'lost') : null,
    telephony_cost_inr: Number((durationSec * 0.011).toFixed(2)),
    voice_agent_cost_inr: Number((durationSec * 0.043 + 1.4).toFixed(2)),
    needs_review: needsReview,
    reviewed_by: reviewed ? pick(['Sanjana', 'Aditi']) : null,
    reviewed_at: reviewed ? new Date(receivedAt.getTime() + 86400_000).toISOString() : null,
    review_verdict: reviewed
      ? weighted([['agree', 86], ['disagree_should_have_qualified', 9],
                  ['disagree_should_have_declined', 5]])
      : null,
    raw_payload: { source: 'seed', note: 'fabricated for the demo dashboard', index },
  }
}

function buildAll() {
  state = 0x2f6e2b1
  return Array.from({ length: COUNT }, (_, i) => makeLead(i + 1))
}

/* --------------------------------- SQL --------------------------------- */
const quote = (v) => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    return v.length === 0 ? `'{}'` : `'{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}'`
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function toSql(leads) {
  const columns = Object.keys(leads[0])
  const values = leads
    .map((lead) => `  (${columns.map((c) => quote(lead[c])).join(', ')})`)
    .join(',\n')
  return [
    `-- Generated by scripts/seed.mjs. ${leads.length} fabricated enquiries.`,
    `delete from alert_log where lead_id in (select lead_id from leads where vaani_call_id like '${SEED_PREFIX}%');`,
    `delete from leads where vaani_call_id like '${SEED_PREFIX}%';`,
    `insert into leads (${columns.join(', ')}) values`,
    values + ';',
  ].join('\n')
}

/* --------------------------------- main -------------------------------- */
const args = process.argv.slice(2)
const leads = buildAll()

async function writeToSupabase(leads) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run with --sql\n' +
      'to print the statements and paste them into the Supabase SQL editor.'
    )
    process.exitCode = 1
    return
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // Only ever removes rows this script created.
  const { data: existing } = await supabase
    .from('leads').select('lead_id').like('vaani_call_id', `${SEED_PREFIX}%`)
  if (existing?.length) {
    const ids = existing.map((r) => r.lead_id)
    await supabase.from('alert_log').delete().in('lead_id', ids)
    await supabase.from('leads').delete().like('vaani_call_id', `${SEED_PREFIX}%`)
    console.log(`Removed ${existing.length} previously seeded rows.`)
  }

  for (let i = 0; i < leads.length; i += 40) {
    const batch = leads.slice(i, i + 40)
    const { error } = await supabase.from('leads').insert(batch)
    if (error) { console.error('Insert failed:', error.message); process.exitCode = 1; return }
    console.log(`Inserted ${Math.min(i + 40, leads.length)}/${leads.length}`)
  }

  const outOfHours = leads.filter((l) => {
    const h = new Date(new Date(l.received_at).getTime() + TZ_OFFSET_MIN * 60000).getUTCHours()
    return h < 10 || h >= 19
  }).length

  console.log(`\nDone. ${leads.length} leads.`)
  console.log(`  outside office hours: ${Math.round((outOfHours / leads.length) * 100)}%`)
  console.log(`  qualified: ${leads.filter((l) => l.result === 'qualified').length}`)
  console.log(`  pricing leaks: ${leads.filter((l) => l.pricing_leaked).length}  (must be 0)`)
}

if (args.includes('--sql')) {
  // writeSync, not process.stdout.write + process.exit: writes to a pipe are
  // asynchronous, and exiting before they flush truncates the output at 64KB -
  // which silently loses a third of the rows when this is piped into psql.
  writeSync(1, toSql(leads) + '\n')
  process.exitCode = 0
} else {
  await writeToSupabase(leads)
}
