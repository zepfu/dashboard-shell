import {
  memo,
  useMemo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { HoverTooltip } from './hover-tooltip'

export interface HealthStripEvent {
  time: string
  model: string
  errorType: string
  count: number
  observedAt?: string
}

export interface CellDef {
  color: string
  category?:
    | 'blue'
    | 'green'
    | 'orange'
    | 'red'
    | 'miss'
    | 'normal'
    | 'teal'
    | 'warning'
  intensity?: number
  rawP95Ms?: number | null
  rawErrorCount?: number
  bucketStart?: string
  eventCount?: number
  events?: HealthStripEvent[]
  rawErrorBreakdown?: {
    provider_error_events: number
    provider_5xx_events: number
    provider_timeout_events: number
    network_error_events: number
    rate_limit_events: number
    capacity_events: number
  }
  rawDegradedBreakdown?: {
    probe_failures: number
    provider_probe_degraded: number
    control_probe_degraded: number
    provider_packet_loss: number
    control_packet_loss: number
    provider_latency_delta: number
  }
  degradedCount?: number
}

export interface HealthStripProps {
  cells: CellDef[]
  orientation?: 'horizontal' | 'vertical'
  tooltipContent?: ReactNode
  now?: Date
}

const TOTAL_CELLS = 288
const BUCKET_MS = 5 * 60 * 1000
const PADDING_COLOR = 'var(--card-2)'
const EVENT_LOG_LIMIT = 14

function computeP90Threshold(cells: readonly CellDef[]): number | null {
  const values = cells
    .map((c) => c.rawP95Ms)
    .filter((v): v is number => v != null && v > 0)

  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.9)
  return sorted[Math.min(idx, sorted.length - 1)]
}

function lerp(lo: number, hi: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return lo + (hi - lo) * clamped
}

function rgba(r: number, g: number, b: number, a: number): string {
  const alpha = Math.round(a * 100) / 100
  return `rgba(${r.toString()},${g.toString()},${b.toString()},${alpha.toString()})`
}

function categoryToColor(
  cat: NonNullable<CellDef['category']>,
  intensity?: number
): { background: string | undefined; extraClass: string } {
  const solidOrAlpha = (
    r: number,
    g: number,
    b: number,
    lo: number,
    hi: number
  ) => ({
    background:
      intensity === undefined
        ? `rgb(${r.toString()}, ${g.toString()}, ${b.toString()})`
        : rgba(r, g, b, lerp(lo, hi, intensity)),
    extraClass: '',
  })

  switch (cat) {
    case 'blue':
    case 'normal':
      return solidOrAlpha(58, 130, 243, 0.75, 0.9)
    case 'green':
    case 'teal':
      return solidOrAlpha(16, 185, 129, 0.6, 0.8)
    case 'orange':
    case 'warning':
      return solidOrAlpha(245, 158, 11, 0.5, 0.7)
    case 'red':
      return solidOrAlpha(239, 68, 68, 0.7, 0.9)
    case 'miss':
      return { background: undefined, extraClass: 'cat-miss' }
  }
}

function deriveCellStyle(
  cell: CellDef,
  p90Threshold: number | null
): { background: string | undefined; extraClass: string } {
  const intensity = cell.intensity ?? 0.5

  if (cell.category !== undefined) {
    return categoryToColor(cell.category, cell.intensity)
  }

  if (cell.rawP95Ms !== undefined || cell.rawErrorCount !== undefined) {
    const p95 = cell.rawP95Ms
    const errCount = cell.rawErrorCount ?? 0

    if (errCount > 0 && p95 === null) {
      return categoryToColor('red', intensity)
    }
    if (errCount > 0) {
      return categoryToColor('orange', intensity)
    }
    if (p95 === null) {
      return categoryToColor('blue', intensity)
    }
    if (p90Threshold !== null && p95 !== undefined && p95 > p90Threshold) {
      return categoryToColor('orange', intensity)
    }
    return categoryToColor('green', intensity)
  }

  return { background: cell.color, extraClass: '' }
}

