import 'server-only'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CACHE_MS = 10_000
const FETCH_TIMEOUT_MS = 5_000
const MAX_METADATA_BYTES = 256 * 1024
const MAX_FRAME_BYTES = 5 * 1024 * 1024

type Frame = Readonly<{
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png'
  frameTime: number
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
}>

type CachedFrame = Frame & Readonly<{ expiresAt: number }>

let cachedFrame: CachedFrame | null = null
let pendingFrame: Promise<Frame> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function configuredUrl(name: string): URL {
  const value = process.env[name]
  if (!value) throw new Error('missing configuration')

  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('invalid configuration')
  }
  return url
}

function configuredOrigin(name: string): URL {
  const url = configuredUrl(name)
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('invalid configuration')
  return url
}

async function readBody(response: Response, limit: number): Promise<Uint8Array> {
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

function imageContentType(bytes: Uint8Array): Frame['contentType'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png'
  return null
}

function webcamFor(metadata: unknown, uid?: string): Record<string, unknown> {
  if (!isRecord(metadata)) throw new Error('invalid metadata')
  const result = isRecord(metadata.result) ? metadata.result : metadata
  if (!Array.isArray(result.webcams)) throw new Error('invalid metadata')

  const cameras = result.webcams.filter((camera) => isRecord(camera) && camera.enabled === true && (!uid || camera.uid === uid))
  const [webcam] = cameras
  if (cameras.length !== 1 || typeof webcam.snapshot_url !== 'string' || !webcam.snapshot_url.trim()) throw new Error('camera unavailable')
  return webcam
}

async function fetchFrame(): Promise<Frame> {
  const moonrakerUrl = configuredUrl('MOONRAKER_URL')
  const cameraOrigin = configuredOrigin('PRINTER_CAMERA_ORIGIN')
  const cameraUid = process.env.PRINTER_CAMERA_UID


  const moonrakerHeaders = new Headers({ accept: 'application/json' })
  const apiKey = process.env.MOONRAKER_API_KEY
  if (apiKey) moonrakerHeaders.set('x-api-key', apiKey)

  const metadataResponse = await fetch(new URL('/server/webcams/list', moonrakerUrl), {
    headers: moonrakerHeaders,
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!metadataResponse.ok) throw new Error('metadata unavailable')
  const metadata = JSON.parse(new TextDecoder().decode(await readBody(metadataResponse, MAX_METADATA_BYTES))) as unknown
  const webcam = webcamFor(metadata, cameraUid)

  const snapshotUrl = new URL(webcam.snapshot_url as string, cameraOrigin)
  if (
    (snapshotUrl.protocol !== 'http:' && snapshotUrl.protocol !== 'https:')
    || snapshotUrl.username
    || snapshotUrl.password
    || snapshotUrl.origin !== cameraOrigin.origin
  ) throw new Error('invalid snapshot URL')

  const [rotation, flipHorizontal, flipVertical] = [
    webcam.rotation,
    webcam.flip_horizontal,
    webcam.flip_vertical,
  ]
  if (
    typeof rotation !== 'number'
    || !Number.isInteger(rotation)
    || ![0, 90, 180, 270].includes(rotation)
    || typeof flipHorizontal !== 'boolean'
    || typeof flipVertical !== 'boolean'
  ) throw new Error('invalid camera metadata')

  const frameResponse = await fetch(snapshotUrl, {
    headers: { accept: 'image/jpeg, image/png' },
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!frameResponse.ok) throw new Error('frame unavailable')
  const bytes = await readBody(frameResponse, MAX_FRAME_BYTES)
  const contentType = imageContentType(bytes)
  if (!contentType) throw new Error('invalid frame')

  return { bytes, contentType, frameTime: Date.now(), rotation, flipHorizontal, flipVertical }
}

async function getFrame(): Promise<Frame> {
  if (cachedFrame && cachedFrame.expiresAt > Date.now()) return cachedFrame
  if (!pendingFrame) {
    pendingFrame = fetchFrame().then((frame) => {
      cachedFrame = { ...frame, expiresAt: Date.now() + CACHE_MS }
      return frame
    }).finally(() => {
      pendingFrame = null
    })
  }
  return pendingFrame
}

function frameResponse(frame: Frame): Response {
  return new Response(frame.bytes.buffer as ArrayBuffer, {
    headers: {
      'cache-control': 'private, max-age=10',
      'content-type': frame.contentType,
      'x-frame-time': String(frame.frameTime),
      'x-rotation': String(frame.rotation),
      'x-flip-horizontal': String(frame.flipHorizontal),
      'x-flip-vertical': String(frame.flipVertical),
    },
  })
}

export async function GET(): Promise<Response> {
  try {
    return frameResponse(await getFrame())
  } catch {
    return Response.json({ error: { code: 'PRINTER_FRAME_UNAVAILABLE', message: 'Printer frame unavailable' } }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
