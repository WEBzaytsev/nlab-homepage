import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
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
    streamWarning: warning,
    streamReady: () => setWarning(null),
    streamFailed: () => setWarning('Нет изображения с камеры.'),
  }
}

type PrinterLight = Readonly<{ enabled: boolean }>

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

export function PrinterScreen() {
  const { streamUrl, streamWarning, streamReady, streamFailed } = usePrinterStream()
  const { light, pending, setEnabled, warning: lightWarning } = usePrinterLight()
  const telemetry = usePrinterTelemetry()
  const warning = streamWarning ?? lightWarning
  const lightStatus = light === null ? 'Состояние подсветки неизвестно' : light.enabled ? 'Включена' : 'Выключена'

  return (
    <section className="printer-screen" aria-labelledby="printer-title">
      <header className="printer-heading">
        <h2 id="printer-title">Принтер</h2>
      </header>
      {warning && <div className="printer-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{warning}</span></div>}
      <div className="printer-dashboard">
        <div>
          <div className="printer-frame">
            {streamUrl ? (
              <img className="printer-live-stream" alt="Изображение с камеры принтера" onError={streamFailed} onLoad={streamReady} src={streamUrl} />
            ) : (
              <div className="printer-frame-empty" role="status">Подключение к камере…</div>
            )}
          </div>
          <section className="printer-light" aria-labelledby="printer-light-title">
            <div><h3 id="printer-light-title">Подсветка камеры</h3><small aria-live="polite">{pending ? 'Применение…' : lightStatus}</small></div>
            <button
              aria-checked={light?.enabled ?? false}
              aria-labelledby="printer-light-title"
              className="printer-light-switch"
              disabled={light === null || pending}
              onClick={() => void setEnabled(!(light?.enabled ?? false))}
              role="switch"
              type="button"
            ><span aria-hidden="true" /></button>
          </section>
        </div>
        <PrinterTelemetryPanel {...telemetry} />
      </div>
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
      <h3 id="telemetry-title">Состояние</h3>
      <div className="printer-telemetry-empty" role="status">{loading ? 'Загрузка телеметрии…' : 'Телеметрия пока недоступна.'}</div>
      {warning && <div className="printer-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{warning}</span></div>}
    </section>
  )

  const { job } = telemetry
  const progress = job.progress === null ? null : Math.max(0, Math.min(100, job.progress * 100))
  return (
    <section className="printer-telemetry" aria-labelledby="telemetry-title">
      <h3 id="telemetry-title">Состояние</h3>
      {warning && <div className="printer-warning printer-telemetry-warning" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{warning} Показаны последние данные.</span></div>}
      <div className="telemetry-job">
        <strong>{job.status ?? job.state ?? 'Неизвестно'}</strong>
        <span title={job.filename ?? undefined}>{job.filename ?? 'Задание не выбрано'}</span>
        {progress !== null && <><div className="telemetry-progress" aria-label={`Выполнено ${progress.toFixed(1)}%`}><i style={{ width: `${progress}%` }} /></div><small>Файл: {progress.toFixed(1)}%</small></>}
      </div>
      <div className="telemetry-summary">
        <span><b>Осталось</b>{job.etaSeconds === null ? '—' : `≈ ${formatDuration(job.etaSeconds)}`}</span>
        <span><b>Слои</b>{job.layer === null || job.totalLayers === null ? '—' : `${job.layer}/${job.totalLayers}`}</span>
      </div>
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
