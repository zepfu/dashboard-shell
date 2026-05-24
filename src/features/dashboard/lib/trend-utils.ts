/**
 * trend-utils — Pure helper functions for token trend data processing.
 *
 * These functions transform raw API data into chart-ready formats and can
 * be used both by components and in isolation (pure functions, no React).
 */
import type {
  UsageReportTokenTrendHourRow,
  UsageReportTokenTrendVersionIntervalRow,
  UsageReportTrendRow,
} from '../api/usage-report'
import type { TrendBucket } from '../components/token-trend-chart'
import { canonicalProvider } from './usage-report-display'

// ---------------------------------------------------------------------------
// normalizeTrendData
// ---------------------------------------------------------------------------

/** Target bucket count for the trend chart — one bar per hour over 24 hours. */
const TREND_BUCKET_COUNT = 24

/**
 * normalizeTrendData groups UsageReportTrendRow records by bucket_start,
 * summing per-provider token counts into a totals map per bucket.
 *
 * Provider names are normalised through {@link canonicalProvider} before keying
 * into the totals map so that raw API variants such as `'x.ai'`, `'gemini'`, or
 * `'nvidia'` are collapsed to their canonical forms (`'xai'`, `'google'`,
 * `'nvidia_nim'`). This ensures that the chart series keys always find their
 * matching entries in `TrendBucket.totals` regardless of which variant the
 * upstream data source emits.
 *
 * The result is always padded (or truncated) to exactly {@link TREND_BUCKET_COUNT}
 * buckets so that the TokenTrendChart always renders ~24 narrow bars regardless
 * of whether the API returns daily, weekly, or monthly aggregates:
 *
 * - If the raw data produces ≥24 buckets: keep the most recent 24.
 * - If the raw data produces <24 buckets: prepend empty buckets labelled
 *   `Xh` (where X counts down from the left) so the chart fills the full
 *   width with appropriately narrow bars.
 *
 * @param rows - Raw trend rows from the usage report API.
 * @returns Array of exactly {@link TREND_BUCKET_COUNT} TrendBucket objects
 *   in ascending bucket order.
 */
export function normalizeTrendData(rows: UsageReportTrendRow[]): TrendBucket[] {
  // Use an ordered map (insertion order = chronological order after sorting)
  const bucketMap = new Map<string, Record<string, number>>()

  for (const row of rows) {
    const key = row.bucket
    // Normalise provider name so variant spellings ('x.ai', 'gemini', 'nvidia')
    // collapse to their canonical forms ('xai', 'google', 'nvidia_nim') and
    // match the keys used in PROVIDER_SERIES / TokenTrendChart.
    const provider = canonicalProvider(row.provider)
    const existing = bucketMap.get(key)
    if (existing === undefined) {
      bucketMap.set(key, { [provider]: row.token_total })
    } else {
      existing[provider] = (existing[provider] ?? 0) + row.token_total
    }
  }

  // Sort buckets chronologically
  const sortedKeys = [...bucketMap.keys()].sort()

  const dataBuckets: TrendBucket[] = sortedKeys.map((bucket) => ({
    label: bucket,
    totals: bucketMap.get(bucket) ?? {},
  }))

  // Truncate to the most recent TREND_BUCKET_COUNT if we have too many
  const trimmed =
    dataBuckets.length > TREND_BUCKET_COUNT
      ? dataBuckets.slice(dataBuckets.length - TREND_BUCKET_COUNT)
      : dataBuckets

  // Pad the beginning with empty buckets so the total is always exactly 24
  const padCount = TREND_BUCKET_COUNT - trimmed.length
  const padBuckets: TrendBucket[] = Array.from(
    { length: padCount },
    (_, i) => ({
      // Label counts back from the oldest real bucket so that the x-axis
      // reads as "Xh ago" for context (e.g. "23h", "22h", …).
      label: `${padCount - i + trimmed.length - 1}h`,
      totals: {},
    })
  )

  return [...padBuckets, ...trimmed]
}

