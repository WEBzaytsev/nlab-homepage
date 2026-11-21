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

function remainingSeconds(state: string | null, nativeRemaining: number | null, displayProgress: number | null, elapsedSeconds: number | null, slicerSeconds: number | null) {
  if (state !== 'printing' && state !== 'paused') return { value: null, source: null }
  if (nativeRemaining !== null) return { value: nativeRemaining, source: 'native' as const }
  if (elapsedSeconds === null || slicerSeconds === null) return { value: null, source: null }
  if (displayProgress !== null && displayProgress > 0 && displayProgress <= 1) {
    const weight = Math.max(0, Math.min(1, (displayProgress - 0.05) / 0.45))
    const total = slicerSeconds * (1 - weight) + elapsedSeconds / displayProgress * weight
    return { value: Math.max(0, total - elapsedSeconds), source: 'display_progress' as const }
  }
  return slicerSeconds > elapsedSeconds
    ? { value: slicerSeconds - elapsedSeconds, source: 'slicer_elapsed' as const }
    : { value: null, source: null }
}

function progressFor(state: string | null, displayProgress: number | null, fileProgress: number | null) {
  if (state !== 'printing' && state !== 'paused') return { value: null, source: null }
  if (displayProgress !== null && displayProgress > 0) return { value: displayProgress, source: 'display_status' }
  if (fileProgress !== null) return { value: fileProgress, source: 'virtual_sdcard' }
  return { value: displayProgress, source: displayProgress === null ? null : 'display_status' }
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

    const displayProgress = numberValue(displayStatus.progress)
    const fileProgress = numberValue(virtualSdcard.progress)
    const progress = progressFor(state, displayProgress, fileProgress)
    let estimatedSeconds: number | null = null
    if ((state === 'printing' || state === 'paused') && filename) {
      try {
        const metadata = moonrakerResult(await moonrakerJson('/server/files/metadata', MAX_RESPONSE_BYTES, new URLSearchParams({ filename })))
        estimatedSeconds = numberValue(metadata.estimated_time)
      } catch {
        // The live job remains useful when Moonraker has no metadata for a new file.
      }
    }
    const nativeRemaining = numberValue(manager.remaining_time) ?? numberValue(manager.remain_time) ?? numberValue(displayStatus.remaining_time)
    const eta = remainingSeconds(state, nativeRemaining, displayProgress, printDuration, estimatedSeconds)

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
        progress: progress.value,
        progressSource: progress.source,
        layer: numberValue(info.current_layer),
        totalLayers: numberValue(info.total_layer),
        elapsedSeconds: state === 'printing' || state === 'paused' ? printDuration : null,
        estimatedSeconds,
        etaSeconds: eta.value,
        etaSource: eta.source,
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
