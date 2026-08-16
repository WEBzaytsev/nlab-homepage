import type { NextRequest } from 'next/server'
import { directorySnapshotErrorRecord, getDirectorySnapshot } from '../../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getDirectorySnapshot()
    if (snapshot.projectsSource === null) {
      return Response.json({
        error: { code: 'PROJECTS_CONFIG_NOT_FOUND', message: 'Projects configuration not found' },
      }, { status: 404, headers: { 'cache-control': 'no-cache' } })
    }
    const etag = `"yaml-${snapshot.revision}"`
    const headers = { 'cache-control': 'no-cache', etag }
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
    return new Response(snapshot.projectsSource, {
      headers: { ...headers, 'content-type': 'application/yaml; charset=utf-8' },
    })
  } catch (error) {
    const record = directorySnapshotErrorRecord(error)
    console.error(JSON.stringify(record))
    return Response.json({ error: { code: record.code, message: 'Projects configuration unavailable' } }, { status: 503 })
  }
}
