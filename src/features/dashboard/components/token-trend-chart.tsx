/**
 * TokenTrendChart — 24-bar stacked provider token visualisation.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - Chart container: background var(--card), border 1px solid var(--border), padding 8px.
 * - Individual bars: border 1px solid var(--border), opacity 0.85, hover 1.0.
 * - Legend: gap 12px (was 8px), swatch 10×10px + border (was 8×8px no border).
 * - Section title: .section-title class with amber color (rendered by parent section).
 *
 * Wave 14-F compliance (audit §12):
 * - Hover via CSS .trend-bar:hover (opacity 1) instead of JS event handlers,
 *   restoring the mockup-spec `transition: opacity 50ms` (audit §12 deviation 2).
 *   CSS rule added to index.css Wave 14-F block.
 * - .tt-slice: removed inline `background` override — color applied exclusively
 *   via CSS class (audit §12 deviation 3).
 *
 * Wave 24 — operator F8 fixes:
 * - F8a: PROVIDER_COLOR_MAP added as the canonical fallback palette so bars
 *   never render white when a CSS class carries no/wrong background. The map
 *   covers every provider the API can emit and uses PROVIDER_BRAND_HEX values.
 *   Inline `background` is applied via `resolveSliceColor` as a secondary
 *   source of truth alongside the CSS class — the CSS class retains priority
 *   through specificity, but the inline value catches any class with no rule.
 * - F8b: normalizeTrendData (trend-utils.ts) now canonicalises provider names
 *   before keying into TrendBucket.totals, ensuring xai rows are never lost.
 *
 * Wave 28-TrendVisual:
 * - Track B: hover tooltip per bar — shows bucket label + per-provider token
 *   breakdown sorted by token count descending. Uses the existing HoverTooltip
 *   primitive (variant='quota': above-bar positioning) and .v9-tip-* CSS
 *   class structure consistent with other dashboard tooltips.
 * - Track C: bucket label row below the bar strip. Each bar shows its
 *   TrendBucket.label; ISO-8601 timestamps are formatted as MM/DD for daily
 *   grain, relative labels (e.g. "23h") are displayed as-is. To avoid
 *   crowding at 24 bars only even-indexed labels are shown (every other bar).
 *
 * Wave 31 — Q1 bar-height fix:
 * - Replaced `height: '100%'` on `.trend-bar` (which collapsed every bar to
 *   4-7px under `align-items: flex-end`) with a volume-proportional inline
 *   `height` computed as `(bucketTotal / maxBucketTotal) * 100%`. Non-zero
 *   buckets are floored at 6% so the smallest visible bucket still renders a
 *   ribbon. Empty buckets (total === 0) get 0% and are fully invisible.
 *   Root-cause diagnosis: Wave 31 principal investigation, Q1 verdict.
 *
 * Accessibility: the outer container carries a descriptive aria-label.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import type {
  UsageReportProviderLatencyHealthRow,
  UsageReportTokenTrendScoreRow,
  UsageReportTokenTrendDayResponse,
  UsageReportTokenTrendModelFirstSeenRow,
  UsageReportTokenTrendVersionIntervalRow,
} from '../api/usage-report'
import {
  deriveTokenTrendActiveVersionLanes,
  deriveTokenTrendModelFirstSeenGroups,
  formatBucketLabel,
  isTokenTrendActiveVersionClient,
  tokenTrendDayHeightPct,
  tokenTrendHourHeightPct,
  type TokenTrendActiveVersionFamilyLane,
  type TokenTrendDayEnvelopeRangeOptions,
  type TokenTrendActiveVersionSegment,
  type TokenTrendDayEnvelope,
  type TokenTrendModelFirstSeenGroup,
  type TokenTrendModelFirstSeenMarker,
} from '../lib/trend-utils'
import {
  canonicalProvider,
  PROVIDER_BRAND_HEX,
} from '../lib/usage-report-display'
import { HoverTooltip } from './primitives/hover-tooltip'

const FORMAT_COMPACT_NUMBER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

// ---------------------------------------------------------------------------
// Provider colour map
// ---------------------------------------------------------------------------

/**
 * Canonical provider→hex map used as a fallback when the CSS class for a
 * series key carries no (or an incorrect) background rule.
 *
 * Values are sourced from {@link PROVIDER_BRAND_HEX} — the single source of
 * truth for provider brand colours across the dashboard — supplemented with
 * aliases that the trend API may emit (`gemini`, `local_llm`, `local_embed`).
 *
 * Every provider name that `providerDimension` in report-service.mjs can
 * produce must have an entry here so that bars are never rendered white:
 *   anthropic, openai, google (+ gemini alias), xai, nvidia_nim, openrouter,
 *   local (+ local_llm / local_embed aliases).
 *
 * Not exported: this is an implementation detail of {@link resolveSliceColor}.
 * Consumer code that needs provider colours should import {@link PROVIDER_BRAND_HEX}
 * directly from `../lib/usage-report-display`.
 */
const PROVIDER_COLOR_MAP: Readonly<Record<string, string>> = {
  ...PROVIDER_BRAND_HEX,
  // Alias: Google/Gemini — same brand colour
  gemini: PROVIDER_BRAND_HEX.google ?? '#4285f4',
  // Aliases: local sub-variants
  local_llm: PROVIDER_BRAND_HEX.local ?? '#64748b',
  local_embed: PROVIDER_BRAND_HEX.local ?? '#64748b',
}

/**
 * Returns the resolved hex color for a series key, preferring the explicit
 * `color` prop then falling back to {@link PROVIDER_COLOR_MAP} then to a
 * mid-grey so bars are never invisible.
 */
function resolveSliceColor(key: string, color: string): string {
  if (color && color !== '') return color
  return PROVIDER_COLOR_MAP[key] ?? '#94a3b8'
}

type TrendSignalMode = 'health' | 'score'
type TrendMetricKind = 'count' | 'latency' | 'score'

interface TrendMetricDefinition {
  key: string
  mode: TrendSignalMode
  label: string
  shortLabel: string
  color: string
  kind: TrendMetricKind
}

const HEALTH_TREND_METRICS: TrendMetricDefinition[] = [
  {
    key: 'requests',
    mode: 'health',
    label: 'Requests',
    shortLabel: 'Req',
    color: '#38bdf8',
    kind: 'count',
  },
  {
    key: 'errors',
    mode: 'health',
    label: 'Errors',
    shortLabel: 'Err',
    color: '#ef4444',
    kind: 'count',
  },
  {
    key: 'rate_limits',
    mode: 'health',
    label: 'Rate limits',
    shortLabel: '429',
    color: '#f59e0b',
    kind: 'count',
  },
  {
    key: 'latency',
    mode: 'health',
    label: 'P95 latency',
    shortLabel: 'P95',
    color: '#a78bfa',
    kind: 'latency',
  },
  {
    key: 'probes',
    mode: 'health',
    label: 'Probes',
    shortLabel: 'Prb',
    color: '#10b981',
    kind: 'count',
  },
]

const SCORE_TREND_METRICS: TrendMetricDefinition[] = [
  {
    key: 'evaluated',
    mode: 'score',
    label: 'Evaluated',
    shortLabel: 'Eval',
    color: '#64748b',
    kind: 'count',
  },
  {
    key: 'quality',
    mode: 'score',
    label: 'Quality',
    shortLabel: 'Q',
    color: '#22c55e',
    kind: 'score',
  },
  {
    key: 'instruction',
    mode: 'score',
    label: 'Instruction',
    shortLabel: 'I',
    color: '#14b8a6',
    kind: 'score',
  },
  {
    key: 'tool',
    mode: 'score',
    label: 'Tool',
    shortLabel: 'T',
    color: '#3b82f6',
    kind: 'score',
  },
  {
    key: 'contract',
    mode: 'score',
    label: 'Contract',
    shortLabel: 'C',
    color: '#8b5cf6',
    kind: 'score',
  },
  {
    key: 'progress',
    mode: 'score',
    label: 'Progress',
    shortLabel: 'P',
    color: '#eab308',
    kind: 'score',
  },
  {
    key: 'risk',
    mode: 'score',
    label: 'Risk',
    shortLabel: 'R',
    color: '#f43f5e',
    kind: 'score',
  },
  {
    key: 'ignored_path',
    mode: 'score',
    label: 'Ignored path pass',
    shortLabel: 'Ign',
    color: '#06b6d4',
    kind: 'score',
  },
  {
    key: 'baseline_clear',
    mode: 'score',
    label: 'Baseline clear',
    shortLabel: 'Base',
    color: '#f97316',
    kind: 'score',
  },
  {
    key: 'sleep_clear',
    mode: 'score',
    label: 'Sleep clear',
    shortLabel: 'SLP',
    color: '#ec4899',
    kind: 'score',
  },
]

interface TrendScopeOption {
  key: string
  label: string
  provider: string | null
  model: string | null
  depth: 0 | 1 | 2
}

interface TrendSignalValue {
  value: number | null
  samples: number
}

type TrendSignalGrid = Map<string, Map<number, TrendSignalValue>>

interface TrendSignalRow {
  metric: TrendMetricDefinition
  grid: TrendSignalGrid
  maxValue: number
  hasData: boolean
}

interface TrendSignalSlice {
  metric: TrendMetricDefinition
  value: number
  scaleValue: number
  samples: number
}

interface TrendSignalHour {
  day: string
  hour: number
  total: number
  slices: TrendSignalSlice[]
}

interface TrendSignalDay {
  day: string
  label: string
  total: number
  maxHourTotal: number
  hours: TrendSignalHour[]
}

// ---------------------------------------------------------------------------
// Tooltip content builder
// ---------------------------------------------------------------------------

