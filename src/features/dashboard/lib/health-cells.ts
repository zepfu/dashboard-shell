/**
 * Health strip cell builders for provider cards.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
} from '../api/usage-report'
import {
  BUCKET_MS,
  type CellDef,
  type HealthStripEvent,
  TOTAL_CELLS,
} from '../components/primitives/health-strip'
import {
  canonicalProvider,
  formatDashboardTime,
  providerAliases,
} from './usage-report-display'

/** Aligned with HealthStrip wall-clock indexing (I5). */
export const HEALTH_CELL_COUNT = TOTAL_CELLS
export const HEALTH_BUCKET_MS = BUCKET_MS

const PROVIDER_DELTA_DEGRADED_MS = 250

function mergeMin(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.min(current, value)
}

function mergeMax(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.max(current, value)
}

interface RowProbeSignals {
  probeFailures: number
  providerProbeDegraded: boolean
  controlProbeDegraded: boolean
  providerPacketLoss: boolean
  controlPacketLoss: boolean
  providerLatencyDelta: boolean
}

function classifyRowProbeSignals(
  row: UsageReportProviderLatencyHealthRow
): RowProbeSignals {
  const probeFailures =
    row.dns_failures + row.tcp_failures + row.tls_failures + row.icmp_failures
  return {
    probeFailures,
    providerProbeDegraded:
      row.status_probe_count > 0 &&
      row.status_probe_success_pct !== null &&
      row.status_probe_success_pct < 100,
    controlProbeDegraded:
      row.control_probe_success_pct !== null &&
      row.control_probe_success_pct < 100,
    providerPacketLoss: (row.provider_ping_packet_loss_pct ?? 0) > 0,
    controlPacketLoss: (row.control_packet_loss_pct ?? 0) > 0,
    providerLatencyDelta:
      (row.provider_ping_minus_control_ms ?? 0) > PROVIDER_DELTA_DEGRADED_MS,
  }
}

interface HealthBucketClassification {
  maxP95: number | null
  eventCount: number
  sumMissingUpstreamLatency: number
  rawErrorBreakdown: CellDef['rawErrorBreakdown']
  rawDegradedBreakdown: CellDef['rawDegradedBreakdown']
  degradedCount: number
  category: CellDef['category'] | undefined
  rowSignals: RowProbeSignals[]
}

/**
 * Single classification pass per bucket (A2): category, counters, and probe
 * events derive from the same row-level signals.
 *
 * G1: Control-path degradation (local network probes) marks the bucket orange
 * for every provider sharing that time slice — provider strip data is untrusted
 * when the control path is unhealthy.
 */
