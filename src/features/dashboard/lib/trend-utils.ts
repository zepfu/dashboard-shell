/**
 * trend-utils — Pure helper functions for token trend data processing.
 *
 * These functions transform raw API data into chart-ready formats and can
 * be used both by components and in isolation (pure functions, no React).
 */
import type {
  UsageReportTokenTrendHourRow,
  UsageReportTokenTrendModelFirstSeenRow,
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

  // Pad the beginning with empty buckets so the total is always exactly 24.
  // Use a reserved prefix so pad labels cannot collide with real bucket keys
  // like "3h" from the API (G2).
  const padCount = TREND_BUCKET_COUNT - trimmed.length
  const padBuckets: TrendBucket[] = Array.from(
    { length: padCount },
    (_, i) => ({
      label: `pad:${padCount - i + trimmed.length - 1}h`,
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

/**
 * Parses API bucket timestamps into a calendar day and optional hour (0–23).
 * Offset/Z timestamps use UTC day+hour; plain date-only strings return hour null.
 */
export function parseTrendDayHour(value: string | null | undefined): {
  day: string
  hour: number | null
} | null {
  if (value == null || value.trim() === '') return null

  const hasOffset = /[T\s]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(
    value.trim()
  )
  if (hasOffset) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const utcDay = parsed.toISOString().slice(0, 10)
    return { day: utcDay, hour: parsed.getUTCHours() }
  }

  const dayMatch = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dayMatch === null) return null

  const localHourMatch = value.match(/^\d{4}-\d{2}-\d{2}[T\s](\d{2})/)
  if (localHourMatch !== null) {
    const hour = Number.parseInt(localHourMatch[1], 10)
    if (hour < 0 || hour > 23) return null
    return { day: dayMatch[1], hour }
  }

  const hasTime = value.includes('T') || /\d{2}:\d{2}/.test(value)
  if (!hasTime) return { day: dayMatch[1], hour: null }

  return { day: dayMatch[1], hour: null }
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

export type TokenTrendEnvelopeMetric = 'tokens' | 'requests' | 'tools'

export interface TokenTrendDayEnvelopeRangeOptions {
  from?: string
  to?: string
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

export interface TokenTrendModelFirstSeenMarker {
  provider: string
  model: string
  firstSeenAt: string | null
  firstSeenDay: string
  firstSeenHour: number
  globalHour: number
  observations: number
  tokenTotal: number
}

export interface TokenTrendModelFirstSeenGroup {
  id: string
  day: string
  hour: number
  globalHour: number
  markers: TokenTrendModelFirstSeenMarker[]
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

function isIsoDay(value: string | undefined): value is string {
  return value !== undefined && ISO_DATE_RE.test(value)
}

function createEmptyEnvelope(day: string): TokenTrendDayEnvelope {
  return {
    day,
    label: formatBucketLabel(day),
    totals: {},
    total: 0,
    maxHourTotal: 0,
    hours: createEmptyHours(day),
  }
}

const MAX_TOKEN_TREND_RANGE_FILL_DAYS = 400

function nextIsoDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + 1)
  return parsed.toISOString().slice(0, 10)
}

function countIsoDaysInclusive(startDay: string, endDay: string): number {
  let count = 0
  for (
    let day = startDay;
    day <= endDay && count < MAX_TOKEN_TREND_RANGE_FILL_DAYS + 1;
    day = nextIsoDay(day)
  ) {
    count += 1
  }
  return count
}

export function buildTokenTrendDayEnvelopes(
  rows: readonly UsageReportTokenTrendHourRow[],
  metric: TokenTrendEnvelopeMetric = 'tokens',
  options: TokenTrendDayEnvelopeRangeOptions = {}
): TokenTrendDayEnvelope[] {
  const dayMap = new Map<string, TokenTrendDayEnvelope>()

  for (const row of rows) {
    const day = row.day?.slice(0, 10)
    const hour = Math.trunc(row.hour)
    const metricValue =
      metric === 'requests'
        ? Number(row.traces)
        : metric === 'tools'
          ? Number(row.tool_calls ?? 0)
          : Number(row.token_total)
    if (
      day === undefined ||
      !ISO_DATE_RE.test(day) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isFinite(metricValue) ||
      metricValue <= 0
    ) {
      continue
    }

    let envelope = dayMap.get(day)
    if (envelope === undefined) {
      envelope = createEmptyEnvelope(day)
      dayMap.set(day, envelope)
    }

    const provider = canonicalProvider(row.provider)
    const hourBucket = envelope.hours[hour]
    if (hourBucket === undefined) continue

    hourBucket.totals[provider] =
      (hourBucket.totals[provider] ?? 0) + metricValue
    hourBucket.total += metricValue
    envelope.totals[provider] = (envelope.totals[provider] ?? 0) + metricValue
    envelope.total += metricValue
  }

  const rangeFrom = options.from?.slice(0, 10)
  const rangeTo = options.to?.slice(0, 10)
  if (isIsoDay(rangeFrom) && isIsoDay(rangeTo)) {
    const startDay = rangeFrom <= rangeTo ? rangeFrom : rangeTo
    const endDay = rangeFrom <= rangeTo ? rangeTo : rangeFrom
    const spanDays = countIsoDaysInclusive(startDay, endDay)
    const fillDays =
      spanDays <= MAX_TOKEN_TREND_RANGE_FILL_DAYS
        ? spanDays
        : MAX_TOKEN_TREND_RANGE_FILL_DAYS
    for (
      let day = startDay, filled = 0;
      filled < fillDays;
      day = nextIsoDay(day)
    ) {
      if (!dayMap.has(day)) {
        dayMap.set(day, createEmptyEnvelope(day))
      }
      filled += 1
      if (day >= endDay) break
    }
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
  hour: number | null,
  clampToEnvelope = false
): number | null {
  if (day === null || hour === null || hour < 0 || hour > 23) return null
  let dayIndex = dayIndexByDay.get(day)
  if (dayIndex === undefined) {
    if (!clampToEnvelope || dayIndexByDay.size === 0) return null
    const sortedDays = [...dayIndexByDay.keys()].sort()
    const first = sortedDays[0]
    const last = sortedDays[sortedDays.length - 1]
    if (first === undefined || last === undefined) return null
    if (day < first) {
      dayIndex = 0
      hour = 0
    } else if (day > last) {
      dayIndex = dayIndexByDay.size - 1
      hour = 23
    } else {
      return null
    }
  }
  return dayIndex * 24 + hour
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function hasTokenSequence(value: string, sequence: string): boolean {
  return value.split(/\s+/).filter(Boolean).join(' ').includes(sequence)
}

export function isTokenTrendActiveVersionClient(row: {
  client_name: string
  client_version?: string
}): boolean {
  const clientName = normalizedText(row.client_name)
  const clientVersion = normalizedText(row.client_version ?? '')

  if (
    hasTokenSequence(clientName, 'claude cli') ||
    hasTokenSequence(clientName, 'claude code')
  ) {
    return true
  }
  if (
    hasTokenSequence(clientName, 'codex tui') ||
    hasTokenSequence(clientName, 'codex cli')
  ) {
    return true
  }
  if (hasTokenSequence(clientName, 'gemini cli')) return true
  if (
    hasTokenSequence(clientName, 'grok build') ||
    hasTokenSequence(clientName, 'grok cli') ||
    hasTokenSequence(clientName, 'xai cli')
  ) {
    return true
  }

  return (
    clientVersion.includes('claude') ||
    clientVersion.includes('gemini') ||
    clientVersion.includes('grok')
  )
}

export function normalizeTokenTrendClientVersionForLane(
  clientVersion: string
): string {
  const trimmed = clientVersion.trim()
  const hashedBuildMatch = /^(\d+\.\d+\.\d+)\.[0-9a-f]*[a-f][0-9a-f]*$/i.exec(
    trimmed
  )
  if (hashedBuildMatch?.[1] !== undefined) return hashedBuildMatch[1]
  return trimmed
}

export function classifyTokenTrendActiveVersionFamily(row: {
  provider: string
  client_name: string
  client_version?: string
}): TokenTrendActiveVersionFamilyKey | null {
  if (!isTokenTrendActiveVersionClient(row)) return null

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
      firstSeenHour,
      true
    )
    const lastGlobalHour = versionHourIndex(
      dayIndexByDay,
      interval.last_seen_day,
      lastSeenHour,
      true
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

export function deriveTokenTrendModelFirstSeenGroups(
  envelopes: readonly TokenTrendDayEnvelope[],
  rows: readonly UsageReportTokenTrendModelFirstSeenRow[]
): TokenTrendModelFirstSeenGroup[] {
  const dayIndexByDay = new Map(
    envelopes.map((envelope, index) => [envelope.day, index])
  )
  const groupsByHour = new Map<string, TokenTrendModelFirstSeenGroup>()

  for (const row of rows) {
    const day = row.first_seen_day
    const hour =
      typeof row.first_seen_hour === 'number'
        ? Math.trunc(row.first_seen_hour)
        : null
    const globalHour = versionHourIndex(dayIndexByDay, day, hour)
    if (day === null || hour === null || globalHour === null) continue

    const provider = canonicalProvider(row.provider)
    if (
      provider !== 'anthropic' &&
      provider !== 'openai' &&
      provider !== 'xai' &&
      provider !== 'google'
    ) {
      continue
    }

    const model = row.model.trim()
    if (model === '' || model === 'unknown') continue

    const key = `${day}|${hour.toString()}`
    let group = groupsByHour.get(key)
    if (group === undefined) {
      group = {
        id: key,
        day,
        hour,
        globalHour,
        markers: [],
      }
      groupsByHour.set(key, group)
    }

    group.markers.push({
      provider,
      model,
      firstSeenAt: row.first_seen_at,
      firstSeenDay: day,
      firstSeenHour: hour,
      globalHour,
      observations: row.observations,
      tokenTotal: row.token_total,
    })
  }

  return [...groupsByHour.values()]
    .map((group) => ({
      ...group,
      markers: [...group.markers].sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)
      ),
    }))
    .sort((a, b) => a.globalHour - b.globalHour)
}
