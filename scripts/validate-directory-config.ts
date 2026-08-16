/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import {
  DirectoryConfigError,
  parseCatalogConfig,
  parseGlobalConfig,
  parseProjectsConfig,
} from '../src/domain/directory-schema.ts'
import { configRoleForPath } from './format-directory-config.ts'

const requestedPaths = process.argv.slice(2)
if (requestedPaths.length === 0) throw new Error('Укажите пути к YAML-конфигурации')

let failed = false
for (const path of requestedPaths) {
  try {
    const source = await readFile(path, 'utf8')
    const role = configRoleForPath(path)
    const data = role === 'global'
      ? parseGlobalConfig(source)
      : role === 'catalog'
        ? parseCatalogConfig(source)
        : parseProjectsConfig(source)
    const collections = 'groups' in data ? data.groups : ('projects' in data ? data.projects : [])
    const services = collections.reduce((count, group) => count + group.services.length, 0)
    console.log(JSON.stringify({ scope: 'directory-config', status: 'valid', role, path, groups: collections.length, services }))
  } catch (error) {
    const optionalMissing = configRoleForPath(path) === 'projects'
      && error instanceof Error && 'code' in error && error.code === 'ENOENT'
    if (optionalMissing) {
      console.log(JSON.stringify({ scope: 'directory-config', status: 'absent', role: 'projects', path }))
      continue
    }
    failed = true
    if (error instanceof DirectoryConfigError) console.error(JSON.stringify({ ...error.toLogRecord(), path }))
    else console.error(JSON.stringify({ scope: 'directory-config', status: 'unreadable', path, message: error instanceof Error ? error.message : 'Unknown error' }))
  }
}
if (failed) process.exitCode = 1
