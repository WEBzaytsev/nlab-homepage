let authNavigationStarted = false

export class TinyAuthExpiredError extends Error {
  constructor() {
    super('Authentication expired')
    this.name = 'TinyAuthExpiredError'
  }
}

export function isTinyAuthExpiredError(error: unknown): error is TinyAuthExpiredError {
  return error instanceof TinyAuthExpiredError
}

function isSameOrigin(input: RequestInfo | URL) {
  try {
    const url = new URL(input instanceof Request ? input.url : input.toString(), window.location.href)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

function isReadRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

function beginTinyAuthFlow() {
  if (authNavigationStarted) return
  authNavigationStarted = true
  window.location.reload()
}

export async function fetchWithTinyAuth(input: RequestInfo | URL, init?: RequestInit) {
  const sameOrigin = isSameOrigin(input)
  const protectedRead = sameOrigin && isReadRequest(input, init)
  const response = await fetch(input, sameOrigin ? { ...init, redirect: 'manual' } : init)

  if (protectedRead && (response.status === 401 || response.type === 'opaqueredirect')) {
    beginTinyAuthFlow()
    throw new TinyAuthExpiredError()
  }

  return response
}
