import 'server-only'

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { request as upstreamRequest } from 'undici'
import { FETCH_TIMEOUT_MS, cameraHeaders, configuredOrigin, moonrakerJson, sameOriginUrl, webcamFor } from '../printer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_METADATA_BYTES = 256 * 1024
async function cameraStream(request: Request): Promise<Response> {
  const cameraOrigin = configuredOrigin('PRINTER_CAMERA_ORIGIN')
  const cameraUid = process.env.PRINTER_CAMERA_UID?.trim() || undefined
  const webcam = webcamFor(await moonrakerJson('/server/webcams/list', MAX_METADATA_BYTES), cameraUid)
  if (typeof webcam.stream_url !== 'string' || !webcam.stream_url.trim()) throw new Error('camera unavailable')

  const streamUrl = sameOriginUrl(webcam.stream_url, cameraOrigin)
  const headers = cameraHeaders()
  headers.set('accept', 'multipart/x-mixed-replace')
  const abort = new AbortController()
  let upstream: Awaited<ReturnType<typeof upstreamRequest>>
  try {
    upstream = await upstreamRequest(streamUrl, {
      headers: Object.fromEntries(headers),
      headersTimeout: FETCH_TIMEOUT_MS,
      bodyTimeout: 0,
      signal: abort.signal,
    })
  } catch (error) {
    abort.abort()
    throw error
  }

  const contentType = upstream.headers['content-type']
  const isMjpeg = typeof contentType === 'string' && contentType.toLowerCase().startsWith('multipart/x-mixed-replace')
  if (upstream.statusCode < 200 || upstream.statusCode >= 300 || !isMjpeg) {
    abort.abort()
    upstream.body.destroy()
    throw new Error('stream unavailable')
  }

  const encoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-f', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-tune', 'zerolatency', '-threads', '1', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-fps_mode', 'passthrough',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    request.signal.removeEventListener('abort', close)
    abort.abort()
    upstream.body.destroy()
    encoder.stdin.destroy()
    encoder.stdout.destroy()
    encoder.kill('SIGTERM')
  }
  request.signal.addEventListener('abort', close, { once: true })
  upstream.body.pipe(encoder.stdin)
  upstream.body.once('error', close)
  encoder.once('error', close)
  encoder.once('close', close)

  return new Response(Readable.toWeb(encoder.stdout) as ReadableStream<Uint8Array>, {
    headers: {
      'cache-control': 'no-store, no-transform',
      'content-type': 'video/mp4',
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
