import { directorySnapshotErrorRecord } from '../domain/directory-snapshot'

export const DIRECTORY_RESPONSE_HEADERS = {
  'cache-control': 'no-cache',
} as const

export function yamlSnapshotResponse(request: Request, source: string, revision: string): Response {
  const etag = `"yaml-${revision}"`
  const headers = { ...DIRECTORY_RESPONSE_HEADERS, etag }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(source, {
    headers: { ...headers, 'content-type': 'application/yaml; charset=utf-8' },
  })
}

export function directoryUnavailable(error: unknown, message: string): Response {
  const record = directorySnapshotErrorRecord(error)
  console.error(JSON.stringify(record))
  const notFound = record.code === 'DIRECTORY_CONFIG_NOT_FOUND'
  return Response.json({
    error: { code: record.code, message: notFound ? 'Directory configuration not found' : message },
  }, {
    status: notFound ? 404 : 503,
    headers: DIRECTORY_RESPONSE_HEADERS,
  })
}
