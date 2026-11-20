import 'server-only'

import { isRecord, moonrakerJson } from '../printer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function labelFor(name: string): string {
  return TEMPERATURE_NAMES[name] ?? name.replace(/^(temperature_sensor|temperature_host|fan_generic|controller_fan|heater_fan|box_heater_fan) /, '').replaceAll('_', ' ')
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
    const objects = moonrakerResult(await moonrakerJson('/printer/objects/list', MAX_RESPONSE_BYTES)).objects
    if (!Array.isArray(objects) || !objects.every((name) => typeof name === 'string')) throw new Error('invalid object list')

    const selected = [...new Set([...BASE_OBJECTS, ...objects.filter(isTemperature), ...objects.filter(isFan)])]
    const params = new URLSearchParams()
    selected.forEach((name) => params.append(name, ''))
    const status = moonrakerResult(await moonrakerJson('/printer/objects/query', MAX_RESPONSE_BYTES, params)).status
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
      const metadata = moonrakerResult(await moonrakerJson('/server/files/metadata', MAX_RESPONSE_BYTES, new URLSearchParams({ filename })))
      const estimatedTime = numberValue(metadata.estimated_time)
      if (estimatedTime !== null) etaSeconds = Math.max(0, estimatedTime - printDuration)
    }

    const temperatureNames = new Set<string>()
    const temperatures = selected.flatMap((name) => {
      const object = status[name]
      const label = labelFor(name)
      if (!isTemperature(name) || !isRecord(object) || temperatureNames.has(label)) return []
      const temperature = numberValue(object.temperature)
      if (temperature === null) return []
      temperatureNames.add(label)
      return [{ name: label, temperature, target: numberValue(object.target) }]
    })
    const fans = selected.flatMap((name) => {
      const object = status[name]
      if (!isFan(name) || !isRecord(object)) return []
      return [{ name: labelFor(name), rpm: numberValue(object.rpm), pwm: numberValue(object.speed) }]
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
