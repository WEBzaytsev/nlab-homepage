import { type NextRequest, NextResponse } from 'next/server.js'

const HOST_VALIDATION_ERROR = Object.freeze({
  error: 'Host validation failed. See logs for more details.',
})

type HostAccessPolicy =
  | Readonly<{ mode: 'allow-all' }>
  | Readonly<{ mode: 'allow-list'; hosts: ReadonlySet<string> }>

function hostAccessPolicy(): HostAccessPolicy {
  const port = process.env.PORT || '3000'
  const configuredHosts = process.env.HOMEPAGE_ALLOWED_HOSTS ?? ''
  if (configuredHosts === '*') return { mode: 'allow-all' }

  return {
    mode: 'allow-list',
    hosts: new Set([
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
      ...configuredHosts.split(',').filter(Boolean),
    ]),
  }
}

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
