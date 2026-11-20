import type { NextRequest } from 'next/server'
import { DIRECTORY_RESPONSE_HEADERS, directoryUnavailable, yamlSnapshotResponse } from '../directory-response'
import { getDirectorySnapshot } from '../../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getDirectorySnapshot()
    if (snapshot.projectsSource === null) {
      return Response.json({
        error: { code: 'PROJECTS_CONFIG_NOT_FOUND', message: 'Projects configuration not found' },
      }, { status: 404, headers: DIRECTORY_RESPONSE_HEADERS })
    }
    return yamlSnapshotResponse(request, snapshot.projectsSource, snapshot.revision)
  } catch (error) {
    return directoryUnavailable(error, 'Projects configuration unavailable')
  }
}