function formatRelTime(offsetSec: number): string {
  const abs = Math.abs(offsetSec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const sign = offsetSec <= 0 ? '−' : '+'
  if (m === 0) return `${sign}${h.toString()}h`
  return `${sign}${h.toString()}h ${m.toString()}m`
}

const ERROR_BREAKDOWN_LABELS: ReadonlyArray<
  [keyof NonNullable<CellDef['rawErrorBreakdown']>, string]
> = [
  ['provider_error_events', 'Provider errors'],
  ['provider_5xx_events', '5xx errors'],
  ['provider_timeout_events', 'Timeouts'],
  ['network_error_events', 'Network errors'],
  ['rate_limit_events', 'Rate limits'],
  ['capacity_events', 'Capacity limits'],
]

const DEGRADED_BREAKDOWN_LABELS: ReadonlyArray<
  [keyof NonNullable<CellDef['rawDegradedBreakdown']>, string]
> = [
  ['probe_failures', 'Probe failures'],
  ['provider_probe_degraded', 'Provider probe degraded'],
  ['control_probe_degraded', 'Control probe degraded'],
  ['provider_packet_loss', 'Provider packet loss'],
  ['control_packet_loss', 'Control packet loss'],
  ['provider_latency_delta', 'Provider latency delta'],
]

function eventSortMs(ev: HealthStripEvent): number {
  if (ev.observedAt == null) return 0
  const ms = new Date(ev.observedAt).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function collectRecentEventLog(cells: readonly CellDef[]): HealthStripEvent[] {
  const events = cells.flatMap((cell) => cell.events ?? [])
  if (events.length <= EVENT_LOG_LIMIT) {
    return [...events].sort((a, b) => eventSortMs(a) - eventSortMs(b))
  }

  const sorted = [...events].sort((a, b) => eventSortMs(a) - eventSortMs(b))
  const omitted = sorted.length - EVENT_LOG_LIMIT
  return [
    {
      time: '...',
      model: '',
      errorType: `+${omitted.toString()} more event${omitted === 1 ? '' : 's'}`,
      count: 0,
    },
    ...sorted.slice(sorted.length - EVENT_LOG_LIMIT),
  ]
}

function sumEventOccurrences(events: readonly HealthStripEvent[]): number {
  return events.reduce((total, event) => total + event.count, 0)
}

function buildDegradedTooltipRows(
  breakdown: CellDef['rawDegradedBreakdown']
): ReactNode[] {
  if (breakdown == null) return []
  return DEGRADED_BREAKDOWN_LABELS.filter(([key]) => breakdown[key] > 0).map(
    ([key, label]) => (
      <div key={key} className='v9-tip-row'>
        <span className='t-err'>{label}</span>
        <span className='t-count'>{breakdown[key].toString()}</span>
      </div>
    )
  )
}

function buildCellTooltip(cell: CellDef, now: Date): ReactNode {
  let headText: string

  if (cell.bucketStart != null) {
    const bucketMs = new Date(cell.bucketStart).getTime()
    const startOffsetSec = (bucketMs - now.getTime()) / 1000
    const endOffsetSec = startOffsetSec + 5 * 60
    const n = (cell.eventCount ?? 0) + (cell.degradedCount ?? 0)
    const noun =
      (cell.degradedCount ?? 0) > 0
        ? n === 1
          ? 'signal'
          : 'signals'
        : n === 1
          ? 'event'
          : 'events'
    headText = `${formatRelTime(startOffsetSec)} → ${formatRelTime(endOffsetSec)} · ${n.toString()} ${noun}`
  } else {
    const n = (cell.eventCount ?? 0) + (cell.degradedCount ?? 0)
    const noun =
      (cell.degradedCount ?? 0) > 0
        ? n === 1
          ? 'signal'
          : 'signals'
        : n === 1
          ? 'event'
          : 'events'
    headText = n > 0 ? `— · ${n.toString()} ${noun}` : '— no data'
  }

  if (cell.events != null && cell.events.length > 0) {
    return (
      <>
        <div className='v9-tip-head'>{headText}</div>
        {cell.events.map((ev, idx) => (
          <div key={idx} className='v9-tip-row'>
            <span className='t-time'>{ev.time}</span>
            <span className='t-model'>{ev.model}</span>
            <span className='t-err'>{ev.errorType}</span>
            <span className='t-count'>
              {ev.count > 1 ? `x${ev.count.toString()}` : ''}
            </span>
          </div>
        ))}
      </>
    )
  }

  if (cell.rawErrorBreakdown != null) {
    const bd = cell.rawErrorBreakdown
    const breakdownRows = ERROR_BREAKDOWN_LABELS.filter(
      ([key]) => bd[key] > 0
    ).map(([key, label]) => (
      <div key={key} className='v9-tip-row'>
        <span className='t-err'>{label}</span>
        <span className='t-count'>{bd[key].toString()}</span>
      </div>
    ))
    const degradedRows = buildDegradedTooltipRows(cell.rawDegradedBreakdown)
    return (
      <>
        <div className='v9-tip-head'>{headText}</div>
        {breakdownRows}
        {degradedRows}
      </>
    )
  }

  const degradedRows = buildDegradedTooltipRows(cell.rawDegradedBreakdown)
  if (degradedRows.length > 0) {
    return (
      <>
        <div className='v9-tip-head'>{headText}</div>
        {degradedRows}
      </>
    )
  }

  if (cell.events != null && cell.events.length === 0) {
    const count = cell.eventCount ?? 0
    return (
      <>
        <div className='v9-tip-head'>{headText}</div>
        <div className='v9-tip-row'>
          <span className='t-time'>—</span>
          <span className='t-model'>—</span>
          <span className='t-err'>
            {count > 0 ? `${count.toString()} events` : 'ok'}
          </span>
          <span className='t-count' />
        </div>
      </>
    )
  }

  return <div className='v9-tip-head'>{headText}</div>
}

function resolveTooltipContent(
  tooltipContent: ReactNode | undefined,
  cells: readonly CellDef[],
  now: Date
): ReactNode | undefined {
  if (tooltipContent !== undefined) return tooltipContent

  const eventLog = collectRecentEventLog(cells)
  if (eventLog.length > 0) {
    const newestEvent = [...eventLog]
      .reverse()
      .find((ev) => ev.observedAt != null)
    const newestBucketMs =
      newestEvent?.observedAt != null
        ? Math.floor(new Date(newestEvent.observedAt).getTime() / BUCKET_MS) *
          BUCKET_MS
        : undefined

    return buildCellTooltip(
      {
        color: PADDING_COLOR,
        bucketStart:
          newestBucketMs !== undefined
            ? new Date(newestBucketMs).toISOString()
            : undefined,
        eventCount: sumEventOccurrences(
          cells.flatMap((cell) => cell.events ?? [])
        ),
        events: eventLog,
      },
      now
    )
  }

  let interesting: CellDef | undefined
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const c = cells[i]
    if (
      ((c.eventCount ?? 0) > 0 || (c.degradedCount ?? 0) > 0) &&
      c.category !== 'miss'
    ) {
      interesting = c
      break
    }
  }

  if (interesting === undefined) {
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      if (cells[i].bucketStart != null) {
        interesting = cells[i]
        break
      }
    }
  }

  return interesting == null ? undefined : buildCellTooltip(interesting, now)
}

