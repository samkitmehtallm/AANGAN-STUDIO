import { OPEN_HOUR, CLOSE_HOUR } from '@/lib/office-hours'

/**
 * Enquiries by hour of day, with the 10am-7pm band shaded.
 *
 * The shading is the argument: everything outside it arrived when nobody was
 * at the desk. Drawn as inline SVG so it renders on the server with no client
 * JavaScript and no chart dependency.
 */
export function HourChart({
  buckets, outsidePct,
}: {
  buckets: Array<{ hour: number; count: number; inOfficeHours: boolean }>
  outsidePct: number | null
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const width = 720
  const height = 190
  const padLeft = 28
  const padBottom = 26
  const padTop = 10
  const plotWidth = width - padLeft - 8
  const plotHeight = height - padBottom - padTop
  const barWidth = plotWidth / 24

  const bandX = padLeft + (OPEN_HOUR / 24) * plotWidth
  const bandWidth = ((CLOSE_HOUR - OPEN_HOUR) / 24) * plotWidth

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[190px] w-full min-w-[560px]"
        role="img"
        aria-label="Enquiries by hour of day, with office hours shaded"
      >
        {/* The shaded band: the nine hours anyone is actually at the desk. */}
        <rect x={bandX} y={padTop} width={bandWidth} height={plotHeight} fill="#eef2ff" />
        <text x={bandX + bandWidth / 2} y={padTop + 12} textAnchor="middle"
              fontSize="10" fill="#6366f1" fontWeight="600" letterSpacing="0.06em">
          10am – 7pm
        </text>

        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={padLeft} x2={width - 8}
                y1={padTop + plotHeight - t * plotHeight} y2={padTop + plotHeight - t * plotHeight}
                stroke="#e3e6eb" strokeWidth="1" />
        ))}

        {buckets.map((bucket) => {
          const barHeight = (bucket.count / max) * plotHeight
          return (
            <rect
              key={bucket.hour}
              x={padLeft + bucket.hour * barWidth + barWidth * 0.18}
              y={padTop + plotHeight - barHeight}
              width={barWidth * 0.64}
              height={barHeight}
              rx="1.5"
              fill={bucket.inOfficeHours ? '#1d4ed8' : '#b45309'}
            >
              <title>{`${String(bucket.hour).padStart(2, '0')}:00 — ${bucket.count} enquiries`}</title>
            </rect>
          )
        })}

        <text x={padLeft - 6} y={padTop + 8} textAnchor="end" fontSize="10" fill="#8a93a3">{max}</text>
        <text x={padLeft - 6} y={padTop + plotHeight} textAnchor="end" fontSize="10" fill="#8a93a3">0</text>

        {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
          <text key={hour} x={padLeft + hour * barWidth + barWidth / 2}
                y={height - 9} textAnchor="middle" fontSize="10" fill="#8a93a3">
            {String(hour).padStart(2, '0')}
          </text>
        ))}
      </svg>

      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
        <span className="mr-3 inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#1d4ed8]" /> office hours
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#b45309]" /> out of hours
        </span>
        {outsidePct !== null ? (
          <span className="ml-3">
            <strong className="tnum font-semibold text-[var(--color-ink)]">{outsidePct}%</strong> of
            enquiries arrived outside office hours — every one of those used to wait until morning.
          </span>
        ) : null}
      </p>
    </div>
  )
}
