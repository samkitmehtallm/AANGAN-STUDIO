/**
 * The handoff card.
 *
 * Rule 3: the caller's phone number is NEVER in a message that lands in a
 * shared inbox. The designers' handoff address is read by several people and
 * forwarded without thought; a number in that body is a number loose in the
 * world. It lives behind the "Open record" link, where reaching it means being
 * signed in to the dashboard.
 *
 * That rule is enforced here rather than remembered: assertNoPhoneNumber()
 * runs over every rendered card before it can be sent, and the renderer is
 * never handed the phone field in the first place.
 */
import { formatLocal, formatAge } from './office-hours'
import { parseLeadWeeks } from './qualification'

export interface CardLead {
  lead_id: string
  name: string | null
  locality: string | null
  service_area: 'in_area' | 'out_of_area' | 'unknown'
  property_type: string | null
  carpet_area_sqft: number | null
  scope: string | null
  current_state: string | null
  timeline_target: string | null
  site_available_from: string | null
  decision_maker: string | null
  referral_source: string | null
  referral_name: string | null
  budget_volunteered: string | null
  received_at: string
  result: string
  criteria_failed?: string[] | null
  criteria_unclear?: string[] | null
  escalation_reason?: string | null
  decline_reason?: string | null
  needs_review?: boolean | null
  pricing_asked_count?: number | null
  pricing_leaked?: boolean | null
  language?: string | null
  duration_sec?: number | null
  first_response_sec?: number | null
  consultation_note?: string | null
}

export interface RenderedCard {
  subject: string
  html: string
  text: string
}

/**
 * Urgency, shown only when it is not normal.
 *
 * The brief asks for this on the card and it has to mean something, or it is
 * just a word. Two things actually change how fast a designer should move: a
 * site that needs starting sooner than the studio's comfortable lead time, and
 * a caller who has already been kept waiting.
 */
export function deriveUrgency(lead: CardLead): string | null {
  const reasons: string[] = []

  const text = [lead.timeline_target, lead.site_available_from].filter(Boolean).join(' ')
  const weeks = parseLeadWeeks(text)
  if (weeks !== null && weeks < 10) reasons.push(`starts in ~${Math.round(weeks)} weeks`)
  else if (/asap|as soon as possible|immediately|right away/i.test(text)) {
    reasons.push('caller said as soon as possible')
  }

  if ((lead.first_response_sec ?? 0) > 300) reasons.push('already waited to be answered')

  return reasons.length === 0 ? null : reasons.join(' · ')
}

const LABELS: Record<string, string> = {
  bare_shell: 'Bare shell',
  builder_handover: 'Builder handover',
  lived_in: 'Lived in',
  under_renovation: 'Under renovation',
  unknown: 'Not established',
  caller: 'The caller',
  caller_and_partner: 'Caller and partner',
  represented: 'Represented by someone',
  researching_for_others: 'Researching for someone else',
  in_area: 'In service area',
  out_of_area: 'Outside service area',
}

function label(value: string | null | undefined): string {
  if (!value) return '—'
  return LABELS[value] ?? value
}

function sourceLine(lead: CardLead): string {
  if (!lead.referral_source) return '—'
  if (lead.referral_source === 'referral') {
    return lead.referral_name ? `Referral — ${lead.referral_name}` : 'Referral (name not captured)'
  }
  return lead.referral_source.charAt(0).toUpperCase() + lead.referral_source.slice(1)
}

/** The brief asks who decides AND whether they were on the call. */
function deciderLine(lead: CardLead): string {
  const who = label(lead.decision_maker)
  if (lead.decision_maker === 'caller') return `${who} — on the call`
  if (lead.decision_maker === 'caller_and_partner') return `${who} — caller was on the call`
  if (lead.decision_maker === 'represented') return `${who} — authorised, on the call`
  if (lead.decision_maker === 'researching_for_others') {
    return `${who} — NOT on the call, confirm the owners attend`
  }
  return who
}

function propertyLine(lead: CardLead): string {
  const parts = [lead.property_type, lead.carpet_area_sqft ? `${lead.carpet_area_sqft} sqft` : null]
  const joined = parts.filter(Boolean).join(' · ')
  return joined === '' ? '—' : joined
}

