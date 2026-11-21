import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Lightbulb } from 'lucide-react'
import { useVisiblePolling } from '../domain/use-visible-polling'

function usePrinterStream() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const [attempt, setAttempt] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)

  useEffect(() => {
    const updateVisibility = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  useEffect(() => {
    if (!visible || !warning) return
    const retry = window.setTimeout(() => setAttempt((value) => value + 1), 5_000)
    return () => window.clearTimeout(retry)
  }, [visible, warning, attempt])

  return {
    streamUrl: visible ? `/api/printer/stream?attempt=${attempt}` : null,
    warning,
    ready: () => setWarning(null),
    failed: () => setWarning('Камера временно недоступна.'),
  }
}

type PrinterLight = Readonly<{ enabled: boolean }>

type TelemetryItem = Readonly<{ name: string; temperature: number; target: number | null }>
type Fan = Readonly<{ name: string; rpm: number | null; pwm: number | null }>
type PrinterTelemetry = Readonly<{
  updatedAt: number
  job: Readonly<{
    state: string | null
    status: string | null
    filename: string | null
    progress: number | null
    progressSource: 'display_status' | 'virtual_sdcard' | null
    layer: number | null
    totalLayers: number | null
    elapsedSeconds: number | null
    estimatedSeconds: number | null
    etaSeconds: number | null
    etaSource: 'native' | 'display_progress' | 'slicer_elapsed' | null
  }>
  temperatures: readonly TelemetryItem[]
  fans: readonly Fan[]
}>

function usePrinterLight() {
  const [light, setLight] = useState<PrinterLight | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const requestRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (requestRef.current || document.visibilityState === 'hidden') return
    const request = new AbortController()
    requestRef.current = request
    try {
      const response = await fetch('/api/printer/light', { cache: 'no-store', signal: request.signal })
      if (!response.ok) throw new Error('Подсветка камеры временно недоступна.')
      setLight(await response.json() as PrinterLight)
      setWarning(null)
    } catch (error) {
      if (!request.signal.aborted) setWarning(error instanceof Error ? error.message : 'Подсветка камеры временно недоступна.')
    } finally {
      if (requestRef.current === request) requestRef.current = null
    }
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (pending || light === null || light.enabled === enabled) return
    setPending(true)
    setWarning(null)
    try {
      const response = await fetch('/api/printer/light', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) throw new Error('Не удалось изменить подсветку камеры.')
      setLight(await response.json() as PrinterLight)
    } catch (error) {
      setWarning(error instanceof Error ? error.message : 'Не удалось изменить подсветку камеры.')
      void refresh()
    } finally {
      setPending(false)
    }
  }, [light, pending, refresh])

  useVisiblePolling(10_000, refresh, () => requestRef.current?.abort())
  return { light, pending, setEnabled, warning }
}

function usePrinterTelemetry() {
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

  useVisiblePolling(10_000, refresh, () => requestRef.current?.abort())
  return { telemetry, warning, loading }
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60))
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

