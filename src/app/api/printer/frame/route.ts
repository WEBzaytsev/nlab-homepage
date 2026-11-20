import 'server-only'

import { FETCH_TIMEOUT_MS, cameraHeaders, configuredOrigin, moonrakerJson, readBody, sameOriginUrl, webcamFor } from '../printer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CACHE_MS = 10_000
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

async function fetchFrame(): Promise<Frame> {
  const cameraOrigin = configuredOrigin('PRINTER_CAMERA_ORIGIN')
  const cameraUid = process.env.PRINTER_CAMERA_UID?.trim() || undefined
  const webcam = webcamFor(await moonrakerJson('/server/webcams/list', MAX_METADATA_BYTES), cameraUid)
  if (typeof webcam.snapshot_url !== 'string' || !webcam.snapshot_url.trim()) throw new Error('camera unavailable')

  const snapshotUrl = sameOriginUrl(webcam.snapshot_url, cameraOrigin)
  const rotation = webcam.rotation ?? 0
  const flipHorizontal = webcam.flip_horizontal ?? false
  const flipVertical = webcam.flip_vertical ?? false
  if (
    typeof rotation !== 'number'
    || !Number.isInteger(rotation)
    || ![0, 90, 180, 270].includes(rotation)
    || typeof flipHorizontal !== 'boolean'
    || typeof flipVertical !== 'boolean'
  ) throw new Error('invalid camera metadata')

  const frameResponse = await fetch(snapshotUrl, {
    headers: cameraHeaders(),
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
