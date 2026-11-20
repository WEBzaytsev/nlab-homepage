'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, Maximize2, Monitor, Moon, RefreshCw, Search, Sun, X } from 'lucide-react'
import { ServiceCard } from './components/ServiceCard'
import { useDirectorySnapshot } from './domain/use-directory-snapshot'
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

type PrinterFrame = Readonly<{
  url: string
  frameTime: number | null
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
}>

function usePrinterFrame(active: boolean) {
  const [frame, setFrame] = useState<PrinterFrame | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestRef = useRef<AbortController | null>(null)
  const frameUrlRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (requestRef.current || document.visibilityState === 'hidden') return
    const request = new AbortController()
    requestRef.current = request

    try {
      const response = await fetch('/api/printer/frame', { cache: 'no-store', signal: request.signal })
      if (response.status === 503) throw new Error('Принтер не настроен или временно недоступен.')
      if (!response.ok) throw new Error('Не удалось обновить изображение принтера.')
      if (!/^image\/(jpeg|png)$/.test(response.headers.get('content-type') ?? '')) {
        throw new Error('Сервер вернул изображение в неподдерживаемом формате.')
      }

      const url = URL.createObjectURL(await response.blob())
      const frameTimeHeader = response.headers.get('X-Frame-Time')
      const rotationHeader = response.headers.get('X-Rotation')
      const previousUrl = frameUrlRef.current
      frameUrlRef.current = url
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      setFrame({
        url,
        frameTime: frameTimeHeader !== null && Number.isFinite(Number(frameTimeHeader))
          ? Number(frameTimeHeader)
          : null,
        rotation: rotationHeader !== null && Number.isFinite(Number(rotationHeader))
          ? Number(rotationHeader)
          : 0,
        flipHorizontal: response.headers.get('X-Flip-Horizontal') === 'true',
        flipVertical: response.headers.get('X-Flip-Vertical') === 'true',
      })
      setWarning(null)
    } catch (error) {
      if (!request.signal.aborted) {
        setWarning(error instanceof Error ? error.message : 'Не удалось обновить изображение принтера.')
      }
    } finally {
      if (requestRef.current === request) requestRef.current = null
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      requestRef.current?.abort()
    }
  }, [active, refresh])

  useEffect(() => () => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current)
  }, [])

  return { frame, loading, refresh, warning }
}

type PrinterTelemetry = Readonly<{
  updatedAt: number
  job: Readonly<{
    state: string | null
    status: string | null
    filename: string | null
    progress: number | null
    displayProgress: number | null
    layer: number | null
    totalLayers: number | null
    etaSeconds: number | null
    etaSource: 'slicer_metadata' | null
  }>
  temperatures: readonly Readonly<{ name: string; temperature: number; target: number | null }>[]
  fans: readonly Readonly<{ name: string; rpm: number | null; pwm: number | null }>[]
}>

function usePrinterTelemetry(active: boolean) {
  const [telemetry, setTelemetry] = useState<PrinterTelemetry | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const requestRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (requestRef.current || document.visibilityState === 'hidden') return
    const request = new AbortController()
    requestRef.current = request
    try {
      const response = await fetch('/api/printer/telemetry', { cache: 'no-store', signal: request.signal })
      if (!response.ok) throw new Error('Телеметрия принтера временно недоступна.')
      setTelemetry(await response.json() as PrinterTelemetry)
      setWarning(null)
    } catch (error) {
      if (!request.signal.aborted) setWarning(error instanceof Error ? error.message : 'Телеметрия принтера временно недоступна.')
    } finally {
      if (requestRef.current === request) requestRef.current = null
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      requestRef.current?.abort()
    }
  }, [active, refresh])

  return { telemetry, warning, loading }
}

function App({ initialScreen, initialSnapshot }: { initialScreen: Screen; initialSnapshot: DirectorySnapshot }) {
  const directory = useDirectorySnapshot(initialSnapshot)
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const printer = usePrinterFrame(screen === 'printer')
  const telemetry = usePrinterTelemetry(screen === 'printer')
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
            <PrinterScreen {...printer} telemetry={telemetry} />
          )}
        </div>
      </main>

    </div>
  )
}

