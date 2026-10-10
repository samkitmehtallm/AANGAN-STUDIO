/**
 * Office hours in the studio's own timezone.
 *
 * The front desk works 10am-7pm IST. Vercel runs in UTC, so every
 * "is it office hours" question has to be asked in Asia/Kolkata or the answer
 * is wrong by five and a half hours - which would make the 30-minute unclaimed
 * sweep nag two designers at 3am and stay silent through the morning.
 */
export const OFFICE_TZ = process.env.OFFICE_TZ ?? 'Asia/Kolkata'
export const OPEN_HOUR = Number(process.env.OFFICE_OPEN_HOUR ?? 10)
export const CLOSE_HOUR = Number(process.env.OFFICE_CLOSE_HOUR ?? 19)

/** Hour of day (0-23) in the studio timezone. */
export function localHour(date: Date, tz = OFFICE_TZ): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: 'numeric', hour12: false,
  }).format(date)
  const hour = Number(formatted)
  return Number.isFinite(hour) ? hour % 24 : date.getUTCHours()
}

export function localDayOfWeek(date: Date, tz = OFFICE_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(date)
}

export function isOfficeHours(date: Date, tz = OFFICE_TZ): boolean {
  // The studio works six days; Sunday is closed.
  if (localDayOfWeek(date, tz) === 'Sun') return false
  const hour = localHour(date, tz)
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR
}

/** Formats a timestamp the way a designer in Pune reads it. */
export function formatLocal(date: Date, tz = OFFICE_TZ): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
