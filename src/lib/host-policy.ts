type HostAccessPolicy =
  | Readonly<{ mode: 'allow-all' }>
  | Readonly<{ mode: 'allow-list'; hosts: ReadonlySet<string> }>

function configuredHosts(): readonly string[] {
  return (process.env.HOMEPAGE_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean)
}

export function hostAccessPolicy(): HostAccessPolicy {
  const port = process.env.PORT || '3000'
  const hosts = configuredHosts()
  if (hosts.includes('*')) return { mode: 'allow-all' }
  return {
    mode: 'allow-list',
    hosts: new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...hosts]),
  }
}

export function originAllowedByHosts(origin: string): boolean {
  const hosts = configuredHosts()
  if (hosts.length === 0 || hosts.includes('*')) return false
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.origin === origin && hosts.includes(url.host)
  } catch {
    return false
  }
}