function classifyHealthBucketGroup(
  group: UsageReportProviderLatencyHealthRow[]
): HealthBucketClassification {
  let maxP95: number | null = null
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

  let statusProbeCount = 0
  let minStatusProbeSuccessPct: number | null = null
  let minControlProbeSuccessPct: number | null = null
  let maxProviderPacketLossPct: number | null = null
  let maxControlPacketLossPct: number | null = null
  let maxProviderDeltaMs: number | null = null
  let hasProbeData = false

  const rowSignals: RowProbeSignals[] = []

  for (const r of group) {
    const passiveP95 = r.upstream_p95_ms ?? r.total_p95_ms
    if (passiveP95 !== null) {
      maxP95 = maxP95 === null ? passiveP95 : Math.max(maxP95, passiveP95)
    }

    sumProviderError += r.provider_error_events
    sum5xx += r.provider_5xx_events
    sumTimeout += r.provider_timeout_events
    sumNetwork += r.network_error_events
    sumRateLimit += r.rate_limit_events
    sumCapacity += r.capacity_events
    sumMissingUpstreamLatency += r.missing_upstream_latency

    const signals = classifyRowProbeSignals(r)
    rowSignals.push(signals)
    probeFailures += signals.probeFailures
    if (signals.providerProbeDegraded) providerProbeDegraded += 1
    if (signals.controlProbeDegraded) controlProbeDegraded += 1
    if (signals.providerPacketLoss) providerPacketLoss += 1
    if (signals.controlPacketLoss) controlPacketLoss += 1
    if (signals.providerLatencyDelta) providerLatencyDelta += 1

    statusProbeCount += r.status_probe_count
    minStatusProbeSuccessPct = mergeMin(
      minStatusProbeSuccessPct,
      r.status_probe_success_pct
    )
    minControlProbeSuccessPct = mergeMin(
      minControlProbeSuccessPct,
      r.control_probe_success_pct
    )
    maxProviderPacketLossPct = mergeMax(
      maxProviderPacketLossPct,
      r.provider_ping_packet_loss_pct
    )
    maxControlPacketLossPct = mergeMax(
      maxControlPacketLossPct,
      r.control_packet_loss_pct
    )
    maxProviderDeltaMs = mergeMax(
      maxProviderDeltaMs,
      r.provider_ping_minus_control_ms
    )

    hasProbeData =
      hasProbeData ||
      r.status_probe_count > 0 ||
      r.status_probe_success_pct !== null ||
      r.status_probe_p95_ms !== null ||
      r.provider_ping_avg_ms !== null ||
      r.provider_ping_packet_loss_pct !== null ||
      r.control_ping_avg_ms !== null ||
      r.control_packet_loss_pct !== null ||
      r.control_probe_success_pct !== null ||
      r.provider_ping_minus_control_ms !== null
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

  let category: CellDef['category'] | undefined
  if (eventCount > 0) {
    category = undefined
  } else if (sumMissingUpstreamLatency > 0 && maxP95 === null) {
    category = 'miss'
  } else if (!hasProbeData) {
    category = undefined
  } else if (
    (statusProbeCount > 0 && minStatusProbeSuccessPct === 0) ||
    (maxProviderPacketLossPct ?? 0) >= 100
  ) {
    category = 'red'
  } else if (
    probeFailures > 0 ||
    (minStatusProbeSuccessPct !== null && minStatusProbeSuccessPct < 100) ||
    (minControlProbeSuccessPct !== null && minControlProbeSuccessPct < 100) ||
    (maxProviderPacketLossPct ?? 0) > 0 ||
    (maxControlPacketLossPct ?? 0) > 0 ||
    (maxProviderDeltaMs ?? 0) > PROVIDER_DELTA_DEGRADED_MS
  ) {
    category = 'orange'
  } else if (maxP95 !== null) {
    category = undefined
  } else {
    category = 'green'
  }

  return {
    maxP95,
    eventCount,
    sumMissingUpstreamLatency,
    rawErrorBreakdown,
    rawDegradedBreakdown,
    degradedCount,
    category,
    rowSignals,
  }
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
  return new Date(
    Math.floor(ms / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS
  ).toISOString()
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

function healthRowMatchesAliases(
  rowProvider: string,
  aliases: readonly string[]
): boolean {
  const providerLower = rowProvider.toLowerCase()
  return (
    aliases.includes(providerLower) ||
    aliases.includes(canonicalProvider(providerLower))
  )
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

function buildProbeEventsFromRowSignals(
  group: UsageReportProviderLatencyHealthRow[],
  rowSignals: RowProbeSignals[],
  bucketStart: string | undefined,
  includeProviderInLabel: boolean
): HealthStripEvent[] {
  if (bucketStart === undefined) return []
  const time = formatHealthEventTime(bucketStart)
  const events: HealthStripEvent[] = []

  for (let i = 0; i < group.length; i += 1) {
    const row = group[i]
    const signals = rowSignals[i]
    if (row === undefined || signals === undefined) continue

    const label = modelEventLabel(
      row.provider,
      row.model,
      includeProviderInLabel
    )
    const observedAt = bucketStart

    if (signals.probeFailures > 0) {
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
        count: signals.probeFailures,
        observedAt,
      })
    }
    if (signals.providerProbeDegraded) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'provider probe',
          `${(row.status_probe_success_pct ?? 0).toFixed(0)}% success`
        ),
        count: 1,
        observedAt,
      })
    }
    if (signals.controlProbeDegraded) {
      events.push({
        time,
        model: label,
        errorType: buildProbeEventDescription(
          'control probe',
          `${(row.control_probe_success_pct ?? 0).toFixed(0)}% success`
        ),
        count: 1,
        observedAt,
      })
    }
    if (signals.providerPacketLoss) {
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
    if (signals.controlPacketLoss) {
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
    if (signals.providerLatencyDelta) {
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
  const classification = classifyHealthBucketGroup(group)
  const {
    maxP95,
    eventCount,
    rawErrorBreakdown,
    rawDegradedBreakdown,
    degradedCount,
    category,
    rowSignals,
  } = classification

  const bucketStart = group.find((r) => r.bucket_start != null)?.bucket_start
  const bucketKey =
    bucketStart != null
      ? (bucketKeyFromIso(bucketStart) ?? String(bucketStart))
      : null
  const events = [
    ...(bucketKey !== null
      ? (observationEventsByBucket.get(bucketKey) ?? [])
      : []),
    ...buildProbeEventsFromRowSignals(
      group,
      rowSignals,
      bucketStart ?? undefined,
      includeProviderInEvents
    ),
  ]

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

  // Tail-slice to HEALTH_CELL_COUNT for test helpers. Production HealthStrip
  // wall-clock re-indexes cells that carry bucketStart (P2).
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
 */
export function padHealthCells(
  rows: UsageReportProviderLatencyHealthRow[],
  provider: string,
  errorObservations: UsageReportProviderErrorObservationRow[] = [],
  aliases: readonly string[] = providerAliases(provider)
): CellDef[] {
  const providerRows = rows.filter((r) =>
    healthRowMatchesAliases(r.provider, aliases)
  )
  const providerObservations = errorObservations.filter((observation) =>
    healthRowMatchesAliases(observation.provider, aliases)
  )
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
