import { NextResponse, type NextRequest } from 'next/server'

/**
 * A door on the dashboard.
 *
 * The record page shows callback numbers, so the dashboard cannot be open to
 * the internet. This is HTTP Basic auth against a single shared password -
 * crude, but it is honest about what it is, it needs no user table, and it is
 * enormously better than the alternative of leaving the page public.
 *
 * With DASHBOARD_PASSWORD unset the dashboard is open. That is fine locally
 * and is called out in the README as something to set before the first real
 * call lands.
 *
 * The API routes are deliberately NOT behind this: the webhook authenticates
 * with an HMAC signature, the cron endpoints with a bearer token, and the
 * claim links with their own signature.
 */
export function middleware(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD
  if (!password || password.trim() === '') return NextResponse.next()

  const header = request.headers.get('authorization') ?? ''
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6))
      const supplied = decoded.slice(decoded.indexOf(':') + 1)
      if (supplied === password) return NextResponse.next()
    } catch {
      // fall through to the challenge
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Aangan Studio", charset="UTF-8"' },
  })
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
