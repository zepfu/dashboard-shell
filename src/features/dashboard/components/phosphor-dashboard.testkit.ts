/**
 * Pure phosphor dashboard helpers (no React components).
 * Consumed by phosphor-dashboard.tsx and unit tests.
 */
import type {
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportProviderStatusUsageRow,
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
  UsageReportRow,
  UsageReportSummary,
  UsageReportToolActivityRow,
  UsageReportTrendRow,
} from '../api/usage-report'
import {
  agentQualityFromFlatRow,
  combineAgentQualitySummaries,
  type AgentQualitySummary,
} from '../lib/agent-quality'
import {
  addDaysToDateString,
  canonicalProvider,
  computeFleetP95,
  formatDashboardDate,
  formatDashboardIntervalCompact,
  formatDashboardTime,
  providerAliases,
} from '../lib/usage-report-display'
import {
  buildToolActivity,
  type ModelLatencySummary,
  type ModelRow,
} from './master-ledger-table'
import { type CellDef, type HealthStripEvent } from './primitives/health-strip'
import {
  type ProviderMetrics,
  type QuotaBarGroup,
  type QuotaLane,
  type QuotaRowConfig,
  type QuotaTipModel,
  type TopModelRow,
} from './provider-card'
import type { RepoRow } from './repo-breakdown-table'

/** Cell count expected by HealthStrip inside ProviderCard. */
export const HEALTH_CELL_COUNT = 288
export const HEALTH_BUCKET_MS = 5 * 60 * 1000
export function formatCompactQuantity(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function quotaHistoryConsumedPct(
  row: UsageReportQuotaHistoryRow
): number {
  const remaining = row.min_remaining_pct ?? row.max_remaining_pct ?? 100
  return Math.max(0, Math.min(100, 100 - remaining))
}

export function quotaHistoryFillColor(consumedPct: number): string {
  if (consumedPct >= 75) return 'var(--accent-hot)'
  if (consumedPct >= 25) return 'var(--accent-warm)'
  if (consumedPct >= 10) return 'var(--accent-teal)'
  return 'var(--accent-cool)'
}

export function quotaHistoryRequests(row: UsageReportQuotaHistoryRow): number {
  return row.usage_breakdown.reduce((sum, entry) => sum + entry.traces, 0)
}

function quotaHistoryHasUsage(row: UsageReportQuotaHistoryRow): boolean {
  return row.usage_tokens > 0 || quotaHistoryRequests(row) > 0
}

interface ProviderQuotaHistoryTab {
  tabKey: string
  label: string
  rows: UsageReportQuotaHistoryRow[]
}

function compareQuotaHistoryResetDesc(
  a: UsageReportQuotaHistoryRow,
  b: UsageReportQuotaHistoryRow
): number {
  const resetCompare = String(b.expected_reset_at ?? '').localeCompare(
    String(a.expected_reset_at ?? '')
  )
  if (resetCompare !== 0) return resetCompare
  return String(b.interval_start ?? '').localeCompare(
    String(a.interval_start ?? '')
  )
}

function shouldHideQuotaHistoryLane(
  providerLower: string,
  def: { laneLabel: string }
): boolean {
  if (providerLower !== 'anthropic' && providerLower !== 'openai') {
    return false
  }
  return def.laneLabel.toLowerCase().includes('5hr')
}

function shouldSuppressProviderLanePriorBars(
  providerLower: string,
  def: { quotaType: string }
): boolean {
  return (
    providerLower === 'openai' &&
    quotaTypeToLaneKey(def.quotaType) === 'short_special'
  )
}

function quotaHistoryRowMatchesLane(
  providerLower: string,
  def: { quotaType: string; googleClass: string | null; quotaKey?: string },
  row: UsageReportQuotaHistoryRow
): boolean {
  if (quotaTypeToLaneKey(row.quota_type) !== quotaTypeToLaneKey(def.quotaType))
    return false

  if (providerLower === 'antigravity' && def.quotaKey !== undefined) {
    return row.model === def.quotaKey
  }

  if (providerLower === 'google' && def.googleClass !== null) {
    if (row.model === null) return false
    return classifyGeminiModel(row.model) === def.googleClass
  }

  return true
}

function quotaHistoryLaneRank(
  providerLower: string,
  def: { quotaType: string }
): number {
  if (providerLower === 'anthropic') {
    switch (quotaTypeToLaneKey(def.quotaType)) {
      case 'weekly':
        return 0
      case 'special':
        return 1
      default:
        return 2
    }
  }

  return 0
}

function googleQuotaHistoryFamilyLabel(
  googleClass: string | null | undefined
): string {
  switch (googleClass) {
    case 'gemini-flash-lite':
      return 'Flash-Lite'
    case 'gemini-flash':
      return 'Flash'
    case 'gemini-pro':
      return 'Pro'
    default:
      return 'Google'
  }
}

function minIso(values: (string | null)[]): string | null {
  const concrete = values.filter((value): value is string => value !== null)
  return concrete.length === 0 ? null : concrete.sort()[0]
}

function maxIso(values: (string | null)[]): string | null {
  const concrete = values.filter((value): value is string => value !== null)
  const sorted = concrete.sort()
  return sorted.length === 0 ? null : sorted[sorted.length - 1]
}

function minNullableNumber(values: (number | null)[]): number | null {
  const concrete = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  return concrete.length === 0 ? null : Math.min(...concrete)
}

function maxNullableNumber(values: (number | null)[]): number | null {
  const concrete = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  return concrete.length === 0 ? null : Math.max(...concrete)
}

function aggregateQuotaUsageBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): UsageReportQuotaUsageBreakdown[] {
  const byModel = new Map<string, UsageReportQuotaUsageBreakdown>()

  for (const entry of breakdown) {
    const model = entry.model || 'unknown'
    const existing = byModel.get(model)
    if (existing === undefined) {
      byModel.set(model, { ...entry, model })
      continue
    }
    byModel.set(model, {
      model,
      tokens: Math.max(existing.tokens, entry.tokens),
      cost: Math.max(existing.cost, entry.cost),
      traces: Math.max(existing.traces, entry.traces),
      recent_traces_90m:
        existing.recent_traces_90m === undefined &&
        entry.recent_traces_90m === undefined
          ? undefined
          : Math.max(
              existing.recent_traces_90m ?? 0,
              entry.recent_traces_90m ?? 0
            ),
    })
  }

  return [...byModel.values()].sort((a, b) => b.tokens - a.tokens)
}

function quotaHistoryResetGroupKey(row: UsageReportQuotaHistoryRow): string {
  const reset = row.expected_reset_at ?? row.interval_end
  if (reset === null) return 'unknown'
  const laneKey = quotaTypeToLaneKey(row.quota_type)
  const provider = canonicalProvider(row.provider)
  const parsed = new Date(reset)
  if (!Number.isNaN(parsed.getTime())) {
    if (
      laneKey === 'weekly' ||
      laneKey === 'special' ||
      laneKey === 'monthly' ||
      (laneKey === 'short' &&
        (provider === 'google' || provider === 'openrouter'))
    ) {
      return parsed.toISOString().slice(0, 10)
    }
  }
  const rounded = roundToNearest30Min(reset)
  return Number.isNaN(rounded.getTime()) ? reset : rounded.toISOString()
}

function aggregateQuotaHistoryRowsByReset(
  rows: UsageReportQuotaHistoryRow[],
  modelLabel?: string
): UsageReportQuotaHistoryRow[] {
  const grouped = new Map<string, UsageReportQuotaHistoryRow[]>()

  for (const row of rows) {
    const resetKey = quotaHistoryResetGroupKey(row)
    const groupKey = [
      row.provider,
      modelLabel ?? row.model ?? 'all',
      row.quota_type,
      resetKey,
    ].join('|')
    const group = grouped.get(groupKey) ?? []
    group.push(row)
    grouped.set(groupKey, group)
  }

  return [...grouped.values()]
    .map((group) => {
      const first = group[0]
      const resetAt = maxIso(group.map((row) => row.expected_reset_at))
      const usageBreakdown = aggregateQuotaUsageBreakdown(
        group.flatMap((row) => row.usage_breakdown)
      )
      const usageTokens =
        usageBreakdown.length > 0
          ? usageBreakdown.reduce((sum, entry) => sum + entry.tokens, 0)
          : (maxNullableNumber(group.map((row) => row.usage_tokens)) ?? 0)
      return {
        provider: first.provider,
        model: modelLabel ?? first.model,
        quota_type: first.quota_type,
        expected_reset_at: resetAt,
        interval_start: minIso(group.map((row) => row.interval_start)),
        interval_end: resetAt ?? maxIso(group.map((row) => row.interval_end)),
        min_remaining_pct: minNullableNumber(
          group.map((row) => row.min_remaining_pct)
        ),
        max_remaining_pct: maxNullableNumber(
          group.map((row) => row.max_remaining_pct)
        ),
        velocity_segments: [],
        velocity_scores: [],
        velocity_sample_count: 0,
        usage_tokens: usageTokens,
        usage_breakdown: usageBreakdown,
      }
    })
    .sort(compareQuotaHistoryResetDesc)
}

function aggregateGoogleQuotaHistoryRows(
  def: { googleClass: string | null },
  rows: UsageReportQuotaHistoryRow[]
): UsageReportQuotaHistoryRow[] {
  return aggregateQuotaHistoryRowsByReset(
    rows,
    googleQuotaHistoryFamilyLabel(def.googleClass)
  )
}

function fallbackQuotaHistoryLabel(quotaType: string): string {
  switch (quotaTypeToLaneKey(quotaType)) {
    case 'short':
      return 'Requests · 24h'
    case 'weekly':
      return 'All Models · 7d'
    case 'special':
      return 'Special · 7d'
    case 'short_special':
      return 'Special · 5hr'
    case 'monthly':
      return 'All Models · 30d'
    case 'wtus':
      return 'WTUs'
    default:
      return quotaType
  }
}

export function buildProviderQuotaHistoryTabs(
  provider: string,
  rows: UsageReportQuotaHistoryRow[]
): ProviderQuotaHistoryTab[] {
  const providerLower = canonicalProvider(provider).toLowerCase()
  const laneDefs = (PROVIDER_LANE_DEFS[providerLower] ?? [])
    .filter((def) => !shouldHideQuotaHistoryLane(providerLower, def))
    .sort(
      (a, b) =>
        quotaHistoryLaneRank(providerLower, a) -
        quotaHistoryLaneRank(providerLower, b)
    )

  if (laneDefs.length > 0) {
    return laneDefs.map((def) => {
      const laneRows = rows
        .filter((row) => quotaHistoryRowMatchesLane(providerLower, def, row))
        .sort(compareQuotaHistoryResetDesc)
      const displayRows =
        providerLower === 'google'
          ? aggregateGoogleQuotaHistoryRows(def, laneRows)
          : aggregateQuotaHistoryRowsByReset(laneRows)
      return {
        tabKey: def.laneKey,
        label: def.laneLabel,
        rows: displayRows.filter(quotaHistoryHasUsage),
      }
    })
  }

  const grouped = new Map<string, UsageReportQuotaHistoryRow[]>()
  for (const row of rows) {
    const key = quotaTypeToLaneKey(row.quota_type)
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map(([quotaType, group]) => ({
      tabKey: `${providerLower}/${quotaType}`,
      label: fallbackQuotaHistoryLabel(quotaType),
      rows: group.sort(compareQuotaHistoryResetDesc),
    }))
    .sort((a, b) => {
      const aNewest = a.rows[0]?.expected_reset_at ?? ''
      const bNewest = b.rows[0]?.expected_reset_at ?? ''
      return String(bNewest).localeCompare(String(aNewest))
    })
}
export function localFallbackRange(): { from: string; to: string } {
  const today = formatDashboardDate(new Date())
  return {
    from: addDaysToDateString(today, -30),
    to: addDaysToDateString(today, 1),
  }
}
function mergeMin(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.min(current, value)
}

function mergeMax(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.max(current, value)
}

function deriveProbeBackedCategory(
  group: UsageReportProviderLatencyHealthRow[],
  maxP95: number | null,
  eventCount: number,
  missingUpstreamLatency: number
): CellDef['category'] | undefined {
  if (eventCount > 0) return undefined
  if (missingUpstreamLatency > 0 && maxP95 === null) return 'miss'

  let statusProbeCount = 0
  let minStatusProbeSuccessPct: number | null = null
  let minControlProbeSuccessPct: number | null = null
  let maxProviderPacketLossPct: number | null = null
  let maxControlPacketLossPct: number | null = null
  let maxProviderDeltaMs: number | null = null
  let probeFailureCount = 0
  let hasProbeData = false

  for (const row of group) {
    statusProbeCount += row.status_probe_count
    minStatusProbeSuccessPct = mergeMin(
      minStatusProbeSuccessPct,
      row.status_probe_success_pct
    )
    minControlProbeSuccessPct = mergeMin(
      minControlProbeSuccessPct,
      row.control_probe_success_pct
    )
    maxProviderPacketLossPct = mergeMax(
      maxProviderPacketLossPct,
      row.provider_ping_packet_loss_pct
    )
    maxControlPacketLossPct = mergeMax(
      maxControlPacketLossPct,
      row.control_packet_loss_pct
    )
    maxProviderDeltaMs = mergeMax(
      maxProviderDeltaMs,
      row.provider_ping_minus_control_ms
    )
    probeFailureCount +=
      row.dns_failures + row.tcp_failures + row.tls_failures + row.icmp_failures

    hasProbeData =
      hasProbeData ||
      row.status_probe_count > 0 ||
      row.status_probe_success_pct !== null ||
      row.status_probe_p95_ms !== null ||
      row.provider_ping_avg_ms !== null ||
      row.provider_ping_packet_loss_pct !== null ||
      row.control_ping_avg_ms !== null ||
      row.control_packet_loss_pct !== null ||
      row.control_probe_success_pct !== null ||
      row.provider_ping_minus_control_ms !== null
  }

  if (!hasProbeData) return undefined

  if (
    (statusProbeCount > 0 && minStatusProbeSuccessPct === 0) ||
    (maxProviderPacketLossPct ?? 0) >= 100
  ) {
    return 'red'
  }

  if (
    probeFailureCount > 0 ||
    (minStatusProbeSuccessPct !== null && minStatusProbeSuccessPct < 100) ||
    (minControlProbeSuccessPct !== null && minControlProbeSuccessPct < 100) ||
    (maxProviderPacketLossPct ?? 0) > 0 ||
    (maxControlPacketLossPct ?? 0) > 0 ||
    (maxProviderDeltaMs ?? 0) > 250
  ) {
    return 'orange'
  }

  if (maxP95 !== null) return undefined

  return 'green'
}

function makeNoDataHealthCell(): CellDef {
  return {
    color: 'var(--card-2)',
    rawP95Ms: null,
    rawErrorCount: 0,
  }
}

function bucketKeyFromIso(value: string | null): string | null {
  if (value == null) return null
  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(Math.floor(ms / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS)
    .toISOString()
    .replace('.000Z', '.000Z')
}

function formatHealthEventTime(value: string | null): string {
  if (value == null) return '--'
  return `${formatDashboardTime(value)}:`
}

function compactErrorMessage(value: string | null): string | null {
  if (value == null) return null
  const cleaned = value
    .replace(/\bb(['"])(.*?)\1/g, '$2')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return null
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned
}

function humanizeSignal(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatObservationEventDescription(
  observation: UsageReportProviderErrorObservationRow
): string {
  const status =
    observation.status_code !== null
      ? observation.status_code.toString()
      : 'status unknown'
  const errorClass =
    observation.error_class !== 'unknown'
      ? humanizeSignal(observation.error_class)
      : humanizeSignal(observation.error_type)
  // Verbatim upstream error_message is rendered in tooltips only (text content);
  // treat as a content-spoof / social-engineering vector, not a code-exec path.
  const message = compactErrorMessage(observation.error_message)
  if (message !== null) return `${status} ${errorClass} / ${message}`

  const code =
    observation.error_code !== '' && observation.error_code !== 'unknown'
      ? humanizeSignal(observation.error_code)
      : humanizeSignal(observation.error_type)
  return `${status} ${errorClass} / ${code}`
}

function modelEventLabel(
  provider: string,
  model: string,
  includeProvider: boolean
): string {
  const modelLabel = model !== 'unknown' ? model : 'unknown'
  return includeProvider
    ? `${canonicalProvider(provider)}/${modelLabel}`
    : modelLabel
}

function buildObservationEventsByBucket(
  observations: UsageReportProviderErrorObservationRow[],
  includeProviderInLabel: boolean
): Map<string, HealthStripEvent[]> {
  const eventsByBucket = new Map<string, HealthStripEvent[]>()

  for (const observation of observations) {
    const bucketKey = bucketKeyFromIso(observation.observed_at)
    if (bucketKey === null) continue

    const existing = eventsByBucket.get(bucketKey) ?? []
    existing.push({
      time: formatHealthEventTime(observation.observed_at),
      model: modelEventLabel(
        observation.provider,
        observation.model,
        includeProviderInLabel
      ),
      errorType: formatObservationEventDescription(observation),
      count: 1,
      observedAt: observation.observed_at ?? undefined,
    })
    eventsByBucket.set(bucketKey, existing)
  }

  return eventsByBucket
}

function buildProbeEventDescription(
  kind: string,
  detail: string | number | null
): string {
  return detail === null ? `degraded ${kind}` : `degraded ${kind} / ${detail}`
}

function buildProbeEventsForGroup(
  group: UsageReportProviderLatencyHealthRow[],
  bucketStart: string | undefined,
  includeProviderInLabel: boolean
): HealthStripEvent[] {
  if (bucketStart === undefined) return []
  const time = formatHealthEventTime(bucketStart)
  const events: HealthStripEvent[] = []

  for (const row of group) {
    const label = modelEventLabel(
      row.provider,
      row.model,
      includeProviderInLabel
    )
    const observedAt = bucketStart
    const probeFailures =
      row.dns_failures + row.tcp_failures + row.tls_failures + row.icmp_failures
    if (probeFailures > 0) {
      const parts = [
        row.dns_failures > 0 ? `dns ${row.dns_failures.toString()}` : null,
        row.tcp_failures > 0 ? `tcp ${row.tcp_failures.toString()}` : null,
        row.tls_failures > 0 ? `tls ${row.tls_failures.toString()}` : null,
        row.icmp_failures > 0 ? `icmp ${row.icmp_failures.toString()}` : null,
      ].filter((part): part is string => part !== null)
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'probe failure',
          parts.join(', ')
        ),
        count: probeFailures,
        observedAt,
      })
    }
    if (
      row.status_probe_count > 0 &&
      row.status_probe_success_pct !== null &&
      row.status_probe_success_pct < 100
    ) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'provider probe',
          `${row.status_probe_success_pct.toFixed(0)}% success`
        ),
        count: 1,
        observedAt,
      })
    }
    if (
      row.control_probe_success_pct !== null &&
      row.control_probe_success_pct < 100
    ) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'control probe',
          `${row.control_probe_success_pct.toFixed(0)}% success`
        ),
        count: 1,
        observedAt,
      })
    }
    if ((row.provider_ping_packet_loss_pct ?? 0) > 0) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'provider packet loss',
          `${(row.provider_ping_packet_loss_pct ?? 0).toFixed(1)}%`
        ),
        count: 1,
        observedAt,
      })
    }
    if ((row.control_packet_loss_pct ?? 0) > 0) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'control packet loss',
          `${(row.control_packet_loss_pct ?? 0).toFixed(1)}%`
        ),
        count: 1,
        observedAt,
      })
    }
    if ((row.provider_ping_minus_control_ms ?? 0) > 250) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'provider latency delta',
          `${(row.provider_ping_minus_control_ms ?? 0).toFixed(0)}ms`
        ),
        count: 1,
        observedAt,
      })
    }
  }

  return events
}