export function cardFlags(lead: CardLead): string[] {
  const flags: string[] = []
  if (lead.service_area === 'unknown') flags.push('Locality not recognised — confirm before travelling')
  if (lead.service_area === 'out_of_area') flags.push('Outside service area')
  if (lead.pricing_leaked) flags.push('PRICE REVEALED ON CALL — incident')
  if ((lead.pricing_asked_count ?? 0) >= 2) flags.push(`Asked about price ${lead.pricing_asked_count} times`)
  if (!lead.name) flags.push('No caller name captured')
  if (lead.needs_review) flags.push('Flagged for review')
  for (const c of lead.criteria_unclear ?? []) flags.push(`Unclear: ${c}`)
  return flags
}

/**
 * Throws if anything that looks like a phone number survived into the message.
 *
 * Deliberately broad: any run of 10 or more digits, with the separators people
 * actually use, and any +91 prefix. False positives are cheap here - a UUID
 * has letters, a timestamp has punctuation we exclude - and a false negative
 * is the one failure this whole rule exists to prevent.
 */
export function assertNoPhoneNumber(content: string, context = 'message'): void {
  const stripped = content
    // Drop URLs first: a lead_id in a link is hex, not a phone number, and
    // query strings carry signed tokens full of digits.
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/href="[^"]*"/g, ' ')
    // A lead_id is 8-4-4-4-12 hex and can be all digits. It is an identifier,
    // not a number anyone can call.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
  const patterns: Array<[RegExp, string]> = [
    [/\+\s*91[\s\-.]*\d{5}[\s\-.]*\d{5}/, 'E.164 Indian number'],
    [/\+\d{10,15}/, 'E.164 number'],
    [/\b\d[\d\s\-.]{8,}\d\b/, 'digit run of 10 or more'],
  ]
  for (const [pattern, description] of patterns) {
    const match = stripped.match(pattern)
    if (match) {
      const digits = match[0].replace(/\D/g, '')
      if (digits.length >= 10) {
        throw new Error(
          `Rule 3 violation: ${context} contains what looks like a phone number ` +
          `(${description}: "${match[0].trim()}"). The number belongs behind the ` +
          `Open record link, never in the message body.`
        )
      }
    }
  }
}

export interface CardOptions {
  baseUrl: string
  /** Omitted for escalations, which carry no Claim button. */
  claimUrl?: string | null
  passUrl?: string | null
  /** Escalations only: "I'm calling now". Stops the 15-minute watchdog. */
  ackUrl?: string | null
  /** Set on a repost so the card leads with how long this has been sitting. */
  ageSeconds?: number | null
  kind?: 'handoff' | 'escalation' | 'repost'
}