// ---------------------------------------------------------------------------
// formatBucketLabel
// ---------------------------------------------------------------------------

/**
 * ISO-8601 date pattern (accepts both date-only and full datetime strings).
 *
 * Matches strings that start with `YYYY-MM-DD` so that daily-grain bucket
 * keys produced by the API (e.g. `2026-05-19T00:00:00.000Z`) are detected
 * and formatted as `MM/DD`. Relative labels such as `"23h"` do not match and
 * are returned unchanged.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

/**
 * Formats a raw {@link TrendBucket} label for display in the x-axis label row.
 *
 * - ISO-8601 strings → `MM/DD` (e.g. `"2026-05-19T00:00:00.000Z"` → `"05/19"`).
 * - Relative strings (e.g. `"23h"`, `"0h"`) → returned as-is.
 *
 * Exported so that the component and tests can share the same formatting logic
 * without duplicating the regex and slice arithmetic.
 *
 * @param rawLabel - The `label` field from a {@link TrendBucket}.
 * @returns A short display string suitable for an 8–9 px monospaced label.
 */
export function formatBucketLabel(rawLabel: string): string {
  if (!ISO_DATE_RE.test(rawLabel)) return rawLabel

  // Parse the date portion only to avoid timezone edge cases.
  // YYYY-MM-DD → MM/DD
  const datePart = rawLabel.slice(0, 10) // "YYYY-MM-DD"
  const month = datePart.slice(5, 7) // "MM"
  const day = datePart.slice(8, 10) // "DD"
  return `${month}/${day}`
}

// ---------------------------------------------------------------------------
// Hourly day envelopes for Token Trend
// ---------------------------------------------------------------------------

export interface TokenTrendHourBucket {
  day: string
  hour: number
  label: string
  totals: Record<string, number>
  total: number
}

export interface TokenTrendDayEnvelope {
  day: string
  label: string
  totals: Record<string, number>
  total: number
  maxHourTotal: number
  hours: TokenTrendHourBucket[]
}

export interface TokenTrendVersionTrackPoint {
  day: string
  hour: number
  x: number
  y: number
  globalHour: number
}

export interface TokenTrendVersionTrack {
  id: string
  provider: string
  clientName: string
  clientVersion: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  releasePoint: TokenTrendVersionTrackPoint | null
  segments: TokenTrendVersionTrackPoint[][]
}

export type TokenTrendActiveVersionFamilyKey =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'grok'

export interface TokenTrendActiveVersionSegment {
  id: string
  familyKey: TokenTrendActiveVersionFamilyKey
  provider: string
  providers: string[]
  clientName: string
  clientNames: string[]
  clientVersion: string
  firstSeenAt: string | null
  lastSeenAt: string | null
  firstSeenDay: string | null
  lastSeenDay: string | null
  firstSeenHour: number | null
  lastSeenHour: number | null
  startGlobalHour: number
  endGlobalHour: number
  xStart: number
  xEnd: number
  releaseX: number
  rowIndex: number
  traces: number
  tokenTotal: number
}

export interface TokenTrendActiveVersionFamilyLane {
  key: TokenTrendActiveVersionFamilyKey
  label: string
  rowCount: number
  segments: TokenTrendActiveVersionSegment[]
}

interface TokenTrendVersionTrackOptions {
  gapToleranceHours?: number
}

const TOKEN_TREND_ACTIVE_VERSION_FAMILIES: readonly {
  key: TokenTrendActiveVersionFamilyKey
  label: string
}[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'grok', label: 'Grok' },
]

export function tokenTrendDayHeightPct(
  dayTotal: number,
  maxDayTotal: number
): number {
  if (dayTotal <= 0 || maxDayTotal <= 0) return 0
  const raw = (dayTotal / maxDayTotal) * 100
  return raw < 8 ? 8 : raw
}

export function tokenTrendHourHeightPct(
  hourTotal: number,
  maxHourTotal: number
): number {
  if (hourTotal <= 0 || maxHourTotal <= 0) return 0
  const raw = (hourTotal / maxHourTotal) * 100
  return raw < 4 ? 4 : raw
}

