import { type NextRequest, NextResponse } from 'next/server.js'
import { hostAccessPolicy } from './lib/host-policy'

const HOST_VALIDATION_ERROR = Object.freeze({
  error: 'Host validation failed. See logs for more details.',
})

const HOST_ACCESS_POLICY = hostAccessPolicy()

export function proxy(request: NextRequest) {
  const host = request.headers.get('host')
  const allowed = HOST_ACCESS_POLICY.mode === 'allow-all'
    || (host !== null && HOST_ACCESS_POLICY.hosts.has(host))

  if (!allowed) {
    console.error(JSON.stringify({
      scope: 'host-validation',
      code: 'HOST_NOT_ALLOWED',
      message: 'Request host is not in HOMEPAGE_ALLOWED_HOSTS',
      details: { host: host ?? '<missing>' },
    }))
    return NextResponse.json(HOST_VALIDATION_ERROR, { status: 400 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg).*)'],
}