function PrinterScreen({
  frame,
  loading,
  refresh,
  warning,
  telemetry,
}: ReturnType<typeof usePrinterFrame> & { telemetry: ReturnType<typeof usePrinterTelemetry> }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const transform = frame ? {
    transform: `rotate(${frame.rotation}deg) scale(${frame.flipHorizontal ? -1 : 1}, ${frame.flipVertical ? -1 : 1})`,
  } satisfies CSSProperties : undefined
  const frameTime = frame?.frameTime === null || frame === null
    ? 'Время кадра не указано'
    : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium' }).format(frame.frameTime)

  return (
    <section className="printer-screen" aria-labelledby="printer-title">
      <header className="printer-heading">
        <div>
          <p>Камера</p>
          <h2 id="printer-title">Принтер</h2>
        </div>
        <button className="printer-refresh" onClick={() => void refresh()} type="button">
          <RefreshCw size={16} aria-hidden="true" /> Обновить
        </button>
      </header>
      {warning && (
        <div className="printer-warning" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{warning}{frame ? ' Показан предыдущий кадр.' : ''}</span>
        </div>
      )}
      <div className="printer-dashboard">
        <div>
          <div className="printer-frame">
            {frame ? (
              <button
                className="printer-frame-button"
                onClick={() => dialogRef.current?.showModal()}
                type="button"
                aria-label="Открыть изображение принтера в полном размере"
              >
                <img alt="Камера принтера" src={frame.url} style={transform} />
                <span><Maximize2 size={17} aria-hidden="true" /> Увеличить</span>
              </button>
            ) : (
              <div className="printer-frame-empty" role="status">
                {loading ? 'Загрузка изображения принтера…' : 'Изображение принтера пока недоступно.'}
              </div>
            )}
          </div>
          {frame && <p className="printer-frame-time">Кадр: {frameTime}</p>}
        </div>
        <PrinterTelemetryPanel {...telemetry} />
      </div>
      <dialog className="printer-dialog" ref={dialogRef} aria-label="Изображение принтера">
        <button className="printer-dialog-close" onClick={() => dialogRef.current?.close()} type="button" aria-label="Закрыть">
          <X size={18} aria-hidden="true" />
        </button>
        {frame && <img alt="Камера принтера, увеличенное изображение" src={frame.url} style={transform} />}
      </dialog>
    </section>
  )
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function PrinterTelemetryPanel({ telemetry, warning, loading }: ReturnType<typeof usePrinterTelemetry>) {
  if (!telemetry) return (
    <section className="printer-telemetry" aria-labelledby="telemetry-title">
      <p>Телеметрия</p><h3 id="telemetry-title">Состояние</h3>
      <div className="printer-telemetry-empty" role="status">{loading ? 'Загрузка телеметрии…' : 'Телеметрия пока недоступна.'}</div>
      {warning && <div className="printer-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{warning}</span></div>}
    </section>
  )

  const { job } = telemetry
  const progress = job.progress === null ? null : Math.max(0, Math.min(100, job.progress * 100))
  return (
    <section className="printer-telemetry" aria-labelledby="telemetry-title">
      <p>Телеметрия · только чтение</p><h3 id="telemetry-title">Состояние</h3>
      {warning && <div className="printer-warning printer-telemetry-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{warning} Показаны последние данные.</span></div>}
      <div className="telemetry-job">
        <strong>{job.status ?? job.state ?? 'Неизвестно'}</strong>
        <span title={job.filename ?? undefined}>{job.filename ?? 'Задание не выбрано'}</span>
        {progress !== null && <><div className="telemetry-progress" aria-label={`Выполнено ${progress.toFixed(1)}%`}><i style={{ width: `${progress}%` }} /></div><small>Файл: {progress.toFixed(1)}%</small></>}
      </div>
      <div className="telemetry-summary">
        <span><b>ETA</b>{job.etaSeconds === null ? '—' : `≈ ${formatDuration(job.etaSeconds)}`}</span>
        <span><b>Слои</b>{job.layer === null || job.totalLayers === null ? '—' : `${job.layer}/${job.totalLayers}`}</span>
      </div>
      {job.etaSource && <small className="telemetry-note">Оценка слайсера; не учитывает паузы и изменение скорости.</small>}
      <TelemetryGroup title="Температуры" items={telemetry.temperatures.map((item) => ({
        name: item.name,
        value: `${item.temperature.toFixed(1)} °C${item.target === null ? '' : ` / ${item.target.toFixed(0)} °C`}`,
      }))} />
      <TelemetryGroup title={`Вентиляторы · тахо ${telemetry.fans.filter((fan) => fan.rpm !== null).length}/${telemetry.fans.length}`} items={telemetry.fans.map((fan) => ({
        name: fan.name,
        value: fan.rpm === null
          ? `тахо нет${fan.pwm === null ? '' : ` · PWM ${Math.round(fan.pwm * 100)}%`}`
          : `${Math.round(fan.rpm)} RPM${fan.pwm === null ? '' : ` · PWM ${Math.round(fan.pwm * 100)}%`}`,
      }))} />
    </section>
  )
}

function TelemetryGroup({ title, items }: { title: string; items: readonly { name: string; value: string }[] }) {
  return <div className="telemetry-group"><h4>{title}</h4><dl>{items.map((item) => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl></div>
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