function createEmptyHours(day: string): TokenTrendHourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    day,
    hour,
    label: `${hour.toString().padStart(2, '0')}:00`,
    totals: {},
    total: 0,
  }))
}

export function buildTokenTrendDayEnvelopes(
  rows: readonly UsageReportTokenTrendHourRow[]
): TokenTrendDayEnvelope[] {
  const dayMap = new Map<string, TokenTrendDayEnvelope>()

  for (const row of rows) {
    const day = row.day?.slice(0, 10)
    const hour = Math.trunc(row.hour)
    const tokens = Number(row.token_total)
    if (
      day === undefined ||
      !ISO_DATE_RE.test(day) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isFinite(tokens) ||
      tokens <= 0
    ) {
      continue
    }

    let envelope = dayMap.get(day)
    if (envelope === undefined) {
      envelope = {
        day,
        label: formatBucketLabel(day),
        totals: {},
        total: 0,
        maxHourTotal: 0,
        hours: createEmptyHours(day),
      }
      dayMap.set(day, envelope)
    }

    const provider = canonicalProvider(row.provider)
    const hourBucket = envelope.hours[hour]
    if (hourBucket === undefined) continue

    hourBucket.totals[provider] = (hourBucket.totals[provider] ?? 0) + tokens
    hourBucket.total += tokens
    envelope.totals[provider] = (envelope.totals[provider] ?? 0) + tokens
    envelope.total += tokens
  }

  const envelopes = [...dayMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day)
  )

  for (const envelope of envelopes) {
    envelope.maxHourTotal = Math.max(0, ...envelope.hours.map((h) => h.total))
  }

  return envelopes
}

