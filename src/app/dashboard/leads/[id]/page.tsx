import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchLead, fetchAlertsForLead } from '@/lib/leads-repo'
import { formatLocal, formatAge } from '@/lib/office-hours'
import { Pill, resultTone } from '@/components/primitives'
import { saveReview, claimFromDashboard } from './actions'

export const dynamic = 'force-dynamic'

const LABELS: Record<string, string> = {
  bare_shell: 'Bare shell', builder_handover: 'Builder handover',
  lived_in: 'Lived in', under_renovation: 'Under renovation', unknown: 'Not established',
  caller: 'The caller', caller_and_partner: 'Caller and partner',
  represented: 'Represented by someone', researching_for_others: 'Researching for someone else',
  in_area: 'In service area', out_of_area: 'Outside service area',
}

export default async function LeadRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const lead = await fetchLead(id)
  if (!lead) notFound()
  const alerts = await fetchAlertsForLead(id)

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-4 border-b border-[var(--color-line)] py-2.5 last:border-0">
      <div className="w-40 shrink-0 text-xs text-[var(--color-ink-faint)]">{label}</div>
      <div className="flex-1 text-sm">{value ?? '—'}</div>
    </div>
  )

  return (
    <main className="mx-auto max-w-[840px] px-6 py-9">
      <Link href="/dashboard/leads" className="text-sm text-[var(--color-accent)] hover:underline">
        ← All leads
      </Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {lead.name ?? 'Caller name not captured'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {formatLocal(new Date(lead.received_at))} · {lead.channel} ·{' '}
            {lead.duration_sec ? formatAge(lead.duration_sec) : 'duration unknown'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={resultTone(lead.result)}>{lead.result}</Pill>
          {lead.pricing_leaked ? <Pill tone="bad">price revealed</Pill> : null}
          {lead.needs_review ? <Pill tone="accent">needs review</Pill> : null}
        </div>
      </header>

      {/* The one place the callback number appears anywhere in this system. */}
      <section className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
          Callback number
        </h2>
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className="tnum text-xl font-semibold text-[var(--color-accent)] hover:underline">
            {lead.phone}
          </a>
        ) : (
          <p className="text-sm text-[var(--color-warn)]">
            No usable number was captured on this call. The recording may have it.
          </p>
        )}
        <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
          This number is deliberately absent from every handoff email. It is here and nowhere else.
        </p>
      </section>

      <section className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-5 py-2">
        {row('Locality', lead.locality
          ? <>{lead.locality} <span className="ml-1 text-xs text-[var(--color-ink-faint)]">
              ({LABELS[lead.service_area] ?? lead.service_area})</span></>
          : null)}
        {row('Property', [lead.property_type, lead.carpet_area_sqft ? `${lead.carpet_area_sqft} sqft` : null]
          .filter(Boolean).join(' · ') || null)}
        {row('Scope', lead.scope)}
        {row('State of site', LABELS[lead.current_state] ?? lead.current_state)}
        {row('Timeline', lead.timeline_target)}
        {row('Who decides', LABELS[lead.decision_maker] ?? lead.decision_maker)}
        {row('Found us via', lead.referral_source
          ? `${lead.referral_source}${lead.referral_name ? ` — ${lead.referral_name}` : ''}`
          : null)}
        {row('Budget', lead.budget_volunteered ?? 'Not volunteered (the agent never asks)')}
        {row('Language', lead.language)}
      </section>

      <section className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-5 py-2">
        {row('Ring received', formatLocal(new Date(lead.received_at)))}
        {row('Answered', lead.answered_at ? formatLocal(new Date(lead.answered_at)) : 'never answered')}
        {row('First response', lead.first_response_sec == null ? null : formatAge(lead.first_response_sec))}
        {row('Handed off', lead.handoff_sent_at ? formatLocal(new Date(lead.handoff_sent_at)) : 'not handed off')}
        {row('Claimed', lead.claimed_at
          ? `${lead.claimed_by} · ${formatLocal(new Date(lead.claimed_at))}`
          : lead.handoff_sent_at ? <span className="text-[var(--color-warn)]">still unclaimed</span> : null)}
        {row('Passed on by', (lead.passed_by ?? []).length > 0 ? (lead.passed_by ?? []).join(', ') : null)}
        {row('Consultation', lead.consultation_booked
          ? `booked${lead.consultation_at ? ` for ${formatLocal(new Date(lead.consultation_at))}` : ''}`
          : 'not booked')}
        {row('Pricing', `asked ${lead.pricing_asked_count ?? 0}× · ` +
          (lead.pricing_leaked ? 'A PRICE WAS REVEALED' : 'no price revealed') +
          (lead.outcome_after_push ? ` · after the push: ${lead.outcome_after_push}` : ''))}
        {row('Cost', `₹${Number(lead.total_cost_inr ?? 0).toFixed(2)}`)}
        {row('Decline reason', lead.decline_reason)}
        {row('Escalation reason', lead.escalation_reason)}
        {row('Criteria failed', (lead.criteria_failed ?? []).join(', ') || null)}
        {row('Criteria unclear', (lead.criteria_unclear ?? []).join(', ') || null)}
      </section>

      {!lead.claimed_at && lead.handoff_sent_at ? (
        <form action={claimFromDashboard}
              className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <input type="hidden" name="lead_id" value={lead.lead_id} />
          <div>
            <label className="block text-xs font-medium text-amber-900">Claim this lead as</label>
            <input name="designer" required placeholder="your name"
                   className="mt-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm" />
          </div>
          <button type="submit"
                  className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">
            Claim
          </button>
        </form>
      ) : null}

      {/* ---------------- human review ---------------- */}
      <form action={saveReview} className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <input type="hidden" name="lead_id" value={lead.lead_id} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
          Human review
        </h2>
        <p className="mt-1 mb-4 text-xs text-[var(--color-ink-soft)]">
          Did the agent judge this call the way you would have? This is the only real check on it.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--color-ink-soft)]">Verdict</span>
            <select name="review_verdict" defaultValue={lead.review_verdict ?? ''}
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm">
              <option value="">Not reviewed</option>
              <option value="agree">Agree with the agent</option>
              <option value="disagree_should_have_qualified">Should have qualified</option>
              <option value="disagree_should_have_declined">Should have declined</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-[var(--color-ink-soft)]">Became a project?</span>
            <select name="became_project"
                    defaultValue={lead.became_project === true ? 'yes' : lead.became_project === false ? 'no' : ''}
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm">
              <option value="">Not known yet</option>
              <option value="yes">Yes — we won it</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="block text-xs font-medium text-[var(--color-ink-soft)]">Note</span>
          <textarea name="review_note" rows={2} defaultValue={lead.review_note ?? ''}
                    placeholder="what the agent missed, or got right"
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-sm" />
        </label>

        <div className="mt-4 flex items-center gap-3">
          <input name="reviewed_by" placeholder="your name" defaultValue={lead.reviewed_by ?? ''}
                 className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm" />
          <button type="submit"
                  className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Save review
          </button>
          {lead.reviewed_at ? (
            <span className="text-xs text-[var(--color-ink-faint)]">
              last reviewed {formatLocal(new Date(lead.reviewed_at))}
            </span>
          ) : null}
        </div>
      </form>

      {alerts.length > 0 ? (
        <section className="mb-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
            What was sent about this lead
          </h2>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((alert) => (
              <li key={String(alert.id)} className="flex gap-3">
                <span className="w-44 shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {formatLocal(new Date(String(alert.sent_at)))}
                </span>
                <span>{String(alert.kind)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">
            Each kind can appear at most once. That is what stops an alert firing twice.
          </p>
        </section>
      ) : null}

      {lead.transcript ? (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
            Transcript
          </h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink-soft)]">
            {lead.transcript}
          </pre>
        </section>
      ) : null}
    </main>
  )
}
