import Link from 'next/link'
import { formatAge } from '@/lib/office-hours'

export function Band({
  title, note, children,
}: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <header className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] px-5 py-3.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-soft)]">
          {title}
        </h2>
        {note ? <p className="text-xs text-[var(--color-ink-faint)]">{note}</p> : null}
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

export function Stat({
  label, value, hint, tone = 'neutral', href,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  href?: string
}) {
  const toneClass =
    tone === 'good' ? 'text-[var(--color-good)]'
    : tone === 'warn' ? 'text-[var(--color-warn)]'
    : tone === 'bad' ? 'text-[var(--color-bad)]'
    : 'text-[var(--color-ink)]'

  const body = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div className={`tnum mt-1.5 text-[26px] font-semibold leading-none ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1.5 text-xs leading-snug text-[var(--color-ink-faint)]">{hint}</div> : null}
    </>
  )

  if (href) {
    return (
      <Link href={href} className="block rounded-lg p-3 -m-3 transition hover:bg-[var(--color-ground)]">
        {body}
      </Link>
    )
  }
  return <div>{body}</div>
}

export function Duration({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <span className="text-[var(--color-ink-faint)]">—</span>
  return <span className="tnum">{formatAge(seconds)}</span>
}

export function Pill({
  children, tone = 'neutral',
}: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const map = {
    neutral: 'bg-[var(--color-ground)] text-[var(--color-ink-soft)] border-[var(--color-line)]',
    good: 'bg-green-50 text-green-800 border-green-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-red-50 text-red-800 border-red-200',
    accent: 'bg-blue-50 text-blue-800 border-blue-200',
  } as const
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  )
}

export function resultTone(result: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (result === 'qualified') return 'good'
  if (result === 'escalated') return 'warn'
  if (result === 'declined') return 'bad'
  return 'neutral'
}

/** A horizontal bar row. No chart library: this is a div with a width. */
export function BarRow({
  label, count, max, tone = 'accent', suffix,
}: { label: string; count: number; max: number; tone?: string; suffix?: string }) {
  const pct = max === 0 ? 0 : (count / max) * 100
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-40 shrink-0 truncate text-xs text-[var(--color-ink-soft)]" title={label}>
        {label}
      </div>
      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-[var(--color-ground)]">
        <div className="h-full rounded-sm" style={{ width: `${Math.max(pct, count > 0 ? 1.5 : 0)}%`, background: tone }} />
      </div>
      <div className="tnum w-14 shrink-0 text-right text-xs text-[var(--color-ink-soft)]">
        {count}{suffix ?? ''}
      </div>
    </div>
  )
}