function buildHealthCellFromGroup(
  group: UsageReportProviderLatencyHealthRow[],
  observationEventsByBucket: Map<string, HealthStripEvent[]>,
  includeProviderInEvents: boolean
): CellDef {
  // Max non-null passive p95 across all tuples in this bucket. Prefer the
  // exact upstream split, but fall back to total request latency for provider
  // routes that recorded timing without upstream sub-span attribution.
  let maxP95: number | null = null
  for (const r of group) {
    const passiveP95 = r.upstream_p95_ms ?? r.total_p95_ms
    if (passiveP95 !== null) {
      maxP95 = maxP95 === null ? passiveP95 : Math.max(maxP95, passiveP95)
    }
  }

  // Summed error-class counters.
  let sumProviderError = 0
  let sum5xx = 0
  let sumTimeout = 0
  let sumNetwork = 0
  let sumRateLimit = 0
  let sumCapacity = 0
  let sumMissingUpstreamLatency = 0
  let probeFailures = 0
  let providerProbeDegraded = 0
  let controlProbeDegraded = 0
  let providerPacketLoss = 0
  let controlPacketLoss = 0
  let providerLatencyDelta = 0

  for (const r of group) {
    sumProviderError += r.provider_error_events
    sum5xx += r.provider_5xx_events
    sumTimeout += r.provider_timeout_events
    sumNetwork += r.network_error_events
    sumRateLimit += r.rate_limit_events
    sumCapacity += r.capacity_events
    sumMissingUpstreamLatency += r.missing_upstream_latency
    probeFailures +=
      r.dns_failures + r.tcp_failures + r.tls_failures + r.icmp_failures
    if (
      r.status_probe_count > 0 &&
      r.status_probe_success_pct !== null &&
      r.status_probe_success_pct < 100
    ) {
      providerProbeDegraded += 1
    }
    if (
      r.control_probe_success_pct !== null &&
      r.control_probe_success_pct < 100
    ) {
      controlProbeDegraded += 1
    }
    if ((r.provider_ping_packet_loss_pct ?? 0) > 0) {
      providerPacketLoss += 1
    }
    if ((r.control_packet_loss_pct ?? 0) > 0) {
      controlPacketLoss += 1
    }
    if ((r.provider_ping_minus_control_ms ?? 0) > 250) {
      providerLatencyDelta += 1
    }
  }

  const eventCount =
    sumProviderError +
    sum5xx +
    sumTimeout +
    sumNetwork +
    sumRateLimit +
    sumCapacity
  const degradedCount =
    probeFailures +
    providerProbeDegraded +
    controlProbeDegraded +
    providerPacketLoss +
    controlPacketLoss +
    providerLatencyDelta

  const rawErrorBreakdown: CellDef['rawErrorBreakdown'] =
    eventCount > 0
      ? {
          provider_error_events: sumProviderError,
          provider_5xx_events: sum5xx,
          provider_timeout_events: sumTimeout,
          network_error_events: sumNetwork,
          rate_limit_events: sumRateLimit,
          capacity_events: sumCapacity,
        }
      : undefined
  const rawDegradedBreakdown: CellDef['rawDegradedBreakdown'] =
    degradedCount > 0
      ? {
          probe_failures: probeFailures,
          provider_probe_degraded: providerProbeDegraded,
          control_probe_degraded: controlProbeDegraded,
          provider_packet_loss: providerPacketLoss,
          control_packet_loss: controlPacketLoss,
          provider_latency_delta: providerLatencyDelta,
        }
      : undefined

  const bucketStart = group.find((r) => r.bucket_start != null)?.bucket_start
  const bucketKey =
    bucketStart != null
      ? (bucketKeyFromIso(bucketStart) ?? String(bucketStart))
      : null
  const events = [
    ...(bucketKey !== null
      ? (observationEventsByBucket.get(bucketKey) ?? [])
      : []),
    ...buildProbeEventsForGroup(
      group,
      bucketStart ?? undefined,
      includeProviderInEvents
    ),
  ]
  const category = deriveProbeBackedCategory(
    group,
    maxP95,
    eventCount,
    sumMissingUpstreamLatency
  )

  return {
    color: 'var(--card-2)',
    bucketStart: bucketStart ?? undefined,
    eventCount: eventCount > 0 ? eventCount : undefined,
    degradedCount: degradedCount > 0 ? degradedCount : undefined,
    ...(events.length > 0 ? { events } : {}),
    rawP95Ms: maxP95,
    rawErrorCount: eventCount > 0 ? eventCount : 0,
    ...(category !== undefined ? { category } : {}),
    rawErrorBreakdown,
    rawDegradedBreakdown,
  }
}

function padHealthCellsFromRows(
  providerRows: UsageReportProviderLatencyHealthRow[],
  observationEventsByBucket: Map<string, HealthStripEvent[]>,
  includeProviderInEvents: boolean
): CellDef[] {
  const bucketMap = new Map<string, UsageReportProviderLatencyHealthRow[]>()
  providerRows.forEach((row, idx) => {
    const normalized =
      row.bucket_start != null ? bucketKeyFromIso(row.bucket_start) : null
    const key =
      normalized ??
      (row.bucket_start != null
        ? String(row.bucket_start)
        : `__missing_${idx.toString()}__`)
    const group = bucketMap.get(key)
    if (group !== undefined) {
      group.push(row)
    } else {
      bucketMap.set(key, [row])
    }
  })

  const cellsDesc: CellDef[] = Array.from(bucketMap.values()).map((group) =>
    buildHealthCellFromGroup(
      group,
      observationEventsByBucket,
      includeProviderInEvents
    )
  )
  const cells = cellsDesc.reverse()

  // _padHealthCellsForTest expects exactly HEALTH_CELL_COUNT cells. Production
  // ProviderCard also passes these through HealthStrip, which no-ops when length
  // is already 288 (S3-15/16: strip owns pad only for shorter arrays).
  if (cells.length >= HEALTH_CELL_COUNT) {
    return cells.slice(cells.length - HEALTH_CELL_COUNT)
  }

  const pad = Array.from<CellDef>({
    length: HEALTH_CELL_COUNT - cells.length,
  }).map(() => makeNoDataHealthCell())
  return [...pad, ...cells]
}

/**
 * Pads or truncates a health cell array to exactly HEALTH_CELL_COUNT entries.
 * Missing cells are filled through the raw no-data path so they render blue.
 *
 * Wave 24-PhosphorDash (operator F1a): wires CellDef hover metadata —
 * `bucketStart` from health row bucket_start, `eventCount` from aggregate
 * error/timeout/rate-limit/capacity counts, and `events: []` (no per-event
 * detail is available at health-row granularity from the API).
 *
 * Wave 30-Track5: The API returns multiple rows per 5-minute bucket (one per
 * environment × model × model_group tuple). Prior code mapped every row to its
 * own cell, inflating the cell count and causing the tail-slice to discard the
 * newest buckets. Fix: collapse rows by bucket_start first (Step 1), then emit
 * one CellDef per bucket using max p95 / summed error counts (Step 2). The
 * resulting array is reversed to ASC order (oldest → newest) so that the strip
 * renders correctly with the oldest cell on the left (-24h) and the newest on
 * the right (now).
 */
export function padHealthCells(
  rows: UsageReportProviderLatencyHealthRow[],
  provider: string,
  errorObservations: UsageReportProviderErrorObservationRow[] = []
): CellDef[] {
  // 15-B.2: use alias map so 'google' also picks up 'gemini' health rows
  const aliases = providerAliases(provider)
  const providerRows = rows.filter((r) =>
    aliases.includes(r.provider.toLowerCase())
  )
  const providerObservations = errorObservations.filter((observation) => {
    const providerLower = observation.provider.toLowerCase()
    return (
      aliases.includes(providerLower) ||
      aliases.includes(canonicalProvider(providerLower))
    )
  })
  const observationEventsByBucket = buildObservationEventsByBucket(
    providerObservations,
    false
  )

  return padHealthCellsFromRows(providerRows, observationEventsByBucket, false)
}

export function buildAggregateHealthCells(
  rows: UsageReportProviderLatencyHealthRow[],
  errorObservations: UsageReportProviderErrorObservationRow[] = []
): CellDef[] {
  const aggregateRows = rows.filter((row) => {
    const provider = row.provider.toLowerCase()
    return provider !== 'proxy_internal' && provider !== 'aggregate'
  })
  const aggregateObservations = errorObservations.filter((observation) => {
    const provider = canonicalProvider(observation.provider).toLowerCase()
    return provider !== 'proxy_internal' && provider !== 'aggregate'
  })
  const observationEventsByBucket = buildObservationEventsByBucket(
    aggregateObservations,
    true
  )
  return padHealthCellsFromRows(aggregateRows, observationEventsByBucket, true)
}

/**
 * Builds ProviderMetrics from latency health rows and per-row usage data for
 * a specific provider.
 *
 * Wave 11 PR2 (11-g): token_in / token_out / usd_cost / traces and cache /
 * reasoning fields are now aggregated from `rows` (UsageReportRow[]) filtered
 * to the matching provider, resolving the $0 / 0-tokens bug.
 */
export function buildProviderMetrics(
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[],
  rows: UsageReportRow[],
  now: Date = new Date()
): ProviderMetrics {
  // 15-B.2: expand canonical provider key to all DB aliases
  // (e.g. 'google' → ['google','gemini'] so gemini health rows are included)
  const aliases = providerAliases(provider)
  const providerHealthRows = healthRows.filter((r) =>
    aliases.includes(r.provider.toLowerCase())
  )
  const providerUsageRows = rows.filter((r) =>
    aliases.includes((r.provider ?? '').toLowerCase())
  )

  const requests = providerHealthRows.reduce((s, r) => s + r.requests, 0)
  const recent_requests_90m = sumRequestsInLast90mFromNewestBucket(
    providerHealthRows,
    now
  )
  const errors = providerHealthRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )

  // 15-B.1: providerLatencyHealth is ordered bucket_start DESC (newest first).
  // The original code used `[length - 1]` (oldest row), which consistently
  // has upstream_p95_ms = null (no-traffic tail buckets). Fix: scan from
  // index 0 (most-recent) and pick the first row with a non-null p95. Use
  // total_p95_ms as a fallback for local routes that do not emit upstream spans.
  const latestP95Row = providerHealthRows.find(
    (r) => (r.upstream_p95_ms ?? r.total_p95_ms) !== null
  )
  const p95 =
    latestP95Row !== undefined
      ? (latestP95Row.upstream_p95_ms ?? latestP95Row.total_p95_ms ?? 0)
      : 0

  // Wave 14-C: rate_limits, capacity from health rows; packet_loss from ping probe.
  const rate_limits = providerHealthRows.reduce(
    (s, r) => s + r.rate_limit_events,
    0
  )
  const capacity = providerHealthRows.reduce((s, r) => s + r.capacity_events, 0)
  // Use average packet loss across all health rows that have data; null if none probed.
  const packetLossValues = providerHealthRows
    .map((r) => r.provider_ping_packet_loss_pct)
    .filter((v): v is number => v !== null)
  const packet_loss_pct =
    packetLossValues.length > 0
      ? packetLossValues.reduce((s, v) => s + v, 0) / packetLossValues.length
      : null

  // Aggregate per-provider token / cost / cache / reasoning from usage rows
  const tokens_in = providerUsageRows.reduce((s, r) => s + (r.token_in ?? 0), 0)
  const tokens_out = providerUsageRows.reduce(
    (s, r) => s + (r.token_out ?? 0),
    0
  )
  const cost_usd = providerUsageRows.reduce((s, r) => s + (r.usd_cost ?? 0), 0)
  const traces = providerUsageRows.reduce((s, r) => s + (r.traces ?? 0), 0)
  const cache_input = providerUsageRows.reduce(
    (s, r) => s + (r.token_cache_input ?? 0),
    0
  )
  const cache_creation = providerUsageRows.reduce(
    (s, r) => s + (r.token_cache_creation ?? 0),
    0
  )
  // Wave 14-C: cache_miss_usd from cache_miss_usd_cost API field (dollar cost of misses).
  const cache_miss_usd = providerUsageRows.reduce(
    (s, r) => s + (r.cache_miss_usd_cost ?? 0),
    0
  )
  const reasoning_reported = providerUsageRows.reduce(
    (s, r) => s + (r.token_reasoning_reported ?? 0),
    0
  )
  const reasoning_estimated = providerUsageRows.reduce(
    (s, r) => s + (r.token_reasoning_estimated ?? 0),
    0
  )
  return {
    tokens_in,
    tokens_out,
    cost_usd,
    requests,
    errors,
    p95_ms: p95,
    cache_input,
    cache_creation,
    cache_miss_usd,
    reasoning_reported,
    reasoning_estimated,
    recent_requests_90m,
    traces,
    rate_limits,
    capacity,
    packet_loss_pct,
  }
}

