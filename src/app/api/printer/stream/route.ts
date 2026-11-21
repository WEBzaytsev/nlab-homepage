import 'server-only'

import { getMultipartBoundary, parseMultipartStream } from '@mjackson/multipart-parser/node'
import sharp from 'sharp'
import { request as upstreamRequest } from 'undici'
import { FETCH_TIMEOUT_MS, cameraHeaders, configuredOrigin, moonrakerJson, sameOriginUrl, webcamFor } from '../printer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_METADATA_BYTES = 256 * 1024
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const STREAM_BOUNDARY = 'nlab-frame'
const encoder = new TextEncoder()

function multipartFrame(frame: Uint8Array): Uint8Array {
  const header = encoder.encode(`--${STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`)
  const output = new Uint8Array(header.byteLength + frame.byteLength + 2)
  output.set(header)
  output.set(frame, header.byteLength)
  output.set([13, 10], header.byteLength + frame.byteLength)
  return output
}

async function cameraStream(request: Request): Promise<Response> {
  const cameraOrigin = configuredOrigin('PRINTER_CAMERA_ORIGIN')
  const cameraUid = process.env.PRINTER_CAMERA_UID?.trim() || undefined
  const webcam = webcamFor(await moonrakerJson('/server/webcams/list', MAX_METADATA_BYTES), cameraUid)
  if (typeof webcam.stream_url !== 'string' || !webcam.stream_url.trim()) throw new Error('camera unavailable')

  const streamUrl = sameOriginUrl(webcam.stream_url, cameraOrigin)
  const headers = cameraHeaders()
  headers.set('accept', 'multipart/x-mixed-replace')
  const abort = new AbortController()
  let upstream: Awaited<ReturnType<typeof upstreamRequest>> | null = null
  let closed = false
  let wake: (() => void) | null = null
  const close = () => {
    if (closed) return
    closed = true
    request.signal.removeEventListener('abort', close)
    abort.abort()
    upstream?.body.destroy()
    wake?.()
    wake = null
  }
  request.signal.addEventListener('abort', close, { once: true })

  try {
    upstream = await upstreamRequest(streamUrl, {
      headers: Object.fromEntries(headers),
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: 0,
      signal: abort.signal,
    })
  } catch (error) {
    close()
    throw error
  }

  const contentType = upstream.headers['content-type']
  const boundary = typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/x-mixed-replace')
    ? getMultipartBoundary(contentType)
    : null
  if (upstream.statusCode < 200 || upstream.statusCode >= 300 || !boundary) {
    close()
    throw new Error('stream unavailable')
  }

  let latest: Uint8Array | null = null
  let finished = false
  let failure: unknown = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const waitForFrame = () => new Promise<void>((resolve) => { wake = resolve })
  void (async () => {
    try {
      for await (const part of parseMultipartStream(upstream.body, {
        boundary,
        maxFileSize: MAX_FRAME_BYTES,
      })) {
        if (part.headers.get('content-type')?.toLowerCase().split(';', 1)[0] === 'image/jpeg') {
          latest = part.bytes
          notify()
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) failure = error
    } finally {
      finished = true
      notify()
    }
  })()

  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (failure) throw failure
          if (!latest) {
            if (finished) {
              close()
              controller.close()
              return
            }
            await waitForFrame()
            continue
          }

          const frame = latest
          latest = null
          const output = await sharp(frame).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 35 }).toBuffer()
          controller.enqueue(multipartFrame(output))
          return
        }
      } catch (error) {
        close()
        controller.error(error)
      }
    },
    cancel: close,
  }), {
    headers: {
      'cache-control': 'no-store, no-transform',
      'content-type': `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
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
