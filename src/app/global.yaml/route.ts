import type { NextRequest } from 'next/server'
import { directorySnapshotErrorRecord, getDirectorySnapshot } from '../../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getDirectorySnapshot()
    const etag = `"yaml-${snapshot.revision}"`
    const headers = { 'cache-control': 'no-cache', etag }
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
    return new Response(snapshot.globalSource, {
      headers: { ...headers, 'content-type': 'application/yaml; charset=utf-8' },
    })
  } catch (error) {
    const record = directorySnapshotErrorRecord(error)
    console.error(JSON.stringify(record))
    return Response.json({ error: { code: record.code, message: 'Global configuration unavailable' } }, { status: 503 })
  }
}