/**
 * Builds aggregate ProviderMetrics by summing across all providers.
 *
 * Wave 11 PR2 (11-g item 4): token / cost / cache / reasoning totals were
 * previously derived from `rows` (all UsageReportRow entries). However, the
 * server caps `report.rows` at 500 entries, causing systematic 20-30%
 * undercounts in the Aggregate card when real usage exceeds 500 rows.
 *
 * Wave 16-D: restores summary-based aggregation for token / cost / cache /
 * reasoning / trace totals. `report.summary` is computed server-side from the
 * full untruncated dataset, so it always matches the KPI strip values.
 * Health-derived metrics (requests, errors, p95_ms, rate_limits, capacity,
 * packet_loss_pct) are unaffected — they come from health rows, not usage rows.
 */
export function buildAggregateMetrics(
  healthRows: UsageReportProviderLatencyHealthRow[],
  summary: UsageReportSummary | undefined,
  now: Date = new Date()
): ProviderMetrics {
  const requests = healthRows.reduce((s, r) => s + r.requests, 0)
  const recent_requests_90m = sumRequestsInLast90mFromNewestBucket(
    healthRows,
    now
  )
  const errors = healthRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )
  // Fleet-wide P95: requests-weighted average with total-latency fallback for
  // providers that do not emit upstream spans.
  const p95 = computeFleetP95(healthRows)

  // Wave 14-C: aggregate rate_limits, capacity, packet_loss across all health rows.
  const rate_limits = healthRows.reduce((s, r) => s + r.rate_limit_events, 0)
  const capacity = healthRows.reduce((s, r) => s + r.capacity_events, 0)
  const packetLossValues = healthRows
    .map((r) => r.provider_ping_packet_loss_pct)
    .filter((v): v is number => v !== null)
  const packet_loss_pct =
    packetLossValues.length > 0
      ? packetLossValues.reduce((s, v) => s + v, 0) / packetLossValues.length
      : null

  // Wave 16-D: use summary (server-side full-dataset totals) to avoid the
  // row-cap undercount. When summary is undefined (data still loading), return
  // zeros for these fields.
  const tokens_in = summary?.token_in ?? 0
  const tokens_out = summary?.token_out ?? 0
  const cost_usd = summary?.usd_cost ?? 0
  const traces = summary?.traces ?? 0
  const cache_input = summary?.token_cache_input ?? 0
  const cache_creation = summary?.token_cache_creation ?? 0
  // Wave 14-C: cache_miss_usd from summary's cache_miss_usd_cost field.
  const cache_miss_usd = summary?.cache_miss_usd_cost ?? 0
  const reasoning_reported = summary?.token_reasoning_reported ?? 0
  const reasoning_estimated = summary?.token_reasoning_estimated ?? 0
  return {
    tokens_in,
    tokens_out,
    cost_usd,
    requests,
    errors,
    p95_ms: p95,
    cache_input,
    cache_creation,
    cache_miss_usd,
    reasoning_reported,
    reasoning_estimated,
    recent_requests_90m,
    traces,
    rate_limits,
    capacity,
    packet_loss_pct,
  }
}

/**
 * Maps a consumed-percent value to the appropriate iv-* threshold CSS class.
 *
 * Wave 11 PR3 (11-h): classes now key on consumed% (100 − remaining%) so
 * colours align with intuitive severity — high consumption = red/amber.
 *   <5%  consumed → iv-0-5  (dim cool — nearly empty bar)
 *   5–10%         → iv-5-10 (cool blue)
 *   10–25%        → iv-10-25 (teal)
 *   25–50%        → iv-25-50 (amber)
 *   ≥50%          → iv-50-p  (red — more than half consumed)
 */
function ivClassForConsumed(consumedPct: number): string {
  if (consumedPct >= 50) return 'iv-50-p'
  if (consumedPct >= 25) return 'iv-25-50'
  if (consumedPct >= 10) return 'iv-10-25'
  if (consumedPct >= 5) return 'iv-5-10'
  return 'iv-0-5'
}

function velocityClassForScore(score: number): string | undefined {
  if (score >= 100) return 'velocity-peak'
  if (score >= 25) return 'velocity-hot'
  if (score >= 5) return 'velocity-fast'
  if (score >= 0.75) return 'velocity-steady'
  if (score > 0) return 'velocity-slow'
  return undefined
}

type QuotaIntervalKind =
  | 'short'
  | 'weekly'
  | 'special'
  | 'short_special'
  | 'monthly'
  | 'wtus'

/**
 * Builds 100 one-percent QuotaRowConfig segments for a single quota interval
 * row. Consumed segments are filled from the left; unconsumed quota remains
 * dim. Backend-supplied velocity flags mark only the percent buckets where
 * consumption outran the reset-window time budget.
 */
function buildQuotaSegments(
  remainingPct: number,
  velocitySegments?: readonly boolean[],
  velocityScores?: readonly number[]
): QuotaRowConfig[] {
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))
  const SEGMENTS = 100
  const consumedWholeSegments = Math.floor(consumedPct)
  const consumedSegmentLimit = Math.ceil(consumedPct)

  // Severity class for the consumed portion — based on overall consumed level.
  const consumedClass = ivClassForConsumed(consumedPct)

  return Array.from({ length: SEGMENTS }, (_, i) => {
    const isConsumed = i < consumedWholeSegments
    const isBoundary = i === consumedWholeSegments && i < consumedSegmentLimit
    let severityClass: string

    if (isConsumed) {
      severityClass = consumedClass
    } else if (isBoundary) {
      severityClass = consumedPct >= 99.5 ? consumedClass : 'iv-5-10'
    } else {
      severityClass = 'iv-0-5'
    }

    const score = velocityScores?.[i] ?? 0
    const hasVelocityData = score > 0 && i < consumedSegmentLimit
    const velocityClass = hasVelocityData
      ? velocityClassForScore(score)
      : undefined
    const highVelocity =
      velocityClass === 'velocity-fast' ||
      velocityClass === 'velocity-hot' ||
      velocityClass === 'velocity-peak'

    void velocitySegments

    return {
      widthPct: 100 / SEGMENTS,
      severityClass,
      highVelocity,
      velocityClass,
    }
  })
}

/**
 * Builds QuotaBarGroup[] from all quota rows for a single provider.
 *
 * Wave 11 PR3 (11-h): replaces the legacy flat QuotaRowConfig[] return.
 * Each active interval type (weekly, short, special, monthly) produces one
 * QuotaBarGroup whose `segments` field holds the 100-segment array.
 */
function buildQuotaIntervals(
  quotaRows: UsageReportQuotaRow[],
  provider: string
): QuotaBarGroup[] {
  const providerQuotas = quotaRows.filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  )
  if (providerQuotas.length === 0) return []

  const result: QuotaBarGroup[] = []
  for (const row of providerQuotas) {
    // F-QB-1 / 15-B.10: Added short_special so openai's exhausted
    // short_special_remaining_pct=0 (and similar) is rendered.
    // Include interval metadata so tooltip window and velocity can be derived.
    const candidates = [
      {
        remainingPct: row.weekly_remaining_pct,
        active: row.weekly_active,
        label: 'Weekly',
        interval: 'weekly' as const,
        resetAt: row.weekly_reset_at ?? undefined,
        usedTokens: row.weekly_usage_tokens,
        intervalStart: row.weekly_interval_start,
        intervalEnd: row.weekly_interval_end,
        durationHours: quotaDurationHours(provider, 'weekly'),
        velocitySegments: row.weekly_velocity_segments,
        velocityScores: row.weekly_velocity_scores,
      },
      {
        remainingPct: row.short_remaining_pct,
        active: row.short_active,
        label: 'Short',
        interval: 'short' as const,
        resetAt: row.short_reset_at ?? undefined,
        usedTokens: row.short_usage_tokens,
        intervalStart: row.short_interval_start,
        intervalEnd: row.short_interval_end,
        durationHours: quotaDurationHours(provider, 'short'),
        velocitySegments: row.short_velocity_segments,
        velocityScores: row.short_velocity_scores,
      },
      {
        remainingPct: row.special_remaining_pct,
        active: row.special_active,
        label: 'Special',
        interval: 'special' as const,
        resetAt: row.special_reset_at ?? undefined,
        usedTokens: row.special_usage_tokens,
        intervalStart: row.special_interval_start,
        intervalEnd: row.special_interval_end,
        durationHours: quotaDurationHours(provider, 'special'),
        velocitySegments: row.special_velocity_segments,
        velocityScores: row.special_velocity_scores,
      },
      {
        remainingPct: row.short_special_remaining_pct,
        active: row.short_special_active,
        label: 'Short-Special',
        interval: 'short_special' as const,
        resetAt: row.short_special_reset_at ?? undefined,
        usedTokens: row.short_special_usage_tokens,
        intervalStart: row.short_special_interval_start,
        intervalEnd: row.short_special_interval_end,
        durationHours: quotaDurationHours(provider, 'short_special'),
        velocitySegments: row.short_special_velocity_segments,
        velocityScores: row.short_special_velocity_scores,
      },
      {
        remainingPct: row.monthly_remaining_pct,
        active: row.monthly_active,
        label: 'Monthly',
        interval: 'monthly' as const,
        resetAt: row.monthly_reset_at ?? undefined,
        usedTokens: row.monthly_usage_tokens,
        intervalStart: row.monthly_interval_start,
        intervalEnd: row.monthly_interval_end,
        durationHours: quotaDurationHours(provider, 'monthly'),
        velocitySegments: row.monthly_velocity_segments,
        velocityScores: row.monthly_velocity_scores,
      },
      {
        remainingPct: row.wtus_remaining_pct,
        active: row.wtus_active ?? false,
        label: 'WTUs',
        interval: 'wtus' as const,
        resetAt: row.wtus_reset_at ?? undefined,
        usedTokens: row.wtus_usage_tokens ?? 0,
        intervalStart: row.wtus_interval_start ?? null,
        intervalEnd: row.wtus_interval_end ?? null,
        durationHours: quotaDurationHours(provider, 'wtus'),
        velocitySegments: row.wtus_velocity_segments,
        velocityScores: row.wtus_velocity_scores,
      },
    ]

    for (const candidate of candidates) {
      if (!candidate.active || candidate.remainingPct == null) continue
      const consumedPct = Math.max(
        0,
        Math.min(100, 100 - candidate.remainingPct)
      )
      result.push({
        label: candidate.label,
        consumedPct,
        remainingPct: candidate.remainingPct,
        resetAt: candidate.resetAt,
        segments: buildQuotaSegments(
          candidate.remainingPct,
          candidate.velocitySegments,
          candidate.velocityScores
        ),
        tipWindow: formatTipWindow(
          candidate.interval,
          candidate.intervalStart,
          candidate.intervalEnd,
          candidate.resetAt ?? null,
          candidate.durationHours
        ),
        tipVelocity: formatTipVelocity(
          consumedPct,
          candidate.resetAt ?? null,
          candidate.durationHours
        ),
      })
    }
  }

  return result
}

/**
 * Classifies a raw model string into a Google quota class label.
 *
 * API quota rows for Google have model names like 'gemini-2.5-pro',
 * 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', etc.
 * The mockup aggregates these into three display classes per F1:
 *   gemini-*-pro*  → 'gemini-pro'
 *   gemini-*-flash-lite* → 'gemini-flash-lite'
 *   gemini-*-flash* → 'gemini-flash'  (must be checked AFTER flash-lite)
 *
 * Returns null for non-gemini or unrecognised model strings.
 */
export function classifyGeminiModel(model: string): string | null {
  const lower = model.toLowerCase()
  if (!lower.startsWith('gemini-')) return null
  if (lower.includes('flash-lite')) return 'gemini-flash-lite'
  if (lower.includes('flash')) return 'gemini-flash'
  if (lower.includes('pro')) return 'gemini-pro'
  return null
}

/** Canonical provider + lowercase model key for joins across usage/health/status. */
export function keyFor(provider: string, model: string): string {
  const p = canonicalProvider(provider ?? '')
  const m = (model ?? '').toLowerCase()
  return `${p}::${m}`
}

