import 'server-only'

import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DIRECTORY_CONFIG_LOCATION, type DirectorySnapshot } from './directory-types'
import {
  DirectoryConfigError,
  parseCatalogConfig,
  parseGlobalConfig,
  parseProjectsConfig,
} from './directory-schema'
import { DirectoryPresentationError, presentDirectory } from './directory-presentation'

type ConfigKey = 'global' | 'catalog' | 'projects'
type FileIdentity = Readonly<{ dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }>
type SourceFile = Readonly<{ identity: FileIdentity; source: string }>
type SourceSet = Readonly<{ global: SourceFile; catalog: SourceFile; projects: SourceFile | null }>
type IdentitySet = Readonly<{ global: FileIdentity; catalog: FileIdentity; projects: FileIdentity | null }>

export type DirectorySourceSnapshot = Readonly<{
  catalogSource: string
  globalSource: string
  projectsSource: string | null
  revision: string
  data: DirectorySnapshot
}>

type CachedSnapshot = Readonly<{ identities: string; snapshot: DirectorySourceSnapshot }>

function configuredPath(environmentKey: string, defaultPath: string) {
  const value = process.env[environmentKey]
  if (value === '') return null
  return value ?? join(/* turbopackIgnore: true */ process.cwd(), defaultPath)
}

const configPaths = {
  global: configuredPath('GLOBAL_CONFIG_PATH', DIRECTORY_CONFIG_LOCATION.global.defaultPath),
  catalog: configuredPath('CATALOG_CONFIG_PATH', DIRECTORY_CONFIG_LOCATION.catalog.defaultPath),
  projects: process.env.PROJECTS_CONFIG_PATH || null,
} satisfies Record<ConfigKey, string | null>

let cachedSnapshot: CachedSnapshot | undefined
let activeLoad: Promise<DirectorySourceSnapshot> | undefined

function fileIdentity(info: BigIntStats): FileIdentity {
  return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs
}

async function readStableFile(path: string): Promise<SourceFile> {
  const handle = await open(/* turbopackIgnore: true */ path, 'r')
  try {
    const before = fileIdentity(await handle.stat({ bigint: true }))
    const source = await handle.readFile({ encoding: 'utf8' })
    const after = fileIdentity(await handle.stat({ bigint: true }))
    const current = fileIdentity(await stat(/* turbopackIgnore: true */ path, { bigint: true }))
    if (!sameIdentity(before, after) || !sameIdentity(after, current)) {
      throw new DirectorySnapshotError('DIRECTORY_CONFIG_UNSTABLE', `Configuration changed while reading ${path}`)
    }
    return { identity: current, source }
  } finally {
    await handle.close()
  }
}