/**
 * Builds the tooltip {@link ReactNode} for a single hovered bucket.
 *
 * Shows the bucket label as a heading and then one row per provider
 * (from `series`) that has a non-zero token count, sorted descending by
 * token count. Uses the standard `.v9-tip-head` / `.v9-tip-row` CSS
 * structure shared by all dashboard tooltips.
 *
 * @param bucket - The {@link TrendBucket} being hovered.
 * @param series - Ordered series config (used only for provider label lookup).
 * @returns A {@link ReactNode} ready to pass to {@link HoverTooltip}.
 */
function buildBarTooltip(
  bucket: TrendBucket,
  series: readonly ProviderSeries[]
): ReactNode {
  // Build a label map for fast lookup (key → human label)
  const labelMap = new Map<string, string>(series.map((s) => [s.key, s.label]))

  // Collect all providers with non-zero tokens and sort descending
  const rows = Object.entries(bucket.totals)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  const total = rows.reduce((sum, [, v]) => sum + v, 0)

  const displayLabel = formatBucketLabel(bucket.label)

  return (
    <>
      <div className='v9-tip-head'>{displayLabel}</div>
      {rows.map(([key, count]) => {
        const providerLabel = labelMap.get(key) ?? key
        const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0'
        const formatted = FORMAT_COMPACT_NUMBER.format(count)
        return (
          <div
            key={key}
            className='v9-tip-row'
            style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
          >
            <span className='t-model'>{providerLabel}</span>
            <span className='t-count'>
              {formatted} ({pct}%)
            </span>
          </div>
        )
      })}
      {rows.length === 0 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-model' style={{ color: 'var(--fg-muted)' }}>
            no data
          </span>
        </div>
      )}
    </>
  )
}

function formatCompactNumber(value: number): string {
  return FORMAT_COMPACT_NUMBER.format(value)
}

function formatDayLabel(day: string): string {
  return formatBucketLabel(day)
}

function formatVersionLabel(clientName: string, clientVersion: string): string {
  return `${clientName} ${clientVersion}`.trim()
}

function versionRowKey(row: {
  provider: string
  client_name: string
  client_version: string
}): string {
  return [
    canonicalProvider(row.provider),
    row.client_name,
    row.client_version,
  ].join('|')
}

function intervalRowKey(row: UsageReportTokenTrendVersionIntervalRow): string {
  return [
    canonicalProvider(row.provider),
    row.client_name,
    row.client_version,
  ].join('|')
}

interface DayVersionSummary {
  provider: string
  client_name: string
  client_version: string
  token_total: number
}

function summarizeDayDetailRows(
  dayDetail: UsageReportTokenTrendDayResponse | null | undefined,
  day: string,
  releaseKeys: ReadonlySet<string>
): DayVersionSummary[] {
  if (dayDetail?.date !== day) return []

  const byVersion = new Map<string, DayVersionSummary>()
  for (const row of dayDetail.rows) {
    if (row.day !== day || row.token_total <= 0) continue
    if (!isTokenTrendActiveVersionClient(row)) continue
    if (releaseKeys.has(versionRowKey(row))) continue

    const key = versionRowKey(row)
    const existing = byVersion.get(key)
    if (existing !== undefined) {
      existing.token_total += row.token_total
      continue
    }

    byVersion.set(key, {
      provider: canonicalProvider(row.provider),
      client_name: row.client_name,
      client_version: row.client_version,
      token_total: row.token_total,
    })
  }

  return [...byVersion.values()].sort((a, b) => b.token_total - a.token_total)
}

function buildDayTooltip(
  day: TokenTrendDayEnvelope,
  series: readonly ProviderSeries[],
  versionIntervals: readonly UsageReportTokenTrendVersionIntervalRow[],
  modelFirstSeenGroups: readonly TokenTrendModelFirstSeenGroup[],
  dayDetail: UsageReportTokenTrendDayResponse | null | undefined,
  detailLoading: boolean | undefined
): ReactNode {
  const labelMap = new Map<string, string>(series.map((s) => [s.key, s.label]))
  const providerRows = Object.entries(day.totals)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  const modelFirstSeenRows = modelFirstSeenGroups
    .filter((group) => group.day === day.day)
    .flatMap((group) => group.markers)
    .sort((a, b) => {
      const hourDelta = a.firstSeenHour - b.firstSeenHour
      if (hourDelta !== 0) return hourDelta
      return (
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)
      )
    })

  const clientFirstSeenRows = versionIntervals
    .filter(
      (interval) =>
        interval.first_seen_day === day.day &&
        isTokenTrendActiveVersionClient(interval)
    )
    .sort((a, b) => {
      const hourDelta = (a.first_seen_hour ?? 99) - (b.first_seen_hour ?? 99)
      if (hourDelta !== 0) return hourDelta
      return b.token_total - a.token_total
    })

  const clientFirstSeenKeys = new Set(clientFirstSeenRows.map(intervalRowKey))
  const detailRows = summarizeDayDetailRows(
    dayDetail,
    day.day,
    clientFirstSeenKeys
  )

  return (
    <>
      <div className='v9-tip-head'>{formatDayLabel(day.day)}</div>
      {providerRows.map(([key, count]) => {
        const providerLabel = labelMap.get(key) ?? key
        const pct = day.total > 0 ? ((count / day.total) * 100).toFixed(0) : '0'
        return (
          <div
            key={key}
            className='v9-tip-row'
            style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
          >
            <span className='t-model'>{providerLabel}</span>
            <span className='t-count'>
              {formatCompactNumber(count)} ({pct}%)
            </span>
          </div>
        )
      })}
      {modelFirstSeenRows.length > 0 && (
        <div className='v9-tip-head' style={{ marginTop: '6px' }}>
          models first seen
        </div>
      )}
      {modelFirstSeenRows.slice(0, 8).map((marker) => (
        <div
          key={`${marker.provider}|${marker.model}|${marker.firstSeenDay}|${marker.firstSeenHour.toString()}`}
          className='v9-tip-row'
          style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
        >
          <span className='t-count'>
            {marker.firstSeenHour.toString().padStart(2, '0')}:00
          </span>
          <span className='t-model'>{marker.model}</span>
          <span className='t-count'>{marker.provider}</span>
        </div>
      ))}
      {modelFirstSeenRows.length > 8 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-count'>
            +{modelFirstSeenRows.length - 8} more models
          </span>
        </div>
      )}
      {clientFirstSeenRows.length > 0 && (
        <div className='v9-tip-head' style={{ marginTop: '6px' }}>
          client versions first seen
        </div>
      )}
      {clientFirstSeenRows.slice(0, 8).map((row) => (
        <div
          key={intervalRowKey(row)}
          className='v9-tip-row'
          style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
        >
          <span className='t-count'>
            {typeof row.first_seen_hour === 'number'
              ? `${row.first_seen_hour.toString().padStart(2, '0')}:00`
              : '--'}
          </span>
          <span className='t-model'>
            {formatVersionLabel(row.client_name, row.client_version)}
          </span>
          <span className='t-count'>{canonicalProvider(row.provider)}</span>
        </div>
      ))}
      {clientFirstSeenRows.length > 8 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-count'>
            +{clientFirstSeenRows.length - 8} more client versions
          </span>
        </div>
      )}
      {clientFirstSeenRows.length === 0 && detailRows.length > 0 && (
        <div className='v9-tip-head' style={{ marginTop: '6px' }}>
          active versions
        </div>
      )}
      {clientFirstSeenRows.length === 0 &&
        detailRows.slice(0, 8).map((row) => (
          <div
            key={versionRowKey(row)}
            className='v9-tip-row'
            style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
          >
            <span className='t-count'>{canonicalProvider(row.provider)}</span>
            <span className='t-model'>
              {formatVersionLabel(row.client_name, row.client_version)}
            </span>
            <span className='t-count'>
              {formatCompactNumber(row.token_total)}
            </span>
          </div>
        ))}
      {clientFirstSeenRows.length === 0 && detailRows.length > 8 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-count'>
            +{detailRows.length - 8} more versions
          </span>
        </div>
      )}
      {clientFirstSeenRows.length === 0 &&
        detailRows.length === 0 &&
        detailLoading === true && (
          <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
            <span className='t-model' style={{ color: 'var(--fg-muted)' }}>
              loading version detail
            </span>
          </div>
        )}
      {providerRows.length === 0 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-model' style={{ color: 'var(--fg-muted)' }}>
            no data
          </span>
        </div>
      )}
    </>
  )
}

interface TokenScaleTick {
  value: number
  pct: number
  label: string
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildTokenScaleTicks(maxValue: number): TokenScaleTick[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return []

  const floorTickValue = maxValue * 0.005

  return [
    {
      value: floorTickValue,
      pct: tokenTrendDayHeightPct(floorTickValue, maxValue),
    },
    { value: maxValue * 0.25, pct: 25 },
    { value: maxValue * 0.5, pct: 50 },
    { value: maxValue, pct: 100 },
  ].map((tick) => ({
    ...tick,
    label: formatCompactNumber(tick.value),
  }))
}

function renderTokenScaleMarkers(ticks: readonly TokenScaleTick[]): ReactNode {
  if (ticks.length === 0) return null

  return ticks.map((tick) => (
    <div
      key={`${tick.pct.toString()}-${tick.label}`}
      className='tt-token-scale-marker'
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: `${tick.pct.toFixed(3)}%`,
        borderTop:
          '1px solid color-mix(in srgb, var(--fg-muted) 20%, transparent)',
        pointerEvents: 'none',
        zIndex: 2,
      }}
      aria-hidden='true'
    >
      <span
        className='tt-token-scale-label'
        style={{
          position: 'absolute',
          left: '4px',
          top: '-1px',
          transform: 'translateY(-50%)',
          padding: '0 3px',
          borderRadius: '3px',
          background: 'color-mix(in srgb, var(--card) 88%, transparent)',
          color: 'var(--fg-muted)',
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          lineHeight: 1.1,
          letterSpacing: '0',
        }}
      >
        {tick.label}
      </span>
    </div>
  ))
}

