/**
 * ProviderCard shared types (S2-22 decomposition).
 */

/** Configuration for a provider card (display metadata). */
export interface ProviderCardConfig {
  provider: string
  color: string
  /** Optional human-readable display name (defaults to provider key uppercased). */
  displayName?: string
  /** Render only quota lanes; omit traffic, token, health, and model sections. */
  quotaOnly?: boolean
}

/** Core metrics for a single provider. */
export interface ProviderMetrics {
  tokens_in: number
  tokens_out: number
  cost_usd: number | null
  requests: number
  errors: number
  p95_ms: number | null
  cache_input: number
  cache_creation: number
  /** Dollar cost of cache misses (from cache_miss_usd_cost API field). */
  cache_miss_usd: number
  reasoning_reported: number
  reasoning_estimated: number
  /** Requests observed in provider health buckets from the last 90 minutes. */
  recent_requests_90m: number
  traces: number
  /** Rate limit events from UsageReportProviderLatencyHealthRow.rate_limit_events. */
  rate_limits: number
  /** Capacity events from UsageReportProviderLatencyHealthRow.capacity_events. */
  capacity: number
  /**
   * Provider ping packet loss percentage.
   * From UsageReportProviderLatencyHealthRow.provider_ping_packet_loss_pct.
   * null when not probed.
   */
  packet_loss_pct: number | null
}

/** v9.7 segment severity class names for quota bar intervals. */
export type QuotaSegmentSeverityClass =
  | 'iv-0-5'
  | 'iv-5-10'
  | 'iv-10-25'
  | 'iv-25-50'
  | 'iv-50-p'

/** Interval configuration for one segment within a quota bar. */
export interface QuotaRowConfig {
  widthPct: number
  severityClass: QuotaSegmentSeverityClass
  highVelocity: boolean
  velocityClass?: string
  label?: string
  resetDate?: string
}

/**
 * A single top-model entry for quota tooltip v9-tip-row rows.
 */
export interface QuotaTipModel {
  model: string
  /** Signed dollar delta string, e.g. '+$24'. */
  costDelta: string
  /** Requests observed for this model during the bar's quota window. */
  requests?: number
  /** Requests observed for this model in the most recent 90 minutes. */
  recentRequests90m?: number
}

/** A single quota-type bar with its pre-built N=100 segment array. */
export interface QuotaBarGroup {
  /** Human-readable quota type: 'Weekly' | 'Short' | 'Special' | 'Monthly'. */
  label: string
  /** 0–100: percentage of quota already consumed (100 − remaining). */
  consumedPct: number
  /** 0–100: raw remaining percentage from the API. */
  remainingPct: number
  /** ISO timestamp when the interval next resets, if known. */
  resetAt?: string
  /** N=100 equal-width percent segments. */
  segments: QuotaRowConfig[]
  tipWindow?: string
  tipVelocity?: string
  /** Exact quota identity fields shown in quota-bar tooltips when available. */
  tipIdentity?: string[]
  tipModels?: QuotaTipModel[]
  tipRequestTotal?: number
  tipRecentRequestTotal90m?: number
  /** ISO timestamp of the billing observation, for freshness display. */
  tipObservedAt?: string
  /** Absolute quota values supplied by billing telemetry. */
  tipQuotaLimit?: number | null
  tipQuotaUsed?: number | null
  tipQuotaRemaining?: number | null
  /** Machine-readable unit for absolute quota values, such as `quota_units`. */
  tipQuotaUnit?: string
  /** True when billing detail exists but absolute values are all null (percentage-only telemetry). */
  tipAbsolutesUnavailable?: boolean
  /** Preserve meaningful sub-1% consumption display for percentage-only providers. */
  showSubPercentPrecision?: boolean
  periodType?:
    | '5hr'
    | 'weekly'
    | 'weekly_overage_included'
    | 'special'
    | 'monthly'
  /**
   * Time-ago label for prior-reset history bars, e.g. '2d ago', '3h ago'.
   * When absent on a prior bar, reset cell renders '—' (S2-17).
   */
  timeAgoLabel?: string
  dateRangeLabel?: string
}

/** One quota lane: current bar plus prior reset bars (Wave 41). */
export interface QuotaLane {
  laneKey: string
  laneLabel: string
  currentBar: QuotaBarGroup | null
  priorBars: QuotaBarGroup[]
}

/** Per-model mini-row for card-pane-right at ≥3840px. */
export interface TopModelRow {
  model: string
  tokens: number
  /** Null means no row in the group persisted response_cost_usd. */
  cost_usd: number | null
  requests: number
  /** Upstream P95 latency in ms; null when no matching health row. */
  p95_ms?: number | null
}

/** Early-reset anomaly payload keyed by provider (hook output). */
export type EarlyResetMap = Map<string, { prior: string; current: string }>

/**
 * Anomaly flags raised by useAnomalyDetection.
 */
export interface AnomalyFlags {
  /** Hook output is Map; legacy tests may still pass Set (both support `.has`). */
  earlyReset: EarlyResetMap | Set<string>
  cacheStale: boolean
}
