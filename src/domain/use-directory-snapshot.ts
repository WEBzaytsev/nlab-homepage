import { useEffect, useState } from 'react'
import {
  CARD_VARIANTS,
  CardTheme,
  DIRECTORY_CONFIG_LOCATION,
  DIRECTORY_REFRESH_POLICY,
  DirectoryRefreshErrorCode,
  ServiceIcon,
  type DirectoryRefreshError,
  type DirectorySnapshot,
} from './directory-types'

export type DirectoryState =
  | { status: 'ready'; data: DirectorySnapshot; error: null }
  | { status: 'stale'; data: DirectorySnapshot; error: DirectoryRefreshError }

function refreshError(code: DirectoryRefreshError['code'], message: string, details: Readonly<Record<string, unknown>> = {}): DirectoryRefreshError {
  return { code, message, details }
}

export function useDirectorySnapshot(initialSnapshot: DirectorySnapshot): DirectoryState {
  const [state, setState] = useState<DirectoryState>({
    status: 'ready',
    data: initialSnapshot,
    error: null,
  })

  useEffect(() => {
    let activeRequest: AbortController | undefined
    let revision = initialSnapshot.revision
    let lastReportedError: DirectoryRefreshError['code'] | undefined

    function publishFailure(error: DirectoryRefreshError) {
      if (lastReportedError !== error.code) {
        console.error({ scope: 'directory-refresh', ...error })
        lastReportedError = error.code
      }
      setState((current) => ({ status: 'stale', data: current.data, error }))
    }

    async function refresh() {
      if (activeRequest || document.visibilityState === 'hidden') return
      const request = new AbortController()
      activeRequest = request

      try {
        const response = await fetch(DIRECTORY_CONFIG_LOCATION.catalog.publicUrl, {
          headers: {
            Accept: 'application/json',
            'If-None-Match': `"json-${revision}"`,
          },
          signal: request.signal,
        })

        if (response.status === 304) {
          lastReportedError = undefined
          setState((current: DirectoryState) => current.status === 'stale'
            ? { status: 'ready', data: current.data, error: null }
            : current)
          return
        }
        if (!response.ok) {
          throw refreshError(
            DirectoryRefreshErrorCode.Http,
            'Сервер не отдал актуальную конфигурацию каталога',
            { status: response.status },
          )
        }

        const snapshot: unknown = await response.json()
        if (!isDirectorySnapshot(snapshot)) {
          throw refreshError(
            DirectoryRefreshErrorCode.Protocol,
            'Сервер вернул некорректный snapshot каталога',
          )
        }

        revision = snapshot.revision
        lastReportedError = undefined
        setState({ status: 'ready', data: snapshot, error: null })
      } catch (cause) {
        if (request.signal.aborted) return
        publishFailure(isDirectoryRefreshError(cause)
          ? cause
          : refreshError(
              DirectoryRefreshErrorCode.Network,
              'Не удалось проверить обновление каталога',
              { cause: cause instanceof Error ? cause.message : 'Unknown error' },
            ))
      } finally {
        if (activeRequest === request) activeRequest = undefined
      }
    }

    const refreshTimer = window.setInterval(
      () => void refresh(),
      DIRECTORY_REFRESH_POLICY.visibleTabIntervalMs,
    )
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      activeRequest?.abort()
    }
  }, [initialSnapshot])

  return state
}

function isDirectoryRefreshError(value: unknown): value is DirectoryRefreshError {
  return typeof value === 'object' && value !== null && 'code' in value
    && Object.values(DirectoryRefreshErrorCode).includes(value.code as DirectoryRefreshError['code'])
}

function isDirectorySnapshot(value: unknown): value is DirectorySnapshot {
  if (typeof value !== 'object' || value === null) return false
  if (!('revision' in value) || typeof value.revision !== 'string') return false
  if (!('header' in value) || typeof value.header !== 'object' || value.header === null
    || !('title' in value.header) || typeof value.header.title !== 'string') return false
  if (!('catalog' in value) || !Array.isArray(value.catalog)) return false
  if (!('projects' in value) || (value.projects !== null && !Array.isArray(value.projects))) return false

  const groups: unknown[] = [...value.catalog, ...(value.projects ?? [])]
  return groups.every((group) => {
    if (
      typeof group !== 'object' || group === null
      || !('name' in group) || typeof group.name !== 'string'
      || !('searchText' in group) || typeof group.searchText !== 'string'
      || !('services' in group) || !Array.isArray(group.services)
    ) return false

    const services: unknown[] = group.services
    return services.every((service) => (
      typeof service === 'object' && service !== null
      && 'name' in service && typeof service.name === 'string'
      && 'href' in service && typeof service.href === 'string'
      && 'description' in service && typeof service.description === 'string'
      && 'icon' in service && Object.values(ServiceIcon).includes(service.icon as ServiceIcon)
      && 'searchText' in service && typeof service.searchText === 'string'
      && 'cardTheme' in service && Object.values(CardTheme).includes(service.cardTheme as CardTheme)
      && 'cardVariant' in service && CARD_VARIANTS.includes(service.cardVariant as typeof CARD_VARIANTS[number])
    ))
  })
}