function hasBucketStarts(cells: readonly CellDef[]): boolean {
  return cells.some((cell) => cell.bucketStart != null)
}

function padFrontAndClipNewest(cells: readonly CellDef[]): CellDef[] {
  const clipped = cells.slice(-TOTAL_CELLS)
  if (clipped.length >= TOTAL_CELLS) return clipped
  return [
    ...Array.from<CellDef>({ length: TOTAL_CELLS - clipped.length }).fill({
      color: PADDING_COLOR,
    }),
    ...clipped,
  ]
}

function wallClockIndexCells(cells: readonly CellDef[], now: Date): CellDef[] {
  const windowStartMs = now.getTime() - TOTAL_CELLS * BUCKET_MS
  const indexed = Array.from<CellDef>({ length: TOTAL_CELLS }).fill({
    color: PADDING_COLOR,
    category: 'blue',
  })

  for (const cell of cells) {
    if (cell.bucketStart == null) continue
    const bucketMs = new Date(cell.bucketStart).getTime()
    if (!Number.isFinite(bucketMs)) continue
    const index = Math.floor((bucketMs - windowStartMs) / BUCKET_MS)
    if (index < 0 || index >= TOTAL_CELLS) continue
    indexed[index] = cell
  }

  return indexed
}

function normalizeCells(
  cells: readonly CellDef[],
  now: Date
): {
  normalized: CellDef[]
  wallClockIndexed: boolean
} {
  const wallClockIndexed = hasBucketStarts(cells)
  return {
    wallClockIndexed,
    normalized: wallClockIndexed
      ? wallClockIndexCells(cells, now)
      : padFrontAndClipNewest(cells),
  }
}

interface HealthCellProps {
  background: string | undefined
  extraClass: string
  vertical: boolean
  span?: number
}

const HealthCell = memo(function HealthCell({
  background,
  extraClass,
  vertical,
  span = 1,
}: HealthCellProps): ReactElement {
  const style: CSSProperties = {
    ...(background !== undefined ? { background } : {}),
    width: vertical ? '12px' : '100%',
    height: vertical ? undefined : '6px',
    flexGrow: vertical ? span : undefined,
    flexShrink: vertical ? 1 : undefined,
    flexBasis: vertical ? 0 : undefined,
    minHeight: vertical ? 0 : undefined,
  }

  return (
    <div
      className={['health-strip-cell', extraClass].filter(Boolean).join(' ')}
      style={style}
    />
  )
})

