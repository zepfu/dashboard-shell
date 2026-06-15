/**
 * Health strip cell builders for provider cards.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
} from '../api/usage-report'
import {
  type CellDef,
  type HealthStripEvent,
} from '../components/primitives/health-strip'
import {
  canonicalProvider,
  formatDashboardTime,
  providerAliases,
} from './usage-report-display'

function mergeMin(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.min(current, value)
}

function mergeMax(current: number | null, value: number | null): number | null {
  if (value === null) return current
  return current === null ? value : Math.max(current, value)
}

/** Cell count expected by HealthStrip inside ProviderCard. */
export const HEALTH_CELL_COUNT = 288
export const HEALTH_BUCKET_MS = 5 * 60 * 1000
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
