'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Monitor, Moon, Search, Sun, X } from 'lucide-react'
import { ServiceCard } from './components/ServiceCard'
import { useDirectorySnapshot } from './domain/use-directory-snapshot'
import { PrinterScreen } from './components/PrinterScreen'
import {
  DirectoryRefreshErrorCode,
  type DirectoryRefreshError,
  type DirectorySnapshot,
  type PresentedServiceGroup,
} from './domain/directory-types'

const CONFIG_UPDATE_COPY = {
  [DirectoryRefreshErrorCode.Network]: {
    title: 'Не удалось проверить обновление',
    description: 'Показана последняя корректная версия. Следующая проверка выполнится автоматически.',
  },
  [DirectoryRefreshErrorCode.Http]: {
    title: 'Файл конфигурации временно недоступен',
    description: 'Показана последняя корректная версия. Следующая проверка выполнится автоматически.',
  },
  [DirectoryRefreshErrorCode.Protocol]: {
    title: 'Обновление каталога отклонено',
    description: 'Показана последняя корректная версия. Сервер вернул некорректный snapshot.',
  },
} satisfies Record<DirectoryRefreshError['code'], { title: string; description: string }>

export type Screen = 'catalog' | 'projects' | 'printer'
type ScreenTransition = 'idle' | 'forward' | 'backward'
type Theme = 'dark' | 'light'
type ThemeMode = 'auto' | Theme
type ThemeMediaEvents = {
  addEventListener?: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  removeEventListener?: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

function readScreenFromUrl(projectsAvailable: boolean): Screen {
  const params = new URLSearchParams(window.location.search)
  if (params.get('screen') === 'printer') return 'printer'
  return projectsAvailable && (params.has('project') || params.get('screen') === 'projects') ? 'projects' : 'catalog'
}

function filteredGroup(group: PresentedServiceGroup, needle: string): PresentedServiceGroup {
  return { ...group, services: group.services.filter((service) => service.searchText.includes(needle)) }
}

function App({ initialScreen, initialSnapshot }: { initialScreen: Screen; initialSnapshot: DirectorySnapshot }) {
  const directory = useDirectorySnapshot(initialSnapshot)
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [screenTransition, setScreenTransition] = useState<ScreenTransition>('idle')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)

  const projectsAvailable = directory.data.projects !== null
  const fixedGroups = directory.data.catalog

  const visibleFixed = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU')
    return needle
      ? fixedGroups.map((group) => group.searchText.includes(needle) ? group : filteredGroup(group, needle))
      : fixedGroups
  }, [fixedGroups, query])

  const visibleProjects = useMemo(() => {
    const projects = directory.data.projects ?? []
    if (!query.trim()) return projects
    const needle = query.trim().toLocaleLowerCase('ru-RU')
    return projects
      .map((project) => (
        project.searchText.includes(needle)
          ? project
          : filteredGroup(project, needle)
      ))
      .filter((project) => project.services.length > 0)
  }, [directory.data.projects, query])

  const visibleServiceCount = useMemo(() => (
    screen === 'catalog'
      ? visibleFixed.reduce((total, group) => total + group.services.length, 0)
      : screen === 'projects'
        ? visibleProjects.reduce<number>((total, project) => total + project.services.length, 0)
        : 0
  ), [screen, visibleFixed, visibleProjects])

  const transitionToScreen = useCallback((nextScreen: Screen) => {
    if (nextScreen === screen) return
    setScreenTransition(nextScreen === 'catalog' ? 'backward' : 'forward')
    setScreen(nextScreen)
  }, [screen])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const initialMode = root.dataset.themeMode === 'dark' || root.dataset.themeMode === 'light'
      ? root.dataset.themeMode
      : 'auto'

    const initialTheme: Theme = initialMode === 'auto'
      ? media.matches ? 'dark' : 'light'
      : initialMode

    root.dataset.themeMode = initialMode
    root.dataset.theme = initialTheme
    setThemeMode(initialMode)
    setTheme(initialTheme)

    const onSystemThemeChange = (event: MediaQueryListEvent) => {
      if (root.dataset.themeMode !== 'auto') return
      const next = event.matches ? 'dark' : 'light'
      root.dataset.theme = next
      setTheme(next)
    }

    const mediaEvents: ThemeMediaEvents = media
    if (mediaEvents.addEventListener && mediaEvents.removeEventListener) {
      mediaEvents.addEventListener('change', onSystemThemeChange)
      return () => mediaEvents.removeEventListener?.('change', onSystemThemeChange)
    }

    mediaEvents.addListener?.(onSystemThemeChange)
    return () => mediaEvents.removeListener?.(onSystemThemeChange)
  }, [])

  const toggleTheme = useCallback(() => {
    const currentMode = document.documentElement.dataset.themeMode
    const nextMode: ThemeMode = currentMode === 'auto' ? 'dark' : currentMode === 'dark' ? 'light' : 'auto'
    const nextTheme: Theme = nextMode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : nextMode

    document.documentElement.dataset.themeMode = nextMode
    document.documentElement.dataset.theme = nextTheme
    setThemeMode(nextMode)
    setTheme(nextTheme)

    try {
      if (nextMode === 'auto') localStorage.removeItem('nlab-theme')
      else localStorage.setItem('nlab-theme', nextMode)
    } catch {}
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('project') && url.searchParams.get('screen') !== 'projects') return

    url.searchParams.delete('project')
    if (url.searchParams.get('screen') === 'printer') {
      window.history.replaceState(window.history.state, '', url)
      return
    }
    if (projectsAvailable) {
      url.searchParams.set('screen', 'projects')
    } else {
      url.searchParams.delete('screen')
      transitionToScreen('catalog')
    }
    window.history.replaceState(window.history.state, '', url)
  }, [projectsAvailable, transitionToScreen])

  useEffect(() => {
    const onPopState = () => {
      transitionToScreen(readScreenFromUrl(projectsAvailable))
      setQuery('')
      setSearchOpen(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [projectsAvailable, transitionToScreen])

  const updateUrl = useCallback((nextScreen: Screen) => {
    const url = new URL(window.location.href)
    if (nextScreen === 'catalog') url.searchParams.delete('screen')
    else url.searchParams.set('screen', nextScreen)
    url.searchParams.delete('project')
    window.history.pushState({}, '', url)
  }, [])

  const openScreen = useCallback((nextScreen: Screen) => {
    if (nextScreen === screen) return
    updateUrl(nextScreen)
    transitionToScreen(nextScreen)
    setQuery('')
    setSearchOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [screen, transitionToScreen, updateUrl])

  const title = screen === 'catalog' ? 'Каталог' : screen === 'projects' ? 'Проекты' : 'Принтер'
  const searchExpanded = screen !== 'printer' && (searchOpen || query.length > 0)
  const themeActionLabel = themeMode === 'auto'
    ? `Автотема: ${theme === 'dark' ? 'тёмная' : 'светлая'}. Включить тёмную тему`
    : themeMode === 'dark'
      ? 'Тёмная тема. Включить светлую тему'
      : 'Светлая тема. Включить автотему'

  const openSearch = () => {
    setSearchOpen(true)
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)

    if (window.matchMedia('(max-width: 820px)').matches) {
      window.requestAnimationFrame(() => searchToggleRef.current?.focus())
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className={`nav-capsule${searchExpanded ? ' search-open' : ''}`}>
          <button className="brand" onClick={() => openScreen('catalog')} type="button" aria-label="Открыть каталог">
            <span>{directory.data.header.title.trim().charAt(0).toLocaleUpperCase('ru-RU')}</span>
            <strong>{directory.data.header.title}</strong>
          </button>

          <nav
            className={`screen-tabs tab-count-${projectsAvailable ? 3 : 2}${screen === 'projects' ? ' projects-active' : ''}${screen === 'printer' ? ' printer-active' : ''}`}
            aria-label="Экраны"
          >
            <button
              aria-current={screen === 'catalog' ? 'page' : undefined}
              className={screen === 'catalog' ? 'active' : ''}
              onClick={() => openScreen('catalog')}
              type="button"
            >
              Каталог
            </button>
            {projectsAvailable && (
              <button
                aria-current={screen === 'projects' ? 'page' : undefined}
                className={screen === 'projects' ? 'active' : ''}
                onClick={() => openScreen('projects')}
                type="button"
              >
                Проекты
              </button>
            )}
            <button
              aria-current={screen === 'printer' ? 'page' : undefined}
              className={screen === 'printer' ? 'active' : ''}
              onClick={() => openScreen('printer')}
              type="button"
            >
              Принтер
            </button>
          </nav>

          <div className="nav-actions">
            {screen !== 'printer' && <div
              aria-label="Поиск по текущему экрану"
              className={`header-search${searchExpanded ? ' open' : ''}`}
              role="search"
            >
              <Search className="search-leading-icon" size={16} aria-hidden="true" />
              <input
                aria-label="Поиск по текущему экрану"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch()
                }}
                placeholder={screen === 'catalog' ? 'Найти сервис' : 'Найти проект или сервис'}
                ref={searchInputRef}
                type="search"
                value={query}
              />
              <button
                aria-expanded={searchExpanded}
                aria-label={searchExpanded ? 'Закрыть поиск' : 'Открыть поиск'}
                onClick={() => {
                  if (searchExpanded) closeSearch()
                  else openSearch()
                }}
                ref={searchToggleRef}
                type="button"
              >
                {searchExpanded ? <X size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
              </button>
            </div>}
            <button
              className="nav-icon-action"
              aria-label={themeActionLabel}
              onClick={toggleTheme}
              title={themeActionLabel}
              type="button"
            >
              <Monitor className="theme-icon-auto" size={16} />
              <Moon className="theme-icon-moon" size={16} />
              <Sun className="theme-icon-sun" size={16} />
            </button>
          </div>
        </div>
      </header>

      <main>
        <h1 className="sr-only">{title}</h1>

        {screen !== 'printer' && query.trim() && (
          <div className="search-summary" role="status" aria-live="polite">
            <span>Найдено: {visibleServiceCount}</span>
            <button type="button" onClick={() => setQuery('')}>Сбросить</button>
          </div>
        )}

        <div className={`screen-content screen-content-${screenTransition}`}>
          {directory.status === 'stale' && <ConfigUpdateFailure error={directory.error} />}
          {screen === 'catalog' ? (
            <CatalogScreen groups={visibleFixed} query={query} />
          ) : screen === 'projects' ? (
            <ProjectsScreen projects={visibleProjects} query={query} />
          ) : (
            <PrinterScreen />
          )}
        </div>
      </main>

    </div>
  )
}

function ConfigUpdateFailure({ error }: { error: DirectoryRefreshError }) {
  const copy = CONFIG_UPDATE_COPY[error.code]

  return (
    <div className="config-state config-state-error" role="alert">
      <strong>{copy.title}</strong>
      <span>{copy.description}</span>
      <code>{error.code}</code>
    </div>
  )
}

function CatalogScreen({ groups, query }: { groups: readonly PresentedServiceGroup[]; query: string }) {
  const hasResults = groups.some((group) => group.services.length > 0)

  return hasResults ? (
    <div className="catalog-stack">
      {groups.map((group, groupIndex) => group.services.length > 0 && (
        <section className="catalog-section" id={`fixed-${groupIndex + 1}`} key={group.name}>
          <header className="section-heading">
            <h2>{group.name}</h2>
          </header>
          <div className={groupIndex === 0 ? 'service-grid featured-grid' : 'service-grid'}>
            {group.services.map((service) => (
              <ServiceCard key={`${group.name}-${service.name}`} service={service} />
            ))}
          </div>
        </section>
      ))}
    </div>
  ) : <EmptySearch query={query} />
}

function ProjectsScreen({
  projects: projectGroups,
  query,
}: {
  projects: readonly PresentedServiceGroup[]
  query: string
}) {
  return projectGroups.length > 0 ? (
    <div className="projects-screen">
      <div className="projects-stack">
        {projectGroups.map((group) => (
          <section className="project-row" key={group.name}>
            <header className="project-row-heading">
              <h2>{group.name}</h2>
            </header>
            <div className="service-grid project-inline-grid">
              {group.services.map((service) => (
                <ServiceCard key={`${group.name}-${service.name}`} service={service} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  ) : <EmptySearch query={query} />
}

function EmptySearch({ query }: { query: string }) {
  return (
    <div className="empty-search">
      <strong>Ничего не найдено</strong>
      <p>По запросу «{query}» на этом экране ничего нет.</p>
    </div>
  )
}

export default App