interface HealthVisualRun {
  background: string | undefined
  extraClass: string
  span: number
}

function healthRunKey(
  run: Pick<HealthVisualRun, 'background' | 'extraClass'>
): string {
  return `${run.background ?? ''}|${run.extraClass}`
}

function buildHealthVisualRuns(
  cells: readonly CellDef[],
  p90Threshold: number | null
): HealthVisualRun[] {
  const runs: HealthVisualRun[] = []

  for (const cell of cells) {
    const { background, extraClass } = deriveCellStyle(cell, p90Threshold)
    const next = { background, extraClass, span: 1 }
    const prev = runs[runs.length - 1]

    if (prev !== undefined && healthRunKey(prev) === healthRunKey(next)) {
      prev.span += 1
    } else {
      runs.push(next)
    }
  }

  return runs
}

export function HealthStrip({
  cells,
  orientation = 'horizontal',
  tooltipContent,
  now = new Date(),
}: HealthStripProps): ReactElement {
  const isVertical = orientation === 'vertical'
  const { normalized, wallClockIndexed } = normalizeCells(cells, now)
  const p90Threshold = useMemo(
    () => computeP90Threshold(normalized),
    [normalized]
  )

  if (isVertical) {
    const renderCells = wallClockIndexed
      ? normalized
      : [...normalized].reverse()
    const visualRuns = buildHealthVisualRuns(renderCells, p90Threshold)
    const resolvedTooltip = resolveTooltipContent(
      tooltipContent,
      cells.length > 0 ? cells : normalized,
      now
    )

    const stripInner = (
      <>
        <div className='vbar-label top'>24H</div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'visible',
            gap: 0,
          }}
        >
          {visualRuns.map((run, i) => (
            <HealthCell
              key={i}
              background={run.background}
              extraClass={run.extraClass}
              vertical
              span={run.span}
            />
          ))}
        </div>
        <div className='vbar-label bottom'>NOW</div>
      </>
    )

    const stripWrapperStyle: CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid rgba(245,158,11,0.25)',
      borderRight: '1px solid var(--border)',
      overflow: 'visible',
      height: '100%',
    }

    const shellStyle: CSSProperties = {
      position: 'absolute',
      top: '6px',
      right: '6px',
      bottom: '6px',
      width: '12px',
      pointerEvents: 'none',
    }

    const stripContent = (
      <div className='health-strip-wrapper' style={stripWrapperStyle}>
        {stripInner}
      </div>
    )

    const tooltipPanelStyle: CSSProperties = {
      minWidth: '360px',
      maxWidth: 'min(560px, calc(100vw - 16px))',
    }

    if (resolvedTooltip !== undefined) {
      if (tooltipContent !== undefined) {
        return (
          <div aria-hidden='true' style={shellStyle}>
            <div style={{ pointerEvents: 'auto', height: '100%' }}>
              <HoverTooltip
                content={resolvedTooltip}
                variant='health'
                panelStyle={tooltipPanelStyle}
              >
                {stripContent}
              </HoverTooltip>
            </div>
          </div>
        )
      }

      return (
        <HoverTooltip
          content={resolvedTooltip}
          variant='health'
          panelStyle={tooltipPanelStyle}
        >
          <div aria-hidden='true' style={shellStyle}>
            {stripContent}
          </div>
        </HoverTooltip>
      )
    }

    return (
      <div
        aria-hidden='true'
        className='health-strip-wrapper'
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          bottom: '6px',
          width: '12px',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid rgba(245,158,11,0.25)',
          borderRight: '1px solid var(--border)',
          overflow: 'visible',
        }}
      >
        {stripInner}
      </div>
    )
  }

  return (
    <div aria-hidden='true'>
      <div
        aria-hidden='true'
        className='health-strip-wrapper'
        style={{ borderRight: '1px solid var(--border)' }}
      >
        <div
          aria-hidden='true'
          className='health-strip'
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${TOTAL_CELLS.toString()}, 1fr)`,
            height: '6px',
            gap: 0,
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {normalized.map((cell, i) => {
            const { background, extraClass } = deriveCellStyle(
              cell,
              p90Threshold
            )
            return (
              <HealthCell
                key={i}
                background={background}
                extraClass={extraClass}
                vertical={false}
              />
            )
          })}
        </div>
      </div>
      <div className='health-strip-axis'>
        <span>-24h</span>
        <span>now</span>
      </div>
    </div>
  )
}