function value(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function findByName<T extends { name: string }>(items: readonly T[], expression: RegExp): T | null {
  return items.find((item) => expression.test(item.name.toLocaleLowerCase('ru-RU'))) ?? null
}

function temperature(temperatures: readonly TelemetryItem[], expression: RegExp): number | null {
  return findByName(temperatures, expression)?.temperature ?? null
}

function fan(fans: readonly Fan[], expression: RegExp): Fan | null {
  return findByName(fans, expression)
}

function jobStateLabel(state: string | null | undefined) {

  if (state === 'paused') return 'Пауза'
  if (state === 'error') return 'Ошибка'
  if (state === 'complete') return 'Готово'
  if (state === 'cancelled') return 'Отменено'
  return null
}

function MetricColumn({ title, unit, rows }: { title: string; unit: string; rows: readonly { label: string; value: string }[] }) {
  return <section className="printer-metric-column" aria-label={`${title}, ${unit}`}>
    <header><h3>{title}</h3><span>{unit}</span></header>
    {rows.map((row) => <div className="printer-metric" key={row.label}><span>{row.label}</span><b>{row.value}</b></div>)}
  </section>
}

function PrinterReadings({ telemetry, warning, loading }: ReturnType<typeof usePrinterTelemetry>) {
  if (!telemetry) return <section className="printer-readings printer-readings-empty" aria-live="polite">
    <strong>{loading ? 'Загрузка показаний…' : 'Показания недоступны.'}</strong>
    {warning && <span>{warning}</span>}
  </section>

  const hotend = fan(telemetry.fans, /hotend|хотэнд/)
  const part = fan(telemetry.fans, /^cooling fan$|part|обдув/)
  const camera = fan(telemetry.fans, /^chamber fan$|^camera fan$|камера/)
  const stale = Date.now() - telemetry.updatedAt > 30_000
  const fanValue = (current: Fan | null) => current?.rpm === null || !current ? '—' : value(current.rpm)

  return <section className="printer-readings" aria-label="Показания принтера">
    {(warning || stale) && <div className="printer-exception" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{warning ?? 'Показания устарели; отображаются последние полученные данные.'}</span></div>}
    <div className="printer-reading-grid">
      <MetricColumn title="Нагрев" unit="°C" rows={[
        { label: 'Сопло', value: value(temperature(telemetry.temperatures, /сопло|extruder/), 1) },
        { label: 'Стол', value: value(temperature(telemetry.temperatures, /стол|heater bed/), 1) },
        { label: 'Камера', value: value(temperature(telemetry.temperatures, /камера|chamber/), 1) },
      ]} />
      <MetricColumn title="Электроника" unit="°C" rows={[
        { label: 'Голова', value: value(temperature(telemetry.temperatures, /головы|toolhead/), 1) },
        { label: 'Основная плата', value: value(temperature(telemetry.temperatures, /mcu основной|mainboard/), 1) },
        { label: 'SoC', value: value(temperature(telemetry.temperatures, /soc/), 1) },
      ]} />
      <MetricColumn title="Вентиляторы" unit="об/мин" rows={[
        { label: 'Хотэнд', value: fanValue(hotend) },
        { label: 'Обдув детали', value: fanValue(part) },
        { label: 'Камера', value: fanValue(camera) },
      ]} />
    </div>
    <details className="printer-details">
      <summary>QIDI Max4 <span aria-hidden="true">·</span> Все показания</summary>
      <div className="printer-details-grid">
        <section><h3>Температуры</h3>{telemetry.temperatures.map((item) => <div key={item.name}><span>{item.name}</span><b>{value(item.temperature, 1)} °C{item.target === null ? '' : ` / ${value(item.target)} °C`}</b></div>)}</section>
        <section><h3>Вентиляторы</h3>{telemetry.fans.map((item) => <div key={item.name}><span>{item.name}</span><b>{item.rpm === null ? 'RPM —' : `${value(item.rpm)} RPM`}{item.pwm === null ? ' · PWM —' : ` · PWM ${value(item.pwm * 100)}%`}</b></div>)}</section>
      </div>

    </details>
  </section>
}

export function PrinterScreen() {
  const stream = usePrinterStream()
  const light = usePrinterLight()
  const telemetry = usePrinterTelemetry()
  const job = telemetry.telemetry?.job
  const progress = job?.progress === null || job?.progress === undefined ? null : Math.max(0, Math.min(100, job.progress * 100))
  const stateLabel = jobStateLabel(job?.state)

  return <section className="printer-screen" aria-label="QIDI Max4">
    {(stream.warning || light.warning) && <div className="printer-exception" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{stream.warning ?? light.warning}</span></div>}
    <section className="printer-camera" aria-label="Камера принтера">
      {stream.streamUrl ? <img alt="Изображение с камеры QIDI Max4" className="printer-live-stream" onError={stream.failed} onLoad={stream.ready} src={stream.streamUrl} /> : <div className="printer-camera-empty" role="status">Подключение к камере…</div>}
      <div className="printer-camera-vignette" aria-hidden="true" />
      <div className="printer-camera-tools">
        <nav aria-label="Панели принтера" className="printer-device-links">
          <a href="http://192.168.0.109:10088/valve-oil">Valve Oil <ExternalLink size={13} aria-hidden="true" /></a>
          <a href="http://192.168.0.109:10088/">Fluidd <ExternalLink size={13} aria-hidden="true" /></a>
        </nav>
        <button
          aria-checked={light.light?.enabled ?? false}
          aria-label={`Свет камеры: ${light.light === null ? 'состояние неизвестно' : light.light.enabled ? 'включен' : 'выключен'}`}
          className="printer-light-switch"
          disabled={light.light === null || light.pending}
          onClick={() => void light.setEnabled(!(light.light?.enabled ?? false))}
          role="switch"
          type="button"
        ><Lightbulb size={15} aria-hidden="true" /><span>Свет</span></button>
      </div>
      {job && <div className="printer-job-overlay">
        {stateLabel && <span className={`printer-job-state state-${job.state}`} role="status">{stateLabel}</span>}
        {progress !== null && <strong>{value(progress, 0)}%</strong>}
        <span className="printer-job-filename" title={job.filename ?? undefined}>{job.filename ?? 'Задание не выбрано'}</span>
        <div className="printer-job-meta">{job.etaSeconds !== null && <span>Осталось ≈ {formatDuration(job.etaSeconds)}</span>}{job.layer !== null && job.totalLayers !== null && <span>Слой {value(job.layer)} / {value(job.totalLayers)}</span>}{job.elapsedSeconds !== null && <span>Прошло {formatDuration(job.elapsedSeconds)}</span>}</div>
      </div>}
    </section>
    <PrinterReadings {...telemetry} />

  </section>
}
