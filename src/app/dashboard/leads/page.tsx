import Link from 'next/link'
import { fetchLeads } from '@/lib/leads-repo'
import { formatLocal, formatAge } from '@/lib/office-hours'
import { Pill, resultTone } from '@/components/primitives'

export const dynamic = 'force-dynamic'

const FILTERS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'All' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'declined', label: 'Declined' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'booked', label: 'Consultation booked' },
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unknown_area', label: 'Locality unknown' },
  { key: 'pricing_leaked', label: 'Pricing leaked' },
]

export default async function LeadsPage({
  searchParams,
}: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams
  const leads = await fetchLeads({ sinceDays: 60, filter: filter ?? null })

  return (
    <main className="mx-auto max-w-[1080px] px-6 py-9">
      <header className="mb-5">
        <Link href="/dashboard" className="text-sm text-[var(--color-accent)] hover:underline">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          {leads.length} {leads.length === 1 ? 'enquiry' : 'enquiries'}
          {filter ? ` matching “${FILTERS.find((f) => f.key === filter)?.label ?? filter}”` : ' in the last 60 days'}.
          {' '}Callback numbers are on the individual records.
        </p>
      </header>

      <nav className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => {
          const active = (item.key ?? '') === (filter ?? '')
          return (
            <Link key={item.label}
                  href={item.key ? `/dashboard/leads?filter=${item.key}` : '/dashboard/leads'}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white'
                      : 'border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink-soft)] hover:bg-[var(--color-ground)]'
                  }`}>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {leads.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-5 py-8 text-center text-sm text-[var(--color-ink-soft)]">
          Nothing here. {filter === 'pricing_leaked' ? 'That is the correct number for this one.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          <table className="w-full min-w-[840px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-[11px] uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                <th className="px-4 py-2.5 font-medium">Received</th>
                <th className="px-4 py-2.5 font-medium">Caller</th>
                <th className="px-4 py-2.5 font-medium">Locality</th>
                <th className="px-4 py-2.5 font-medium">Property</th>
                <th className="px-4 py-2.5 font-medium">Outcome</th>
                <th className="px-4 py-2.5 text-right font-medium">1st response</th>
                <th className="px-4 py-2.5 font-medium">Claimed by</th>
                <th className="px-4 py-2.5 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.lead_id}
                    className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-ground)]">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">
                    <Link href={`/dashboard/leads/${lead.lead_id}`} className="hover:underline">
                      {formatLocal(new Date(lead.received_at))}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/dashboard/leads/${lead.lead_id}`} className="hover:underline">
                      {lead.name ?? <span className="text-[var(--color-ink-faint)]">no name captured</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-ink-soft)]">
                    {lead.locality ?? '—'}
                    {lead.service_area === 'unknown' ? <span className="ml-1 text-[var(--color-warn)]">?</span> : null}
                    {lead.service_area === 'out_of_area' ? <span className="ml-1 text-[var(--color-bad)]">✕</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">
                    {lead.property_type ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Pill tone={resultTone(lead.result)}>{lead.result}</Pill>
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-xs">
                    {lead.first_response_sec == null ? '—' : formatAge(lead.first_response_sec)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">
                    {lead.claimed_by ?? (lead.handoff_sent_at
                      ? <span className="text-[var(--color-warn)]">unclaimed</span>
                      : '—')}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {lead.pricing_leaked ? <Pill tone="bad">price revealed</Pill> : null}
                      {(lead.pricing_asked_count ?? 0) > 0 ? <Pill tone="warn">asked ×{lead.pricing_asked_count}</Pill> : null}
                      {lead.needs_review && !lead.review_verdict ? <Pill tone="accent">review</Pill> : null}
                      {lead.consultation_booked ? <Pill tone="good">booked</Pill> : null}
                      {lead.became_project ? <Pill tone="good">won</Pill> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
