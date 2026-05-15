export const usageReportGroupPresets = [
  {
    value: 'daily-model',
    label: 'Daily model',
    groupBy: ['environment', 'client', 'repository', 'provider_model'],
  },
  {
    value: 'repository',
    label: 'Repository',
    groupBy: ['repository', 'provider_model'],
  },
  {
    value: 'environment',
    label: 'Environment',
    groupBy: ['environment', 'client'],
  },
  {
    value: 'provider-model',
    label: 'Provider model',
    groupBy: ['provider', 'model'],
  },
  {
    value: 'provider',
    label: 'Provider',
    groupBy: ['provider'],
  },
] as const

export const usageReportGrains = ['day', 'week', 'month'] as const

export type UsageReportGrain = (typeof usageReportGrains)[number]
export type UsageReportGroupPreset = (typeof usageReportGroupPresets)[number]
export type UsageReportDimension = UsageReportGroupPreset['groupBy'][number]

export interface UsageReportParams {
  from: string
  to: string
  grain: UsageReportGrain
  groupBy?: readonly UsageReportDimension[]
}

export interface UsageReportRow {
  bucket: string
  environment?: string
  client?: string
  repository?: string
  provider?: string
  model?: string
  provider_model?: string
  weekly_reset_first: string | null
  weekly_reset_last: string | null
  min_weekly_pct: number | null
  max_weekly_pct: number | null
  short_reset_first: string | null
  short_reset_last: string | null
  min_short_pct: number | null
  max_short_pct: number | null
  weekly_reset_special_first: string | null
  weekly_reset_special_last: string | null
  min_weekly_pct_special: number | null
  max_weekly_pct_special: number | null
  short_reset_special_first: string | null
  short_reset_special_last: string | null
  min_short_pct_special: number | null
  max_short_pct_special: number | null
  traces: number | null
  token_in: number | null
  token_out: number | null
  token_cache_input: number | null
  token_cache_creation: number | null
  reasoning_tokens_sources: string | null
  token_reasoning_reported: number | null
  token_reasoning_estimated: number | null
  cache_attempted_summary: string | null
  cache_miss_summary: string | null
  cache_miss_reasons: string | null
  token_cache_miss: number | null
  token_total: number | null
  cache_miss_usd_cost: number | null
  usd_cost: number | null
  tool_calls: number | null
  git_commit: number | null
  git_push: number | null
  litellm_processing_total_ms: number | null
  litellm_processing_average_ms: number | null
  llm_upstream_elapsed_total_ms: number | null
  llm_upstream_elapsed_average_ms: number | null
  period_start: string | null
  period_end: string | null
}

export interface UsageReportSummary {
  traces: number
  token_in: number
  token_out: number
  token_cache_input: number
  token_cache_creation: number
  token_reasoning_reported: number
  token_reasoning_estimated: number
  token_total: number
  usd_cost: number
  cache_miss_usd_cost: number
  tool_calls: number
  git_commit: number
  git_push: number
  period_start: string | null
  period_end: string | null
  latest_record_at: string | null
}

export interface UsageReportTrendRow {
  bucket: string
  provider: string
  model: string
  repository: string
  traces: number
  token_total: number
  usd_cost: number
}

export interface UsageReportClientRow {
  client_name: string
  client_version: string
  first_seen_at: string | null
  traces: number
  token_total: number
  usd_cost: number
}