export function renderHandoffCard(lead: CardLead, options: CardOptions): RenderedCard {
  const kind = options.kind ?? 'handoff'
  const recordUrl = `${options.baseUrl.replace(/\/$/, '')}/dashboard/leads/${lead.lead_id}`
  const flags = cardFlags(lead)
  const received = new Date(lead.received_at)
  const who = lead.name ?? 'Caller name not captured'

  const urgency = kind === 'handoff' ? deriveUrgency(lead) : null
  const subjectPrefix =
    kind === 'escalation' ? 'ESCALATION'
    : kind === 'repost' ? `UNCLAIMED ${options.ageSeconds ? formatAge(options.ageSeconds) : ''}`.trim()
    : urgency ? 'New enquiry · MOVE FAST'
    : 'New enquiry'
  const subject =
    `${subjectPrefix} — ${who}${lead.locality ? `, ${lead.locality}` : ''}` +
    `${lead.property_type ? ` — ${lead.property_type}` : ''}`

  const rows: Array<[string, string]> = [
    ['Name', who],
    ['Locality', lead.locality ? `${lead.locality} (${label(lead.service_area)})` : '—'],
    ['Property', propertyLine(lead)],
    ['Scope', lead.scope ?? '—'],
    ['State of site', label(lead.current_state)],
    ['Timeline', lead.timeline_target ?? '—'],
    ['Site available', lead.site_available_from ?? 'Not established'],
    ['Who decides', deciderLine(lead)],
    ['Found us via', sourceLine(lead)],
    ['Budget', lead.budget_volunteered ?? 'Not volunteered'],
    ['Consultation', lead.consultation_note ?? '—'],
    ['Call', `${formatLocal(received)}${lead.duration_sec ? ` · ${formatAge(lead.duration_sec)}` : ''}`],
  ]

  /* ---------------- text ---------------- */
  const textLines: string[] = []
  if (urgency) textLines.push(`MOVE FAST — ${urgency}.`, '')
  if (kind === 'repost' && options.ageSeconds) {
    textLines.push(`STILL UNCLAIMED — ${formatAge(options.ageSeconds)} old.`, '')
  }
  if (kind === 'escalation') {
    textLines.push('ESCALATED BY THE AGENT — needs a human.', '')
    if (lead.escalation_reason) textLines.push(`Reason: ${lead.escalation_reason}`, '')
  }
  for (const [k, v] of rows) textLines.push(`${k}: ${v}`)
  if (flags.length > 0) {
    textLines.push('', 'Flags:')
    for (const f of flags) textLines.push(`  - ${f}`)
  }
  textLines.push('', `Open record (callback number is here): ${recordUrl}`)
  if (options.ackUrl) {
    textLines.push('', `I'm calling now: ${options.ackUrl}`)
  }
  if (options.claimUrl) {
    textLines.push('', `Claim this lead: ${options.claimUrl}`)
    if (options.passUrl) textLines.push(`Can't take it: ${options.passUrl}`)
  }
  const text = textLines.join('\n')

  /* ---------------- html ---------------- */
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const banner =
    kind === 'repost' && options.ageSeconds
      ? `<div style="background:#7f1d1d;color:#fff;padding:12px 20px;font-weight:600;font-size:15px">
           Still unclaimed — ${esc(formatAge(options.ageSeconds))} old
         </div>`
      : kind === 'escalation'
      ? `<div style="background:#78350f;color:#fff;padding:12px 20px;font-weight:600;font-size:15px">
           Escalated by the agent — needs a human
           ${lead.escalation_reason ? `<div style="font-weight:400;font-size:13px;margin-top:4px;opacity:.9">${esc(lead.escalation_reason)}</div>` : ''}
         </div>`
      : ''

  const flagHtml = flags.length === 0 ? '' : `
    <div style="margin:0 20px 18px;padding:12px 14px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px">
      ${flags.map((f) => `<div style="font-size:13px;color:#78350f;line-height:1.6">${esc(f)}</div>`).join('')}
    </div>`

  const buttons = options.claimUrl ? `
    <div style="padding:4px 20px 24px">
      <a href="${esc(options.claimUrl)}" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px">Claim this lead</a>
      ${options.passUrl ? `<a href="${esc(options.passUrl)}" style="display:inline-block;margin-left:10px;background:#fff;color:#4b5563;text-decoration:none;padding:10px 20px;border:1px solid #d1d5db;border-radius:6px;font-size:14px">Can't take it</a>` : ''}
    </div>`
    : options.ackUrl ? `
    <div style="padding:4px 20px 24px">
      <a href="${esc(options.ackUrl)}" style="display:inline-block;background:#92400e;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px">I'm calling now</a>
    </div>` : ''

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
    ${banner}
    <div style="padding:20px 20px 6px">
      <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#6b7280;font-weight:600">Aangan Studio — inbound enquiry</div>
      ${urgency ? `<div style="margin-top:6px;display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:3px">Move fast — ${esc(urgency)}</div>` : ''}
      <div style="font-size:21px;font-weight:650;color:#111827;margin-top:6px">${esc(who)}</div>
    </div>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:14px 0 18px">
      ${rows.map(([k, v]) => `
        <tr>
          <td style="padding:7px 20px;font-size:12px;color:#6b7280;width:132px;vertical-align:top;border-top:1px solid #f3f4f6">${esc(k)}</td>
          <td style="padding:7px 20px 7px 0;font-size:14px;color:#111827;vertical-align:top;border-top:1px solid #f3f4f6">${esc(v)}</td>
        </tr>`).join('')}
    </table>
    ${flagHtml}
    <div style="padding:0 20px 16px">
      <a href="${esc(recordUrl)}" style="font-size:14px;color:#1d4ed8;text-decoration:none;font-weight:550">Open record →</a>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">The callback number is on the record, not in this email.</div>
    </div>
    ${buttons}
  </div>
</body></html>`

  const card: RenderedCard = { subject, html, text }

  // The guardrail runs on the rendered output, so it catches a number that
  // arrived inside any free-text field - a scope note, a referral name - not
  // just one passed in the phone slot.
  assertNoPhoneNumber(card.subject, 'handoff email subject')
  assertNoPhoneNumber(card.text, 'handoff email text body')
  assertNoPhoneNumber(card.html, 'handoff email html body')

  return card
}
