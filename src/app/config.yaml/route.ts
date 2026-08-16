import type { NextRequest } from 'next/server'
import { directorySnapshotErrorRecord, getDirectorySnapshot } from '../../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RESPONSE_HEADERS = {
  'cache-control': 'no-cache',
  vary: 'Accept',
} as const

const Representation = {
  Json: 'json',
  Yaml: 'yaml',
} as const

type Representation = typeof Representation[keyof typeof Representation]

function representationFor(request: NextRequest): Representation {
  return request.headers.get('accept')?.includes('application/json')
    ? Representation.Json
    : Representation.Yaml
}

function representationEtag(representation: Representation, revision: string) {
  return `"${representation}-${revision}"`
}

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getDirectorySnapshot()
    const representation = representationFor(request)
    const etag = representationEtag(representation, snapshot.revision)

    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...RESPONSE_HEADERS, etag },
      })
    }

    if (representation === Representation.Json) {
      return Response.json(snapshot.data, {
        headers: { ...RESPONSE_HEADERS, etag },
      })
    }

    return new Response(snapshot.catalogSource, {
      headers: {
        ...RESPONSE_HEADERS,
        'content-type': 'application/yaml; charset=utf-8',
        etag,
      },
    })
  } catch (error) {
    const record = directorySnapshotErrorRecord(error)
    console.error(JSON.stringify(record))
    const notFound = record.code === 'DIRECTORY_CONFIG_NOT_FOUND'

    return Response.json({
      error: {
        code: record.code,
        message: notFound ? 'Directory configuration not found' : 'Directory configuration unavailable',
      },
    }, {
      status: notFound ? 404 : 503,
      headers: RESPONSE_HEADERS,
    })
  }
}
