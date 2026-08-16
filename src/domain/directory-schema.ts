import { parse } from 'yaml'
import { z } from 'zod'
import {
  ServiceIcon,
  type CatalogData,
  type GlobalConfig,
  type ProjectsData,
  type ServiceGroup,
} from './directory-types.ts'

const httpUrlSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
}, 'Допустимы только HTTP(S)-ссылки без встроенных учётных данных')

const serviceSchema = z.object({
  name: z.string().trim().min(1),
  href: httpUrlSchema,
  description: z.string().trim().min(1),
  icon: z.enum(Object.values(ServiceIcon)),
}).strict()

const groupSortingSchema = z.object({
  cards: z.boolean(),
}).strict()

const serviceGroupSchema = z.object({
  name: z.string().trim().min(1),
  sorting: groupSortingSchema.optional(),
  services: z.array(serviceSchema).min(1),
}).strict()

function uniqueGroups(groups: readonly ServiceGroup[], context: z.RefinementCtx, root: 'groups' | 'projects') {
  const groupNames = new Set<string>()
  groups.forEach((group, groupIndex) => {
    if (groupNames.has(group.name)) {
      context.addIssue({
        code: 'custom',
        message: `Название группы «${group.name}» повторяется`,
        path: [root, groupIndex, 'name'],
      })
    }
    groupNames.add(group.name)

    const serviceNames = new Set<string>()
    group.services.forEach((service, serviceIndex) => {
      if (serviceNames.has(service.name)) {
        context.addIssue({
          code: 'custom',
          message: `Название сервиса «${service.name}» повторяется внутри группы`,
          path: [root, groupIndex, 'services', serviceIndex, 'name'],
        })
      }
      serviceNames.add(service.name)
    })
  })
}

const collectionSortingSchema = z.object({
  categories: z.boolean().default(false),
  cards: z.boolean().default(false),
}).strict().default({ categories: false, cards: false })
const sortingSchema = z.object({
  catalog: collectionSortingSchema,
  projects: collectionSortingSchema,
}).strict().default({
  catalog: { categories: false, cards: false },
  projects: { categories: false, cards: false },
})
const globalConfigSchema = z.object({
  header: z.object({ title: z.string().trim().min(1).max(48) }).strict(),
  sorting: sortingSchema,
}).strict()
const catalogDataSchema = z.object({ groups: z.array(serviceGroupSchema).min(1) }).strict()
  .superRefine((data, context) => uniqueGroups(data.groups, context, 'groups'))
const projectsDataSchema = z.object({ projects: z.array(serviceGroupSchema).min(1) }).strict()
  .superRefine((data, context) => uniqueGroups(data.projects, context, 'projects'))

export const DirectoryConfigErrorCode = {
  YamlSyntax: 'DIRECTORY_CONFIG_YAML_SYNTAX',
  Schema: 'DIRECTORY_CONFIG_SCHEMA',
} as const

export type DirectoryConfigErrorCode = typeof DirectoryConfigErrorCode[keyof typeof DirectoryConfigErrorCode]
type DirectoryConfigErrorDetails = Readonly<Record<string, unknown>>

export class DirectoryConfigError extends Error {
  readonly name = 'DirectoryConfigError'
  readonly code: DirectoryConfigErrorCode
  readonly details: DirectoryConfigErrorDetails

  constructor(code: DirectoryConfigErrorCode, message: string, details: DirectoryConfigErrorDetails = {}, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.details = details
  }

  toLogRecord() {
    return { scope: 'directory-config', code: this.code, message: this.message, details: this.details }
  }
}

function parseConfig<T>(source: string, label: string, schema: z.ZodType<T>): T {
  let parsed: unknown
  try {
    parsed = parse(source)
  } catch (cause) {
    throw new DirectoryConfigError(
      DirectoryConfigErrorCode.YamlSyntax,
      `Не удалось разобрать YAML-конфигурацию «${label}»`,
      { label },
      { cause },
    )
  }

  const result = schema.safeParse(parsed)
  if (result.success) return result.data
  throw new DirectoryConfigError(
    DirectoryConfigErrorCode.Schema,
    `YAML-конфигурация «${label}» не соответствует схеме`,
    {
      label,
      issues: result.error.issues.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path })),
    },
  )
}

export const parseGlobalConfig = (source: string) => parseConfig<GlobalConfig>(source, 'global', globalConfigSchema)
export const parseCatalogConfig = (source: string) => parseConfig<CatalogData>(source, 'catalog', catalogDataSchema)
export const parseProjectsConfig = (source: string) => parseConfig<ProjectsData>(source, 'projects', projectsDataSchema)
