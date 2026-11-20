import type { NextRequest } from 'next/server'
import { directoryUnavailable, yamlSnapshotResponse } from '../directory-response'
import { getDirectorySnapshot } from '../../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getDirectorySnapshot()
    return yamlSnapshotResponse(request, snapshot.globalSource, snapshot.revision)
  } catch (error) {
    return directoryUnavailable(error, 'Global configuration unavailable')
  }
}