export interface UsageReportProviderLatencyHealthRow {
  bucket_start: string | null
  environment: string
  provider: string
  model: string
  model_group: string
  requests: number
  passive_latency_sample_status: string
  upstream_p50_ms: number | null
  upstream_p95_ms: number | null
  upstream_p99_ms: number | null
  total_p95_ms: number | null
  proxy_processing_p95_ms: number | null
  missing_upstream_latency: number
  provider_error_events: number
  rate_limit_events: number
  capacity_events: number
  provider_5xx_events: number
  provider_timeout_events: number
  network_error_events: number
  auth_failed_events: number
  adapter_error_events: number
  status_probe_count: number
  status_probe_success_pct: number | null
  status_probe_p95_ms: number | null
  provider_ping_avg_ms: number | null
  provider_ping_packet_loss_pct: number | null
  control_ping_avg_ms: number | null
  control_packet_loss_pct: number | null
  control_probe_success_pct: number | null
  provider_ping_minus_control_ms: number | null
  dns_failures: number
  tcp_failures: number
  tls_failures: number
  icmp_failures: number
  probed_endpoints: string | null
  status_error_classes: string | null
  min_remaining_pct: number | null
  max_remaining_pct: number | null
  next_expected_reset_at: string | null
  quota_keys: string | null
  request_period_start: string | null
  request_period_end: string | null
}

export interface UsageReportProviderErrorObservationRow {
  observed_at: string | null
  environment: string
  provider: string
  model: string
  model_group: string
  route_family: string
  status_code: number | null
  error_type: string
  error_code: string
  error_class: string
  retry_after_seconds: number | null
  expected_reset_at: string | null
}

export interface UsageReportProviderStatusUsageRow {
  provider: string
  model: string
  traces: number
  token_total: number
  usd_cost: number
  period_start: string | null
  period_end: string | null
}

export interface UsageReportQuotaRow {
  provider: string
  model: string | null
  weekly_remaining_pct: number | null
  weekly_reset_at: string | null
  weekly_interval_start: string | null
  weekly_interval_end: string | null
  weekly_active: boolean
  weekly_usage_tokens: number
  weekly_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  short_remaining_pct: number | null
  short_reset_at: string | null
  short_interval_start: string | null
  short_interval_end: string | null
  short_active: boolean
  short_usage_tokens: number
  short_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  special_remaining_pct: number | null
  special_reset_at: string | null
  special_interval_start: string | null
  special_interval_end: string | null
  special_active: boolean
  special_usage_tokens: number
  special_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  short_special_remaining_pct: number | null
  short_special_reset_at: string | null
  short_special_interval_start: string | null
  short_special_interval_end: string | null
  short_special_active: boolean
  short_special_usage_tokens: number
  short_special_usage_breakdown: UsageReportQuotaUsageBreakdown[]
}

export interface UsageReportQuotaUsageBreakdown {
  model: string
  tokens: number
  cost: number
  traces: number
}

export interface UsageReportResponse {
  metadata: {
    from: string
    to: string
    grain: UsageReportGrain
    groupBy: UsageReportDimension[]
    limit: number
    generatedAt: string
    latestRecordAt: string | null
    latestRecordAgeMinutes: number | null
    latestRecordStale: boolean
    staleRecordThresholdMinutes: number
  }
  summary: UsageReportSummary
  trend: UsageReportTrendRow[]
  clients: UsageReportClientRow[]
  providerLatencyHealth: UsageReportProviderLatencyHealthRow[]
  providerErrorObservations: UsageReportProviderErrorObservationRow[]
  providerStatusUsage: UsageReportProviderStatusUsageRow[]
  quotas: UsageReportQuotaRow[]
  rows: UsageReportRow[]
}

export interface UsageReportQuotasResponse {
  metadata: {
    generatedAt: string
    latestRecordAt: string | null
    latestRecordAgeMinutes: number | null
    latestRecordStale: boolean
    staleRecordThresholdMinutes: number
  }
  quotas: UsageReportQuotaRow[]
}

export async function fetchUsageReport(
  params: UsageReportParams
): Promise<UsageReportResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
    grain: params.grain,
    group_by:
      params.groupBy?.join(',') ??
      'environment,client,repository,provider_model',
    limit: '500',
    sort: 'period_end',
  })

  const response = await fetch(`/api/shell/reports/usage?${searchParams}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Usage report request failed with ${response.status}`
    throw new Error(message)
  }

  return response.json()
}

export async function fetchUsageReportQuotas(): Promise<UsageReportQuotasResponse> {
  const response = await fetch('/api/shell/reports/quotas')
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Usage quota request failed with ${response.status}`
    throw new Error(message)
  }

  return response.json()
}