function metricScaleUnit(mode: Exclude<LowerLaneMode, 'tui'>): string {
  return mode === 'requests' ? 'req' : 'tools'
}

function buildMetricScaleTicks(
  maxValue: number,
  mode: Exclude<LowerLaneMode, 'tui'>
): TokenScaleTick[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return []

  return [25, 50, 75, 100].map((pct) => ({
    value: maxValue * (pct / 100),
    pct,
    label: `${formatCompactNumber(maxValue * (pct / 100))} ${metricScaleUnit(mode)}`,
  }))
}

function renderMetricScaleMarkers(ticks: readonly TokenScaleTick[]): ReactNode {
  if (ticks.length === 0) return null

  return ticks.map((tick) => (
    <div
      key={`metric-${tick.pct.toString()}-${tick.label}`}
      className='tt-metric-scale-marker'
      style={{ top: `${tick.pct.toFixed(3)}%` }}
      aria-hidden='true'
    >
      <span className='tt-metric-scale-label'>{tick.label}</span>
    </div>
  ))
}

function renderDayStripeLayer(dayCount: number): ReactNode {
  if (dayCount <= 0) return null

  return (
    <div className='tt-day-stripe-layer' aria-hidden='true'>
      {Array.from({ length: dayCount }, (_, index) => (
        <div
          key={`day-stripe-${index.toString()}`}
          className={
            index % 2 === 0 ? 'tt-day-stripe is-even' : 'tt-day-stripe is-odd'
          }
        />
      ))}
    </div>
  )
}

function dayBandClass(index: number): 'is-even' | 'is-odd' {
  return index % 2 === 0 ? 'is-even' : 'is-odd'
}

function dayEnvelopeBackground(index: number): string {
  return index % 2 === 0
    ? 'color-mix(in srgb, var(--card) 90%, var(--fg-muted) 10%)'
    : 'color-mix(in srgb, var(--card) 82%, var(--fg-muted) 18%)'
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseTrendDayHour(value: string | null | undefined): {
  day: string
  hour: number | null
} | null {
  if (value == null || value.trim() === '') return null

  // Check for an explicit UTC-offset suffix (e.g. "T23:30:00-04:00" or "+05:30").
  // When present, derive both day and hour from the parsed UTC timestamp so
  // they are always consistent with each other.
  const hasOffset = /[T\s]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(
    value.trim()
  )
  if (hasOffset) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const utcDay = parsed.toISOString().slice(0, 10)
    return { day: utcDay, hour: parsed.getUTCHours() }
  }

  // No offset — treat as a plain "local-looking" string.
  const dayMatch = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dayMatch === null) return null

  const localHourMatch = value.match(/^\d{4}-\d{2}-\d{2}[T\s](\d{2})/)
  if (localHourMatch !== null) {
    const hour = Number.parseInt(localHourMatch[1], 10)
    // Reject out-of-range hours (e.g. hour=99 from bad DB rows).
    if (hour < 0 || hour > 23) return null
    return { day: dayMatch[1], hour }
  }

  const hasTime = value.includes('T') || /\d{2}:\d{2}/.test(value)
  if (!hasTime) return { day: dayMatch[1], hour: null }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { day: dayMatch[1], hour: null }
  return { day: dayMatch[1], hour: parsed.getUTCHours() }
}

function finiteMetricValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function healthMetricValue(
  metric: TrendMetricDefinition,
  row: UsageReportProviderLatencyHealthRow
): number | null {
  switch (metric.key) {
    case 'requests':
      return finiteMetricValue(row.requests)
    case 'errors':
      return (
        (finiteMetricValue(row.provider_error_events) ?? 0) +
        (finiteMetricValue(row.provider_5xx_events) ?? 0) +
        (finiteMetricValue(row.provider_timeout_events) ?? 0) +
        (finiteMetricValue(row.network_error_events) ?? 0) +
        (finiteMetricValue(row.auth_failed_events) ?? 0) +
        (finiteMetricValue(row.adapter_error_events) ?? 0)
      )
    case 'rate_limits':
      return finiteMetricValue(row.rate_limit_events)
    case 'latency':
      return (
        finiteMetricValue(row.upstream_p95_ms) ??
        finiteMetricValue(row.total_p95_ms)
      )
    case 'probes':
      return finiteMetricValue(row.status_probe_count)
    default:
      return null
  }
}

function healthMetricWeight(
  metric: TrendMetricDefinition,
  row: UsageReportProviderLatencyHealthRow
): number {
  if (metric.kind !== 'latency') return 1
  const requests = finiteMetricValue(row.requests) ?? 0
  return Math.max(1, requests)
}

function invertedIncidentScore(
  value: number | null | undefined
): number | null {
  const score = finiteMetricValue(value)
  if (score === null) return null
  return 1 - normalizeMetricScore(score)
}

function scoreMetricValue(
  metric: TrendMetricDefinition,
  row: UsageReportTokenTrendScoreRow
): number | null {
  switch (metric.key) {
    case 'evaluated':
      return finiteMetricValue(row.agent_score_rows)
    case 'quality':
      return finiteMetricValue(row.agent_quality_score)
    case 'instruction':
      return finiteMetricValue(row.agent_instruction_score)
    case 'tool':
      return finiteMetricValue(row.agent_tool_score)
    case 'contract':
      return finiteMetricValue(row.agent_contract_score)
    case 'progress':
      return finiteMetricValue(row.agent_progress_score)
    case 'risk':
      return finiteMetricValue(row.agent_risk_score)
    case 'ignored_path':
      return finiteMetricValue(row.agent_ignored_path_tracking_policy_score)
    case 'baseline_clear':
      return invertedIncidentScore(
        row.agent_baseline_deflection_attempted_score
      )
    case 'sleep_clear':
      return invertedIncidentScore(
        row.agent_sleep_wellness_interruption_attempted_score
      )
    default:
      return null
  }
}

function scoreMetricWeight(
  metric: TrendMetricDefinition,
  row: UsageReportTokenTrendScoreRow
): number {
  const fallback = 1
  switch (metric.key) {
    case 'quality':
      return finiteMetricValue(row.agent_quality_evaluated) ?? fallback
    case 'instruction':
      return finiteMetricValue(row.agent_instruction_evaluated) ?? fallback
    case 'tool':
      return finiteMetricValue(row.agent_tool_evaluated) ?? fallback
    case 'contract':
      return finiteMetricValue(row.agent_contract_evaluated) ?? fallback
    case 'progress':
      return finiteMetricValue(row.agent_progress_evaluated) ?? fallback
    case 'risk':
      return finiteMetricValue(row.agent_risk_evaluated) ?? fallback
    case 'ignored_path':
      return (
        finiteMetricValue(row.agent_ignored_path_tracking_policy_evaluated) ??
        fallback
      )
    case 'baseline_clear':
      return (
        finiteMetricValue(row.agent_baseline_deflection_attempted_evaluated) ??
        fallback
      )
    case 'sleep_clear':
      return (
        finiteMetricValue(
          row.agent_sleep_wellness_interruption_attempted_evaluated
        ) ?? fallback
      )
    default:
      return fallback
  }
}

function normalizeMetricScore(value: number): number {
  if (value > 1) return Math.min(1, Math.max(0, value / 100))
  return Math.min(1, Math.max(0, value))
}

