import 'server-only'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 256 * 1024

const BASE_OBJECTS = ['print_stats', 'print_stats_manager', 'display_status', 'virtual_sdcard'] as const

const TEMPERATURE_NAMES: Record<string, string> = {
  extruder: 'Сопло',
  heater_bed: 'Стол',
  'heater_generic chamber': 'Камера',
  'temperature_sensor Mainboard_MCU': 'MCU основной платы',
  'temperature_sensor Box1_MCU': 'MCU бокса',
  'temperature_host AP_Board_SOC': 'SoC платы управления',
  'temperature_sensor AP_Board_SOC': 'SoC платы управления',
  'temperature_sensor Toolhead_MCU': 'MCU головы',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function configuredOrigin(name: string): URL {
  const value = process.env[name]
  if (!value) throw new Error('missing configuration')
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('invalid configuration')
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('invalid configuration')
  return url
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function labelFor(name: string): string {
  return TEMPERATURE_NAMES[name] ?? name.replace(/^(temperature_sensor|temperature_host|fan_generic|controller_fan|heater_fan|box_heater_fan) /, '').replaceAll('_', ' ')
}

async function readJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('response too large')
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function moonraker(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = new URL(path, configuredOrigin('MOONRAKER_URL'))
  if (params) url.search = params.toString()
  const headers = new Headers({ accept: 'application/json' })
  if (process.env.MOONRAKER_API_KEY) headers.set('x-api-key', process.env.MOONRAKER_API_KEY)
  const response = await fetch(url, { headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error('Moonraker unavailable')
  return readJson(response)
}

function moonrakerResult(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.result)) throw new Error('invalid Moonraker response')
  return value.result
}

function isTemperature(name: string): boolean {
  return name === 'extruder' || name === 'heater_bed' || name === 'heater_generic chamber' || name.startsWith('temperature_sensor ') || name.startsWith('temperature_host ')
}

function isFan(name: string): boolean {
  return /^(fan_generic|controller_fan|heater_fan|box_heater_fan) /.test(name)
}

export async function GET(): Promise<Response> {
  try {
    const objects = moonrakerResult(await moonraker('/printer/objects/list')).objects
    if (!Array.isArray(objects) || !objects.every((name) => typeof name === 'string')) throw new Error('invalid object list')

    const selected = [...new Set([...BASE_OBJECTS, ...objects.filter(isTemperature), ...objects.filter(isFan)])]
    const params = new URLSearchParams()
    selected.forEach((name) => params.append(name, ''))
    const status = moonrakerResult(await moonraker('/printer/objects/query', params)).status
    if (!isRecord(status)) throw new Error('invalid telemetry')

    const printStats = isRecord(status.print_stats) ? status.print_stats : {}
    const virtualSdcard = isRecord(status.virtual_sdcard) ? status.virtual_sdcard : {}
    const displayStatus = isRecord(status.display_status) ? status.display_status : {}
    const manager = isRecord(status.print_stats_manager) ? status.print_stats_manager : {}
    const state = typeof printStats.state === 'string' ? printStats.state : null
    const filename = typeof printStats.filename === 'string' && printStats.filename ? printStats.filename : null
    const printDuration = numberValue(printStats.print_duration)

    let etaSeconds: number | null = null
    if (state === 'printing' && filename && printDuration !== null) {
      const metadataParams = new URLSearchParams({ filename })
      const metadata = moonrakerResult(await moonraker('/server/files/metadata', metadataParams))
      const estimatedTime = numberValue(metadata.estimated_time)
      if (estimatedTime !== null) etaSeconds = Math.max(0, estimatedTime - printDuration)
    }

    const temperatures = selected.flatMap((name) => {
      const object = status[name]
      if (!isTemperature(name) || !isRecord(object)) return []
      const temperature = numberValue(object.temperature)
      if (temperature === null) return []
      return [{ name: labelFor(name), temperature, target: numberValue(object.target) }]
    })
    const fans = selected.flatMap((name) => {
      const object = status[name]
      if (!isFan(name) || !isRecord(object)) return []
      const rpm = numberValue(object.rpm)
      return [{ name: labelFor(name), rpm, pwm: numberValue(object.speed) }]
    })
    const info = isRecord(printStats.info) ? printStats.info : {}

    return Response.json({
      updatedAt: Date.now(),
      job: {
        state,
        status: typeof manager.main_status === 'string' ? manager.main_status : null,
        filename,
        progress: numberValue(virtualSdcard.progress),
        displayProgress: numberValue(displayStatus.progress),
        layer: numberValue(info.current_layer),
        totalLayers: numberValue(info.total_layer),
        etaSeconds,
        etaSource: etaSeconds === null ? null : 'slicer_metadata',
      },
      temperatures,
      fans,
    }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ error: { code: 'PRINTER_TELEMETRY_UNAVAILABLE', message: 'Printer telemetry unavailable' } }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
