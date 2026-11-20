import 'server-only'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 5_000
const MAX_METADATA_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function configuredOrigin(name: string): URL {
  const value = process.env[name]
  if (!value) throw new Error('missing configuration')
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid configuration')
  }
  return url
}

function optionalPair(firstName: string, secondName: string): readonly [string, string] | null {
  const first = process.env[firstName]
  const second = process.env[secondName]
  if (Boolean(first) !== Boolean(second)) throw new Error('incomplete credentials')
  return first && second ? [first, second] : null
}

async function readJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_METADATA_BYTES) throw new Error('response too large')
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function cameraStream(request: Request): Promise<Response> {
  const moonrakerUrl = configuredOrigin('MOONRAKER_URL')
  const cameraOrigin = configuredOrigin('PRINTER_CAMERA_ORIGIN')
  const cameraUid = process.env.PRINTER_CAMERA_UID?.trim() || undefined
  const moonrakerHeaders = new Headers({ accept: 'application/json' })
  if (process.env.MOONRAKER_API_KEY) moonrakerHeaders.set('x-api-key', process.env.MOONRAKER_API_KEY)

  const metadataResponse = await fetch(new URL('/server/webcams/list', moonrakerUrl), {
    headers: moonrakerHeaders,
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!metadataResponse.ok) throw new Error('metadata unavailable')
  const metadata = await readJson(metadataResponse)
  const result = isRecord(metadata) && isRecord(metadata.result) ? metadata.result : metadata
  const cameras = isRecord(result) && Array.isArray(result.webcams)
    ? result.webcams.filter((camera) => isRecord(camera) && camera.enabled !== false && (!cameraUid || camera.uid === cameraUid))
    : []
  const [camera] = cameras
  if (cameras.length !== 1 || !isRecord(camera) || typeof camera.stream_url !== 'string' || !camera.stream_url.trim()) {
    throw new Error('camera unavailable')
  }

  const streamUrl = new URL(camera.stream_url, cameraOrigin)
  if ((streamUrl.protocol !== 'http:' && streamUrl.protocol !== 'https:') || streamUrl.username || streamUrl.password || streamUrl.origin !== cameraOrigin.origin) {
    throw new Error('invalid stream URL')
  }

  const headers = new Headers({ accept: 'multipart/x-mixed-replace' })
  const credentials = optionalPair('PRINTER_CAMERA_USER', 'PRINTER_CAMERA_PASSWORD')
  if (credentials) {
    const [user, password] = credentials
    if (user.includes(':')) throw new Error('invalid Basic username')
    headers.set('authorization', `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)
  }

  const abort = new AbortController()
  const stop = () => abort.abort()
  request.signal.addEventListener('abort', stop, { once: true })
  let response: Response
  try {
    response = await fetch(streamUrl, { headers, redirect: 'error', credentials: 'omit', signal: abort.signal })
  } catch (error) {
    request.signal.removeEventListener('abort', stop)
    throw error
  }
  if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('multipart/x-mixed-replace')) {
    request.signal.removeEventListener('abort', stop)
    await response.body?.cancel()
    throw new Error('stream unavailable')
  }

  const reader = response.body.getReader()
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          request.signal.removeEventListener('abort', stop)
          controller.close()
        } else controller.enqueue(value)
      } catch (error) {
        request.signal.removeEventListener('abort', stop)
        controller.error(error)
      }
    },
    async cancel() {
      request.signal.removeEventListener('abort', stop)
      abort.abort()
      await reader.cancel()
    },
  }), {
    headers: {
      'cache-control': 'no-store, no-transform',
      'content-type': response.headers.get('content-type')!,
      'x-accel-buffering': 'no',
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await cameraStream(request)
  } catch {
    return Response.json({ error: { code: 'PRINTER_STREAM_UNAVAILABLE', message: 'Printer stream unavailable' } }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
