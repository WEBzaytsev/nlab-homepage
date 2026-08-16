import App, { type Screen } from '../App'
import { directorySnapshotErrorRecord, getDirectorySnapshot } from '../domain/directory-snapshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>

function initialScreenFrom(
  params: Record<string, string | string[] | undefined>,
  projectsAvailable: boolean,
): Screen {
  return projectsAvailable && (params.project !== undefined || params.screen === 'projects') ? 'projects' : 'catalog'
}

export default async function Page({ searchParams }: { searchParams: PageSearchParams }) {
  try {
    const [snapshot, params] = await Promise.all([
      getDirectorySnapshot(),
      searchParams,
    ])

    return <App
      initialScreen={initialScreenFrom(params, snapshot.data.projects !== null)}
      initialSnapshot={snapshot.data}
    />
  } catch (error) {
    console.error(JSON.stringify(directorySnapshotErrorRecord(error)))
    throw error
  }
}
