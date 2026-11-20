import 'server-only'

export const FETCH_TIMEOUT_MS = 5_000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function configuredOrigin(name: string): URL {
  const value = process.env[name]
  if (!value) throw new Error('missing configuration')
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid configuration')
  }
  return url
}

export function sameOriginUrl(value: string, origin: URL): URL {
  const url = new URL(value, origin)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.origin !== origin.origin) {
    throw new Error('invalid camera URL')
  }
  return url
}

export function optionalPair(firstName: string, secondName: string): readonly [string, string] | null {
  const first = process.env[firstName]
  const second = process.env[secondName]
  if (Boolean(first) !== Boolean(second)) throw new Error('incomplete credentials')
  return first && second ? [first, second] : null
}

export function cameraHeaders(): Headers {
  const headers = new Headers({ accept: 'image/jpeg, image/png' })
  const credentials = optionalPair('PRINTER_CAMERA_USER', 'PRINTER_CAMERA_PASSWORD')
  if (!credentials) return headers

  const [user, password] = credentials
  if (user.includes(':')) throw new Error('invalid Basic username')
  headers.set('authorization', `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)
  return headers
}

export async function readBody(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('missing response body')

  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('response too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function readJson(response: Response, limit: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBody(response, limit))) as unknown
}

export async function moonraker(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (process.env.MOONRAKER_API_KEY) headers.set('x-api-key', process.env.MOONRAKER_API_KEY)

  const response = await fetch(new URL(path, configuredOrigin('MOONRAKER_URL')), {
    ...init,
    headers,
    redirect: 'error',
    credentials: 'omit',
    signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('Moonraker unavailable')
  return response
}

export async function moonrakerJson(path: string, limit: number, params?: URLSearchParams): Promise<unknown> {
  const url = params ? `${path}?${params}` : path
  return readJson(await moonraker(url), limit)
}

export function webcamFor(metadata: unknown, uid?: string): Record<string, unknown> {
  const result = isRecord(metadata) && isRecord(metadata.result) ? metadata.result : metadata
  const cameras = isRecord(result) && Array.isArray(result.webcams)
    ? result.webcams.filter((camera) => isRecord(camera) && camera.enabled !== false && (!uid || camera.uid === uid))
    : []
  const [webcam] = cameras
  if (cameras.length !== 1 || !isRecord(webcam)) throw new Error('camera unavailable')
  return webcam
}