function versionHourIndex(
  dayIndexByDay: ReadonlyMap<string, number>,
  day: string | null,
  hour: number | null
): number | null {
  if (day === null || hour === null || hour < 0 || hour > 23) return null
  const dayIndex = dayIndexByDay.get(day)
  if (dayIndex === undefined) return null
  return dayIndex * 24 + hour
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

export function normalizeTokenTrendClientVersionForLane(
  clientVersion: string
): string {
  const trimmed = clientVersion.trim()
  const hashedBuildMatch = /^(\d+\.\d+\.\d+)\.[0-9a-f]{3,}$/i.exec(trimmed)
  if (hashedBuildMatch?.[1] !== undefined) return hashedBuildMatch[1]
  return trimmed
}

export function classifyTokenTrendActiveVersionFamily(row: {
  provider: string
  client_name: string
  client_version?: string
}): TokenTrendActiveVersionFamilyKey | null {
  const clientName = normalizedText(row.client_name)
  const clientVersion = normalizedText(row.client_version ?? '')

  if (clientName.includes('claude') || clientVersion.includes('claude')) {
    return 'claude'
  }
  if (clientName.includes('codex') || clientVersion.includes('codex')) {
    return 'codex'
  }
  if (clientName.includes('gemini') || clientVersion.includes('gemini')) {
    return 'gemini'
  }
  if (clientName.includes('grok') || clientVersion.includes('grok')) {
    return 'grok'
  }

  const provider = canonicalProvider(row.provider)
  if (provider === 'xai') return 'grok'
  if (provider === 'google') return 'gemini'

  return null
}

function providerMidpointPct(
  hourBucket: TokenTrendHourBucket,
  provider: string,
  seriesKeys: readonly string[]
): number | null {
  const providerTokens = hourBucket.totals[provider] ?? 0
  if (hourBucket.total <= 0 || providerTokens <= 0) return null

  const orderedKeys = [
    ...seriesKeys,
    ...Object.keys(hourBucket.totals).filter(
      (key) => !seriesKeys.includes(key)
    ),
  ]
  let precedingTokens = 0
  for (const key of orderedKeys) {
    const tokens = hourBucket.totals[key] ?? 0
    if (key === provider) {
      return ((precedingTokens + tokens / 2) / hourBucket.total) * 100
    }
    precedingTokens += tokens
  }

  return null
}

function versionTrackPoint(
  envelope: TokenTrendDayEnvelope,
  dayIndex: number,
  hour: number,
  provider: string,
  seriesKeys: readonly string[],
  maxDayTotal: number
): TokenTrendVersionTrackPoint | null {
  const hourBucket = envelope.hours[hour]
  if (hourBucket === undefined || envelope.maxHourTotal <= 0) return null

  const stackMidpointPct = providerMidpointPct(hourBucket, provider, seriesKeys)
  if (stackMidpointPct === null) return null

  const dayHeightPct = tokenTrendDayHeightPct(envelope.total, maxDayTotal)
  const hourHeightPct = tokenTrendHourHeightPct(
    hourBucket.total,
    envelope.maxHourTotal
  )
  const y = 100 - (dayHeightPct * hourHeightPct * stackMidpointPct) / 10_000

  return {
    day: envelope.day,
    hour,
    x: dayIndex * 24 + hour + 0.5,
    y,
    globalHour: dayIndex * 24 + hour,
  }
}

export function deriveTokenTrendVersionTracks(
  envelopes: readonly TokenTrendDayEnvelope[],
  intervals: readonly UsageReportTokenTrendVersionIntervalRow[],
  seriesKeys: readonly string[],
  options: TokenTrendVersionTrackOptions = {}
): TokenTrendVersionTrack[] {
  const gapToleranceHours = Math.max(0, options.gapToleranceHours ?? 2)
  const dayIndexByDay = new Map(
    envelopes.map((envelope, index) => [envelope.day, index])
  )
  const maxDayTotal = Math.max(
    0,
    ...envelopes.map((envelope) => envelope.total)
  )
  const tracks: TokenTrendVersionTrack[] = []

  for (const interval of intervals) {
    const provider = canonicalProvider(interval.provider)
    const firstSeenHour =
      typeof interval.first_seen_hour === 'number'
        ? Math.trunc(interval.first_seen_hour)
        : null
    const lastSeenHour =
      typeof interval.last_seen_hour === 'number'
        ? Math.trunc(interval.last_seen_hour)
        : null
    const firstGlobalHour = versionHourIndex(
      dayIndexByDay,
      interval.first_seen_day,
      firstSeenHour
    )
    const lastGlobalHour = versionHourIndex(
      dayIndexByDay,
      interval.last_seen_day,
      lastSeenHour
    )
    if (firstGlobalHour === null || lastGlobalHour === null) continue

    const rangeStart = Math.min(firstGlobalHour, lastGlobalHour)
    const rangeEnd = Math.max(firstGlobalHour, lastGlobalHour)
    const points: TokenTrendVersionTrackPoint[] = []

    for (let dayIndex = 0; dayIndex < envelopes.length; dayIndex += 1) {
      const envelope = envelopes[dayIndex]
      if (envelope === undefined) continue

      for (let hour = 0; hour < 24; hour += 1) {
        const globalHour = dayIndex * 24 + hour
        if (globalHour < rangeStart || globalHour > rangeEnd) continue

        const point = versionTrackPoint(
          envelope,
          dayIndex,
          hour,
          provider,
          seriesKeys,
          maxDayTotal
        )
        if (point !== null) points.push(point)
      }
    }

    if (!points.length) continue

    const segments: TokenTrendVersionTrackPoint[][] = []
    let currentSegment: TokenTrendVersionTrackPoint[] = []
    let previousPoint: TokenTrendVersionTrackPoint | null = null

    for (const point of points) {
      const missingHours =
        previousPoint === null
          ? 0
          : point.globalHour - previousPoint.globalHour - 1
      if (previousPoint !== null && missingHours > gapToleranceHours) {
        if (currentSegment.length > 0) segments.push(currentSegment)
        currentSegment = []
      }
      currentSegment.push(point)
      previousPoint = point
    }
    if (currentSegment.length > 0) segments.push(currentSegment)

    tracks.push({
      id: [
        provider,
        interval.client_name,
        interval.client_version,
        interval.first_seen_at ?? interval.first_seen_day ?? 'unknown',
      ].join('|'),
      provider,
      clientName: interval.client_name,
      clientVersion: interval.client_version,
      firstSeenAt: interval.first_seen_at,
      lastSeenAt: interval.last_seen_at,
      releasePoint:
        points.find((point) => point.globalHour === firstGlobalHour) ?? null,
      segments,
    })
  }

  return tracks
}

export function deriveTokenTrendActiveVersionLanes(
  envelopes: readonly TokenTrendDayEnvelope[],
  intervals: readonly UsageReportTokenTrendVersionIntervalRow[]
): TokenTrendActiveVersionFamilyLane[] {
  const dayIndexByDay = new Map(
    envelopes.map((envelope, index) => [envelope.day, index])
  )
  const segmentsByFamily = new Map<
    TokenTrendActiveVersionFamilyKey,
    Omit<TokenTrendActiveVersionSegment, 'rowIndex'>[]
  >(TOKEN_TREND_ACTIVE_VERSION_FAMILIES.map((family) => [family.key, []]))
  const aggregateByVersion = new Map<
    string,
    {
      familyKey: TokenTrendActiveVersionFamilyKey
      provider: string
      providerTotals: Map<string, number>
      clientNames: Set<string>
      clientName: string
      clientVersion: string
      firstSeenAt: string | null
      lastSeenAt: string | null
      firstSeenDay: string | null
      lastSeenDay: string | null
      firstSeenHour: number | null
      lastSeenHour: number | null
      startGlobalHour: number
      endGlobalHour: number
      releaseGlobalHour: number
      traces: number
      tokenTotal: number
    }
  >()

  for (const interval of intervals) {
    const familyKey = classifyTokenTrendActiveVersionFamily(interval)
    if (familyKey === null) continue

    const firstSeenHour =
      typeof interval.first_seen_hour === 'number'
        ? Math.trunc(interval.first_seen_hour)
        : null
    const lastSeenHour =
      typeof interval.last_seen_hour === 'number'
        ? Math.trunc(interval.last_seen_hour)
        : null
    const firstGlobalHour = versionHourIndex(
      dayIndexByDay,
      interval.first_seen_day,
      firstSeenHour
    )
    const lastGlobalHour = versionHourIndex(
      dayIndexByDay,
      interval.last_seen_day,
      lastSeenHour
    )
    if (firstGlobalHour === null || lastGlobalHour === null) continue

    const startGlobalHour = Math.min(firstGlobalHour, lastGlobalHour)
    const endGlobalHour = Math.max(firstGlobalHour, lastGlobalHour)
    const provider = canonicalProvider(interval.provider)
    const clientVersion = normalizeTokenTrendClientVersionForLane(
      interval.client_version
    )
    const aggregateKey = [familyKey, clientVersion].join('|')
    const existing = aggregateByVersion.get(aggregateKey)

    if (existing === undefined) {
      aggregateByVersion.set(aggregateKey, {
        familyKey,
        provider,
        providerTotals: new Map([[provider, interval.token_total]]),
        clientNames: new Set([interval.client_name]),
        clientName: interval.client_name,
        clientVersion,
        firstSeenAt: interval.first_seen_at,
        lastSeenAt: interval.last_seen_at,
        firstSeenDay: interval.first_seen_day,
        lastSeenDay: interval.last_seen_day,
        firstSeenHour,
        lastSeenHour,
        startGlobalHour,
        endGlobalHour,
        releaseGlobalHour: firstGlobalHour,
        traces: interval.traces,
        tokenTotal: interval.token_total,
      })
      continue
    }

    existing.traces += interval.traces
    existing.tokenTotal += interval.token_total
    existing.clientNames.add(interval.client_name)
    existing.providerTotals.set(
      provider,
      (existing.providerTotals.get(provider) ?? 0) + interval.token_total
    )
    existing.provider =
      [...existing.providerTotals.entries()].sort(
        ([, a], [, b]) => b - a
      )[0]?.[0] ?? existing.provider
    if (startGlobalHour < existing.startGlobalHour) {
      existing.startGlobalHour = startGlobalHour
      existing.releaseGlobalHour = firstGlobalHour
      existing.firstSeenAt = interval.first_seen_at
      existing.firstSeenDay = interval.first_seen_day
      existing.firstSeenHour = firstSeenHour
      existing.clientName = interval.client_name
    }
    if (endGlobalHour > existing.endGlobalHour) {
      existing.endGlobalHour = endGlobalHour
      existing.lastSeenAt = interval.last_seen_at
      existing.lastSeenDay = interval.last_seen_day
      existing.lastSeenHour = lastSeenHour
    }
  }

  for (const aggregate of aggregateByVersion.values()) {
    const xStart = aggregate.startGlobalHour + 0.12
    const xEnd = Math.max(xStart + 0.62, aggregate.endGlobalHour + 0.88)

    segmentsByFamily.get(aggregate.familyKey)?.push({
      id: [
        aggregate.familyKey,
        aggregate.provider,
        aggregate.clientVersion,
        aggregate.firstSeenAt ?? aggregate.firstSeenDay ?? 'unknown',
      ].join('|'),
      familyKey: aggregate.familyKey,
      provider: aggregate.provider,
      providers: [...aggregate.providerTotals.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([providerKey]) => providerKey),
      clientName: aggregate.clientName,
      clientNames: [...aggregate.clientNames].sort(),
      clientVersion: aggregate.clientVersion,
      firstSeenAt: aggregate.firstSeenAt,
      lastSeenAt: aggregate.lastSeenAt,
      firstSeenDay: aggregate.firstSeenDay,
      lastSeenDay: aggregate.lastSeenDay,
      firstSeenHour: aggregate.firstSeenHour,
      lastSeenHour: aggregate.lastSeenHour,
      startGlobalHour: aggregate.startGlobalHour,
      endGlobalHour: aggregate.endGlobalHour,
      xStart,
      xEnd,
      releaseX: aggregate.releaseGlobalHour + 0.5,
      traces: aggregate.traces,
      tokenTotal: aggregate.tokenTotal,
    })
  }

  return TOKEN_TREND_ACTIVE_VERSION_FAMILIES.map((family) => {
    const familySegments = [...(segmentsByFamily.get(family.key) ?? [])].sort(
      (a, b) => {
        const startDelta = a.startGlobalHour - b.startGlobalHour
        if (startDelta !== 0) return startDelta
        const endDelta = a.endGlobalHour - b.endGlobalHour
        if (endDelta !== 0) return endDelta
        return b.tokenTotal - a.tokenTotal
      }
    )
    const laneStates: {
      endGlobalHour: number
      lastPointHour: number | null
    }[] = []
    const packedSegments: TokenTrendActiveVersionSegment[] = []

    for (const segment of familySegments) {
      const isPoint = segment.startGlobalHour === segment.endGlobalHour
      let rowIndex = laneStates.findIndex(
        (state) =>
          state.endGlobalHour < segment.startGlobalHour ||
          (isPoint && state.lastPointHour === segment.startGlobalHour)
      )
      if (rowIndex === -1) {
        rowIndex = laneStates.length
        laneStates.push({
          endGlobalHour: segment.endGlobalHour,
          lastPointHour: isPoint ? segment.startGlobalHour : null,
        })
      } else {
        const state = laneStates[rowIndex]
        if (state !== undefined) {
          state.endGlobalHour = Math.max(
            state.endGlobalHour,
            segment.endGlobalHour
          )
          state.lastPointHour = isPoint ? segment.startGlobalHour : null
        }
      }
      packedSegments.push({ ...segment, rowIndex })
    }

    return {
      key: family.key,
      label: family.label,
      rowCount: Math.max(1, laneStates.length),
      segments: packedSegments,
    }
  })
}
