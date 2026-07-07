/**
 * Provider and aggregate metrics builders.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportProviderLatencyHealthRow,
  UsageReportRow,
  UsageReportSummary,
} from '../api/usage-report'
import type { ProviderMetrics } from '../components/provider-card'
import { sumRequestsInLast90mFromNewestBucket } from './quota-bars/fields'
import { computeFleetP95, providerAliases } from './usage-report-display'

const PACKET_LOSS_RECENT_BUCKET_COUNT = 12

function passiveP95(row: UsageReportProviderLatencyHealthRow): number | null {
  return row.upstream_p95_ms ?? row.total_p95_ms
}

function newestBucketStartMs(
  rows: UsageReportProviderLatencyHealthRow[]
): number | null {
  let newest: number | null = null
  for (const row of rows) {
    if (row.bucket_start == null) continue
    const ms = new Date(row.bucket_start).getTime()
    if (!Number.isFinite(ms)) continue
    if (newest === null || ms > newest) newest = ms
  }
  return newest
}

function maxP95InNewestBucket(
  rows: UsageReportProviderLatencyHealthRow[]
): number | null {
  const newestMs = newestBucketStartMs(rows)
  if (newestMs === null) return null
  let max: number | null = null
  for (const row of rows) {
    if (row.bucket_start == null) continue
    const ms = new Date(row.bucket_start).getTime()
    if (!Number.isFinite(ms) || ms !== newestMs) continue
    const p95 = passiveP95(row)
    if (p95 === null) continue
    max = max === null ? p95 : Math.max(max, p95)
  }
  return max
}

function weightedPacketLossRecent(
  rows: UsageReportProviderLatencyHealthRow[]
): number | null {
  const newestMs = newestBucketStartMs(rows)
  if (newestMs === null) return null
  const cutoffMs = newestMs - PACKET_LOSS_RECENT_BUCKET_COUNT * 5 * 60 * 1000
  let weightedSum = 0
  let weightTotal = 0
  for (const row of rows) {
    if (row.bucket_start == null) continue
    const loss = row.provider_ping_packet_loss_pct
    if (loss === null) continue
    const ms = new Date(row.bucket_start).getTime()
    if (!Number.isFinite(ms) || ms < cutoffMs) continue
    const weight = row.requests > 0 ? row.requests : 1
    weightedSum += loss * weight
    weightTotal += weight
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null
}

export function buildProviderMetrics(
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[],
  rows: UsageReportRow[],
  now: Date = new Date(),
  aliases: readonly string[] = providerAliases(provider)
): ProviderMetrics {
  // 15-B.2: expand canonical provider key to all DB aliases
  // (e.g. 'google' → ['google','gemini'] so gemini health rows are included)
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

  const p95 = maxP95InNewestBucket(providerHealthRows)

  // Wave 14-C: rate_limits, capacity from health rows; packet_loss from ping probe.
  const rate_limits = providerHealthRows.reduce(
    (s, r) => s + r.rate_limit_events,
    0
  )
  const capacity = providerHealthRows.reduce((s, r) => s + r.capacity_events, 0)
  const packet_loss_pct = weightedPacketLossRecent(providerHealthRows)

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
  const packet_loss_pct = weightedPacketLossRecent(healthRows)

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