function googleShortIntervalStartMs(row: UsageReportQuotaRow): number {
  const iso = row.short_interval_start
  if (iso == null) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Prefer the row with the most recent short_interval_start for a Gemini class. */
export function pickBestGoogleQuotaRowForClass(
  providerRows: UsageReportQuotaRow[],
  googleClass: string
): UsageReportQuotaRow | null {
  let best: UsageReportQuotaRow | null = null
  let bestMs = -1
  for (const row of providerRows) {
    if (row.model === null) continue
    if (classifyGeminiModel(row.model) !== googleClass) continue
    const ms = googleShortIntervalStartMs(row)
    if (ms > bestMs) {
      bestMs = ms
      best = row
    }
  }
  return best
}

/**
 * Sums request counts in the 90 minutes ending at the newest health bucket_start
 * (rolling window anchored on latest data, not wall-clock `now` alone).
 */
export function sumRequestsInLast90mFromNewestBucket(
  rows: UsageReportProviderLatencyHealthRow[],
  now: Date
): number {
  let newestMs = 0
  for (const row of rows) {
    if (row.bucket_start == null) continue
    const t = new Date(row.bucket_start).getTime()
    if (Number.isFinite(t) && t > newestMs) newestMs = t
  }
  const anchorMs = newestMs > 0 ? newestMs : now.getTime()
  const recentCutoffMs = anchorMs - 90 * 60 * 1000
  return rows
    .filter((row) => {
      if (row.bucket_start === null) return false
      const time = new Date(row.bucket_start).getTime()
      return Number.isFinite(time) && time >= recentCutoffMs
    })
    .reduce((s, r) => s + r.requests, 0)
}

/**
 * Returns the best single remaining-pct from an active interval, given:
 *   - short  → '5h'
 *   - weekly → '7d'
 *   - special → '5h' (same period bucket; takes priority over short when active)
 *   - short_special → '5h'
 *   - monthly → 'monthly'
 *   - short → '24h' (for Google — caller maps intervals to display labels)
 *
 * Used by buildQuotaRows to extract single-interval bars per provider.
 */
function extractInterval(
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): {
  remainingPct: number
  resetAt: string | undefined
  velocitySegments?: readonly boolean[]
  velocityScores?: readonly number[]
} | null {
  switch (interval) {
    case 'short':
      if (!row.short_active || row.short_remaining_pct === null) return null
      return {
        remainingPct: row.short_remaining_pct,
        resetAt: row.short_reset_at ?? undefined,
        velocitySegments: row.short_velocity_segments,
        velocityScores: row.short_velocity_scores,
      }
    case 'weekly':
      if (!row.weekly_active || row.weekly_remaining_pct === null) return null
      return {
        remainingPct: row.weekly_remaining_pct,
        resetAt: row.weekly_reset_at ?? undefined,
        velocitySegments: row.weekly_velocity_segments,
        velocityScores: row.weekly_velocity_scores,
      }
    case 'special':
      if (!row.special_active || row.special_remaining_pct === null) return null
      return {
        remainingPct: row.special_remaining_pct,
        resetAt: row.special_reset_at ?? undefined,
        velocitySegments: row.special_velocity_segments,
        velocityScores: row.special_velocity_scores,
      }
    case 'short_special':
      if (!row.short_special_active || row.short_special_remaining_pct === null)
        return null
      return {
        remainingPct: row.short_special_remaining_pct,
        resetAt: row.short_special_reset_at ?? undefined,
        velocitySegments: row.short_special_velocity_segments,
        velocityScores: row.short_special_velocity_scores,
      }
    case 'monthly':
      if (!row.monthly_active || row.monthly_remaining_pct === null) return null
      return {
        remainingPct: row.monthly_remaining_pct,
        resetAt: row.monthly_reset_at ?? undefined,
        velocitySegments: row.monthly_velocity_segments,
        velocityScores: row.monthly_velocity_scores,
      }
    case 'wtus':
      if (!row.wtus_active || row.wtus_remaining_pct == null) return null
      return {
        remainingPct: row.wtus_remaining_pct,
        resetAt: row.wtus_reset_at ?? undefined,
        velocitySegments: row.wtus_velocity_segments,
        velocityScores: row.wtus_velocity_scores,
      }
    default:
      return null
  }
}

function quotaDurationHours(
  provider: string,
  interval: QuotaIntervalKind
): number {
  const providerLower = provider.toLowerCase()
  if (
    (providerLower === 'google' || providerLower === 'openrouter') &&
    interval === 'short'
  )
    return 24
  if (interval === 'monthly') return 720
  if (interval === 'wtus') return 5
  if (interval === 'short' || interval === 'short_special') return 5
  return 168
}

function resetWindowStartIso(
  resetAt: string | null,
  durationHours: number | undefined
): string | null {
  if (resetAt === null || durationHours === undefined || durationHours <= 0) {
    return null
  }

  const resetMs = new Date(resetAt).getTime()
  if (Number.isNaN(resetMs)) return null

  return new Date(resetMs - durationHours * 3_600_000).toISOString()
}

/**
 * Formats a quota tooltip window label from interval start/end ISO strings.
 *
 * Wave 45 (operator request): emits absolute date+time rather than a relative
 * span so the tooltip header shows the exact window boundaries.  Format is
 * `M/D HH:MM → M/D HH:MM` (both endpoints 30-min snapped via
 * {@link fmtIntervalCompact}).  Monthly quotas still display `this month`.
 *
 * Sentinel guard: the API uses year 9999 (e.g. "9999-12-31T00:00:00.000Z") to
 * mean "no fixed end" for ongoing intervals (i.e. the current active window).
 * For such bars the window end IS "now", so we substitute `new Date()` so the
 * tooltip displays the actual current moment (30-min snapped) rather than the
 * far-future sentinel year.
 *
 * @param intervalType - Which quota interval produced this bar.
 * @param intervalStart - ISO string for interval start, or null.
 * @param intervalEnd   - ISO string for interval end (≈ now or sentinel), or null.
 */
export function formatTipWindow(
  intervalType: QuotaIntervalKind,
  intervalStart: string | null,
  intervalEnd: string | null,
  resetAt: string | null = null,
  durationHours?: number
): string {
  // Monthly quotas: simple label; exact dates rarely meaningful in the tooltip.
  if (intervalType === 'monthly') return 'this month'

  // Current active rows use rate_limit_intervals.fromDate as the latest
  // change point, not the reset-window start. When reset metadata is available,
  // derive the true start from resetAt - durationHours.
  const effectiveStart =
    resetWindowStartIso(resetAt, durationHours) ?? intervalStart

  // Sentinel guard: the API uses year 9999 to mean "no fixed end" (ongoing
  // interval). Current bars always end at "now", so substitute the current
  // timestamp in place of the sentinel so the tooltip shows an accurate bound.
  const effectiveEnd =
    intervalEnd !== null &&
    !Number.isNaN(new Date(intervalEnd).getTime()) &&
    new Date(intervalEnd).getUTCFullYear() > 9000
      ? new Date().toISOString()
      : intervalEnd

  // Emit absolute date+time using the shared compact formatter (30-min snapped).
  return fmtIntervalCompact(effectiveStart, effectiveEnd)
}
/**
 * Derives a reset-window-aware average burn-rate label.
 *
 * The API interval_start marks the latest remaining_pct change point, not the
 * reset-window start, so using it for long quotas wildly inflates the hover
 * value. Use resetAt - durationHours instead, then choose a display unit that
 * matches the quota period.
 */
export function formatTipVelocity(
  consumedPct: number,
  resetAt: string | null,
  durationHours: number
): string | undefined {
  if (resetAt === null || consumedPct === 0 || durationHours <= 0) {
    return undefined
  }

  const resetMs = new Date(resetAt).getTime()
  if (Number.isNaN(resetMs)) return undefined

  const startMs = resetMs - durationHours * 3_600_000
  const effectiveNowMs = Math.min(Date.now(), resetMs)
  const hoursElapsed = (effectiveNowMs - startMs) / 3_600_000
  if (hoursElapsed <= 0) return undefined

  const unitHours = durationHours >= 48 ? 24 : 1
  const unitLabel = unitHours === 24 ? 'd' : 'h'
  const pctPerUnit = consumedPct / (hoursElapsed / unitHours)
  return `avg +${pctPerUnit.toFixed(1)}%/${unitLabel} since reset`
}

/**
 * Derives top-3 tipModels from a UsageReportQuotaUsageBreakdown array.
 *
 * Wave 24-PhosphorDash (operator F1b): aggregates cost per model, picks the
 * top 3 by cost, and formats costDelta as `$X.XX` strings.
 * Returns undefined when the breakdown is empty so QuotaBarGroup renders `—`.
 */
function tipModelsFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate per model (breakdown may have duplicates from multiple rows).
  const costByModel = new Map<string, number>()
  const requestsByModel = new Map<string, number>()
  const recentRequests90mByModel = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    costByModel.set(
      entry.model,
      (costByModel.get(entry.model) ?? 0) + entry.cost
    )
    requestsByModel.set(
      entry.model,
      (requestsByModel.get(entry.model) ?? 0) + entry.traces
    )
    recentRequests90mByModel.set(
      entry.model,
      (recentRequests90mByModel.get(entry.model) ?? 0) +
        (entry.recent_traces_90m ?? 0)
    )
  }
  if (costByModel.size === 0) return undefined

  return [...costByModel.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([model, cost]) => ({
      model,
      costDelta: `$${cost.toFixed(2)}`,
      requests: requestsByModel.get(model) ?? 0,
      recentRequests90m: recentRequests90mByModel.get(model) ?? 0,
    }))
}

function tipRequestTotalFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): number | undefined {
  if (breakdown.length === 0) return undefined
  return breakdown.reduce((sum, entry) => sum + entry.traces, 0)
}

function tipRecentRequestTotal90mFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): number | undefined {
  if (breakdown.length === 0) return undefined
  return breakdown.reduce(
    (sum, entry) => sum + (entry.recent_traces_90m ?? 0),
    0
  )
}

/**
 * Google-specific variant of tipModelsFromBreakdown for prior history bars.
 *
 * Wave 40 item #1: instead of showing raw model names (e.g. gemini-2.5-flash-001,
 * gemini-2.5-flash-preview), aggregates the usage_breakdown into Gemini model
 * class buckets: 'flash-lite', 'flash', 'pro', 'other'. Cost is summed per class
 * and the top 3 classes by cost are returned. This keeps history tooltips concise
 * and avoids overwhelming the operator with individual version names.
 */
export function tipModelsFromBreakdownGoogleAggregated(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate cost into Gemini class buckets.
  const costByClass = new Map<string, number>()
  const requestsByClass = new Map<string, number>()
  const recentRequests90mByClass = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    const lower = entry.model.toLowerCase()
    let cls: string
    // Order of checks matters: flash-lite before flash.
    if (lower.includes('flash-lite')) {
      cls = 'flash-lite'
    } else if (lower.includes('flash')) {
      cls = 'flash'
    } else if (lower.includes('pro')) {
      cls = 'pro'
    } else {
      cls = 'other'
    }
    costByClass.set(cls, (costByClass.get(cls) ?? 0) + entry.cost)
    requestsByClass.set(cls, (requestsByClass.get(cls) ?? 0) + entry.traces)
    recentRequests90mByClass.set(
      cls,
      (recentRequests90mByClass.get(cls) ?? 0) + (entry.recent_traces_90m ?? 0)
    )
  }
  if (costByClass.size === 0) return undefined

  return [...costByClass.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cls, cost]) => ({
      model: cls,
      costDelta: `$${cost.toFixed(2)}`,
      requests: requestsByClass.get(cls) ?? 0,
      recentRequests90m: recentRequests90mByClass.get(cls) ?? 0,
    }))
}

/**
 * Anthropic/OpenAI weekly-tier variant of tipModelsFromBreakdown for prior bars.
 *
 * Wave 40 item #2: for Anthropic weekly + weekly_special tiers, collapses all
 * model breakdown entries into a single 'sonnet' label. For OpenAI weekly +
 * weekly_special, collapses to 'codex-spark'. Returns undefined when breakdown
 * is empty.
 *
 * Interpretation: the operator wants the *tier display name* as a single label
 * in history tooltips — the same name used in the current active bar label —
 * rather than per-model granularity.
 */
export function tipModelsFromBreakdownSingleLabel(
  breakdown: UsageReportQuotaUsageBreakdown[],
  displayLabel: string
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined
  const totalCost = breakdown.reduce((s, e) => s + e.cost, 0)
  const requests = breakdown.reduce((s, e) => s + e.traces, 0)
  const recentRequests90m = breakdown.reduce(
    (s, e) => s + (e.recent_traces_90m ?? 0),
    0
  )
  return [
    {
      model: displayLabel,
      costDelta: `$${totalCost.toFixed(2)}`,
      requests,
      recentRequests90m,
    },
  ]
}

/**
 * Formats a "time ago" string for a prior reset bar relative to now.
 *
 * Wave 40 item #5: uses the 30-min-rounded period_start timestamp as the base
 * for calculation so the displayed age is consistent with the snapped date shown
 * in the bar label. Falls back to '—' when input is null or unparseable.
 *
 * Output format (compact, one unit of precision):
 *   < 1h  → "45m ago"
 *   < 24h → "3h ago"
 *   < 14d → "2d ago"
 *   ≥ 14d → "2w ago"
 */
