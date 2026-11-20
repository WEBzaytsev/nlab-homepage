import 'server-only'

import { cameraHeaders, configuredOrigin, moonrakerJson, sameOriginUrl, webcamFor } from '../printer'

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
