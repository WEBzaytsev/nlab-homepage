import {
  CARD_VARIANTS,
  CardTheme,
  ServiceIcon,
  type CardVariant,
  type CatalogData,
  type DirectorySnapshot,
  type GlobalConfig,
  type PresentedService,
  type PresentedServiceGroup,
  type ProjectsData,
  type Service,
  type ServiceGroup,
} from './directory-types'

const CARD_THEME_BY_ICON = {
  [ServiceIcon.Bitwarden]: CardTheme.Security,
  [ServiceIcon.Dozzle]: CardTheme.Observability,
  [ServiceIcon.GitHub]: CardTheme.Development,
  [ServiceIcon.Gmail]: CardTheme.Communication,
  [ServiceIcon.Grafana]: CardTheme.Observability,
  [ServiceIcon.Immich]: CardTheme.Media,
  [ServiceIcon.YouTrack]: CardTheme.Development,
  [ServiceIcon.AccountGroup]: CardTheme.Communication,
  [ServiceIcon.AccountKey]: CardTheme.Identity,
  [ServiceIcon.BackupRestore]: CardTheme.Data,
  [ServiceIcon.Brain]: CardTheme.Ai,
  [ServiceIcon.Bug]: CardTheme.Observability,
  [ServiceIcon.Cash]: CardTheme.Finance,
  [ServiceIcon.ChartArea]: CardTheme.Analytics,
  [ServiceIcon.ChartBox]: CardTheme.Analytics,
  [ServiceIcon.ChartTimeline]: CardTheme.Observability,
  [ServiceIcon.Code]: CardTheme.Development,
  [ServiceIcon.CreditCard]: CardTheme.Finance,
  [ServiceIcon.Database]: CardTheme.Data,
  [ServiceIcon.Docker]: CardTheme.Infrastructure,
  [ServiceIcon.Email]: CardTheme.Communication,
  [ServiceIcon.Ethernet]: CardTheme.Infrastructure,
  [ServiceIcon.DocumentEdit]: CardTheme.Web,
  [ServiceIcon.Key]: CardTheme.Security,
  [ServiceIcon.License]: CardTheme.Security,
  [ServiceIcon.MonitorDashboard]: CardTheme.Observability,
  [ServiceIcon.Package]: CardTheme.Infrastructure,
  [ServiceIcon.Robot]: CardTheme.Ai,
  [ServiceIcon.Server]: CardTheme.Infrastructure,
  [ServiceIcon.ServerNetwork]: CardTheme.Infrastructure,
  [ServiceIcon.ShieldAccount]: CardTheme.Security,
  [ServiceIcon.Shopping]: CardTheme.Web,
  [ServiceIcon.SourceBranch]: CardTheme.Automation,
  [ServiceIcon.SourceRepository]: CardTheme.Development,
  [ServiceIcon.Storefront]: CardTheme.Web,
  [ServiceIcon.TimelineClock]: CardTheme.Automation,
  [ServiceIcon.Dashboard]: CardTheme.Web,
  [ServiceIcon.Watermark]: CardTheme.Media,
  [ServiceIcon.Web]: CardTheme.Web,
  [ServiceIcon.WebClock]: CardTheme.Observability,
  [ServiceIcon.Npm]: CardTheme.Development,
  [ServiceIcon.Sentry]: CardTheme.Observability,
  [ServiceIcon.SigNoz]: CardTheme.Observability,
  [ServiceIcon.Telegram]: CardTheme.Communication,
  [ServiceIcon.YouTube]: CardTheme.Media,
} satisfies Readonly<Record<ServiceIcon, CardTheme>>

export class DirectoryPresentationError extends Error {
  readonly name = 'DirectoryPresentationError'
  readonly code = 'DIRECTORY_CARD_VARIANTS_EXHAUSTED'
  readonly details: Readonly<{ theme: CardTheme; occurrence: number; availableVariants: number }>

  constructor(theme: CardTheme, occurrence: number) {
    super(`Card theme “${theme}” has more services than available visual variants`)
    this.details = { theme, occurrence, availableVariants: CARD_VARIANTS.length }
  }

  toLogRecord() {
    return { scope: 'directory-presentation', code: this.code, message: this.message, details: this.details }
  }
}

const nameCollator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' })

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase('ru-RU')
}

function optionallyOrderedByName<T extends { name: string }>(items: readonly T[], enabled: boolean): readonly T[] {
  if (!enabled) return items
  return [...items].sort((left, right) => nameCollator.compare(left.name, right.name))
}

function presentService(service: Service, cardTheme: CardTheme, cardVariant: CardVariant): PresentedService {
  return {
    ...service,
    searchText: normalizeSearchText(`${service.name} ${service.description} ${service.href}`),
    cardTheme,
    cardVariant,
  }
}

function cardVariantForOccurrence(cardTheme: CardTheme, occurrence: number): CardVariant {
  const cardVariant = CARD_VARIANTS[occurrence]
  if (cardVariant !== undefined) return cardVariant
  throw new DirectoryPresentationError(cardTheme, occurrence)
}

function presentGroups(groups: readonly ServiceGroup[], sortCategories: boolean, sortCards: boolean): readonly PresentedServiceGroup[] {
  const themeOccurrences = new Map<CardTheme, number>()
  return optionallyOrderedByName(groups, sortCategories).map((group) => {
    const { sorting, ...presentedGroup } = group
    return {
      ...presentedGroup,
      searchText: normalizeSearchText(group.name),
      services: optionallyOrderedByName(group.services, sorting?.cards ?? sortCards)
        .map((service) => {
          const cardTheme = CARD_THEME_BY_ICON[service.icon]
          const occurrence = themeOccurrences.get(cardTheme) ?? 0
          themeOccurrences.set(cardTheme, occurrence + 1)
          return presentService(service, cardTheme, cardVariantForOccurrence(cardTheme, occurrence))
        }),
    }
  })
}

export function presentDirectory(
  globalConfig: GlobalConfig,
  catalog: CatalogData,
  projects: ProjectsData | null,
  revision: string,
): DirectorySnapshot {
  return {
    revision,
    header: globalConfig.header,
    catalog: presentGroups(catalog.groups, globalConfig.sorting.catalog.categories, globalConfig.sorting.catalog.cards),
    projects: projects
      ? presentGroups(projects.projects, globalConfig.sorting.projects.categories, globalConfig.sorting.projects.cards)
      : null,
  }
}