export function formatTimeAgo(roundedDate: Date): string {
  const diffMs = Date.now() - roundedDate.getTime()
  // Treat slightly-future timestamps (rounding artefacts ≤ 30 min) as their
  // absolute distance so the label is sensible rather than "now".
  const absDiffMs = Math.abs(diffMs)
  if (diffMs < -60_000) {
    // More than a minute in the future — use absolute distance with "ago" label
    // so rounding artefacts still produce readable output (e.g. "30m ago").
    const totalMins = Math.floor(absDiffMs / 60_000)
    const hours = Math.floor(totalMins / 60)
    const days = Math.floor(hours / 24)
    const weeks = Math.floor(days / 7)
    if (totalMins < 60) return `${totalMins.toString()}m ago`
    if (hours < 24) return `${hours.toString()}h ago`
    if (days < 14) return `${days.toString()}d ago`
    return `${weeks.toString()}w ago`
  }
  if (diffMs < 0) return 'just now' // within 1 minute in future — truly at boundary
  const totalMins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(totalMins / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  if (totalMins < 60) return `${totalMins.toString()}m ago`
  if (hours < 24) return `${hours.toString()}h ago`
  if (days < 14) return `${days.toString()}d ago`
  return `${weeks.toString()}w ago`
}

/**
 * Maps a quota_type string to the QuotaBarGroup periodType used for stacked
 * lane grouping in provider-card.tsx.
 *
 * Wave 40 item #3: returns '5hr' for short/short_special, 'weekly' for weekly,
 * 'special' for special/weekly_special, 'monthly' for monthly.
 */
export function quotaTypeToPeriodType(
  quotaType: string
): QuotaBarGroup['periodType'] {
  switch (quotaType.toLowerCase()) {
    case 'short':
    case 'short_special':
    case 'wtus':
      return '5hr'
    case 'weekly':
      return 'weekly'
    case 'special':
    case 'weekly_special':
      return 'special'
    case 'monthly':
      return 'monthly'
    default:
      return 'weekly'
  }
}

/**
 * Creates a QuotaBarGroup for a single (label, interval) pair.
 *
 * Wave 24-PhosphorDash (operator F1b): now wires optional `tipWindow` from
 * interval timestamps and `tipModels` from the usage breakdown array for the
 * same interval. `tipVelocity` is derived locally while spectral segment flags come from backend observations.
 *
 * Returns null if the interval is not active on the given row.
 */
export function makeQuotaBarGroup(
  label: string,
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): QuotaBarGroup | null {
  const iv = extractInterval(row, interval)
  if (iv === null) return null
  const consumedPct = Math.max(0, Math.min(100, 100 - iv.remainingPct))
  const durationHours = quotaDurationHours(row.provider, interval)

  // F1b: interval_start/end for tipWindow, breakdown for tipModels.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
    case 'wtus':
      intervalStart = row.wtus_interval_start ?? null
      intervalEnd = row.wtus_interval_end ?? null
      breakdown = row.wtus_usage_breakdown ?? []
      break
  }

  return {
    label,
    consumedPct,
    remainingPct: iv.remainingPct,
    resetAt: iv.resetAt,
    segments: buildQuotaSegments(
      iv.remainingPct,
      iv.velocitySegments,
      iv.velocityScores
    ),
    // F1b: computed tip fields.
    tipWindow: formatTipWindow(
      interval,
      intervalStart,
      intervalEnd,
      iv.resetAt ?? null,
      durationHours
    ),
    tipVelocity: formatTipVelocity(
      consumedPct,
      iv.resetAt ?? null,
      durationHours
    ),
    tipModels: tipModelsFromBreakdown(breakdown),
    tipRequestTotal: tipRequestTotalFromBreakdown(breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(breakdown),
  }
}

/**
 * Like makeQuotaBarGroup but ALWAYS emits a bar — never returns null.
 *
 * Wave 28 fix: openai and anthropic must always render 4 quota bars so the
 * operator card layout is stable even when an interval is not currently active
 * (e.g. `short_special_active=false` for anthropic's sonnet · 5h bar).
 *
 * When the underlying interval is inactive or its remaining_pct is null, this
 * function returns a zero-consumed bar (`consumedPct=0, remainingPct=100`)
 * using the interval's timestamp fallback labels via `formatTipWindow`.
 *
 * Only used for the openai and anthropic provider branches in buildQuotaRows.
 * All other providers continue to use makeQuotaBarGroup (null → omit).
 */
function makeQuotaBarGroupAlways(
  label: string,
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): QuotaBarGroup {
  const existing = makeQuotaBarGroup(label, row, interval)
  if (existing !== null) return existing
  const durationHours = quotaDurationHours(row.provider, interval)

  // Interval is inactive or pct is null — emit a 0%-consumed placeholder bar.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
    case 'wtus':
      intervalStart = row.wtus_interval_start ?? null
      intervalEnd = row.wtus_interval_end ?? null
      breakdown = row.wtus_usage_breakdown ?? []
      break
  }

  return {
    label,
    consumedPct: 0,
    remainingPct: 100,
    segments: buildQuotaSegments(100),
    tipWindow: formatTipWindow(
      interval,
      intervalStart,
      intervalEnd,
      null,
      durationHours
    ),
    tipModels: tipModelsFromBreakdown(breakdown),
    tipRequestTotal: tipRequestTotalFromBreakdown(breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(breakdown),
  }
}

/**
 * Builds per-provider curated QuotaBarGroup[] matching the operator F1 mockup.
 *
 * This replaces the raw `buildQuotaIntervals` call at the ProviderCard callsite
 * so each provider shows only the quota rows relevant to its contract shape.
 * `buildQuotaIntervals` is preserved for multi-bar rendering compatibility.
 *
 * ### Returned shape (QuotaBarGroup[])
 * Each element has:
 *   - `label`        — display label per mockup (e.g. `'all · 5h'`, `'gemini-pro · 24h'`)
 *   - `consumedPct`  — 0–100 (100 − remainingPct, clamped)
 *   - `remainingPct` — raw API remaining_pct
 *   - `resetAt?`     — ISO timestamp of next reset if known
 *   - `segments`     — 100-segment array from buildQuotaSegments
 *
 * ### Provider → row mapping (Operator F1)
 * | provider   | rows included                                                   |
 * |------------|-----------------------------------------------------------------|
 * | openai     | all·5h (short), all·7d (weekly), codex-spark·5h, codex-spark·7d|
 * | anthropic  | all·5h (short), all·7d (weekly), sonnet·7d (W29: sonnet·5h dropped)|
 * | google     | gemini-flash·24h, gemini-pro·24h, gemini-flash-lite·24h (short, mockup order) |
 * | xai        | grok·monthly                                                    |
 * | nvidia_nim | NIM credits·monthly                                             |
 * | openrouter | free requests·24h                                            |
 * | local      | [] (no quotas)                                                  |
 *
 * openai always emits exactly 4 bars (inactive intervals render at 0% consumed).
 * anthropic emits 3 bars (sonnet·5h dropped in W29 Fix #3).
 * All other providers silently omit inactive intervals.
 *
 * @param provider - Canonical provider name from CANONICAL_PROVIDERS
 * @param allQuotaRows - Full quota rows array from /api/shell/reports/quotas
 */
export function buildQuotaRows(
  provider: string,
  allQuotaRows: UsageReportQuotaRow[]
): QuotaBarGroup[] {
  const providerLower = provider.toLowerCase()

  // Filter all quota rows to this provider (API returns canonical names for quotas)
  const providerRows = allQuotaRows.filter(
    (r) => r.provider.toLowerCase() === providerLower
  )

  if (providerRows.length === 0 || provider === 'local') return []

  const result: QuotaBarGroup[] = []

  switch (providerLower) {
    case 'openai': {
      // 22-PhosphorDash Fix ⚠-W21-1: the live API encodes codex-spark quotas in
      // the special_* and short_special_* columns of the model=null row — there is
      // no separate model-scoped row for codex-spark.  Read all 4 bars from the
      // single provider-level row:
      //   short          → 'all · 5h'
      //   weekly         → 'all · 7d'
      //   short_special  → 'codex-spark · 5h'
      //   special        → 'codex-spark · 7d'
      //
      // W28: always emit all 4 bars (inactive → 0% consumed) via
      // makeQuotaBarGroupAlways so the card layout is stable.
      const allRow = providerRows.find((r) => r.model === null)
      if (allRow !== undefined) {
        result.push(makeQuotaBarGroupAlways('all · 5h', allRow, 'short'))
        result.push(makeQuotaBarGroupAlways('all · 7d', allRow, 'weekly'))
        result.push(
          makeQuotaBarGroupAlways('codex-spark · 5h', allRow, 'short_special')
        )
        result.push(
          makeQuotaBarGroupAlways('codex-spark · 7d', allRow, 'special')
        )
      }
      break
    }

    case 'anthropic': {
      // 22-PhosphorDash Fix ⚠-W21-1: same pattern as OpenAI — sonnet quotas live
      // in the special_* / short_special_* columns of the model=null row.
      //   short          → 'all · 5h'
      //   weekly         → 'all · 7d'
      //   special        → 'sonnet · 7d'
      //
      // W29 Fix #3: operator dropped the sonnet·5h bar — emit 3 bars only.
      // short_special (sonnet·5h) is omitted entirely.
      const allRow = providerRows.find((r) => r.model === null)
      if (allRow !== undefined) {
        const g5h = makeQuotaBarGroup('all · 5h', allRow, 'short')
        if (g5h !== null) result.push(g5h)
        const g7d = makeQuotaBarGroup('all · 7d', allRow, 'weekly')
        if (g7d !== null) result.push(g7d)
        const gs7d = makeQuotaBarGroup('sonnet · 7d', allRow, 'special')
        if (gs7d !== null) result.push(gs7d)
      }
      break
    }

    case 'google': {
      // Google uses short interval but labels it as '24h' per the mockup.
      // Aggregate by gemini model class (gemini-pro / gemini-flash / gemini-flash-lite).
      // When multiple API rows map to the same class, take the first active one
      // (they share the same rate-limit pool per class in practice).
      //
      // 22-PhosphorDash Fix ⚠-W21-2275-#1: emit in mockup order
      // (gemini-flash · 24h, gemini-pro · 24h, gemini-flash-lite · 24h).
      // See mockup 06-phosphor-atlas.html L2533–2548.  We collect the best row
      // per class first (sorting by name length so shorter names are preferred),
      // then emit rows in the canonical class order.
      const GOOGLE_CLASS_ORDER: Record<string, number> = {
        'gemini-flash': 0,
        'gemini-pro': 1,
        'gemini-flash-lite': 2,
      }

      const bestRowByClass = new Map<string, UsageReportQuotaRow>()
      for (const cls of Object.keys(GOOGLE_CLASS_ORDER)) {
        const row = pickBestGoogleQuotaRowForClass(providerRows, cls)
        if (row !== null) bestRowByClass.set(cls, row)
      }

      // Emit in mockup order
      const orderedClasses = [...bestRowByClass.keys()].sort(
        (a, b) => (GOOGLE_CLASS_ORDER[a] ?? 99) - (GOOGLE_CLASS_ORDER[b] ?? 99)
      )
      for (const cls of orderedClasses) {
        const row = bestRowByClass.get(cls)
        if (row === undefined) continue
        const g = makeQuotaBarGroup(`${cls} · 24h`, row, 'short')
        if (g !== null) result.push(g)
      }
      break
    }

    case 'xai': {
      // All xAI quota rows aggregate under 'grok · monthly'
      // Take the first active monthly row (usually provider-level, model=null)
      for (const row of providerRows) {
        const g = makeQuotaBarGroup('grok · monthly', row, 'monthly')
        if (g !== null) {
          result.push(g)
          break
        }
      }
      break
    }

    case 'nvidia_nim': {
      // NIM credits → monthly
      for (const row of providerRows) {
        const g = makeQuotaBarGroup('NIM credits · monthly', row, 'monthly')
        if (g !== null) {
          result.push(g)
          break
        }
      }
      break
    }

    case 'openrouter': {
      // Provider-level (model === null): 'credits · monthly'
      const creditsRow = providerRows.find((r) => r.model === null)
      if (creditsRow !== undefined) {
        const gc = makeQuotaBarGroup('credits · monthly', creditsRow, 'monthly')
        if (gc !== null) result.push(gc)
      }
      // Free-tier model rows by name
      const gemmaRow = providerRows.find(
        (r) => r.model !== null && r.model.toLowerCase().includes('gemma-4-31b')
      )
      if (gemmaRow !== undefined) {
        const gg = makeQuotaBarGroup(
          'gemma-4-31b free · monthly',
          gemmaRow,
          'monthly'
        )
        if (gg !== null) result.push(gg)
      }
      const qwenRow = providerRows.find(
        (r) => r.model !== null && r.model.toLowerCase().includes('qwen3-coder')
      )
      if (qwenRow !== undefined) {
        const gq = makeQuotaBarGroup(
          'qwen3-coder free · monthly',
          qwenRow,
          'monthly'
        )
        if (gq !== null) result.push(gq)
      }
      break
    }

    default:
      // Unknown provider: fall back to raw interval rendering
      return buildQuotaIntervals(allQuotaRows, provider)
  }

  return result
}

/**
 * Maps a normalised quota_type string from quotaHistory[] to the operator
 * display label prefix used in buildQuotaRows labels (e.g. 'weekly' → '7d',
 * 'short' → '5h'). Falls back to the raw quota_type when unrecognised.
 */
function quotaTypeToSuffix(quotaType: string): string {
  switch (quotaType.toLowerCase()) {
    case 'weekly':
      return '7d'
    case 'short':
      return '5h'
    case 'special':
      return '7d'
    case 'short_special':
      return '5h'
    case 'monthly':
      return 'monthly'
    default:
      return quotaType
  }
}

/**
 * Rounds a UTC timestamp to the nearest 30-minute boundary.
 * Used to collapse sub-minute poll-jitter duplicates (e.g. 00:04:53, 00:04:54,
 * 00:04:56 → all round to 00:00) into a single logical reset slot.
 */
function roundToNearest30Min(iso: string): Date {
  const ms = 30 * 60 * 1000
  return new Date(Math.round(new Date(iso).getTime() / ms) * ms)
}

/**
 * Formats a compact inline date-range label for prior-bar row display, e.g.
 * `5/19 10:00 → 5/20 10:00`. Both bounds are 30-min snapped before formatting
 * so the displayed range matches the snapped slot used for time-ago.
 *
 * Falls back to '—' when either bound is null/unparseable.
 */
export function fmtIntervalCompact(
  start: string | null,
  end: string | null
): string {
  if (start === null || end === null) return '—'
  const s = roundToNearest30Min(start)
  const e = roundToNearest30Min(end)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—'
  return formatDashboardIntervalCompact(s, e)
}

/**
 * Builds QuotaBarGroup[] for past reset windows from quotaHistory[] for a
 * single provider. Full parity with current bars: identical 100-segment fills,
 * per-model tooltip content, and visual weight. Only the label heading differs
 * (model prefix · time-ago instead of model prefix · duration tag).
 *
 * Wave 40 multi-quota redesign changes:
 *
 * #1 Google model-class aggregation (prior bars only):
 *   Raw model names (gemini-2.5-flash-001, gemini-2.5-flash-preview, …) are
 *   aggregated into class buckets: flash-lite / flash / pro / other. The
 *   tooltip shows the class name, not individual model names. The current
 *   active bar (built by buildQuotaRows) is NOT changed.
 *
 * #2 Anthropic/OpenAI weekly-tier display names:
 *   For Anthropic weekly + special quota types: tooltip displays 'sonnet'.
 *   For OpenAI weekly + special quota types: tooltip displays 'codex-spark'.
 *   Short/5hr bars use the standard tipModelsFromBreakdown (per-model).
 *
 * #3 Render ALL history bars (no fixed-count slice):
 *   The 1.5× lookback server change (Engineer A, W40) extends the window.
 *   All returned bars are rendered; the operator can always see the full
 *   1.5× interval history for each tier.
 *
 * #4 30-min snapped period_start for time-ago base:
 *   timeAgoLabel is derived from roundToNearest30Min(expected_reset_at) so
 *   the displayed age matches the bar's rounded date label.
 *
 * #5 Time-ago in label and reset cell:
 *   Label format changed from 'prefix · YYYY-MM-DD HH:MM' to 'prefix · Xd ago'
 *   (time-ago of the rounded expected_reset_at). The same string populates
 *   timeAgoLabel for the reset cell in provider-card.tsx.
 *
 * #6 periodType set on all history bars for stacked-lane grouping.
 *
 * Dedup: history rows whose expected_reset_at matches the resetAt of any
 * current bar (same live window) are skipped.
 *
 * Sort: descending by expected_reset_at (most-recent past reset first).
 *
 * @param provider - canonical provider name
 * @param historyRows - flat quotaHistory[] from the API response
 * @param currentBars - already-built current QuotaBarGroup[] for this provider
 *   (used for deduplication and quota_type → model-label mapping)
 */
export function buildHistoryBarsForProvider(
  provider: string,
  historyRows: UsageReportQuotaHistoryRow[],
  currentBars: QuotaBarGroup[]
): QuotaBarGroup[] {
  const aliases = providerAliases(provider)
  const providerLower = provider.toLowerCase()

  // Filter history to this provider (handle aliases like 'gemini' → 'google').
  const relevant = historyRows.filter((h) =>
    aliases.includes(h.provider.toLowerCase())
  )
  if (relevant.length === 0) return []

  // If no current bars exist the provider has no active quotas — skip history.
  if (currentBars.length === 0) return []

  // Build an array of numeric timestamps (ms) from current bars' rounded reset
  // times.  We use numeric comparison for ±30 min proximity so that rounding
  // artefacts from Math.round (which can push a past reset into the future
  // slot) don't slip through an exact ISO-string match.
  const THIRTY_MIN_MS_H = 30 * 60 * 1000
  const currentRoundedResetMsList: number[] = currentBars
    .map((b) => b.resetAt)
    .filter((r): r is string => r !== undefined)
    .map((r) => roundToNearest30Min(r).getTime())

  /** Returns true if slotMs is within ±30 min of any current bar's reset. */
  const isNearCurrentReset = (slotMs: number): boolean =>
    currentRoundedResetMsList.some(
      (cur) => Math.abs(cur - slotMs) <= THIRTY_MIN_MS_H
    )

  // Build a lookup: quota_type → model-prefix from current bar labels.
  // e.g. 'all · 7d' for quota_type='weekly' gives prefix='all'.
  const modelPrefixByQuotaType = new Map<string, string>()
  for (const bar of currentBars) {
    const dotIdx = bar.label.indexOf(' · ')
    if (dotIdx === -1) continue
    const suffix = bar.label.slice(dotIdx + 3)
    const modelPrefix = bar.label.slice(0, dotIdx)
    for (const qt of [
      'weekly',
      'short',
      'special',
      'short_special',
      'monthly',
    ] as const) {
      if (quotaTypeToSuffix(qt) === suffix && !modelPrefixByQuotaType.has(qt)) {
        modelPrefixByQuotaType.set(qt, modelPrefix)
      }
    }
  }

  // Pre-pass: for each rounded slot, collect the set of distinct quota_types
  // that appear.  Any slot with >1 quota_type needs label disambiguation so
  // bars that would otherwise render identical labels become distinguishable.
  const quotaTypesPerSlot = new Map<string, Set<string>>()
  for (const h of relevant) {
    if (h.min_remaining_pct === null) continue
    if (h.expected_reset_at === null) continue
    const slotDate = roundToNearest30Min(h.expected_reset_at)
    if (isNearCurrentReset(slotDate.getTime())) continue
    const slot = slotDate.toISOString()
    let types = quotaTypesPerSlot.get(slot)
    if (types === undefined) {
      types = new Set<string>()
      quotaTypesPerSlot.set(slot, types)
    }
    types.add(h.quota_type.toLowerCase())
  }

  // Deduplicate by (quota_type, rounded-slot) — sub-minute poll-jitter
  // duplicates of the same quota type collapse to one bar per 30-min window.
  const seen = new Set<string>()
  const result: QuotaBarGroup[] = []

  for (const h of relevant) {
    // Skip rows without usable data.
    if (h.min_remaining_pct === null) continue

    const roundedSlotDate =
      h.expected_reset_at !== null
        ? roundToNearest30Min(h.expected_reset_at)
        : null
    const roundedSlot =
      roundedSlotDate !== null ? roundedSlotDate.toISOString() : ''

    // Dedup against current bars — skip if within ±30 min of any live reset
    // window (proximity check absorbs Math.round artefacts).
    if (
      roundedSlotDate !== null &&
      isNearCurrentReset(roundedSlotDate.getTime())
    ) {
      continue
    }

    // Dedup across multiple history rows for the same (quota_type, rounded slot).
    const dedupeKey = `${h.quota_type}::${roundedSlot}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const quotaTypeLower = h.quota_type.toLowerCase()

    // Wave 40 #5: time-ago label derived from the 30-min-snapped reset time.
    // Used in both the bar label (replaces YYYY-MM-DD HH:MM) and the reset cell.
    const timeAgoLabel =
      roundedSlotDate !== null ? formatTimeAgo(roundedSlotDate) : '—'

    // Build the display label: '<model-prefix> · <time-ago>[(quota_type)]'
    // The time-ago replaces the previous absolute date string so the operator
    // sees "flash · 2d ago" instead of "flash · 2026-05-18 00:00".
    const modelPrefix =
      modelPrefixByQuotaType.get(quotaTypeLower) ??
      (h.model !== null ? h.model : 'all')
    const disambig =
      roundedSlot !== '' && (quotaTypesPerSlot.get(roundedSlot)?.size ?? 0) > 1
        ? ` (${quotaTypeLower})`
        : ''
    const label = `${modelPrefix} · ${timeAgoLabel}${disambig}`

    // Wave 40 #6: determine periodType for stacked-lane grouping.
    const periodType = quotaTypeToPeriodType(quotaTypeLower)

    // Wave 40 #1/#2: choose the correct tipModels builder based on provider
    // and quota type.
    let tipModels: QuotaTipModel[] | undefined
    if (providerLower === 'google') {
      // #1: Google history bars → aggregate by model class (flash-lite/flash/pro/other)
      tipModels = tipModelsFromBreakdownGoogleAggregated(h.usage_breakdown)
    } else if (
      providerLower === 'anthropic' &&
      (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
    ) {
      // #2: Anthropic weekly-tier bars → single 'sonnet' label
      tipModels = tipModelsFromBreakdownSingleLabel(h.usage_breakdown, 'sonnet')
    } else if (
      providerLower === 'openai' &&
      (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
    ) {
      // #2: OpenAI weekly-tier bars → single 'codex-spark' label
      tipModels = tipModelsFromBreakdownSingleLabel(
        h.usage_breakdown,
        'codex-spark'
      )
    } else {
      // All other providers/tiers: standard per-model breakdown
      tipModels = tipModelsFromBreakdown(h.usage_breakdown)
    }

    // Full-parity 100-segment render using the same buildQuotaSegments function
    // as current bars. Use min_remaining_pct (peak consumption).
    const remainingPct = h.min_remaining_pct
    const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))

    result.push({
      label,
      consumedPct,
      remainingPct,
      resetAt: h.expected_reset_at ?? undefined,
      segments: buildQuotaSegments(
        remainingPct,
        h.velocity_segments,
        h.velocity_scores
      ),
      tipWindow: fmtIntervalCompact(h.interval_start, h.interval_end),
      tipModels,
      tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
      tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
        h.usage_breakdown
      ),
      // Wave 40 #3: no slice — all history bars returned (1.5× lookback from server).
      // Wave 40 #4/#5: time-ago label for the reset cell.
      timeAgoLabel,
      // Wave 40 #6: stacked-lane grouping by period type.
      periodType,
    })
  }

  // Sort descending by expected_reset_at (most-recent past reset first).
  result.sort((a, b) => {
    const aDate = a.resetAt ?? ''
    const bDate = b.resetAt ?? ''
    return bDate < aDate ? -1 : bDate > aDate ? 1 : 0
  })

  return result
}

// ---------------------------------------------------------------------------
// Lane key constants — maps quota_type normalised values to lane identifiers.
// ---------------------------------------------------------------------------

/**
 * Maps a normalised quota_type to its canonical lane key suffix.
 * These keys match the lane definitions in PROVIDER_LANE_DEFS below.
 */
function quotaTypeToLaneKey(quotaType: string): string {
  switch (quotaType.toLowerCase()) {
    case 'short':
      return 'short'
    case 'weekly':
      return 'weekly'
    case 'special':
      return 'special'
    case 'short_special':
      return 'short_special'
    case 'monthly':
      return 'monthly'
    default:
      return quotaType.toLowerCase()
  }
}

/**
 * Maps a normalised quota_type to the `QuotaBarGroup['periodType']` so that
 * lane-based priorBars use the correct type tag (kept for tooltip reuse).
 */
function quotaTypeToBarPeriodType(
  quotaType: string
): QuotaBarGroup['periodType'] {
  switch (quotaType.toLowerCase()) {
    case 'short':
    case 'short_special':
    case 'wtus':
      return '5hr'
    case 'weekly':
      return 'weekly'
    case 'special':
      return 'special'
    case 'monthly':
      return 'monthly'
    default:
      return 'weekly'
  }
}

/**
 * Per-provider lane definitions.
 *
 * Wave 41: each entry describes one quota lane for a provider.
 *   laneKey  — stable ID used to group current + prior bars
 *   laneLabel — human-readable label shown on the left of the lane row
 *   quotaType — the normalised quota_type value from quotaHistory / quotaRows
 *               that feeds this lane
 *   googleClass — (Google only) the classifyGeminiModel class that feeds
 *                 this lane (null for non-Google providers)
 *
 * Anthropic: 3 lanes — all·5h (short), all·7d (weekly), sonnet·7d (special)
 * OpenAI:    4 lanes — all·5h (short), all·7d (weekly),
 *                      codex-spark·5h (short_special), codex-spark·7d (special)
 * Google:    3 lanes — flash·24h, flash-lite·24h, pro·24h (all short, per-class)
 * xAI:       1 lane  — all·monthly (monthly)
 * OpenRouter: 1 lane — free requests·24h (short/request quota)
 */
interface LaneDef {
  laneKey: string
  laneLabel: string
  quotaType: string
  googleClass: string | null
  quotaKey?: string
}

const ANTHROPIC_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'anthropic/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/special',
    laneLabel: 'Sonnet · 7d',
    quotaType: 'special',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
]

const OPENAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'openai/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'openai/short_special',
    laneLabel: 'codex-spark · 5hr',
    quotaType: 'short_special',
    googleClass: null,
  },
  {
    laneKey: 'openai/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
  {
    laneKey: 'openai/special',
    laneLabel: 'codex-spark · 7d',
    quotaType: 'special',
    googleClass: null,
  },
]

const GOOGLE_LANE_DEFS: LaneDef[] = [
  // flash-lite MUST be checked before flash (substring containment).
  {
    laneKey: 'google/flash-lite',
    laneLabel: 'Flash-Lite · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash-lite',
  },
  {
    laneKey: 'google/flash',
    laneLabel: 'Flash · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash',
  },
  {
    laneKey: 'google/pro',
    laneLabel: 'Pro · 24h',
    quotaType: 'short',
    googleClass: 'gemini-pro',
  },
]

const ANTIGRAVITY_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'antigravity/gemini-pool',
    laneLabel: 'Gemini Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:gemini_pool',
  },
  {
    laneKey: 'antigravity/vertex-pool',
    laneLabel: 'Vertex Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:vertex_pool',
  },
]

const XAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'xai/monthly',
    laneLabel: 'All Models · 30d',
    quotaType: 'monthly',
    googleClass: null,
  },
]

const OPENROUTER_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'openrouter/requests',
    laneLabel: 'Free Requests · 24h',
    quotaType: 'short',
    googleClass: null,
  },
]

const PROVIDER_LANE_DEFS: Readonly<Record<string, LaneDef[]>> = {
  anthropic: ANTHROPIC_LANE_DEFS,
  openai: OPENAI_LANE_DEFS,
  antigravity: ANTIGRAVITY_LANE_DEFS,
  google: GOOGLE_LANE_DEFS,
  xai: XAI_LANE_DEFS,
  openrouter: OPENROUTER_LANE_DEFS,
}

/**
 * Builds a QuotaBarGroup for a single history row in a lane.
 *
 * Wave 41: all prior bars use the same 100-segment fill as current bars.
 * The `timeAgoLabel` is derived from roundToNearest30Min(expected_reset_at).
 * The `periodType` is set for legacy compat but lanes don't need it.
 */
export function buildPriorBarFromHistory(
  h: UsageReportQuotaHistoryRow,
  provider: string
): QuotaBarGroup {
  const quotaTypeLower = h.quota_type.toLowerCase()
  const roundedSlotDate =
    h.expected_reset_at !== null
      ? roundToNearest30Min(h.expected_reset_at)
      : null
  const timeAgoLabel =
    roundedSlotDate !== null ? formatTimeAgo(roundedSlotDate) : '—'

  if (h.min_remaining_pct === null) {
    return {
      label: timeAgoLabel,
      consumedPct: 0,
      remainingPct: 100,
      resetAt: h.expected_reset_at ?? undefined,
      segments: buildQuotaSegments(100, h.velocity_segments, h.velocity_scores),
      tipWindow: fmtIntervalCompact(h.interval_start, h.interval_end),
      tipModels: undefined,
      tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
      tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
        h.usage_breakdown
      ),
      timeAgoLabel,
      dateRangeLabel: fmtIntervalCompact(h.interval_start, h.expected_reset_at),
      periodType: quotaTypeToBarPeriodType(quotaTypeLower),
    }
  }

  const remainingPct = h.min_remaining_pct
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))

  let tipModels: QuotaTipModel[] | undefined
  const providerLower = provider.toLowerCase()
  if (providerLower === 'google') {
    tipModels = tipModelsFromBreakdownGoogleAggregated(h.usage_breakdown)
  } else if (
    providerLower === 'anthropic' &&
    (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(h.usage_breakdown, 'sonnet')
  } else if (
    providerLower === 'openai' &&
    (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(
      h.usage_breakdown,
      'codex-spark'
    )
  } else {
    tipModels = tipModelsFromBreakdown(h.usage_breakdown)
  }

  const dateRangeLabel = fmtIntervalCompact(
    h.interval_start,
    h.expected_reset_at
  )

  return {
    label: timeAgoLabel,
    consumedPct,
    remainingPct,
    resetAt: h.expected_reset_at ?? undefined,
    segments: buildQuotaSegments(
      remainingPct,
      h.velocity_segments,
      h.velocity_scores
    ),
    tipWindow: fmtIntervalCompact(h.interval_start, h.interval_end),
    tipModels,
    tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
      h.usage_breakdown
    ),
    timeAgoLabel,
    dateRangeLabel,
    periodType: quotaTypeToBarPeriodType(quotaTypeLower),
  }
}

/**
 * Builds `QuotaLane[]` for a single provider by combining current quota rows
 * with history rows. Each lane = one quota type, current bar + prior bars.
 *
 * Wave 41 multi-reset redesign (replaces Wave 40 flat list):
 *
 * For each lane defined in PROVIDER_LANE_DEFS[provider]:
 * 1. Find the current bar from `allQuotaRows` using the existing `buildQuotaRows`
 *    (single-bar) logic per quota type.
 * 2. Find all matching history rows for this lane's quota_type (and Google
 *    model class) from `historyRows`, deduplicate by 30-min slot, and sort
 *    newest-first.
 * 3. Return a `QuotaLane` with `currentBar` + `priorBars`.
 *
 * Only lanes defined in PROVIDER_LANE_DEFS are rendered; unknown providers
 * fall back to the old `buildQuotaRows` flat-list path (no lanes prop passed).
 *
 * @param provider    — canonical provider name (lowercase)
 * @param allQuotaRows — full quotas[] from /api/shell/reports/quotas
 * @param historyRows  — full quotaHistory[] from the usage report
 */
export function buildProviderLanes(
  provider: string,
  allQuotaRows: UsageReportQuotaRow[],
  historyRows: UsageReportQuotaHistoryRow[]
): QuotaLane[] {
  const providerLower = provider.toLowerCase()
  const laneDefs = PROVIDER_LANE_DEFS[providerLower]
  if (laneDefs === undefined || laneDefs.length === 0) return []

  // Pre-filter quota rows to this provider.
  const providerQuotas = allQuotaRows.filter(
    (r) => r.provider.toLowerCase() === providerLower
  )

  // Pre-filter history rows to this provider (handle aliases e.g. gemini→google).
  const aliases = providerAliases(providerLower)
  const providerHistory = historyRows.filter((h) =>
    aliases.includes(h.provider.toLowerCase())
  )

  const result: QuotaLane[] = []

  for (const def of laneDefs) {
    // ── 1. Build current bar ────────────────────────────────────────────────
    let currentBar: QuotaBarGroup | null = null

    if (providerLower === 'google' && def.googleClass !== null) {
      const bestRow = pickBestGoogleQuotaRowForClass(
        providerQuotas,
        def.googleClass
      )
      if (bestRow !== null) {
        const g = makeQuotaBarGroup(`${def.laneLabel}`, bestRow, 'short')
        if (g !== null) {
          // Aggregate short_usage_breakdown across ALL same-class rows so that
          // split quota rows (e.g. gemini-2.5-flash-lite vs gemini-3.1-flash-lite-preview)
          // are merged into one class-bucket tooltip instead of showing "— —".
          const mergedBreakdown = providerQuotas
            .filter(
              (r) =>
                r.model !== null &&
                classifyGeminiModel(r.model) === def.googleClass
            )
            .flatMap((r) => r.short_usage_breakdown)
          const aggregatedTipModels =
            tipModelsFromBreakdownGoogleAggregated(mergedBreakdown)
          currentBar = {
            ...g,
            label: def.laneLabel,
            tipModels: aggregatedTipModels,
            tipRequestTotal: tipRequestTotalFromBreakdown(mergedBreakdown),
            tipRecentRequestTotal90m:
              tipRecentRequestTotal90mFromBreakdown(mergedBreakdown),
          }
        }
      }
    } else if (providerLower === 'antigravity' && def.quotaKey !== undefined) {
      const row = providerQuotas.find((quota) => quota.model === def.quotaKey)
      if (row !== undefined) {
        currentBar = makeQuotaBarGroup(def.laneLabel, row, 'wtus')
      }
    } else if (providerLower === 'xai') {
      // xAI: aggregate all rows under monthly.
      for (const row of providerQuotas) {
        const g = makeQuotaBarGroup(def.laneLabel, row, 'monthly')
        if (g !== null) {
          currentBar = g
          break
        }
      }
    } else {
      // Anthropic / OpenAI: all quota data lives in the model=null row.
      const allRow = providerQuotas.find((r) => r.model === null)
      if (allRow !== undefined) {
        const interval = ((): Parameters<typeof makeQuotaBarGroup>[2] => {
          switch (def.quotaType) {
            case 'short':
              return 'short'
            case 'weekly':
              return 'weekly'
            case 'special':
              return 'special'
            case 'short_special':
              return 'short_special'
            case 'monthly':
              return 'monthly'
            case 'wtus':
              return 'wtus'
            default:
              return 'weekly'
          }
        })()
        const g =
          providerLower === 'openai'
            ? makeQuotaBarGroupAlways(def.laneLabel, allRow, interval)
            : makeQuotaBarGroup(def.laneLabel, allRow, interval)
        if (g !== null) {
          currentBar = g
        }
      }
    }

    // ── 2. Build prior bars ─────────────────────────────────────────────────
    // Filter history rows to this lane's quota_type (+ Google class).
    const laneHistory = shouldSuppressProviderLanePriorBars(providerLower, def)
      ? []
      : providerHistory.filter((h) => {
          const htLower = h.quota_type.toLowerCase()
          if (htLower !== quotaTypeToLaneKey(def.quotaType)) return false
          // Google: additionally filter by model class.
          if (providerLower === 'google' && def.googleClass !== null) {
            if (h.model === null) return false
            const cls = classifyGeminiModel(h.model)
            return cls === def.googleClass
          }
          if (providerLower === 'antigravity' && def.quotaKey !== undefined) {
            return h.model === def.quotaKey
          }
          return true
        })

    // Deduplicate by (rounded-30min slot) — suppress current reset window.
    // Use a numeric timestamp for ±30 min proximity comparison to handle
    // rounding artefacts where Math.round pushes a past reset into the future.
    const THIRTY_MIN_MS = 30 * 60 * 1000
    const currentRoundedResetMs: number | null =
      currentBar?.resetAt !== undefined
        ? roundToNearest30Min(currentBar.resetAt).getTime()
        : null
    const seen = new Set<string>()
    const priorBars: QuotaBarGroup[] = []

    // Sort by expected_reset_at DESC so newest prior is first.
    const sortedHistory = [...laneHistory].sort((a, b) => {
      const ad = a.expected_reset_at ?? ''
      const bd = b.expected_reset_at ?? ''
      return bd < ad ? -1 : bd > ad ? 1 : 0
    })

    for (const h of sortedHistory) {
      if (h.min_remaining_pct === null) continue

      const roundedSlotDate =
        h.expected_reset_at !== null
          ? roundToNearest30Min(h.expected_reset_at)
          : null
      const roundedSlot =
        roundedSlotDate !== null
          ? roundedSlotDate.toISOString()
          : (h.interval_start ?? `null-reset-${seen.size.toString()}`)

      // Skip if this slot is within ±30 min of the current bar's reset time.
      // The ±30 min window absorbs rounding artefacts from Math.round that can
      // push a history row's slot to the next 30-min boundary, making an exact
      // ISO-string match miss rows that belong to the live reset window.
      if (
        roundedSlotDate !== null &&
        currentRoundedResetMs !== null &&
        Math.abs(currentRoundedResetMs - roundedSlotDate.getTime()) <=
          THIRTY_MIN_MS
      )
        continue

      // Dedup within the same 30-min slot.
      if (seen.has(roundedSlot)) continue
      seen.add(roundedSlot)

      priorBars.push(buildPriorBarFromHistory(h, providerLower))
    }

    result.push({
      laneKey: def.laneKey,
      laneLabel: def.laneLabel,
      currentBar,
      priorBars,
    })
  }

  // Return only lanes that have at least a current bar OR prior bars.
  return result.filter((l) => l.currentBar !== null || l.priorBars.length > 0)
}

// ---------------------------------------------------------------------------
// computeFleetErrors lives in usage-report-display.ts (lib) so the helper
// can be imported by both phosphor-dashboard and index.tsx without violating
// the react-refresh/only-export-components constraint.
// ---------------------------------------------------------------------------

/**
 * Canonical provider order — always present in fixed sequence.
 *
 * Wave 11 PR2 (11-f): the dashboard always shows all 8 canonical providers so
 * the status grid (7 providers + aggregate) is fully populated regardless of
 * which providers the API returns in a given time range.
 */
const CANONICAL_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'antigravity',
  'xai',
  'openrouter',
  'nvidia_nim',
  'local',
] as const

/**
 * Always returns the canonical 8 providers in fixed order.
 *
 * Wave 11 PR2 (11-f): replaces dynamic derivation from the API response so
 * every provider card slot (including `local`) is always present.
 */
export function deriveProviders(): string[] {
  return [...CANONICAL_PROVIDERS]
}

export function canonicalRepositoryName(
  repository: string | null | undefined
): string {
  return (repository ?? '(unknown)').replace(/\s+\(memory\)$/i, '')
}

/**
 * Builds RepoRow[] from raw UsageReportRow records by aggregating per
 * repository.
 */
export function buildRepoRows(
  rows: {
    repository?: string
    token_total: number | null
    usd_cost: number | null
    traces: number | null
    model?: string
  }[],
  trendRows: UsageReportTrendRow[]
): RepoRow[] {
  // Build per-repository sparkline series from trend data (24h buckets).
  // Each bucket can have multiple rows (one per provider+model combination for
  // that repository). Aggregate token_total per (repository, bucket) first so
  // each sparkline point represents the full repository output for that bucket,
  // then sort chronologically so the polyline reads left-to-right oldest-to-newest.
  const bucketSumByRepo = new Map<string, Map<string, number>>()
  for (const t of trendRows) {
    const repo = canonicalRepositoryName(t.repository)
    const bucketMap = bucketSumByRepo.get(repo) ?? new Map<string, number>()
    bucketMap.set(t.bucket, (bucketMap.get(t.bucket) ?? 0) + t.token_total)
    bucketSumByRepo.set(repo, bucketMap)
  }
  const sparkByRepo = new Map<string, number[]>()
  for (const [repo, bucketMap] of bucketSumByRepo) {
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    sparkByRepo.set(
      repo,
      sortedBuckets.map(([, sum]) => sum)
    )
  }

  // 15-B.7: Track per-repo model token sums so we can pick the genuine top
  // model (max token_total) instead of the last-iterated model.
  const repoMap = new Map<
    string,
    {
      tokens: number
      cost: number
      traces: number
      modelTokens: Map<string, number>
    }
  >()

  for (const row of rows) {
    const repo = canonicalRepositoryName(row.repository)
    const rowTokens = row.token_total ?? 0
    const existing = repoMap.get(repo)
    if (existing === undefined) {
      const modelTokens = new Map<string, number>()
      if (row.model) modelTokens.set(row.model, rowTokens)
      repoMap.set(repo, {
        tokens: rowTokens,
        cost: row.usd_cost ?? 0,
        traces: row.traces ?? 0,
        modelTokens,
      })
    } else {
      existing.tokens += rowTokens
      existing.cost += row.usd_cost ?? 0
      existing.traces += row.traces ?? 0
      // Accumulate per-model token totals for max selection
      if (row.model) {
        existing.modelTokens.set(
          row.model,
          (existing.modelTokens.get(row.model) ?? 0) + rowTokens
        )
      }
    }
  }

  return [...repoMap.entries()]
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([repository, data]) => {
      // 15-B.7: Pick the model with the most accumulated tokens for this repo.
      // 16-D: Exclude sentinel/placeholder model names ('', 'unknown', 'null')
      // from the top-model competition. These entries (e.g. rows where
      // sh.model IS NULL in the DB) were out-massing named models and causing
      // every repo to display top_model="unknown". Token sums are unaffected —
      // only the topModel picker is filtered.
      let topModel = ''
      let topTokens = -1
      for (const [model, modelTokens] of data.modelTokens) {
        const normalized = model.toLowerCase().trim()
        if (
          normalized === '' ||
          normalized === 'unknown' ||
          normalized === 'null'
        ) {
          continue
        }
        if (modelTokens > topTokens) {
          topTokens = modelTokens
          topModel = model
        }
      }
      return {
        repository,
        tokens: data.tokens,
        cost_usd: data.cost,
        traces: data.traces,
        top_model: topModel,
        spark: sparkByRepo.get(repository) ?? [data.tokens],
      }
    })
}

function latencySummaryFromReportRow(
  row: UsageReportRow | UsageReportProviderStatusUsageRow
): ModelLatencySummary | undefined {
  const summary: ModelLatencySummary = {
    sampleRows: row.latency_sample_rows ?? row.traces ?? 0,
    totalServerP50Ms: row.total_server_elapsed_p50_ms,
    totalServerP95Ms: row.total_server_elapsed_p95_ms,
    totalServerCount: row.total_server_elapsed_count,
    upstreamElapsedP50Ms: row.llm_upstream_elapsed_p50_ms,
    upstreamElapsedP95Ms: row.llm_upstream_elapsed_p95_ms,
    upstreamElapsedCount: row.llm_upstream_elapsed_count,
    ttftP95Ms: row.ttft_p95_ms,
    ttftCount: row.ttft_count,
    litellmProcessingP95Ms: row.litellm_processing_p95_ms,
    litellmProcessingCount: row.litellm_processing_count,
    upstreamStreamP95Ms: row.llm_upstream_stream_p95_ms,
    upstreamStreamCount: row.llm_upstream_stream_count,
    unclassifiedP95Ms: row.latency_unclassified_p95_ms,
    unclassifiedCount: row.latency_unclassified_count,
    previousResponseGapP95Ms: row.previous_response_to_current_request_p95_ms,
    previousResponseGapCount: row.previous_response_to_current_request_count,
    upstreamOutputTokensPerSecondP50:
      row.llm_upstream_output_tokens_per_second_p50,
    upstreamOutputTokensPerSecondP95:
      row.llm_upstream_output_tokens_per_second_p95,
    upstreamOutputTokensPerSecondCount:
      row.llm_upstream_output_tokens_per_second_count,
    streamOutputTokensPerSecondP50: row.llm_stream_output_tokens_per_second_p50,
    streamOutputTokensPerSecondP95: row.llm_stream_output_tokens_per_second_p95,
    streamOutputTokensPerSecondCount:
      row.llm_stream_output_tokens_per_second_count,
  }
  const hasLatencyCoverage =
    (summary.totalServerCount ?? 0) > 0 ||
    (summary.upstreamElapsedCount ?? 0) > 0 ||
    (summary.ttftCount ?? 0) > 0 ||
    (summary.litellmProcessingCount ?? 0) > 0
  return hasLatencyCoverage ? summary : undefined
}

function maxOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined
): number | null {
  if (left == null) return right ?? null
  if (right == null) return left
  return Math.max(left, right)
}

function sumOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined
): number | null {
  if (left == null && right == null) return null
  return (left ?? 0) + (right ?? 0)
}

function mergeLatencySummaries(
  left: ModelLatencySummary | undefined,
  right: ModelLatencySummary | undefined
): ModelLatencySummary | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return {
    sampleRows: left.sampleRows + right.sampleRows,
    totalServerP50Ms: maxOptionalNumber(
      left.totalServerP50Ms,
      right.totalServerP50Ms
    ),
    totalServerP95Ms: maxOptionalNumber(
      left.totalServerP95Ms,
      right.totalServerP95Ms
    ),
    totalServerCount: sumOptionalNumber(
      left.totalServerCount,
      right.totalServerCount
    ),
    upstreamElapsedP50Ms: maxOptionalNumber(
      left.upstreamElapsedP50Ms,
      right.upstreamElapsedP50Ms
    ),
    upstreamElapsedP95Ms: maxOptionalNumber(
      left.upstreamElapsedP95Ms,
      right.upstreamElapsedP95Ms
    ),
    upstreamElapsedCount: sumOptionalNumber(
      left.upstreamElapsedCount,
      right.upstreamElapsedCount
    ),
    ttftP95Ms: maxOptionalNumber(left.ttftP95Ms, right.ttftP95Ms),
    ttftCount: sumOptionalNumber(left.ttftCount, right.ttftCount),
    litellmProcessingP95Ms: maxOptionalNumber(
      left.litellmProcessingP95Ms,
      right.litellmProcessingP95Ms
    ),
    litellmProcessingCount: sumOptionalNumber(
      left.litellmProcessingCount,
      right.litellmProcessingCount
    ),
    upstreamStreamP95Ms: maxOptionalNumber(
      left.upstreamStreamP95Ms,
      right.upstreamStreamP95Ms
    ),
    upstreamStreamCount: sumOptionalNumber(
      left.upstreamStreamCount,
      right.upstreamStreamCount
    ),
    unclassifiedP95Ms: maxOptionalNumber(
      left.unclassifiedP95Ms,
      right.unclassifiedP95Ms
    ),
    unclassifiedCount: sumOptionalNumber(
      left.unclassifiedCount,
      right.unclassifiedCount
    ),
    previousResponseGapP95Ms: maxOptionalNumber(
      left.previousResponseGapP95Ms,
      right.previousResponseGapP95Ms
    ),
    previousResponseGapCount: sumOptionalNumber(
      left.previousResponseGapCount,
      right.previousResponseGapCount
    ),
    upstreamOutputTokensPerSecondP50: maxOptionalNumber(
      left.upstreamOutputTokensPerSecondP50,
      right.upstreamOutputTokensPerSecondP50
    ),
    upstreamOutputTokensPerSecondP95: maxOptionalNumber(
      left.upstreamOutputTokensPerSecondP95,
      right.upstreamOutputTokensPerSecondP95
    ),
    upstreamOutputTokensPerSecondCount: sumOptionalNumber(
      left.upstreamOutputTokensPerSecondCount,
      right.upstreamOutputTokensPerSecondCount
    ),
    streamOutputTokensPerSecondP50: maxOptionalNumber(
      left.streamOutputTokensPerSecondP50,
      right.streamOutputTokensPerSecondP50
    ),
    streamOutputTokensPerSecondP95: maxOptionalNumber(
      left.streamOutputTokensPerSecondP95,
      right.streamOutputTokensPerSecondP95
    ),
    streamOutputTokensPerSecondCount: sumOptionalNumber(
      left.streamOutputTokensPerSecondCount,
      right.streamOutputTokensPerSecondCount
    ),
  }
}

function ledgerP50Ms(
  summary: ModelLatencySummary | undefined,
  fallback: number | null | undefined
): number {
  return (
    summary?.totalServerP50Ms ?? summary?.upstreamElapsedP50Ms ?? fallback ?? 0
  )
}

function ledgerP95Ms(
  summary: ModelLatencySummary | undefined,
  fallback: number | null | undefined
): number {
  return (
    summary?.totalServerP95Ms ?? summary?.upstreamElapsedP95Ms ?? fallback ?? 0
  )
}

/**
 * Builds ModelRow[] for MasterLedgerTable from providerStatusUsage rows
 * aggregated by provider+model key.
 *
 * Wave 15-B fixes:
 * - 15-B.3: real token_in / token_out aggregated from usageRows (report.rows)
 *   grouped by provider+model, replacing the fake 60/40 split of token_total.
 * - 15-B.4: upstream_p50_ms wired from healthRows (was always null/0).
 * - 15-B.5: quota_pct computed from quotaRows (was always hardcoded 0).
 */
export function buildModelRows(
  rows: UsageReportProviderStatusUsageRow[],
  healthRows: UsageReportProviderLatencyHealthRow[],
  usageRows: UsageReportRow[],
  quotaRows: UsageReportQuotaRow[],
  trendRows: UsageReportTrendRow[],
  toolActivityRows: UsageReportToolActivityRow[] = []
): ModelRow[] {
  // 15-B.3: Aggregate real token_in / token_out from report.rows by provider+model.
  // providerStatusUsage (the `rows` param) lacks per-direction token fields;
  // report.rows has them and uses group_by=provider,model,repository so we sum
  // across all repository buckets.
  // 15-B.2: normalise via canonicalProvider so 'google' rows in report.rows
  // always key as 'google' (not 'gemini'), matching providerStatusUsage keys.
  //
  // 20-PhosphorDash Fix ⚠-W19-2: also accumulate token_cache_input and
  // token_cache_creation per provider+model so we can compute cache_pct.
  // cache_pct = (cache_input + cache_creation) / token_in × 100.
  // We use token_in (not token_total) as the denominator because cache tokens
  // are measured relative to input tokens processed.
  // 26-Bundle (operator F#12): extend per-key accumulator with cache_miss and
  // reasoning fields so they can be surfaced in the new ledger columns.
  const tokensByKey = new Map<
    string,
    {
      token_in: number
      token_out: number
      cache_input: number
      cache_creation: number
      cache_miss_usd: number
      reasoning_reported: number
      reasoning_estimated: number
      agentQuality?: AgentQualitySummary
    }
  >()
  for (const r of usageRows) {
    const m = (r.model ?? '').toLowerCase()
    const p = canonicalProvider(r.provider ?? '')
    if (!p || !m) continue
    const key = keyFor(r.provider ?? '', r.model ?? '')
    const existing = tokensByKey.get(key)
    const tin = r.token_in ?? 0
    const tout = r.token_out ?? 0
    const ci = r.token_cache_input ?? 0
    const cc = r.token_cache_creation ?? 0
    const cm_usd = r.cache_miss_usd_cost ?? 0
    const rr = r.token_reasoning_reported ?? 0
    const re = r.token_reasoning_estimated ?? 0
    const agentQuality = agentQualityFromFlatRow(r)
    if (existing === undefined) {
      tokensByKey.set(key, {
        token_in: tin,
        token_out: tout,
        cache_input: ci,
        cache_creation: cc,
        cache_miss_usd: cm_usd,
        reasoning_reported: rr,
        reasoning_estimated: re,
        agentQuality,
      })
    } else {
      existing.token_in += tin
      existing.token_out += tout
      existing.cache_input += ci
      existing.cache_creation += cc
      existing.cache_miss_usd += cm_usd
      existing.reasoning_reported += rr
      existing.reasoning_estimated += re
      existing.agentQuality = combineAgentQualitySummaries([
        existing.agentQuality,
        agentQuality,
      ])
    }
  }

  // quotaRows param retained in signature for backward compat with call-sites
  // but quota_pct column removed (Wave 26, operator F#13).
  void quotaRows

  // Build per-(provider, model) sparkline series from trend data (24h buckets).
  // Sort chronologically so the polyline reads left-to-right oldest-to-newest.
  // Key mirrors tokensByKey: canonicalProvider + model lowercase.
  const sortedTrendRows = [...trendRows].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0
  )
  const sparkByKey = new Map<string, number[]>()
  for (const t of sortedTrendRows) {
    const m = (t.model ?? '').toLowerCase()
    const p = canonicalProvider(t.provider ?? '')
    if (!p || !m) continue
    const sparkKey = keyFor(t.provider ?? '', t.model ?? '')
    const arr = sparkByKey.get(sparkKey) ?? []
    arr.push(t.token_total)
    sparkByKey.set(sparkKey, arr)
  }

  const sparkByRepositoryKey = new Map<string, number[]>()
  const bucketTokensByRepositoryKey = new Map<string, Map<string, number>>()
  for (const t of trendRows) {
    const p = canonicalProvider(t.provider ?? '')
    const m = (t.model ?? '').toLowerCase()
    if (!p || !m) continue
    const repo = canonicalRepositoryName(t.repository)
    const key = `${p}::${m}::${repo}`
    const bucketMap = bucketTokensByRepositoryKey.get(key) ?? new Map()
    bucketMap.set(t.bucket, (bucketMap.get(t.bucket) ?? 0) + t.token_total)
    bucketTokensByRepositoryKey.set(key, bucketMap)
  }
  for (const [key, bucketMap] of bucketTokensByRepositoryKey) {
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    sparkByRepositoryKey.set(
      key,
      sortedBuckets.map(([, tokens]) => tokens)
    )
  }

  const repositoryChildrenByKey = new Map<string, Map<string, ModelRow>>()
  for (const r of usageRows) {
    const m = (r.model ?? '').toLowerCase()
    const p = canonicalProvider(r.provider ?? '')
    if (!p || !m) continue
    const repo = canonicalRepositoryName(r.repository)
    const modelKey = keyFor(r.provider ?? '', r.model ?? '')
    const repoMap = repositoryChildrenByKey.get(modelKey) ?? new Map()
    const existing = repoMap.get(repo)
    const cacheTokens =
      (r.token_cache_input ?? 0) + (r.token_cache_creation ?? 0)
    const cachePct =
      (r.token_in ?? 0) > 0
        ? Math.round((cacheTokens / Math.max(1, r.token_in ?? 0)) * 1000) / 10
        : undefined
    const cacheMissUsd = r.cache_miss_usd_cost ?? 0
    const cost = r.usd_cost ?? 0
    const cacheMissPct =
      cacheMissUsd > 0 && cost > 0
        ? Math.round((cacheMissUsd / cost) * 1000) / 10
        : undefined
    const agentQuality = agentQualityFromFlatRow(r)
    const latencySummary = latencySummaryFromReportRow(r)

    if (existing === undefined) {
      repoMap.set(repo, {
        model: repo,
        provider: p,
        tokens_in: r.token_in ?? 0,
        tokens_out: r.token_out ?? 0,
        requests: r.traces ?? 0,
        p50_ms: ledgerP50Ms(latencySummary, r.llm_upstream_elapsed_average_ms),
        p95_ms: ledgerP95Ms(latencySummary, r.llm_upstream_elapsed_average_ms),
        error_pct: 0,
        cost_usd: cost,
        cache_pct: cachePct,
        cache_miss_pct: cacheMissPct,
        cache_miss_usd_cost: cacheMissUsd > 0 ? cacheMissUsd : undefined,
        reasoning_reported: r.token_reasoning_reported ?? 0,
        reasoning_estimated: r.token_reasoning_estimated ?? 0,
        cache_toks: cacheTokens > 0 ? cacheTokens : undefined,
        tool: r.tool_calls ?? undefined,
        git_commits: r.git_commit ?? undefined,
        git_pushes: r.git_push ?? undefined,
        agentQuality,
        latencySummary,
        spark: sparkByRepositoryKey.get(`${modelKey}::${repo}`) ?? [
          r.token_total ?? 0,
        ],
      })
    } else {
      existing.tokens_in += r.token_in ?? 0
      existing.tokens_out += r.token_out ?? 0
      existing.requests += r.traces ?? 0
      existing.cost_usd += cost
      existing.latencySummary = mergeLatencySummaries(
        existing.latencySummary,
        latencySummary
      )
      existing.p50_ms = Math.max(
        existing.p50_ms,
        ledgerP50Ms(latencySummary, r.llm_upstream_elapsed_average_ms)
      )
      existing.p95_ms = Math.max(
        existing.p95_ms,
        ledgerP95Ms(latencySummary, r.llm_upstream_elapsed_average_ms)
      )
      existing.cache_miss_usd_cost =
        (existing.cache_miss_usd_cost ?? 0) + cacheMissUsd
      existing.reasoning_reported =
        (existing.reasoning_reported ?? 0) + (r.token_reasoning_reported ?? 0)
      existing.reasoning_estimated =
        (existing.reasoning_estimated ?? 0) + (r.token_reasoning_estimated ?? 0)
      existing.cache_toks = (existing.cache_toks ?? 0) + cacheTokens
      existing.tool = (existing.tool ?? 0) + (r.tool_calls ?? 0)
      existing.git_commits = (existing.git_commits ?? 0) + (r.git_commit ?? 0)
      existing.git_pushes = (existing.git_pushes ?? 0) + (r.git_push ?? 0)
      existing.agentQuality = combineAgentQualitySummaries([
        existing.agentQuality,
        agentQuality,
      ])
      existing.spark = sparkByRepositoryKey.get(`${modelKey}::${repo}`) ?? [
        ...((existing.spark ?? []).length > 0 ? (existing.spark ?? []) : []),
        r.token_total ?? 0,
      ]
      existing.cache_pct =
        existing.tokens_in > 0 && (existing.cache_toks ?? 0) > 0
          ? Math.round(
              ((existing.cache_toks ?? 0) / existing.tokens_in) * 1000
            ) / 10
          : undefined
      existing.cache_miss_pct =
        (existing.cache_miss_usd_cost ?? 0) > 0 && existing.cost_usd > 0
          ? Math.round(
              ((existing.cache_miss_usd_cost ?? 0) / existing.cost_usd) * 1000
            ) / 10
          : undefined
    }
    repositoryChildrenByKey.set(modelKey, repoMap)
  }

  // Group health data by provider+model for latency lookups
  // 15-B.4: also accumulate upstream_p50_ms (previously always left null)
  const healthByKey = new Map<
    string,
    {
      p50: number | null
      p95: number | null
      errors: number
      requests: number
    }
  >()
  for (const row of healthRows) {
    const key = keyFor(row.provider, row.model)
    const existing = healthByKey.get(key)
    const errors =
      row.provider_error_events +
      row.provider_5xx_events +
      row.provider_timeout_events
    if (existing === undefined) {
      healthByKey.set(key, {
        // 15-B.4: seed p50 from the first (most-recent) row with a non-null value
        p50: row.upstream_p50_ms,
        p95: row.upstream_p95_ms,
        errors,
        requests: row.requests,
      })
    } else {
      existing.errors += errors
      existing.requests += row.requests
      // 15-B.4: take max p50/p95 across all health buckets for this model key
      if (row.upstream_p50_ms !== null) {
        existing.p50 =
          existing.p50 !== null
            ? Math.max(existing.p50, row.upstream_p50_ms)
            : row.upstream_p50_ms
      }
      if (row.upstream_p95_ms !== null) {
        existing.p95 =
          existing.p95 !== null
            ? Math.max(existing.p95, row.upstream_p95_ms)
            : row.upstream_p95_ms
      }
    }
  }

  // W33: Build a lookup of toolActivity rows indexed by "provider::model" so
  // each ModelRow can quickly retrieve its pre-processed tool activity data.
  // Keys use lowercase provider + model to match tokensByKey and healthByKey.
  const toolActivityByKey = new Map<string, UsageReportToolActivityRow[]>()
  for (const ta of toolActivityRows) {
    const taKey = keyFor(ta.provider, ta.model)
    const existing = toolActivityByKey.get(taKey)
    if (existing === undefined) {
      toolActivityByKey.set(taKey, [ta])
    } else {
      existing.push(ta)
    }
  }

  return rows.map((row) => {
    const key = keyFor(row.provider, row.model)
    const health = healthByKey.get(key)
    const latencySummary = latencySummaryFromReportRow(row)
    const requests = health?.requests ?? row.traces
    const errors = health?.errors ?? 0
    const errorPct = requests > 0 ? (errors / requests) * 100 : 0
    // 15-B.3: use real per-direction tokens from report.rows; fall back to
    // 60/40 split only when the usage rows don't have coverage for this model
    // (e.g. providerStatusUsage has data but report.rows cap was hit)
    const tokenAgg = tokensByKey.get(key)
    const tokens_in = tokenAgg?.token_in ?? Math.round(row.token_total * 0.6)
    const tokens_out = tokenAgg?.token_out ?? Math.round(row.token_total * 0.4)

    // 20-PhosphorDash Fix ⚠-W19-2: compute cache_pct from aggregated cache
    // tokens. Formula: (cache_input + cache_creation) / token_in × 100.
    // Returns null (rendered as '—') when token_in is zero or data unavailable.
    let cache_pct: number | null = null
    if (tokenAgg !== undefined && tokenAgg.token_in > 0) {
      const cacheTokens = tokenAgg.cache_input + tokenAgg.cache_creation
      cache_pct = Math.round((cacheTokens / tokenAgg.token_in) * 1000) / 10
    }

    // 26-Bundle (operator F#12): derive cache_miss_pct + populate new fields.
    // cache_miss_pct: best-effort — use cache_miss_usd / usd_cost * 100 when
    // both are positive; otherwise undefined so table shows '—'.
    const cache_miss_usd_cost =
      tokenAgg !== undefined ? tokenAgg.cache_miss_usd : undefined
    let cache_miss_pct: number | undefined
    if (
      cache_miss_usd_cost !== undefined &&
      cache_miss_usd_cost > 0 &&
      row.usd_cost > 0
    ) {
      cache_miss_pct =
        Math.round((cache_miss_usd_cost / row.usd_cost) * 1000) / 10
    }
    const reasoning_reported =
      tokenAgg !== undefined ? tokenAgg.reasoning_reported : undefined
    const reasoning_estimated =
      tokenAgg !== undefined ? tokenAgg.reasoning_estimated : undefined

    // W33: pre-processed tool activity for the TOOL cell hover tooltip.
    // buildToolActivity returns a zero-calls result when no rows are found,
    // so undefined is only stored when the lookup is empty (no API data).
    // W34: also derive the scalar `tool` field from totalCalls so the TOOL
    // cell renders the count instead of '—' (wave34-data-flow-audit Critical #4).
    const rowToolActivity = toolActivityByKey.has(key)
      ? buildToolActivity(toolActivityByKey.get(key) ?? [])
      : undefined

    return {
      model: row.model,
      provider: row.provider,
      tokens_in,
      tokens_out,
      requests,
      p50_ms: ledgerP50Ms(latencySummary, health?.p50), // 15-B.4: wired upstream_p50_ms
      p95_ms: ledgerP95Ms(latencySummary, health?.p95),
      error_pct: Math.round(errorPct * 10) / 10,
      cost_usd: row.usd_cost,
      // quota_pct removed — Wave 26 operator F#13
      cache_pct: cache_pct ?? undefined, // 20-PhosphorDash: null → undefined for optional field
      // 26-Bundle (operator F#12): cache miss + reasoning fields
      cache_miss_pct,
      cache_miss_usd_cost:
        cache_miss_usd_cost !== undefined ? cache_miss_usd_cost : undefined,
      reasoning_reported:
        reasoning_reported !== undefined ? reasoning_reported : undefined,
      reasoning_estimated:
        reasoning_estimated !== undefined ? reasoning_estimated : undefined,
      // Wave 30 operator reorder: total cache tokens for new Cache toks column
      cache_toks:
        tokenAgg !== undefined
          ? tokenAgg.cache_input + tokenAgg.cache_creation
          : undefined,
      spark: sparkByKey.get(keyFor(row.provider, row.model)) ?? [
        row.token_total,
      ],
      tool: rowToolActivity?.totalCalls,
      toolActivity: rowToolActivity,
      agentQuality: tokenAgg?.agentQuality,
      latencySummary,
      repositoryChildren: [
        ...(repositoryChildrenByKey.get(key)?.values() ?? []),
      ].sort(
        (left, right) =>
          right.tokens_in +
          right.tokens_out -
          (left.tokens_in + left.tokens_out)
      ),
    }
  })
}

/**
 * Builds TopModelRow[] for ProviderCard card-pane-right at 4K.
 * Groups providerStatusUsage by provider+model and returns top 3 by tokens.
 *
 * Wave 18-Cards C3: populates `p95_ms` from the latest non-null
 * `upstream_p95_ms` in `healthRows` matching provider+model, fixing the
 * prior bug where the `.p95` cell displayed request count instead of latency.
 */
export function buildTopModels(
  rows: {
    provider: string
    model: string
    token_total: number
    usd_cost: number
    traces: number
  }[],
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[]
): TopModelRow[] {
  // 20-PhosphorDash Fix ⚠-W19-1: canonicalize the target provider so that
  // callers passing 'google' correctly match health rows stored as 'gemini'.
  // Without this, all Google top-model .p95 cells render '0ms' despite real
  // latency data being available in providerLatencyHealth.
  const targetCanonical = canonicalProvider(provider)

  return rows
    .filter((r) => r.provider.toLowerCase() === provider.toLowerCase())
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 3)
    .map((r) => {
      // Look up the most-recent health row with a non-null p95 for this
      // provider+model combination. healthRows are ordered bucket_start DESC
      // (newest first per 15-B.1), so the first match is the most recent.
      // canonicalProvider on the health row's provider handles the
      // 'gemini' → 'google' alias transparently.
      const lowerModel = r.model.toLowerCase()
      const matchingHealthRow = healthRows.find(
        (h) =>
          canonicalProvider(h.provider) === targetCanonical &&
          h.model.toLowerCase() === lowerModel &&
          (h.upstream_p95_ms ?? h.total_p95_ms) !== null
      )
      const passiveP95 =
        matchingHealthRow !== undefined
          ? (matchingHealthRow.upstream_p95_ms ??
            matchingHealthRow.total_p95_ms ??
            null)
          : null
      return {
        model: r.model,
        tokens: r.token_total,
        cost_usd: r.usd_cost,
        requests: r.traces,
        p95_ms: passiveP95,
      }
    })
}
