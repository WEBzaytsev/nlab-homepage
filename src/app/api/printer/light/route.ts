import 'server-only'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 5_000
const MAX_BODY_BYTES = 128
const LIGHT_OBJECT = 'output_pin caselight'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function configuredMoonraker(): URL {
  const value = process.env.MOONRAKER_URL
  if (!value) throw new Error('missing configuration')
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid configuration')
  }
  return url
}

function allowedOrigins(): ReadonlySet<string> {
  const hosts = process.env.HOMEPAGE_ALLOWED_HOSTS
  if (!hosts || hosts === '*') throw new Error('write origin is not configured')
  return new Set(hosts.split(',').filter(Boolean).map((host) => new URL(`https://${host}`).origin))
}

function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins().has(origin)) throw new Error('origin denied')
}

async function moonraker(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')
  if (process.env.MOONRAKER_API_KEY) headers.set('x-api-key', process.env.MOONRAKER_API_KEY)
  const response = await fetch(new URL(path, configuredMoonraker()), {
    ...init,
    headers,
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('Moonraker unavailable')
  return response.json() as Promise<unknown>
}

async function lightState(): Promise<boolean> {
  const params = new URLSearchParams([[LIGHT_OBJECT, '']])
  const response = await moonraker(`/printer/objects/query?${params}`)
  const result = isRecord(response) && isRecord(response.result) ? response.result : null
  const status = result && isRecord(result.status) ? result.status : null
  const light = status && isRecord(status[LIGHT_OBJECT]) ? status[LIGHT_OBJECT] : null
  if (!light || typeof light.value !== 'number' || !Number.isFinite(light.value)) throw new Error('invalid light state')
  return light.value === 1
}

function unavailable(): Response {
  return Response.json({ error: { code: 'PRINTER_LIGHT_UNAVAILABLE', message: 'Printer light unavailable' } }, {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function GET(): Promise<Response> {
  try {
    return Response.json({ enabled: await lightState() }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return unavailable()
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request)
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      return Response.json({ error: { code: 'INVALID_INPUT', message: 'Expected JSON' } }, { status: 415, headers: { 'cache-control': 'no-store' } })
    }
    const body = await request.text()
    if (body.length > MAX_BODY_BYTES) throw new Error('invalid input')
    const payload: unknown = JSON.parse(body)
    if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.enabled !== 'boolean') throw new Error('invalid input')

    const enabled = payload.enabled
    await moonraker('/printer/gcode/script', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: enabled ? 'SET_PIN PIN=caselight VALUE=1' : 'SET_PIN PIN=caselight VALUE=0' }),
    })
    const confirmed = await lightState()
    if (confirmed !== enabled) throw new Error('light state was not confirmed')
    return Response.json({ enabled: confirmed }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'origin denied') {
      return Response.json({ error: { code: 'ORIGIN_DENIED', message: 'Origin denied' } }, { status: 403, headers: { 'cache-control': 'no-store' } })
    }
    if (error instanceof SyntaxError || error instanceof Error && error.message === 'invalid input') {
      return Response.json({ error: { code: 'INVALID_INPUT', message: 'Expected { enabled: boolean }' } }, { status: 400, headers: { 'cache-control': 'no-store' } })
    }
    return unavailable()
  }
}
