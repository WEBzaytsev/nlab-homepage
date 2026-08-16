export const DIRECTORY_CONFIG_LOCATION = Object.freeze({
  global: {
    publicUrl: '/global.yaml',
    defaultPath: 'config/global.yaml',
  },
  catalog: {
    publicUrl: '/config.yaml',
    defaultPath: 'config/catalog.yaml',
  },
  projects: {
    publicUrl: '/projects.yaml',
    defaultPath: 'config/projects.yaml',
  },
})

export const DIRECTORY_REFRESH_POLICY = Object.freeze({
  visibleTabIntervalMs: 30_000,
})

export const ServiceIcon = {
  Bitwarden: 'bitwarden.svg',
  Dozzle: 'dozzle.svg',
  GitHub: 'github.svg',
  Gmail: 'gmail.svg',
  Grafana: 'grafana.svg',
  Immich: 'immich.svg',
  YouTrack: 'jetbrains-youtrack.svg',
  AccountGroup: 'mdi-account-group-outline',
  AccountKey: 'mdi-account-key-outline',
  BackupRestore: 'mdi-backup-restore',
  Brain: 'mdi-brain',
  Bug: 'mdi-bug-outline',
  Cash: 'mdi-cash-multiple',
  ChartArea: 'mdi-chart-areaspline',
  ChartBox: 'mdi-chart-box-outline',
  ChartTimeline: 'mdi-chart-timeline-variant',
  Code: 'mdi-code-braces',
  CreditCard: 'mdi-credit-card-outline',
  Database: 'mdi-database-cog-outline',
  Docker: 'mdi-docker',
  Email: 'mdi-email-outline',
  Ethernet: 'mdi-ethernet',
  DocumentEdit: 'mdi-file-document-edit-outline',
  Key: 'mdi-key-variant',
  License: 'mdi-license',
  MonitorDashboard: 'mdi-monitor-dashboard',
  Package: 'mdi-package-variant-closed',
  Robot: 'mdi-robot-happy-outline',
  Server: 'mdi-server',
  ServerNetwork: 'mdi-server-network',
  ShieldAccount: 'mdi-shield-account-outline',
  Shopping: 'mdi-shopping-outline',
  SourceBranch: 'mdi-source-branch',
  SourceRepository: 'mdi-source-repository',
  Storefront: 'mdi-storefront-outline',
  TimelineClock: 'mdi-timeline-clock-outline',
  Dashboard: 'mdi-view-dashboard-outline',
  Watermark: 'mdi-watermark',
  Web: 'mdi-web',
  WebClock: 'mdi-web-clock',
  Npm: 'npm.svg',
  Sentry: 'sentry.svg',
  SigNoz: 'signoz.svg',
  Telegram: 'telegram.svg',
  YouTube: 'youtube.svg',
} as const

export type ServiceIcon = typeof ServiceIcon[keyof typeof ServiceIcon]

export const CardTheme = {
  Ai: 'ai',
  Analytics: 'analytics',
  Automation: 'automation',
  Communication: 'communication',
  Data: 'data',
  Development: 'development',
  Finance: 'finance',
  Identity: 'identity',
  Infrastructure: 'infrastructure',
  Media: 'media',
  Observability: 'observability',
  Security: 'security',
  Web: 'web',
} as const

export type CardTheme = typeof CardTheme[keyof typeof CardTheme]

export const CARD_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const
export type CardVariant = typeof CARD_VARIANTS[number]

export type Service = Readonly<{
  name: string
  href: string
  description: string
  icon: ServiceIcon
}>

export type ServiceGroup = Readonly<{
  name: string
  sorting?: Readonly<{
    cards: boolean
  }>
  services: readonly Service[]
}>

export type GlobalConfig = Readonly<{
  header: Readonly<{ title: string }>
  sorting: Readonly<{
    catalog: Readonly<{
      categories: boolean
      cards: boolean
    }>
    projects: Readonly<{
      categories: boolean
      cards: boolean
    }>
  }>
}>

export type CatalogData = Readonly<{ groups: readonly ServiceGroup[] }>
export type ProjectsData = Readonly<{ projects: readonly ServiceGroup[] }>

export type PresentedService = Service & Readonly<{
  searchText: string
  cardTheme: CardTheme
  cardVariant: CardVariant
}>

export type PresentedServiceGroup = Omit<ServiceGroup, 'services' | 'sorting'> & Readonly<{
  searchText: string
  services: readonly PresentedService[]
}>

export type DirectorySnapshot = Readonly<{
  revision: string
  header: GlobalConfig['header']
  catalog: readonly PresentedServiceGroup[]
  projects: readonly PresentedServiceGroup[] | null
}>

export const DirectoryRefreshErrorCode = {
  Network: 'DIRECTORY_REFRESH_NETWORK',
  Http: 'DIRECTORY_REFRESH_HTTP',
  Protocol: 'DIRECTORY_REFRESH_PROTOCOL',
} as const

export type DirectoryRefreshErrorCode = typeof DirectoryRefreshErrorCode[keyof typeof DirectoryRefreshErrorCode]

export type DirectoryRefreshError = Readonly<{
  code: DirectoryRefreshErrorCode
  message: string
  details: Readonly<Record<string, unknown>>
}>