function deriveTrendScopeOptions(
  series: readonly ProviderSeries[],
  healthRows: readonly UsageReportProviderLatencyHealthRow[],
  scoreRows: readonly UsageReportTokenTrendScoreRow[]
): TrendScopeOption[] {
  const providerModels = new Map<string, Set<string>>()
  for (const provider of series.map((item) => canonicalProvider(item.key))) {
    providerModels.set(provider, providerModels.get(provider) ?? new Set())
  }

  const add = (
    providerRaw: string | undefined,
    modelRaw: string | undefined
  ) => {
    if (providerRaw === undefined || providerRaw.trim() === '') return
    const provider = canonicalProvider(providerRaw)
    const models = providerModels.get(provider) ?? new Set<string>()
    if (modelRaw !== undefined && modelRaw.trim() !== '') {
      models.add(modelRaw)
    }
    providerModels.set(provider, models)
  }

  for (const row of healthRows) add(row.provider, row.model)
  for (const row of scoreRows) add(row.provider, row.model)

  const options: TrendScopeOption[] = [
    { key: 'all', label: 'All', provider: null, model: null, depth: 0 },
  ]
  for (const [provider, models] of [...providerModels.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    options.push({
      key: `provider:${provider}`,
      label: provider,
      provider,
      model: null,
      depth: 1,
    })
    for (const model of [...models].sort()) {
      options.push({
        key: `model:${provider}:${model}`,
        label: model,
        provider,
        model,
        depth: 2,
      })
    }
  }

  return options
}

function selectedKeysMatchScope(
  selectedKeys: readonly string[],
  providerRaw: string | undefined,
  modelRaw: string | undefined
): boolean {
  if (selectedKeys.includes('all')) return true
  if (selectedKeys.length === 0) return false
  const provider = canonicalProvider(providerRaw ?? '')
  const model = modelRaw ?? ''
  return selectedKeys.some((key) => {
    if (key === `provider:${provider}`) return true
    return model !== '' && key === `model:${provider}:${model}`
  })
}

function updateMultiSelectKeys(
  selectedKeys: readonly string[],
  key: string,
  checked: boolean
): string[] {
  if (key === 'all') return checked ? ['all'] : []
  const next = new Set(selectedKeys.filter((item) => item !== 'all'))
  if (checked) {
    next.add(key)
  } else {
    next.delete(key)
  }
  return [...next]
}

function summarizeSelectedOptions(
  selectedKeys: readonly string[],
  options: readonly { key: string; label: string }[],
  fallback: string
): string {
  if (selectedKeys.includes('all')) return 'All'
  if (selectedKeys.length === 0) return fallback
  const labels = selectedKeys
    .map((key) => options.find((option) => option.key === key)?.label)
    .filter((label): label is string => label !== undefined)
  if (labels.length === 0) return fallback
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} +${(labels.length - 2).toString()}`
}

function metricDefinitionsForMode(
  mode: TrendSignalMode
): TrendMetricDefinition[] {
  return mode === 'health' ? HEALTH_TREND_METRICS : SCORE_TREND_METRICS
}

function selectedMetricDefinitions(
  mode: TrendSignalMode,
  selectedKeys: readonly string[]
): TrendMetricDefinition[] {
  const definitions = metricDefinitionsForMode(mode)
  if (selectedKeys.includes('all')) return definitions
  if (selectedKeys.length === 0) return []
  return definitions.filter((definition) =>
    selectedKeys.includes(definition.key)
  )
}

function addSignalValue(
  cells: Map<string, { sum: number; weight: number; samples: number }>,
  metric: TrendMetricDefinition,
  day: string,
  hour: number,
  value: number,
  weight = 1
): void {
  const key = `${metric.key}|${day}|${hour.toString()}`
  const existing = cells.get(key) ?? { sum: 0, weight: 0, samples: 0 }
  if (metric.kind === 'count') {
    existing.sum += value
    existing.weight = 1
  } else {
    existing.sum += value * weight
    existing.weight += weight
  }
  existing.samples += 1
  cells.set(key, existing)
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildTrendSignalRows({
  mode,
  dayEnvelopes,
  healthRows,
  scoreRows,
  selectedScopeKeys,
  selectedMetrics,
}: {
  mode: TrendSignalMode
  dayEnvelopes: readonly TokenTrendDayEnvelope[]
  healthRows: readonly UsageReportProviderLatencyHealthRow[]
  scoreRows: readonly UsageReportTokenTrendScoreRow[]
  selectedScopeKeys: readonly string[]
  selectedMetrics: readonly TrendMetricDefinition[]
}): { rows: TrendSignalRow[]; sourceRowCount: number } {
  const days = new Set(dayEnvelopes.map((day) => day.day))
  const mutableCells = new Map<
    string,
    { sum: number; weight: number; samples: number }
  >()
  let sourceRowCount = 0

  if (mode === 'health') {
    for (const row of healthRows) {
      if (!selectedKeysMatchScope(selectedScopeKeys, row.provider, row.model)) {
        continue
      }
      const parsed = parseTrendDayHour(row.bucket_start)
      if (parsed === null || parsed.hour === null || !days.has(parsed.day)) {
        continue
      }
      sourceRowCount += 1
      for (const metric of selectedMetrics) {
        const value = healthMetricValue(metric, row)
        if (value === null) continue
        addSignalValue(
          mutableCells,
          metric,
          parsed.day,
          parsed.hour,
          value,
          healthMetricWeight(metric, row)
        )
      }
    }
  } else {
    for (const row of scoreRows) {
      if (!selectedKeysMatchScope(selectedScopeKeys, row.provider, row.model)) {
        continue
      }
      const parsed = parseTrendDayHour(row.bucket)
      if (parsed === null || !days.has(parsed.day)) continue
      sourceRowCount += 1
      const hours =
        parsed.hour === null
          ? Array.from({ length: 24 }, (_, hour) => hour)
          : [parsed.hour]
      for (const metric of selectedMetrics) {
        const value = scoreMetricValue(metric, row)
        if (value === null) continue
        const normalized = normalizeMetricScore(value)
        const weight = Math.max(1, scoreMetricWeight(metric, row))
        for (const hour of hours) {
          addSignalValue(
            mutableCells,
            metric,
            parsed.day,
            hour,
            normalized,
            weight
          )
        }
      }
    }
  }

  const rows = selectedMetrics.map((metric) => {
    const grid: TrendSignalGrid = new Map()
    let maxValue = metric.kind === 'score' ? 1 : 0
    let hasData = false

    for (const [key, cell] of mutableCells.entries()) {
      const [metricKey, day, hourText] = key.split('|')
      if (
        metricKey !== metric.key ||
        day === undefined ||
        hourText === undefined
      ) {
        continue
      }
      const hour = Number.parseInt(hourText, 10)
      const value =
        metric.kind === 'count'
          ? cell.sum
          : cell.weight > 0
            ? cell.sum / cell.weight
            : null
      if (value === null || !Number.isFinite(value)) continue
      const dayMap = grid.get(day) ?? new Map<number, TrendSignalValue>()
      dayMap.set(hour, { value, samples: cell.samples })
      grid.set(day, dayMap)
      maxValue = Math.max(maxValue, value)
      hasData = true
    }

    return { metric, grid, maxValue, hasData }
  })

  return { rows, sourceRowCount }
}

function formatTrendSignalValue(
  metric: TrendMetricDefinition,
  value: number | null
): string {
  if (value === null) return 'no data'
  if (metric.kind === 'score') return `${Math.round(value * 100).toString()}%`
  if (metric.kind === 'latency') return `${Math.round(value).toString()} ms`
  return formatCompactNumber(value)
}

function buildTrendSignalEnvelopes(
  rows: readonly TrendSignalRow[],
  dayEnvelopes: readonly TokenTrendDayEnvelope[]
): TrendSignalDay[] {
  return dayEnvelopes.map((day) => {
    const hours = Array.from({ length: 24 }, (_, hour): TrendSignalHour => {
      const slices = rows
        .map((row): TrendSignalSlice | null => {
          const cell = row.grid.get(day.day)?.get(hour)
          const value = cell?.value ?? null
          if (value === null || row.maxValue <= 0) return null
          const scaleValue = Math.max(0, value / row.maxValue)
          if (scaleValue <= 0) return null
          return {
            metric: row.metric,
            value,
            scaleValue,
            samples: cell?.samples ?? 0,
          }
        })
        .filter((slice): slice is TrendSignalSlice => slice !== null)
      return {
        day: day.day,
        hour,
        total: slices.reduce((sum, slice) => sum + slice.scaleValue, 0),
        slices,
      }
    })
    const total = hours.reduce((sum, hour) => sum + hour.total, 0)
    return {
      day: day.day,
      label: day.label,
      total,
      maxHourTotal: Math.max(0, ...hours.map((hour) => hour.total)),
      hours,
    }
  })
}

function formatTrendSignalHourTitle(hour: TrendSignalHour): string {
  const details = hour.slices.map(
    (slice) =>
      `${slice.metric.label}: ${formatTrendSignalValue(slice.metric, slice.value)}`
  )
  const prefix = `${formatDayLabel(hour.day)} ${hour.hour
    .toString()
    .padStart(2, '0')}:00`
  return details.length > 0 ? `${prefix} · ${details.join(' · ')}` : prefix
}

function renderTrendSignalGraph(
  rows: readonly TrendSignalRow[],
  dayEnvelopes: readonly TokenTrendDayEnvelope[]
): ReactNode {
  const metricRows = rows.filter((row) => row.hasData)
  const signalDays = buildTrendSignalEnvelopes(metricRows, dayEnvelopes)
  const maxDayTotal = Math.max(0, ...signalDays.map((day) => day.total))

  return (
    <>
      <div className='tt-signal-legend'>
        {metricRows.map((row) => (
          <span key={row.metric.key} className='tt-signal-legend-item'>
            <span
              className='tt-signal-legend-swatch'
              style={{ background: row.metric.color }}
            />
            <span>{row.metric.shortLabel}</span>
          </span>
        ))}
      </div>
      <div className='tt-signal-graph'>
        {renderDayStripeLayer(signalDays.length)}
        {signalDays.map((day, dayIndex) => {
          const dayHeightPct = tokenTrendDayHeightPct(day.total, maxDayTotal)
          return (
            <div
              key={`signal-${day.day}`}
              className={`tt-signal-day-shell ${dayBandClass(dayIndex)}`}
              data-day={day.day}
            >
              <div
                className='tt-signal-day-envelope'
                style={{ height: `${dayHeightPct.toFixed(1)}%` }}
              >
                {day.hours.map((hour) => {
                  const hourHeightPct = tokenTrendHourHeightPct(
                    hour.total,
                    day.maxHourTotal
                  )
                  return (
                    <div
                      key={`signal-${day.day}-${hour.hour.toString()}`}
                      className='tt-signal-hour-cell'
                      title={formatTrendSignalHourTitle(hour)}
                    >
                      <div
                        className='tt-signal-hour-bar'
                        style={{ height: `${hourHeightPct.toFixed(1)}%` }}
                      >
                        {hour.slices.map((slice) => {
                          const pct =
                            hour.total > 0
                              ? (slice.scaleValue / hour.total) * 100
                              : 0
                          return (
                            <span
                              key={slice.metric.key}
                              className='tt-signal-slice'
                              style={{
                                flexBasis: `${pct.toFixed(4)}%`,
                                background: slice.metric.color,
                              }}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function formatVersionHour(day: string | null, hour: number | null): string {
  if (day === null || hour === null) return '--'
  return `${formatDayLabel(day)} ${hour.toString().padStart(2, '0')}:00`
}

function formatVersionSegmentTitle(
  segment: TokenTrendActiveVersionSegment
): string {
  const clientLabel =
    segment.clientNames.length > 0
      ? segment.clientNames.join(', ')
      : segment.clientName
  const providerLabel =
    segment.providers.length > 0
      ? segment.providers.join(', ')
      : segment.provider
  return [
    formatVersionLabel(clientLabel, segment.clientVersion),
    `providers ${providerLabel}`,
    `${formatVersionHour(segment.firstSeenDay, segment.firstSeenHour)} -> ${formatVersionHour(
      segment.lastSeenDay,
      segment.lastSeenHour
    )}`,
    `${formatCompactNumber(segment.tokenTotal)} tokens`,
  ].join(' · ')
}

function formatVersionSegmentText(
  segment: TokenTrendActiveVersionSegment
): string {
  const version = segment.clientVersion.trim()
  if (version !== '' && version !== '0.0.0') return version
  return segment.clientName
}

function formatModelFirstSeenDayMarker(
  marker: TokenTrendModelFirstSeenMarker
): string {
  return `${marker.firstSeenHour.toString().padStart(2, '0')}:00 ${marker.provider} ${marker.model}`
}

function formatModelFirstSeenDayTitle(
  day: string,
  markers: readonly TokenTrendModelFirstSeenMarker[]
): string {
  const details = markers
    .slice(0, 6)
    .map((marker) => formatModelFirstSeenDayMarker(marker))
  const suffix =
    markers.length > details.length
      ? ` · +${(markers.length - details.length).toString()} more`
      : ''
  return [
    `${markers.length.toString()} model${markers.length === 1 ? '' : 's'} first seen on ${formatDayLabel(day)}`,
    `${details.join(' · ')}${suffix}`,
  ].join(' · ')
}

function groupModelFirstSeenMarkersByDay(
  groups: readonly TokenTrendModelFirstSeenGroup[]
): Map<string, TokenTrendModelFirstSeenMarker[]> {
  const byDay = new Map<string, TokenTrendModelFirstSeenMarker[]>()

  for (const group of groups) {
    const dayMarkers = byDay.get(group.day)
    if (dayMarkers === undefined) {
      byDay.set(group.day, [...group.markers])
      continue
    }

    dayMarkers.push(...group.markers)
  }

  for (const markers of byDay.values()) {
    markers.sort(
      (a, b) =>
        a.firstSeenHour - b.firstSeenHour ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model)
    )
  }

  return byDay
}

function renderModelFirstSeenDayOutline(
  day: string,
  markers: readonly TokenTrendModelFirstSeenMarker[]
): ReactNode {
  if (markers.length === 0) return null

  const title = formatModelFirstSeenDayTitle(day, markers)

  return (
    <div
      className='tt-model-first-seen-column'
      role='img'
      aria-label={title}
      title={title}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        border: '1px solid color-mix(in srgb, #c084fc 70%, transparent)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  )
}

const ACTIVE_VERSION_ROW_HEIGHT_PX = 18
const ACTIVE_VERSION_VIEW_ROW_HEIGHT = 18
const ACTIVE_VERSION_INLINE_LABEL_MIN_WIDTH_PCT = 1.2

function renderActiveVersionLanes(
  lanes: readonly TokenTrendActiveVersionFamilyLane[],
  widthUnits: number,
  dayCount: number,
  heightPx: number
): ReactNode {
  const hasSegments = lanes.some((lane) => lane.segments.length > 0)
  if (!hasSegments || widthUnits <= 0) {
    return (
      <div
        className='tt-active-version-lane is-empty'
        aria-label='Active client versions by provider family'
        style={{ height: `${heightPx.toString()}px` }}
      >
        {renderDayStripeLayer(dayCount)}
        <span>no version data</span>
      </div>
    )
  }

  return (
    <div
      className='tt-active-version-lane'
      aria-label='Active client versions by provider family'
      style={{
        height: `${heightPx.toString()}px`,
        padding: '6px 8px',
        border: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--card) 94%, var(--fg-muted) 6%)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
        isolation: 'isolate',
      }}
    >
      {renderDayStripeLayer(dayCount)}
      {lanes.map((lane, laneIndex) => {
        const separatorHeight = laneIndex === 0 ? 0 : 7
        const trackHeight = Math.max(
          14,
          lane.rowCount * ACTIVE_VERSION_ROW_HEIGHT_PX + 2
        )
        const viewHeight = Math.max(
          ACTIVE_VERSION_VIEW_ROW_HEIGHT,
          lane.rowCount * ACTIVE_VERSION_VIEW_ROW_HEIGHT
        )

        return (
          <div
            key={lane.key}
            className='tt-active-version-family'
            style={{
              position: 'relative',
              height: `${(trackHeight + separatorHeight).toString()}px`,
              marginTop: laneIndex === 0 ? 0 : '3px',
              paddingTop: `${separatorHeight.toString()}px`,
              borderTop:
                laneIndex === 0
                  ? '0'
                  : '1px solid color-mix(in srgb, var(--fg-muted) 28%, transparent)',
              background:
                laneIndex % 2 === 0
                  ? 'color-mix(in srgb, var(--card) 82%, transparent)'
                  : 'color-mix(in srgb, var(--fg-muted) 7%, transparent)',
              boxSizing: 'border-box',
              zIndex: 1,
            }}
          >
            <div
              className='tt-active-version-family-label'
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 4,
                minWidth: '42px',
                padding: '1px 4px',
                borderRadius: '3px',
                background: 'color-mix(in srgb, var(--card) 92%, transparent)',
                color: 'var(--fg-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                lineHeight: 1.1,
                letterSpacing: '0',
              }}
            >
              {lane.label}
            </div>
            <div
              className='tt-active-version-track'
              style={{
                position: 'relative',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
              }}
            >
              <svg
                className='tt-active-version-svg'
                viewBox={`0 0 ${widthUnits.toString()} ${viewHeight.toString()}`}
                preserveAspectRatio='none'
                aria-hidden='true'
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  zIndex: 2,
                }}
              >
                {Array.from({ length: dayCount + 1 }, (_, index) => (
                  <line
                    key={`grid-${lane.key}-${index.toString()}`}
                    className='tt-active-version-day-line'
                    x1={index * 24}
                    x2={index * 24}
                    y1={0}
                    y2={viewHeight}
                    stroke='color-mix(in srgb, var(--border) 56%, transparent)'
                    strokeWidth={0.5}
                    vectorEffect='non-scaling-stroke'
                  />
                ))}
                {lane.segments.map((segment) => {
                  const y =
                    segment.rowIndex * ACTIVE_VERSION_VIEW_ROW_HEIGHT + 5
                  const title = formatVersionSegmentTitle(segment)
                  return (
                    <g key={`${segment.id}|line`}>
                      <title>{title}</title>
                      <line
                        className='tt-active-version-line'
                        x1={segment.xStart}
                        x2={segment.xEnd}
                        y1={y}
                        y2={y}
                        stroke={resolveSliceColor(segment.provider, '')}
                        strokeWidth={4}
                        strokeLinecap='round'
                        strokeOpacity={0.9}
                        vectorEffect='non-scaling-stroke'
                      />
                      <circle
                        className='tt-active-version-release-dot'
                        cx={segment.releaseX}
                        cy={y}
                        r={1.05}
                        fill={resolveSliceColor(segment.provider, '')}
                        stroke='var(--card)'
                        strokeWidth={0.72}
                        vectorEffect='non-scaling-stroke'
                      />
                    </g>
                  )
                })}
              </svg>
              {lane.segments.map((segment) => {
                const leftPct = (segment.xStart / widthUnits) * 100
                const widthPct =
                  ((segment.xEnd - segment.xStart) / widthUnits) * 100
                const isShortLabel =
                  widthPct < ACTIVE_VERSION_INLINE_LABEL_MIN_WIDTH_PCT
                const midpointPct =
                  ((segment.xStart + segment.xEnd) / 2 / widthUnits) * 100
                const topPx =
                  segment.rowIndex * ACTIVE_VERSION_ROW_HEIGHT_PX +
                  (isShortLabel ? 9 : 1)

                return (
                  <div
                    key={`${segment.id}|label`}
                    className={
                      isShortLabel
                        ? 'tt-active-version-segment-label is-under'
                        : 'tt-active-version-segment-label'
                    }
                    title={formatVersionSegmentTitle(segment)}
                    style={{
                      position: 'absolute',
                      left: isShortLabel
                        ? `clamp(24px, ${midpointPct.toFixed(4)}%, calc(100% - 24px))`
                        : `${leftPct.toFixed(4)}%`,
                      top: `${topPx.toString()}px`,
                      width: isShortLabel
                        ? '48px'
                        : `${Math.max(widthPct, 0.8).toFixed(4)}%`,
                      height: '9px',
                      padding: '0 3px',
                      borderRadius: '3px',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--fg)',
                      background:
                        'color-mix(in srgb, var(--card) 82%, transparent)',
                      border:
                        '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '8px',
                      lineHeight: '8px',
                      letterSpacing: '0',
                      pointerEvents: 'auto',
                      transform: isShortLabel ? 'translateX(-50%)' : undefined,
                      zIndex: 3,
                    }}
                  >
                    {formatVersionSegmentText(segment)}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function metricLaneTitle(mode: Exclude<LowerLaneMode, 'tui'>): string {
  return mode === 'requests' ? 'Requests' : 'Tool calls'
}

function buildMetricDayTooltip(
  day: TokenTrendDayEnvelope,
  series: readonly ProviderSeries[],
  mode: Exclude<LowerLaneMode, 'tui'>
): ReactNode {
  const labelMap = new Map<string, string>(series.map((s) => [s.key, s.label]))
  const rows = Object.entries(day.totals)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  return (
    <>
      <div className='v9-tip-head'>
        {formatDayLabel(day.day)} · {metricLaneTitle(mode)}
      </div>
      {rows.map(([key, count]) => {
        const pct = day.total > 0 ? ((count / day.total) * 100).toFixed(0) : '0'
        return (
          <div
            key={key}
            className='v9-tip-row'
            style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
          >
            <span className='t-model'>{labelMap.get(key) ?? key}</span>
            <span className='t-count'>
              {formatCompactNumber(count)} ({pct}%)
            </span>
          </div>
        )
      })}
      {rows.length === 0 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-model' style={{ color: 'var(--fg-muted)' }}>
            no data
          </span>
        </div>
      )}
    </>
  )
}

function renderMetricLowerLane(
  mode: Exclude<LowerLaneMode, 'tui'>,
  envelopes: readonly TokenTrendDayEnvelope[],
  series: readonly ProviderSeries[],
  heightPx: number
): ReactNode {
  if (envelopes.length === 0) {
    return (
      <div
        className={`tt-metric-lane tt-metric-lane-${mode} is-empty`}
        aria-label={`${metricLaneTitle(mode)} by day and hour, stacked by provider`}
        style={{ height: `${heightPx.toString()}px` }}
      >
        <span>no {metricLaneTitle(mode).toLowerCase()} data</span>
      </div>
    )
  }

  const maxDayTotal = Math.max(0, ...envelopes.map((day) => day.total))
  const scaleTicks = buildMetricScaleTicks(maxDayTotal, mode)

  return (
    <div
      className={`tt-metric-lane tt-metric-lane-${mode}`}
      aria-label={`${metricLaneTitle(mode)} by day and hour, stacked by provider`}
      style={{ height: `${heightPx.toString()}px` }}
    >
      {renderDayStripeLayer(envelopes.length)}
      {renderMetricScaleMarkers(scaleTicks)}
      {envelopes.map((day, dayIndex) => {
        const dayHeightPct = tokenTrendDayHeightPct(day.total, maxDayTotal)
        const dayShell = (
          <div
            className={`tt-metric-day-shell ${dayBandClass(dayIndex)}`}
            data-day={day.day}
          >
            <div
              className='tt-metric-day-envelope'
              style={{ height: `${dayHeightPct.toFixed(1)}%` }}
            >
              {day.hours.map((hourBucket) => {
                const hourHeightPct = tokenTrendHourHeightPct(
                  hourBucket.total,
                  day.maxHourTotal
                )
                return (
                  <div
                    key={`${mode}-${hourBucket.day}-${hourBucket.hour.toString()}`}
                    className='tt-metric-hour-cell'
                  >
                    <div
                      className='tt-metric-hour-bar'
                      style={{ height: `${hourHeightPct.toFixed(1)}%` }}
                    >
                      {series.map((s) => {
                        const value = hourBucket.totals[s.key] ?? 0
                        if (value <= 0) return null
                        const pct =
                          hourBucket.total > 0
                            ? (value / hourBucket.total) * 100
                            : 0
                        return (
                          <div
                            key={s.key}
                            className={`tt-slice ${s.cssClass}`}
                            style={{
                              flexBasis: `${pct.toFixed(4)}%`,
                              flexShrink: 0,
                              minHeight: '1px',
                              width: '100%',
                              background: resolveSliceColor(s.key, s.color),
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )

        return (
          <HoverTooltip
            key={`${mode}-${day.day}`}
            content={buildMetricDayTooltip(day, series, mode)}
            variant='quota'
            className='tt-day-tip-wrap'
          >
            {dayShell}
          </HoverTooltip>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One time bucket with per-provider token totals. */
export interface TrendBucket {
  label: string
  totals: Record<string, number>
}

/** Series configuration for one provider in the chart. */
export interface ProviderSeries {
  key: string
  label: string
  color: string
  cssClass: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TokenTrendChartProps {
  data?: TrendBucket[]
  series: ProviderSeries[]
  dayEnvelopes?: TokenTrendDayEnvelope[]
  requestDayEnvelopes?: TokenTrendDayEnvelope[]
  toolDayEnvelopes?: TokenTrendDayEnvelope[]
  dayEnvelopeRange?: TokenTrendDayEnvelopeRangeOptions
  versionIntervals?: UsageReportTokenTrendVersionIntervalRow[]
  modelFirstSeen?: UsageReportTokenTrendModelFirstSeenRow[]
  healthRows?: UsageReportProviderLatencyHealthRow[]
  scoreRows?: UsageReportTokenTrendScoreRow[]
  dayDetail?: UsageReportTokenTrendDayResponse | null
  detailLoading?: boolean
  onHourHover?: (target: { day: string; hour: number } | null) => void
  lowerLaneMode?: LowerLaneMode
  onLowerLaneModeChange?: (mode: LowerLaneMode) => void
}

export type LowerLaneMode = 'tui' | 'requests' | 'tools'

interface TrendSignalPanelProps {
  dayEnvelopes: readonly TokenTrendDayEnvelope[]
  series: readonly ProviderSeries[]
  healthRows: readonly UsageReportProviderLatencyHealthRow[]
  scoreRows: readonly UsageReportTokenTrendScoreRow[]
}

function TrendSignalPanel({
  dayEnvelopes,
  series,
  healthRows,
  scoreRows,
}: TrendSignalPanelProps): ReactElement {
  const [signalMode, setSignalMode] = useState<TrendSignalMode>('health')
  const [selectedScopeKeys, setSelectedScopeKeys] = useState<string[]>(['all'])
  const [selectedHealthMetricKeys, setSelectedHealthMetricKeys] = useState<
    string[]
  >(['all'])
  const [selectedScoreMetricKeys, setSelectedScoreMetricKeys] = useState<
    string[]
  >(['all'])
  const [openSignalMenu, setOpenSignalMenu] = useState<
    'scope' | 'metrics' | null
  >(null)
  const menuRootRef = useRef<HTMLDivElement | null>(null)
  const scopeOptions = useMemo(
    () => deriveTrendScopeOptions(series, healthRows, scoreRows),
    [series, healthRows, scoreRows]
  )
  const metricOptions = useMemo(
    () => [
      { key: 'all', label: 'All' },
      ...metricDefinitionsForMode(signalMode).map((metric) => ({
        key: metric.key,
        label: metric.label,
      })),
    ],
    [signalMode]
  )
  const selectedMetricKeys =
    signalMode === 'health' ? selectedHealthMetricKeys : selectedScoreMetricKeys
  const setSelectedMetricKeys =
    signalMode === 'health'
      ? setSelectedHealthMetricKeys
      : setSelectedScoreMetricKeys
  const selectedMetrics = useMemo(
    () => selectedMetricDefinitions(signalMode, selectedMetricKeys),
    [signalMode, selectedMetricKeys]
  )
  const signalRows = useMemo(
    () =>
      buildTrendSignalRows({
        mode: signalMode,
        dayEnvelopes,
        healthRows,
        scoreRows,
        selectedScopeKeys,
        selectedMetrics,
      }),
    [
      signalMode,
      dayEnvelopes,
      healthRows,
      scoreRows,
      selectedScopeKeys,
      selectedMetrics,
    ]
  )
  const visibleSignalRows = useMemo(
    () => signalRows.rows.filter((row) => row.hasData),
    [signalRows.rows]
  )
  const signalEmptyText =
    selectedMetrics.length === 0
      ? 'no selected metrics'
      : signalRows.sourceRowCount === 0
        ? 'no matching data'
        : visibleSignalRows.length === 0
          ? 'unavailable metric categories'
          : null
  const signalGraphContent = useMemo(
    () =>
      signalEmptyText === null ? (
        renderTrendSignalGraph(visibleSignalRows, dayEnvelopes)
      ) : (
        <div className='tt-signal-empty'>{signalEmptyText}</div>
      ),
    [dayEnvelopes, signalEmptyText, visibleSignalRows]
  )

  useEffect(() => {
    if (openSignalMenu === null) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRootRef.current?.contains(target)) return
      setOpenSignalMenu(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [openSignalMenu])

  return (
    <div
      className={`tt-signal-panel tt-signal-panel-${signalMode}`}
      aria-label='Trend health and score graph'
    >
      <div className='tt-signal-toolbar' ref={menuRootRef}>
        <div
          role='tablist'
          aria-label='Trend signal graph'
          className='tt-signal-tabs'
        >
          {(['health', 'score'] as const).map((mode) => (
            <button
              key={mode}
              type='button'
              role='tab'
              aria-selected={signalMode === mode}
              className={signalMode === mode ? 'is-active' : undefined}
              onClick={() => {
                setSignalMode(mode)
                setOpenSignalMenu(null)
              }}
            >
              {mode === 'health' ? 'Health' : 'Score'}
            </button>
          ))}
        </div>
        <div className='tt-multiselect'>
          <button
            type='button'
            className='tt-multiselect-trigger'
            aria-haspopup='true'
            aria-expanded={openSignalMenu === 'scope'}
            onClick={() => {
              setOpenSignalMenu((current) =>
                current === 'scope' ? null : 'scope'
              )
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpenSignalMenu(null)
            }}
          >
            Scope:{' '}
            {summarizeSelectedOptions(selectedScopeKeys, scopeOptions, 'None')}
          </button>
          <div
            role='group'
            aria-label='Trend scope options'
            hidden={openSignalMenu !== 'scope'}
          >
            {scopeOptions.map((option) => (
              <label
                key={option.key}
                className={`tt-multiselect-option depth-${option.depth.toString()}`}
              >
                <input
                  type='checkbox'
                  checked={selectedScopeKeys.includes(option.key)}
                  onChange={(event) => {
                    setSelectedScopeKeys(
                      updateMultiSelectKeys(
                        selectedScopeKeys,
                        option.key,
                        event.currentTarget.checked
                      )
                    )
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className='tt-multiselect'>
          <button
            type='button'
            className='tt-multiselect-trigger'
            aria-haspopup='true'
            aria-expanded={openSignalMenu === 'metrics'}
            onClick={() => {
              setOpenSignalMenu((current) =>
                current === 'metrics' ? null : 'metrics'
              )
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpenSignalMenu(null)
            }}
          >
            Metrics:{' '}
            {summarizeSelectedOptions(
              selectedMetricKeys,
              metricOptions,
              'None'
            )}
          </button>
          <div
            role='group'
            aria-label='Trend metric options'
            hidden={openSignalMenu !== 'metrics'}
          >
            {metricOptions.map((option) => (
              <label key={option.key} className='tt-multiselect-option'>
                <input
                  type='checkbox'
                  checked={selectedMetricKeys.includes(option.key)}
                  onChange={(event) => {
                    setSelectedMetricKeys(
                      updateMultiSelectKeys(
                        selectedMetricKeys,
                        option.key,
                        event.currentTarget.checked
                      )
                    )
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div
        className='tt-signal-chart'
        aria-label={`${signalMode === 'health' ? 'Health' : 'Score'} metrics by day and hour`}
      >
        {signalGraphContent}
      </div>
    </div>
  )
}

function createAlignedDayEnvelope(
  day: string,
  label: string
): TokenTrendDayEnvelope {
  return {
    day,
    label,
    totals: {},
    total: 0,
    maxHourTotal: 0,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      day,
      hour,
      label: `${hour.toString().padStart(2, '0')}:00`,
      totals: {},
      total: 0,
    })),
  }
}

function alignDayEnvelopesToRange(
  baseEnvelopes: readonly TokenTrendDayEnvelope[],
  envelopes: readonly TokenTrendDayEnvelope[]
): TokenTrendDayEnvelope[] {
  if (baseEnvelopes.length === 0 || envelopes.length === 0) {
    return [...envelopes]
  }

  const byDay = new Map(envelopes.map((envelope) => [envelope.day, envelope]))
  return baseEnvelopes.map(
    (baseEnvelope) =>
      byDay.get(baseEnvelope.day) ??
      createAlignedDayEnvelope(baseEnvelope.day, baseEnvelope.label)
  )
}

// ---------------------------------------------------------------------------
// TokenTrendChart
// ---------------------------------------------------------------------------

/**
 * TokenTrendChart renders a stacked bar chart of token usage over time,
 * grouped by provider, with a legend strip and bucket label row below.
 *
 * Each bar has a hover tooltip (via {@link HoverTooltip}) showing the
 * bucket label and per-provider token breakdown sorted descending.
 * A label row underneath each bar displays `MM/DD` (ISO dates) or the
 * relative label (e.g. `"23h"`) as-is, with every-other-bar skipping
 * at 24 buckets to prevent text crowding.
 */
export function TokenTrendChart({
  data = [],
  series,
  dayEnvelopes,
  requestDayEnvelopes = [],
  toolDayEnvelopes = [],
  dayEnvelopeRange,
  versionIntervals = [],
  modelFirstSeen = [],
  healthRows = [],
  scoreRows = [],
  dayDetail,
  detailLoading = false,
  onHourHover,
  lowerLaneMode: lowerLaneModeProp,
  onLowerLaneModeChange,
}: TokenTrendChartProps): ReactElement {
  const [internalLowerLaneMode, setInternalLowerLaneMode] =
    useState<LowerLaneMode>('tui')
  const lastHourHoverRef = useRef<{ day: string; hour: number } | null>(null)
  const reportHourHover = useCallback(
    (target: { day: string; hour: number } | null): void => {
      if (target === null) {
        lastHourHoverRef.current = null
        onHourHover?.(null)
        return
      }
      const last = lastHourHoverRef.current
      if (last?.day === target.day && last.hour === target.hour) {
        return
      }
      lastHourHoverRef.current = target
      onHourHover?.(target)
    },
    [onHourHover]
  )
  void dayEnvelopeRange
  const lowerLaneMode = lowerLaneModeProp ?? internalLowerLaneMode
  const handleLowerLaneModeChange = (mode: LowerLaneMode): void => {
    if (lowerLaneModeProp === undefined) {
      setInternalLowerLaneMode(mode)
    }
    onLowerLaneModeChange?.(mode)
  }

  if (dayEnvelopes !== undefined) {
    const maxDayTotal = Math.max(0, ...dayEnvelopes.map((day) => day.total))
    const activeVersionLanes = deriveTokenTrendActiveVersionLanes(
      dayEnvelopes,
      versionIntervals
    )
    const alignedRequestDayEnvelopes = alignDayEnvelopesToRange(
      dayEnvelopes,
      requestDayEnvelopes
    )
    const alignedToolDayEnvelopes = alignDayEnvelopesToRange(
      dayEnvelopes,
      toolDayEnvelopes
    )
    const modelFirstSeenGroups = deriveTokenTrendModelFirstSeenGroups(
      dayEnvelopes,
      modelFirstSeen
    )
    const modelFirstSeenMarkersByDay =
      groupModelFirstSeenMarkersByDay(modelFirstSeenGroups)
    const hasActiveVersionLanes = activeVersionLanes.some(
      (lane) => lane.segments.length > 0
    )
    const hasActiveVersionLaneData = hasActiveVersionLanes
    const tokenScaleTicks = buildTokenScaleTicks(maxDayTotal)
    const widthUnits = Math.max(1, dayEnvelopes.length * 24)
    const labelStride =
      dayEnvelopes.length <= 14 ? 1 : Math.ceil(dayEnvelopes.length / 14)
    const chartHeightPx = dayEnvelopes.length >= 21 ? 224 : 196
    const lowerChartHeightPx = chartHeightPx

    return (
      <div
        aria-label='Token usage by day and hour, stacked by provider'
        style={{ width: '100%' }}
      >
        <TrendSignalPanel
          dayEnvelopes={dayEnvelopes}
          series={series}
          healthRows={healthRows}
          scoreRows={scoreRows}
        />

        <div
          className='token-trend-chart tt-day-chart'
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: '8px',
            height: `${chartHeightPx.toString()}px`,
            width: '100%',
            boxSizing: 'border-box',
            position: 'relative',
          }}
        >
          <div
            className='tt-day-strip'
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'flex-end',
              gap: '2px',
              height: '100%',
              width: '100%',
              overflow: 'hidden',
              isolation: 'isolate',
            }}
          >
            {renderDayStripeLayer(dayEnvelopes.length)}
            {renderTokenScaleMarkers(tokenScaleTicks)}
            {dayEnvelopes.map((day, dayIndex) => {
              const dayHeightPct = tokenTrendDayHeightPct(
                day.total,
                maxDayTotal
              )
              const dayModelMarkers =
                modelFirstSeenMarkersByDay.get(day.day) ?? []
              const hoverHour =
                day.hours.reduce(
                  (best, hour) => (hour.total > best.total ? hour : best),
                  day.hours[0] ?? {
                    day: day.day,
                    hour: 0,
                    label: '00:00',
                    totals: {},
                    total: 0,
                  }
                ).hour ?? 0

              const dayShell = (
                <div
                  className={`tt-day-hover-shell ${dayBandClass(dayIndex)}`}
                  data-day={day.day}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'flex-end',
                    minWidth: 0,
                    position: 'relative',
                    zIndex: 1,
                  }}
                  onPointerEnter={(event) => {
                    if (event.target !== event.currentTarget) return
                    reportHourHover({
                      day: day.day,
                      hour: hoverHour,
                    })
                  }}
                  onPointerLeave={() => {
                    reportHourHover(null)
                  }}
                >
                  <div
                    className='tt-day-envelope'
                    data-day={day.day}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      height: `${dayHeightPct.toFixed(1)}%`,
                      display: 'flex',
                      alignItems: 'flex-end',
                      position: 'relative',
                      border:
                        '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                      background: dayEnvelopeBackground(dayIndex),
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      className='tt-hour-row'
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: '1px',
                        height: '100%',
                        width: '100%',
                      }}
                    >
                      {day.hours.map((hourBucket) => {
                        const hourHeightPct = tokenTrendHourHeightPct(
                          hourBucket.total,
                          day.maxHourTotal
                        )

                        const hourBar = (
                          <div
                            className='tt-hour-bar trend-bar'
                            data-day={hourBucket.day}
                            data-hour={hourBucket.hour}
                            style={{
                              flex: '0 0 auto',
                              width: '100%',
                              height: `${hourHeightPct.toFixed(1)}%`,
                              display: 'flex',
                              flexDirection: 'column-reverse',
                              overflow: 'hidden',
                              minWidth: 0,
                              border: '0',
                              opacity: 0.66,
                              position: 'relative',
                              zIndex: 1,
                            }}
                            onPointerEnter={() => {
                              reportHourHover({
                                day: hourBucket.day,
                                hour: hourBucket.hour,
                              })
                            }}
                          >
                            {series.map((s) => {
                              const tokens = hourBucket.totals[s.key] ?? 0
                              if (tokens <= 0) return null

                              const pct =
                                hourBucket.total > 0
                                  ? (tokens / hourBucket.total) * 100
                                  : 0
                              const sliceStyle: CSSProperties = {
                                flexBasis: `${pct.toFixed(4)}%`,
                                flexShrink: 0,
                                minHeight: '1px',
                                width: '100%',
                                background: resolveSliceColor(s.key, s.color),
                              }

                              return (
                                <div
                                  key={s.key}
                                  className={`tt-slice ${s.cssClass}`}
                                  style={sliceStyle}
                                />
                              )
                            })}
                          </div>
                        )

                        const hourShell = (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'flex-end',
                            }}
                          >
                            {hourBar}
                          </div>
                        )

                        return (
                          <div
                            key={`${hourBucket.day}-${hourBucket.hour.toString()}`}
                            style={{
                              flex: '1 1 0%',
                              minWidth: 0,
                              height: '100%',
                              display: 'flex',
                              alignItems: 'flex-end',
                            }}
                          >
                            {hourShell}
                          </div>
                        )
                      })}
                    </div>
                    {renderModelFirstSeenDayOutline(day.day, dayModelMarkers)}
                  </div>
                </div>
              )

              return (
                <HoverTooltip
                  key={day.day}
                  content={buildDayTooltip(
                    day,
                    series,
                    versionIntervals,
                    modelFirstSeenGroups,
                    dayDetail,
                    detailLoading && dayDetail?.date !== day.day
                  )}
                  variant='quota'
                  className='tt-day-tip-wrap'
                >
                  {dayShell}
                </HoverTooltip>
              )
            })}
          </div>
        </div>

        <div
          className='tt-label-row'
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '2px',
            paddingTop: '3px',
            paddingLeft: '8px',
            paddingRight: '8px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {dayEnvelopes.map((day, idx) => {
            const visible = idx % labelStride === 0
            return (
              <div
                key={`lbl-${day.day}`}
                style={{
                  flex: '1 1 0%',
                  minWidth: '14px',
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: 'var(--fg-muted)',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'clip',
                  lineHeight: 1.2,
                  letterSpacing: '0',
                  userSelect: 'none',
                  visibility: visible ? 'visible' : 'hidden',
                }}
                aria-hidden={visible ? undefined : true}
              >
                {visible ? day.label : ' '}
              </div>
            )
          })}
        </div>

        {lowerLaneMode === 'tui'
          ? renderActiveVersionLanes(
              activeVersionLanes,
              widthUnits,
              dayEnvelopes.length,
              lowerChartHeightPx
            )
          : renderMetricLowerLane(
              lowerLaneMode,
              lowerLaneMode === 'requests'
                ? alignedRequestDayEnvelopes
                : alignedToolDayEnvelopes,
              series,
              lowerChartHeightPx
            )}

        <div className='tt-chart-footer'>
          <div
            role='tablist'
            aria-label='Trend detail lane'
            className='tt-lower-tabs'
          >
            {(['tui', 'requests', 'tools'] as const).map((mode) => {
              const selected = lowerLaneMode === mode
              const label =
                mode === 'tui'
                  ? 'Version'
                  : mode === 'requests'
                    ? 'Request'
                    : 'Tool'
              return (
                <button
                  key={mode}
                  type='button'
                  role='tab'
                  aria-selected={selected}
                  className={selected ? 'is-active' : undefined}
                  onClick={() => {
                    handleLowerLaneModeChange(mode)
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <div className='tt-legend'>
            {series.map((s) => (
              <div key={s.key} className='tt-leg-item'>
                <span
                  className={`tt-swatch ${s.cssClass}`}
                  style={{
                    background: resolveSliceColor(s.key, s.color),
                  }}
                />
                {s.label}
              </div>
            ))}
            {hasActiveVersionLaneData && (
              <div className='tt-leg-item'>
                <span className='tt-active-version-swatch' />
                Active version
              </div>
            )}
            {modelFirstSeenGroups.length > 0 && (
              <div className='tt-leg-item'>
                <span className='tt-model-first-seen-swatch' />
                First seen model
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Determine whether to show every other label (crowding threshold).
  // At 24 bars the text would overlap at any practical chart width, so we
  // skip odd-indexed labels. Below 12 bars all labels can be shown.
  const skipAlternate = data.length >= 12

  // Pre-compute per-bucket totals for volume-proportional height scaling.
  // A single pass here avoids a second reduce inside the render loop and
  // lets us derive maxBucketTotal before JSX construction begins.
  const bucketTotals = data.map((bucket) =>
    series.reduce((sum, s) => sum + (bucket.totals[s.key] ?? 0), 0)
  )
  const maxBucketTotal = Math.max(0, ...bucketTotals)

  return (
    <div
      aria-label='Token usage over time, stacked by provider'
      style={{ width: '100%' }}
    >
      {/* Bar strip with reference card styling */}
      <div
        className='token-trend-chart'
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          padding: '8px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          height: '80px',
          width: '100%',
        }}
      >
        {data.map((bucket, idx) => {
          // Use the pre-computed per-bucket total (avoids a second reduce pass).
          const total = bucketTotals[idx] ?? 0

          // Compute the volume-proportional outer bar height as a % of the 80px
          // container (height is set on the parent flex container above).
          //
          // Under `align-items: flex-end`, percentage heights on flex children
          // are resolved relative to the container's definite height (80px), so
          // `height: 50%` → 40px, `height: 100%` → 80px.
          //
          // The previous `height: '100%'` did NOT produce this: with no definite
          // height on the flex container itself (only a fixed px value on the
          // container), the percentage resolved against the *content* height of
          // each child, collapsing every bar to the sum of its slice min-heights
          // (4-7px). See Wave 31 principal investigation Q1 for DOM evidence.
          //
          // Rules (matching mockup lines 2780-2795):
          //   • total === 0  → 0%  (empty bucket, bar invisible)
          //   • raw < 6      → 6%  (floor so the smallest non-zero bucket still
          //                         renders a visible ~5px ribbon)
          //   • otherwise    → (total / maxBucketTotal) * 100%
          let pctHeight = 0
          if (total > 0 && maxBucketTotal > 0) {
            const raw = (total / maxBucketTotal) * 100
            pctHeight = raw < 6 ? 6 : raw
          }

          // Only show tooltip for non-empty bars (at least one provider has tokens)
          const isEmpty = total === 0
          const tooltipContent = isEmpty
            ? null
            : buildBarTooltip(bucket, series)

          const bar = (
            <div
              key={bucket.label}
              className='trend-bar'
              style={{
                // flex: '0 0 auto' — no grow, no shrink, height-driven sizing.
                // Inside the column-flex wrapper, flex: 1 (= flex: 1 1 0%) was
                // forcing this child to consume all main-axis (height) space,
                // making the inline height: N% inert. Width distribution across
                // the 24 bars is handled by the wrapper's own flex: 1 1 0%
                // (set in hover-tooltip.tsx), so we don't need flex growth here.
                flex: '0 0 auto',
                width: '100%',
                height: `${pctHeight.toFixed(1)}%`,
                display: 'flex',
                flexDirection: 'column-reverse',
                overflow: 'hidden',
                minWidth: 0,
                border: '1px solid var(--border)',
                // 14-F.5: opacity set via inline style; CSS .trend-bar:hover
                // overrides to 1 with transition: opacity 50ms from index.css
                opacity: 0.85,
              }}
            >
              {series.map((s) => {
                const tokens = bucket.totals[s.key] ?? 0
                if (tokens <= 0) return null

                const pct = total > 0 ? (tokens / total) * 100 : 0

                // F8a: resolve bar color — prefer the explicit prop value then
                // fall back to PROVIDER_COLOR_MAP so bars are never white.
                const sliceStyle: CSSProperties = {
                  flexBasis: `${pct.toFixed(4)}%`,
                  flexShrink: 0,
                  minHeight: '1px',
                  width: '100%',
                  // Inline background is the second source of truth after the
                  // CSS class. It catches providers whose .tt-* rule is absent
                  // or carries an incorrect near-white value (e.g. old tt-xai).
                  background: resolveSliceColor(s.key, s.color),
                }

                return (
                  <div
                    key={s.key}
                    className={`tt-slice ${s.cssClass}`}
                    style={sliceStyle}
                  />
                )
              })}
            </div>
          )

          // W28-TrendVisual Track B: wrap non-empty bars in HoverTooltip.
          // Empty (padding) bars are left unwrapped to avoid spurious tooltip
          // triggers and keep the DOM minimal.
          if (isEmpty || tooltipContent === null) {
            return (
              <div
                key={`${bucket.label}-${idx.toString()}`}
                style={{ flex: 1, minWidth: 0 }}
              >
                {bar}
              </div>
            )
          }

          return (
            <HoverTooltip
              key={`${bucket.label}-${idx.toString()}`}
              content={tooltipContent}
              variant='quota'
              className='tt-bar-tip-wrap'
            >
              {bar}
            </HoverTooltip>
          )
        })}
      </div>

      {/* W28-TrendVisual Track C: x-axis bucket label row.
          Labels mirror the bar strip's flex layout (gap: 1px, flex: 1 per
          bar) so each label is centred under its bar.
          ISO-8601 labels → MM/DD; relative labels ("Xh") → as-is.
          Every other label is hidden when data.length >= 12 to prevent
          crowding at 24-bar density. */}
      <div
        className='tt-label-row'
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1px',
          paddingTop: '3px',
          paddingLeft: '8px',
          paddingRight: '8px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {data.map((bucket, idx) => {
          const displayLabel =
            skipAlternate && idx % 2 !== 0
              ? ''
              : formatBucketLabel(bucket.label)

          return (
            <div
              key={`lbl-${bucket.label}-${idx.toString()}`}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                color: 'var(--fg-muted)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'clip',
                lineHeight: 1.2,
                letterSpacing: '0',
                userSelect: 'none',
                // Visually hidden placeholder for odd-indexed bars at 24-bar density
                visibility: displayLabel === '' ? 'hidden' : 'visible',
              }}
              aria-hidden={displayLabel === '' ? true : undefined}
            >
              {displayLabel === '' ? ' ' : displayLabel}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div
        className='tt-legend'
        style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--fg-muted)',
          padding: '6px 8px',
          letterSpacing: '0',
        }}
      >
        {series.map((s) => (
          <div
            key={s.key}
            className='tt-leg-item'
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span
              className={`tt-swatch ${s.cssClass}`}
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                border: '1px solid var(--border)',
                flexShrink: 0,
                // F8a: same fallback approach as .tt-slice — inline background
                // ensures legend swatches always show the correct brand color.
                background: resolveSliceColor(s.key, s.color),
              }}
            />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