function isMissingFile(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readOptionalProjects(): Promise<SourceFile | null> {
  if (configPaths.projects === null) return null
  try {
    return await readStableFile(configPaths.projects)
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

async function readSourceSet(): Promise<SourceSet> {
  if (configPaths.global === null || configPaths.catalog === null) {
    throw new DirectorySnapshotError('DIRECTORY_CONFIG_PATH_REQUIRED', 'Global and catalog configuration paths are required')
  }
  const [global, catalog, projects] = await Promise.all([
    readStableFile(configPaths.global),
    readStableFile(configPaths.catalog),
    readOptionalProjects(),
  ])
  return { global, catalog, projects }
}

function identityToken(file: SourceFile | FileIdentity | null) {
  if (file === null) return 'absent'
  const identity = 'identity' in file ? file.identity : file
  const { dev, ino, size, mtimeNs } = identity
  return `${dev}:${ino}:${size}:${mtimeNs}`
}

function sourceSetIdentity(sources: SourceSet | IdentitySet) {
  return [identityToken(sources.global), identityToken(sources.catalog), identityToken(sources.projects)].join('|')
}

function revisionFor(sources: SourceSet) {
  const hash = createHash('sha256')
  hash.update(sources.global.source).update('\0').update(sources.catalog.source).update('\0')
  hash.update(sources.projects?.source ?? 'projects:absent')
  return hash.digest('base64url')
}

class DirectorySnapshotError extends Error {
  readonly name = 'DirectorySnapshotError'
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

async function readCurrentSnapshot(attempt = 1): Promise<DirectorySourceSnapshot> {
  try {
    const sources = await readSourceSet()
    const identities = sourceSetIdentity(sources)
    if (identities !== await currentIdentity()) {
      throw new DirectorySnapshotError('DIRECTORY_CONFIG_UNSTABLE', 'Configuration set changed while reading')
    }
    const revision = revisionFor(sources)
    const globalConfig = parseGlobalConfig(sources.global.source)
    const catalog = parseCatalogConfig(sources.catalog.source)
    const projects = sources.projects ? parseProjectsConfig(sources.projects.source) : null
    const data = presentDirectory(globalConfig, catalog, projects, revision)
    if (identities !== await currentIdentity()) {
      throw new DirectorySnapshotError('DIRECTORY_CONFIG_UNSTABLE', 'Configuration set changed before snapshot publication')
    }
    const event = cachedSnapshot ? 'directory-config.updated' : 'directory-config.accepted'
    console.info(JSON.stringify({
      scope: 'directory-config',
      event,
      revision,
      catalog: {
        groups: data.catalog.length,
        services: data.catalog.reduce((count, group) => count + group.services.length, 0),
      },
      projects: data.projects === null ? null : {
        groups: data.projects.length,
        services: data.projects.reduce((count, group) => count + group.services.length, 0),
      },
    }))
    const snapshot = {
      globalSource: sources.global.source,
      catalogSource: sources.catalog.source,
      projectsSource: sources.projects?.source ?? null,
      revision,
      data,
    } satisfies DirectorySourceSnapshot
    cachedSnapshot = { identities, snapshot }
    return snapshot
  } catch (error) {
    if (error instanceof DirectorySnapshotError && error.code === 'DIRECTORY_CONFIG_UNSTABLE' && attempt < 3) {
      return readCurrentSnapshot(attempt + 1)
    }
    throw error
  }
}

async function optionalProjectsIdentity(): Promise<FileIdentity | null> {
  if (configPaths.projects === null) return null
  try {
    return fileIdentity(await stat(/* turbopackIgnore: true */ configPaths.projects, { bigint: true }))
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

async function currentIdentity() {
  if (configPaths.global === null || configPaths.catalog === null) {
    throw new DirectorySnapshotError('DIRECTORY_CONFIG_PATH_REQUIRED', 'Global and catalog configuration paths are required')
  }
  const [global, catalog, projects] = await Promise.all([
    stat(/* turbopackIgnore: true */ configPaths.global, { bigint: true }).then(fileIdentity),
    stat(/* turbopackIgnore: true */ configPaths.catalog, { bigint: true }).then(fileIdentity),
    optionalProjectsIdentity(),
  ])
  return sourceSetIdentity({ global, catalog, projects })
}

export async function getDirectorySnapshot(): Promise<DirectorySourceSnapshot> {
  const identity = await currentIdentity()
  if (cachedSnapshot?.identities === identity) return cachedSnapshot.snapshot
  if (activeLoad) {
    await activeLoad
    return getDirectorySnapshot()
  }
  activeLoad = readCurrentSnapshot().finally(() => { activeLoad = undefined })
  return activeLoad
}

export function directorySnapshotErrorRecord(error: unknown) {
  if (error instanceof DirectoryConfigError) return error.toLogRecord()
  if (error instanceof DirectoryPresentationError) return error.toLogRecord()
  const nodeCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return {
    scope: 'directory-config',
    code: nodeCode === 'ENOENT' ? 'DIRECTORY_CONFIG_NOT_FOUND' : (nodeCode ?? 'DIRECTORY_CONFIG_UNAVAILABLE'),
    message: error instanceof Error ? error.message : 'Unknown directory configuration error',
    details: {
      paths: {
        global: configPaths.global,
        catalog: configPaths.catalog,
        projects: configPaths.projects,
      },
    },
  }
}
