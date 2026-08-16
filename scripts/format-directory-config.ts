/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isNode, isSeq, parseDocument } from 'yaml'
import {
  parseCatalogConfig,
  parseGlobalConfig,
  parseProjectsConfig,
} from '../src/domain/directory-schema.ts'
import { DIRECTORY_CONFIG_LOCATION } from '../src/domain/directory-types.ts'

export type ConfigRole = 'global' | 'catalog' | 'projects'

export function configRoleForPath(path: string): ConfigRole {
  const name = basename(path)
  if (name === basename(DIRECTORY_CONFIG_LOCATION.global.defaultPath)) return 'global'
  if (name === basename(DIRECTORY_CONFIG_LOCATION.catalog.defaultPath)) return 'catalog'
  if (name === basename(DIRECTORY_CONFIG_LOCATION.projects.defaultPath)) return 'projects'
  throw new Error(`Неизвестная роль YAML-конфигурации: ${name}`)
}

export function formatDirectoryConfig(source: string, role: ConfigRole) {
  if (role === 'global') parseGlobalConfig(source)
  else if (role === 'catalog') parseCatalogConfig(source)
  else parseProjectsConfig(source)

  const document = parseDocument(source)
  const collection = document.get(role === 'projects' ? 'projects' : 'groups', true)
  if (isSeq(collection)) {
    collection.items.forEach((item, index) => {
      if (isNode(item)) item.spaceBefore = index > 0
    })
  }
  return document.toString({ indent: 2, lineWidth: 0 })
}

export async function checkConfigFile(path: string): Promise<'canonical' | 'noncanonical'> {
  const source = await readFile(path, 'utf8')
  return source === formatDirectoryConfig(source, configRoleForPath(path)) ? 'canonical' : 'noncanonical'
}

async function main() {
  const requestedPaths = process.argv.slice(2)
  if (requestedPaths.length === 0) throw new Error('Укажите пути к YAML-конфигурации')
  let noncanonical = false

  for (const path of requestedPaths) {
    try {
      const status = await checkConfigFile(path)
      if (status === 'noncanonical') noncanonical = true
      console.log(JSON.stringify({ scope: 'directory-config-format', status, path }))
    } catch (error) {
      const optionalMissing = configRoleForPath(path) === 'projects'
        && error instanceof Error && 'code' in error && error.code === 'ENOENT'
      if (!optionalMissing) throw error
      console.log(JSON.stringify({ scope: 'directory-config-format', status: 'absent', path }))
    }
  }
  if (noncanonical) process.exitCode = 1
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) await main()
