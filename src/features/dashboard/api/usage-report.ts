import { z } from 'zod'
import { queryOptions } from '@tanstack/react-query'

const LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS = 60_000

/** Shared React Query key for quota fetches (index + phosphor-dashboard). */
export function usageReportQuotasKey(
  from: string,
  to: string,
  cacheBust?: string
): readonly [string, string, string, ...string[]] {
  const key: [string, string, string, ...string[]] = [
    'usage-report-quotas',
    from,
    to,
  ]
  if (cacheBust !== undefined) {
    key.push(cacheBust)
  }
  return key
}

export interface UsageReportQuotasQueryOptionsParams {
  from: string
  to: string
  /** Optional bust token; included in queryKey when set (manual refresh / report refresh). */
  cacheBust?: string
}

/** Shared quotas query options (index + phosphor-dashboard). */
export function usageReportQuotasQueryOptions({
  from,
  to,
  cacheBust,
}: UsageReportQuotasQueryOptionsParams) {
  const resolvedCacheBust =
    cacheBust !== undefined && cacheBust !== '' ? cacheBust : undefined
  return queryOptions({
    queryKey: usageReportQuotasKey(from, to, resolvedCacheBust),
    queryFn: ({ signal }) =>
      fetchUsageReportQuotas({ cacheBust: resolvedCacheBust }, signal),
    staleTime: LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })
}

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
export const usageReportIdentityDimensions = [
  'inbound_model_alias',
  'agent_name',
  'agent_id',
] as const

export type UsageReportGrain = (typeof usageReportGrains)[number]
export type UsageReportGroupPreset = (typeof usageReportGroupPresets)[number]

/** Wire fields attached to usage-report API metadata when cache decoration is present. */
export interface ReportCacheMetadata {
  cacheBackend?: string
  cacheFreshUntil?: string | null
  cacheGeneratedAt?: string | null
  cacheKeyHash?: string
  cacheScope?: string
  cacheStaleUntil?: string | null
  cacheStatus?: string
  cacheRefreshing?: boolean
}

/** Canonical field names for {@link ReportCacheMetadata} (runtime companion). */
export const REPORT_CACHE_METADATA_FIELDS = [
  'cacheBackend',
  'cacheFreshUntil',
  'cacheGeneratedAt',
  'cacheKeyHash',
  'cacheScope',
  'cacheStaleUntil',
  'cacheStatus',
  'cacheRefreshing',
] as const

export type ReportCacheMetadataField =
  (typeof REPORT_CACHE_METADATA_FIELDS)[number]

export function isReportCacheMetadata(
  value: unknown
): value is ReportCacheMetadata {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const key of REPORT_CACHE_METADATA_FIELDS) {
    if (!(key in record)) continue
    const field = record[key]
    if (key === 'cacheRefreshing') {
      if (field !== undefined && typeof field !== 'boolean') return false
      continue
    }
    if (
      key === 'cacheFreshUntil' ||
      key === 'cacheGeneratedAt' ||
      key === 'cacheStaleUntil'
    ) {
      if (field !== undefined && field !== null && typeof field !== 'string') {
        return false
      }
      continue
    }
    if (field !== undefined && typeof field !== 'string') return false
  }
  return true
}
export type UsageReportDimension =
  | UsageReportGroupPreset['groupBy'][number]
  | (typeof usageReportIdentityDimensions)[number]
export type UsageReportConfigChangeFilterValue =
  | 'true'
  | 'false'
  | 'null'
  | 'unknown'
  | 'evaluated'
  | 'unevaluated'

/**
 * Multi-value dimension filters supported by the usage report API.
 *
 * 15-D.1: The server uses parseCsv() on each param, so values are joined as
 * comma-separated strings in the query string (e.g. `provider=openai,anthropic`).
 * The server's filterColumns map accepts: provider, repository, client,
 * environment, model, provider_model, inbound_model_alias, agent_name, and
 * agent_id. Config-change filters accept true, false, null/unknown/unevaluated,
 * or evaluated. Empty arrays → no filter applied (all values returned).
 *
 * Param names (singular) match the server's filterColumns keys exactly.
 */
export interface UsageReportFilterParams {
  /** Filter to specific providers (empty = all). */
  provider?: readonly string[]
  /** Filter to specific repositories/tenant_ids (empty = all). */
  repository?: readonly string[]
  /** Filter to specific client names (empty = all). */
  client?: readonly string[]
  /** Filter to specific environments (empty = all). */
  environment?: readonly string[]
  /** Filter to specific models (empty = all). */
  model?: readonly string[]
  /** Filter to requested inbound aliases/models captured by session_history. */
  inbound_model_alias?: readonly string[]
  /** Filter to display agent names captured by session_history. */
  agent_name?: readonly string[]
  /** Filter to opaque agent IDs captured by session/tool activity rows. */
  agent_id?: readonly string[]
  /** Filter by sessions that changed .pre-commit config. */
  changed_pre_commit_config?: readonly UsageReportConfigChangeFilterValue[]
  /** Filter by sessions that changed .env* files. */
  changed_env_file?: readonly UsageReportConfigChangeFilterValue[]
  /** Filter by sessions that changed pyproject.toml. */
  changed_pyproject_toml?: readonly UsageReportConfigChangeFilterValue[]
  /** Filter by sessions that changed .gitignore. */
  changed_gitignore?: readonly UsageReportConfigChangeFilterValue[]
}

export interface UsageReportParams extends UsageReportFilterParams {
  from: string
  to: string
  grain: UsageReportGrain
  groupBy?: readonly UsageReportDimension[]
  cacheBust?: string
}

export interface UsageReportAgentScoreReason {
  family: string
  reason: string
  count: number
}

export interface UsageReportLatencyFields {
  latency_sample_rows?: number | null
  litellm_pre_send_p50_ms?: number | null
  litellm_pre_send_p95_ms?: number | null
  litellm_pre_send_p99_ms?: number | null
  litellm_pre_send_count?: number | null
  litellm_post_response_p50_ms?: number | null
  litellm_post_response_p95_ms?: number | null
  litellm_post_response_p99_ms?: number | null
  litellm_post_response_count?: number | null
  litellm_processing_p50_ms?: number | null
  litellm_processing_p95_ms?: number | null
  litellm_processing_p99_ms?: number | null
  litellm_processing_count?: number | null
  llm_upstream_time_to_first_byte_p50_ms?: number | null
  llm_upstream_time_to_first_byte_p95_ms?: number | null
  llm_upstream_time_to_first_byte_p99_ms?: number | null
  llm_upstream_time_to_first_byte_count?: number | null
  llm_upstream_elapsed_p50_ms?: number | null
  llm_upstream_elapsed_p95_ms?: number | null
  llm_upstream_elapsed_p99_ms?: number | null
  llm_upstream_elapsed_count?: number | null
  llm_upstream_stream_p50_ms?: number | null
  llm_upstream_stream_p95_ms?: number | null
  llm_upstream_stream_p99_ms?: number | null
  llm_upstream_stream_count?: number | null
  ttft_p50_ms?: number | null
  ttft_p95_ms?: number | null
  ttft_p99_ms?: number | null
  ttft_count?: number | null
  total_server_elapsed_p50_ms?: number | null
  total_server_elapsed_p95_ms?: number | null
  total_server_elapsed_p99_ms?: number | null
  total_server_elapsed_count?: number | null
  latency_unclassified_p50_ms?: number | null
  latency_unclassified_p95_ms?: number | null
  latency_unclassified_p99_ms?: number | null
  latency_unclassified_count?: number | null
  previous_response_to_current_request_p50_ms?: number | null
  previous_response_to_current_request_p95_ms?: number | null
  previous_response_to_current_request_p99_ms?: number | null
  previous_response_to_current_request_count?: number | null
  llm_upstream_output_tokens_per_second_p50?: number | null
  llm_upstream_output_tokens_per_second_p95?: number | null
  llm_upstream_output_tokens_per_second_count?: number | null
  llm_stream_output_tokens_per_second_p50?: number | null
  llm_stream_output_tokens_per_second_p95?: number | null
  llm_stream_output_tokens_per_second_count?: number | null
}

export interface UsageReportConfigChangeFields {
  config_change_evaluated_rows?: number | null
  config_change_unevaluated_rows?: number | null
  config_change_any_true_rows?: number | null
  changed_pre_commit_config_true_rows?: number | null
  changed_pre_commit_config_false_rows?: number | null
  changed_pre_commit_config_unknown_rows?: number | null
  changed_env_file_true_rows?: number | null
  changed_env_file_false_rows?: number | null
  changed_env_file_unknown_rows?: number | null
  changed_pyproject_toml_true_rows?: number | null
  changed_pyproject_toml_false_rows?: number | null
  changed_pyproject_toml_unknown_rows?: number | null
  changed_gitignore_true_rows?: number | null
  changed_gitignore_false_rows?: number | null
  changed_gitignore_unknown_rows?: number | null
}

export interface UsageReportQuotaRangeHistoryParams {
  from: string
  to: string
  cacheBust?: string
}

export interface UsageReportQuotaHistoryParams {
  cacheBust?: string
}

export interface UsageReportQuotaEstimatorParams {
  from: string
  to: string
  cacheBust?: string
}

export interface UsageReportQuotasParams {
  cacheBust?: string
}

export interface UsageReportToolActivityParams extends UsageReportFilterParams {
  from: string
  to: string
  cacheBust?: string
}

export interface UsageReportSessionDiagnosticsParams extends UsageReportFilterParams {
  from: string
  to: string
  session_id?: readonly string[]
  trace_id?: readonly string[]
  litellm_call_id?: readonly string[]
  grok_side_channel?: boolean | string | null
  grok_side_channel_endpoint_type?: readonly string[]
  limit?: number
  cacheBust?: string
}

export interface UsageReportRow
  extends UsageReportLatencyFields, UsageReportConfigChangeFields {
  bucket: string
  environment?: string
  client?: string
  repository?: string
  provider?: string
  model?: string
  inbound_model_alias?: string | null
  agent_name?: string | null
  agent_id?: string | null
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
  agent_score_rows?: number | null
  agent_quality_score?: number | null
  agent_quality_evaluated?: number | null
  agent_quality_possible?: number | null
  agent_quality_failures?: number | null
  agent_instruction_score?: number | null
  agent_instruction_evaluated?: number | null
  agent_instruction_possible?: number | null
  agent_instruction_failures?: number | null
  agent_tool_score?: number | null
  agent_tool_evaluated?: number | null
  agent_tool_possible?: number | null
  agent_tool_failures?: number | null
  agent_contract_score?: number | null
  agent_contract_evaluated?: number | null
  agent_contract_possible?: number | null
  agent_contract_failures?: number | null
  agent_progress_score?: number | null
  agent_progress_evaluated?: number | null
  agent_progress_possible?: number | null
  agent_progress_failures?: number | null
  agent_risk_score?: number | null
  agent_risk_evaluated?: number | null
  agent_risk_possible?: number | null
  agent_risk_events?: number | null
  agent_discovery_inventory_coverage_score?: number | null
  agent_discovery_inventory_coverage_evaluated?: number | null
  agent_discovery_inventory_coverage_possible?: number | null
  agent_discovery_inventory_coverage_failures?: number | null
  agent_discovery_inventory_missing_count?: number | null
  agent_terminal_completion_score?: number | null
  agent_terminal_completion_evaluated?: number | null
  agent_terminal_completion_possible?: number | null
  agent_terminal_completion_failures?: number | null
  agent_empty_completion_failures?: number | null
  agent_invalid_tool_call_errors?: number | null
  agent_destructive_checkout_failures?: number | null
  agent_large_payload_risks?: number | null
  agent_read_only_policy_violations?: number | null
  agent_ignored_path_tracking_policy_score?: number | null
  agent_ignored_path_tracking_policy_evaluated?: number | null
  agent_ignored_path_tracking_policy_possible?: number | null
  agent_ignored_path_tracking_violation_count?: number | null
  agent_baseline_deflection_attempted_score?: number | null
  agent_baseline_deflection_attempted_evaluated?: number | null
  agent_baseline_deflection_attempted_incidents?: number | null
  agent_baseline_deflection_incident_score?: number | null
  agent_baseline_deflection_incident_evaluated?: number | null
  agent_baseline_deflection_incidents?: number | null
  agent_baseline_deflection_attempt_count?: number | null
  agent_baseline_deflection_tool_call_count?: number | null
  agent_baseline_deflection_input_tokens?: number | null
  agent_baseline_deflection_elapsed_ms?: number | null
  agent_quality_gate_trigger_count?: number | null
  agent_quality_gate_fix_attempt_count?: number | null
  agent_quality_gate_rerun_count?: number | null
  agent_sleep_wellness_interruption_attempted_score?: number | null
  agent_sleep_wellness_interruption_attempted_evaluated?: number | null
  agent_sleep_wellness_interruption_attempted_incidents?: number | null
  agent_sleep_wellness_interruption_incident_score?: number | null
  agent_sleep_wellness_interruption_incident_evaluated?: number | null
  agent_sleep_wellness_interruption_incidents?: number | null
  agent_sleep_wellness_interruption_count?: number | null
  agent_sleep_wellness_interruption_output_tokens?: number | null
  agent_sleep_wellness_interruption_input_tokens?: number | null
  agent_sleep_wellness_interruption_elapsed_ms?: number | null
  agent_sleep_wellness_interruption_after_user_pushback_count?: number | null
  agent_sleep_wellness_interruption_repeated_count?: number | null
  agent_compact_summary_events?: number | null
  agent_compact_summary_thread_count?: number | null
  agent_compact_summary_id_count?: number | null
  agent_compact_summary_resume_contexts?: number | null
  agent_compact_summary_verify_contexts?: number | null
  agent_compact_summary_source_counts?: Record<string, number> | string | null
  agent_score_reasons_top?: UsageReportAgentScoreReason[] | string | null
  period_start: string | null
  period_end: string | null
}

export interface UsageReportTokenTrendScoreRow {
  bucket: string
  provider: string
  model: string
  agent_score_rows?: number | null
  agent_quality_score?: number | null
  agent_quality_evaluated?: number | null
  agent_quality_possible?: number | null
  agent_quality_failures?: number | null
  agent_instruction_score?: number | null
  agent_instruction_evaluated?: number | null
  agent_instruction_possible?: number | null
  agent_instruction_failures?: number | null
  agent_tool_score?: number | null
  agent_tool_evaluated?: number | null
  agent_tool_possible?: number | null
  agent_tool_failures?: number | null
  agent_contract_score?: number | null
  agent_contract_evaluated?: number | null
  agent_contract_possible?: number | null
  agent_contract_failures?: number | null
  agent_progress_score?: number | null
  agent_progress_evaluated?: number | null
  agent_progress_possible?: number | null
  agent_progress_failures?: number | null
  agent_risk_score?: number | null
  agent_risk_evaluated?: number | null
  agent_risk_possible?: number | null
  agent_risk_events?: number | null
  agent_discovery_inventory_coverage_score?: number | null
  agent_discovery_inventory_coverage_evaluated?: number | null
  agent_discovery_inventory_coverage_possible?: number | null
  agent_discovery_inventory_coverage_failures?: number | null
  agent_terminal_completion_score?: number | null
  agent_terminal_completion_evaluated?: number | null
  agent_terminal_completion_possible?: number | null
  agent_terminal_completion_failures?: number | null
  agent_ignored_path_tracking_policy_score?: number | null
  agent_ignored_path_tracking_policy_evaluated?: number | null
  agent_ignored_path_tracking_policy_possible?: number | null
  agent_ignored_path_tracking_violation_count?: number | null
  agent_baseline_deflection_attempted_score?: number | null
  agent_baseline_deflection_attempted_evaluated?: number | null
  agent_baseline_deflection_attempted_incidents?: number | null
  agent_baseline_deflection_incident_score?: number | null
  agent_baseline_deflection_incident_evaluated?: number | null
  agent_baseline_deflection_incidents?: number | null
  agent_sleep_wellness_interruption_attempted_score?: number | null
  agent_sleep_wellness_interruption_attempted_evaluated?: number | null
  agent_sleep_wellness_interruption_attempted_incidents?: number | null
  agent_sleep_wellness_interruption_incident_score?: number | null
  agent_sleep_wellness_interruption_incident_evaluated?: number | null
  agent_sleep_wellness_interruption_incidents?: number | null
}

export interface UsageReportSummary extends UsageReportConfigChangeFields {
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

export interface UsageReportTokenTrendHourRow {
  day: string
  hour: number
  provider: string
  traces: number
  token_total: number
  usd_cost: number
  tool_calls?: number
}

export interface UsageReportTokenTrendVersionIntervalRow {
  provider: string
  client_name: string
  client_version: string
  first_seen_at: string | null
  last_seen_at: string | null
  first_seen_day: string | null
  first_seen_hour: number | null
  last_seen_day: string | null
  last_seen_hour: number | null
  traces: number
  token_total: number
  usd_cost: number
}

export interface UsageReportTokenTrendModelFirstSeenRow {
  provider: string
  model: string
  first_seen_at: string | null
  first_seen_day: string | null
  first_seen_hour: number | null
  observations: number
  token_total: number
}

export interface UsageReportTokenTrendDayDetailRow {
  day: string
  hour: number
  provider: string
  client_name: string
  client_version: string
  first_seen_at: string | null
  last_seen_at: string | null
  traces: number
  token_total: number
  usd_cost: number
}

export interface UsageReportClientRow {
  client_name: string
  client_version: string
  first_seen_at: string | null
  /** W32: timestamp of the most recent request from this client/version tuple. */
  last_seen_at: string | null
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
  error_message: string | null
  retry_after_seconds: number | null
  expected_reset_at: string | null
}

export interface UsageReportDockerLogErrorRow {
  observed_at: string | null
  container: string
  stream: string
  provider: string
  status_code: number | null
  level: string
  message: string
}

export interface UsageReportLocalHealthRow {
  checked_at: string | null
  category: 'container' | 'model'
  key: string
  label: string
  status: 'green' | 'yellow' | 'red'
  detail: string
  target: string | null
  latency_ms: number | null
}

export interface ShellPgBouncerPoolSummary {
  clActive: number
  clWaiting: number
  svActive: number
  svIdle: number
  svUsed: number
  svTested: number
  svLogin: number
  maxWaitSeconds: number
  maxWaitMicroseconds: number
}

export interface ShellPgBouncerStatsSummary {
  totalXactCount: number
  totalQueryCount: number
  totalReceived: number
  totalSent: number
  avgXactCount: number
  avgQueryCount: number
  avgWaitTime: number
}

export interface ShellPgBouncerServerSummary {
  total: number
  active: number
  idle: number
  used: number
  tested: number
  login: number
  byState: { state: string; count: number }[]
}

export interface ShellPgBouncerPoolRow extends ShellPgBouncerPoolSummary {
  database: string | null
  user: string | null
  poolMode: string | null
}

export interface ShellPgBouncerStatsRow extends ShellPgBouncerStatsSummary {
  database: string | null
}

export interface ShellPgBouncerContainerStatus {
  present: boolean
  status: string
  health: string | null
  running: boolean
  startedAt?: string | null
  finishedAt?: string | null
  logConfig: {
    type: string | null
    maxSize: string | null
    maxFile: string | null
  } | null
  error: string | null
}

export interface ShellPgBouncerAdminStatus {
  configured: boolean
  status: 'ok' | 'unconfigured' | 'unreachable' | 'unknown'
  endpoint: {
    database: string | null
    host: string
    port: string | null
  } | null
  error: string | null
  poolSummary: ShellPgBouncerPoolSummary
  statsSummary: ShellPgBouncerStatsSummary
  serverSummary: ShellPgBouncerServerSummary
  pools: ShellPgBouncerPoolRow[]
  stats: ShellPgBouncerStatsRow[]
}

export interface ShellPgBouncerSidecar {
  key: string
  label: string
  containerName: string
  hostEndpoint: string
  runtimeAliases: string[]
  upstreamPostgres: string
  status: 'green' | 'yellow' | 'red'
  container: ShellPgBouncerContainerStatus
  admin: ShellPgBouncerAdminStatus
}

export interface ShellPgBouncerHealth {
  status: 'green' | 'yellow' | 'red' | 'unknown'
  error?: string
  sidecars: ShellPgBouncerSidecar[]
}

export interface ShellHealthResponse {
  ok: boolean
  pgBouncerSidecars?: ShellPgBouncerHealth
  sourceTables?: {
    status: string
    checkedAt: string
    cacheTtlMs?: number
    tables: Array<{
      tableName: string
      category?: string
      status: string
      latestRowId?: number | null
      latestDataAt: string | null
      latestPersistedAt?: string | null
      latestEventAt: string | null
      latestDataAgeMinutes?: number | null
      rowCount?: number | null
      staleAfterMinutes?: number | null
      refreshOwner?: string | null
    }>
  }
}

export interface UsageReportProviderStatusUsageRow extends UsageReportLatencyFields {
  provider: string
  model: string
  traces: number
  token_total: number
  usd_cost: number
  period_start: string | null
  period_end: string | null
}

export type UsageReportQuotaBillingLane =
  | 'weekly'
  | 'short'
  | 'special'
  | 'short_special'
  | 'monthly'
  | 'wtus'

export interface UsageReportQuotaBillingDetail {
  quota_limit?: number | null
  quota_used?: number | null
  quota_remaining?: number | null
  billing_observed_at?: string | null
  billing_period_start_at?: string | null
  billing_period_end_at?: string | null
  raw_provider_fields?: Record<string, unknown>
  evidence?: Record<string, unknown>
}

export interface UsageReportQuotaRow {
  provider: string
  model: string | null
  billing_details?: Partial<
    Record<UsageReportQuotaBillingLane, UsageReportQuotaBillingDetail>
  >
  weekly_remaining_pct: number | null
  weekly_reset_at: string | null
  weekly_interval_start: string | null
  weekly_interval_end: string | null
  weekly_active: boolean
  weekly_usage_tokens: number
  weekly_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  weekly_velocity_segments?: boolean[]
  weekly_velocity_scores?: number[]
  weekly_velocity_sample_count?: number
  short_remaining_pct: number | null
  short_reset_at: string | null
  short_interval_start: string | null
  short_interval_end: string | null
  short_active: boolean
  short_usage_tokens: number
  short_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  short_velocity_segments?: boolean[]
  short_velocity_scores?: number[]
  short_velocity_sample_count?: number
  special_remaining_pct: number | null
  special_reset_at: string | null
  special_interval_start: string | null
  special_interval_end: string | null
  special_active: boolean
  special_usage_tokens: number
  special_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  special_velocity_segments?: boolean[]
  special_velocity_scores?: number[]
  special_velocity_sample_count?: number
  short_special_remaining_pct: number | null
  short_special_reset_at: string | null
  short_special_interval_start: string | null
  short_special_interval_end: string | null
  short_special_active: boolean
  short_special_usage_tokens: number
  short_special_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  short_special_velocity_segments?: boolean[]
  short_special_velocity_scores?: number[]
  short_special_velocity_sample_count?: number
  monthly_remaining_pct: number | null
  monthly_reset_at: string | null
  monthly_interval_start: string | null
  monthly_interval_end: string | null
  monthly_active: boolean
  monthly_usage_tokens: number
  monthly_usage_breakdown: UsageReportQuotaUsageBreakdown[]
  monthly_velocity_segments?: boolean[]
  monthly_velocity_scores?: number[]
  monthly_velocity_sample_count?: number
  wtus_remaining_pct?: number | null
  wtus_reset_at?: string | null
  wtus_interval_start?: string | null
  wtus_interval_end?: string | null
  wtus_active?: boolean
  wtus_usage_tokens?: number
  wtus_usage_breakdown?: UsageReportQuotaUsageBreakdown[]
  wtus_velocity_segments?: boolean[]
  wtus_velocity_scores?: number[]
  wtus_velocity_sample_count?: number
}

export interface UsageReportQuotaUsageBreakdown {
  model: string
  tokens: number
  cost: number
  traces: number
  recent_traces_90m?: number
}

/**
 * W32: A single past reset window entry from quotaHistory[].
 *
 * Each row represents one completed reset window for a (provider, quota_type)
 * pair. Full parity with current quota bars: per-model breakdown, interval
 * bounds, and token totals are all included so historical bars can render
 * identically to current bars.
 */
export interface UsageReportQuotaHistoryRow {
  provider: string
  model: string | null
  /**
   * Quota type after normalisation: 'weekly' | 'special' | 'short' |
   * 'short_special' | 'monthly' | 'wtus'
   */
  quota_type: string
  /** ISO timestamp of the reset point that ended this window. */
  expected_reset_at: string | null
  /** ISO timestamp of the earliest rate-limit record in this window. */
  interval_start: string | null
  /** ISO timestamp equal to expected_reset_at (the window close boundary). */
  interval_end: string | null
  /** Lowest remaining_pct observed within this window (peak consumption). */
  min_remaining_pct: number | null
  /** Highest remaining_pct observed (typically near-100 just after reset). */
  max_remaining_pct: number | null
  /** Per-percent velocity flags for this completed reset window. */
  velocity_segments?: boolean[]
  /** Per-percent burn-rate scores for this completed reset window. */
  velocity_scores?: number[]
  /** Number of observation samples behind the historical velocity arrays. */
  velocity_sample_count?: number
  /** Total tokens consumed within the window across all models. */
  usage_tokens: number
  /** Per-model breakdown: token/cost/traces for each model in the window. */
  usage_breakdown: UsageReportQuotaUsageBreakdown[]
}

/**
 * W33: One row from the toolActivity[] field in the usage report.
 *
 * Rows are ordered `provider ASC, model ASC, kind ASC, calls DESC`.
 * - `kind === 'outer'`: per-tool_name call counts (includes MCP tool names like
 *   `mcp__aawm__search` and shell-class names like `Bash`).
 * - `kind === 'shell'`: command-label sub-rollup rows (e.g. `git commit`,
 *   `npm test`) recorded when shell-class tools are invoked.
 */
export interface UsageReportToolActivityRow {
  provider: string
  model: string
  /** 'outer' = per tool_name count; 'shell' = command-label sub-rollup. */
  kind: 'outer' | 'shell'
  /** Tool name (outer rows) or command label (shell rows). */
  label: string
  /** Distinct display agent names represented by the grouped row. */
  agent_names?: string[]
  /** Distinct opaque agent IDs represented by the grouped row. */
  agent_ids?: string[]
  calls: number
}

export interface UsageReportAliasRouteEvent {
  observed_at?: string | null
  session_id?: string | null
  trace_id?: string | null
  litellm_call_id?: string | null
  alias_model?: string | null
  alias_family?: string | null
  provider?: string | null
  model?: string | null
  route_family?: string | null
  attempt_number?: number | string | null
  event_type?: string | null
  failure_class?: string | null
  cooldown_state?: string | null
  cooldown_until?: string | null
  redispatch_required?: boolean | string | null
  last_resort?: boolean | string | null
  details?: Record<string, unknown> | null
}

export interface UsageReportSessionDiagnosticsRow {
  created_at?: string | null
  start_time?: string | null
  end_time?: string | null
  session_id?: string | null
  trace_id?: string | null
  litellm_call_id?: string | null
  provider?: string | null
  model?: string | null
  model_group?: string | null
  repository?: string | null
  client?: string | null
  client_version?: string | null
  environment?: string | null
  inbound_model_alias?: string | null
  agent_name?: string | null
  agent_id?: string | null
  diagnostic_flags?: string[]
  diagnostic_categories?: string[]
  grok_oauth?: {
    credential_family?: string | null
    grok_native_oauth_managed?: boolean | string | null
    grok_native_entrypoint?: string | null
    passthrough_route_family?: string | null
    route_family?: string | null
    auth_mode?: string | null
    grok_model_override?: string | null
  } | null
  grok_side_channel?: {
    enabled?: boolean | string | null
    endpoint_type?: string | null
    endpoint_template?: string | null
    content_type?: string | null
    body_byte_length?: number | null
    body_sha256?: string | null
    digest_source?: string | null
    json_container_type?: string | null
    top_level_key_types?: unknown
    array_length?: number | null
  } | null
  output_contract?: {
    usage_output_contract_required_final_phrase?: string | null
    usage_output_contract_required_final_phrase_present?:
      | boolean
      | string
      | null
    usage_output_contract_required_final_phrase_source?: string | null
    usage_output_contract_failure_class?: string | null
    usage_output_contract_failure_count?: number | null
    usage_output_contract_setup_only_detected?: boolean | string | null
    usage_output_contract_setup_only_markers?: unknown
    usage_output_contract_final_text_chars?: number | null
    usage_agent_score_reasons?: unknown
  } | null
  xai_sanitizer?: {
    xai_responses_request_sanitized?: boolean | string | null
    xai_responses_sanitized_removed_params?: string[] | unknown
    xai_responses_sanitized_tool_count?: number | null
    xai_responses_sanitized_tool_types?: string[] | unknown
    xai_responses_sanitized_tools?: unknown
    xai_tool_choice_without_tools_removed?: unknown
    xai_tool_choice_without_tools_removed_reason?: string | null
    request_tags?: unknown
    openai_passthrough_route_family?: string | null
    passthrough_route_family?: string | null
    route_family?: string | null
    credential_family?: string | null
  } | null
  transcript_attribution?: {
    session_history_transcript_attribution_status?: string | null
    session_history_transcript_attribution_source?: string | null
    reason?: string | null
    match_rule?: string | null
    updated_at?: string | null
    session_history_transcript_attribution?: unknown
  } | null
  tool_definitions?: {
    aawm_tool_definition_capture_version?: string | null
    aawm_tool_definition_capture_source?: string | null
    aawm_tool_definition_count?: number | null
    aawm_tool_definition_captured_count?: number | null
    aawm_tool_definition_sources?: unknown
    aawm_tool_definition_names?: string[] | unknown
    aawm_tool_definition_types?: string[] | unknown
    snapshot_hash?: string | null
    aawm_tool_definition_snapshot_truncated?: boolean | string | null
    aawm_tool_definition_snapshot_storage?: string | null
    aawm_tool_definition_snapshot_storage_key?: string | null
    tool_definition_snapshot?: unknown
  } | null
  alias_route_events?: UsageReportAliasRouteEvent[]
}

export type UsageReportProviderAliasRoutingStateSource =
  | 'memory'
  | 'durable_cache'
  | 'local_fallback'
  | 'unknown'

export interface UsageReportProviderAliasRoutingCandidate {
  provider?: string | null
  model?: string | null
  route_family?: string | null
  reason?: string | null
}

export interface UsageReportProviderAliasRoutingEntry {
  family: 'codex' | 'anthropic'
  alias_label?: string | null
  provider?: string | null
  model?: string | null
  route_family?: string | null
  state_kind: 'affinity' | 'cooldown'
  state_source: UsageReportProviderAliasRoutingStateSource
  observed_at: string
  expires_at?: string | null
  cooldown_until?: string | null
  remaining_seconds?: number | null
  is_active?: boolean
  last_resort?: boolean | null
  selection_reason?: string | null
  selected?: UsageReportProviderAliasRoutingCandidate | null
  skipped_candidates?: UsageReportProviderAliasRoutingCandidate[]
}

export type UsageReportProviderAuthHealthState =
  | 'refreshed'
  | 'skipped_valid'
  | 'skipped_expired'
  | 'failed'
  | 'attempted'
  | 'expired'
  | 'unknown'

export interface UsageReportProviderAuthHealthEntry {
  observed_at: string
  environment: string
  provider: string
  auth_family: string
  credential_scope?: string | null
  auth_file_hash_short?: string | null
  status: string
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  expires_at?: string | null
  last_success_at?: string | null
  remaining_seconds?: number | null
  auth_health_state: UsageReportProviderAuthHealthState
  source_task?: string | null
  error_class?: string | null
  error_message?: string | null
  auth_file_source?: string | null
}

export interface UsageReportProviderAuthHealth {
  data_source: 'provider_auth_current'
  freshness_label: string
  generated_at: string
  entries: UsageReportProviderAuthHealthEntry[]
}

export type UsageReportProviderCreditLifecycleStatus =
  | 'available'
  | 'used'
  | 'expired'
  | string

export interface UsageReportProviderCreditLifecycleEntry {
  observed_at: string
  environment: string
  provider: string
  account_hash_short?: string | null
  credit_family: string
  credit_type?: string | null
  available_count: number
  expires_at?: string | null
  source?: string | null
  credit_identity?: string | null
  granted_at?: string | null
  status: UsageReportProviderCreditLifecycleStatus
  redeem_started_at?: string | null
  redeemed_at?: string | null
  operator_annotation?: string | null
  source_url?: string | null
}

export interface UsageReportProviderCreditLifecycleSummary {
  environment: string
  provider: string
  credit_family: string
  label: string
  available_count: number
  used_count: number
  expired_count: number
  total_count: number
}

export interface UsageReportProviderCreditLifecycle {
  data_source: 'provider_credit_current'
  freshness_label: string
  generated_at: string
  summaries: UsageReportProviderCreditLifecycleSummary[]
  entries: UsageReportProviderCreditLifecycleEntry[]
}

export interface UsageReportProviderAliasRouting {
  data_source: 'recent_observed_session_history'
  freshness_label: string
  generated_at: string
  lookback_hours: number
  families: Array<{ family: 'codex' | 'anthropic'; observed: boolean }>
  entries: UsageReportProviderAliasRoutingEntry[]
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
  tokenTrendHours?: UsageReportTokenTrendHourRow[]
  tokenTrendHealth?: UsageReportProviderLatencyHealthRow[]
  tokenTrendScores?: UsageReportTokenTrendScoreRow[]
  tokenTrendVersions?: UsageReportTokenTrendVersionIntervalRow[]
  tokenTrendModelFirstSeen?: UsageReportTokenTrendModelFirstSeenRow[]
  clients: UsageReportClientRow[]
  providerLatencyHealth: UsageReportProviderLatencyHealthRow[]
  providerErrorObservations: UsageReportProviderErrorObservationRow[]
  dockerLogErrors?: UsageReportDockerLogErrorRow[]
  localHealth?: UsageReportLocalHealthRow[]
  providerStatusUsage: UsageReportProviderStatusUsageRow[]
  providerAliasRouting?: UsageReportProviderAliasRouting
  providerAuthHealth?: UsageReportProviderAuthHealth
  providerCreditLifecycle?: UsageReportProviderCreditLifecycle
  quotas: UsageReportQuotaRow[]
  /** W32: flat list of past reset windows per (provider, quota_type). */
  quotaHistory: UsageReportQuotaHistoryRow[]
  /** Range-aware quota history for the PROVIDERS / Quota tab. */
  quotaRangeHistory?: UsageReportQuotaHistoryRow[]
  /** W33: per-tool and per-command-label call counts for the TOOL cell hover. */
  toolActivity: UsageReportToolActivityRow[]
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

export interface UsageReportQuotaRangeHistoryResponse {
  metadata: {
    from: string
    to: string
    generatedAt?: string
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  quotaRangeHistory: UsageReportQuotaHistoryRow[]
}

export interface UsageReportQuotaHistoryResponse {
  metadata: {
    generatedAt?: string
    degraded?: boolean
    degradedReason?: string
    degradedMessage?: string
    quotaHistoryStatementTimeoutMs?: number
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  quotaHistory: UsageReportQuotaHistoryRow[]
}

export interface UsageReportQuotaEstimatorCoefficient {
  estimate_kind: 'static_baseline' | 'rolling_exponential'
  feature: string
  model_family: string
  token_category: 'workload_excluding_cache_read' | 'cache_read'
  coefficient_pct_per_mtok: number
  relative_weight_vs_sonnet: number | null
  confidence_low_pct_per_mtok: number
  confidence_high_pct_per_mtok: number
  half_life_hours: number | null
  effective_sample_size: number
  estimate_status: 'high_confidence' | 'directional_only' | 'not_identifiable'
}

export interface UsageReportQuotaEstimatorLagSensitivity {
  lag_minutes: number
  trainable_interval_count: number
  rmse_pct: number | null
  status: 'evaluated' | 'not_identifiable'
}

export interface UsageReportQuotaEstimatorCacheReadRatio {
  model_family: string
  cache_read_vs_uncached_workload_ratio: number | null
  expected_lower_than_uncached: boolean
  status: 'consistent' | 'anomalous' | 'not_identifiable'
}

export interface UsageReportQuotaEstimatorDiagnostic {
  code: string
  severity: 'info' | 'warning'
  detail: string
}

export interface UsageReportQuotaEstimatorEstimate {
  provider: string
  quota_key: string
  quota_type: string
  quota_lane: string
  selected_lag_minutes: number
  lag_sensitivity: UsageReportQuotaEstimatorLagSensitivity[]
  interval_count: number
  trainable_interval_count: number
  excluded_interval_count: number
  excluded_reasons: Record<string, number>
  residuals: {
    static_baseline: {
      rmse_pct: number | null
      mae_pct: number | null
      max_abs_error_pct: number | null
    }
    rolling_exponential: {
      rmse_pct: number | null
      mae_pct: number | null
      max_abs_error_pct: number | null
    }
  }
  identifiability: {
    status: 'high_confidence' | 'directional_only' | 'not_identifiable'
    trainable_interval_count: number
    effective_sample_size: number
    active_feature_count: number
    model_family_mix_count: number
    max_feature_correlation: number
    risks: string[]
  }
  backtest: {
    status: 'evaluated' | 'not_enough_holdout_data'
    holdout_interval_count?: number
    static_rmse_pct: number | null
    rolling_rmse_pct: number | null
    rolling_improved: boolean
  }
  cache_read_ratios: UsageReportQuotaEstimatorCacheReadRatio[]
  coefficients: UsageReportQuotaEstimatorCoefficient[]
  diagnostics: UsageReportQuotaEstimatorDiagnostic[]
}

export interface UsageReportQuotaEstimatorResponse {
  metadata: {
    from: string | null
    to: string | null
    generatedAt?: string
    phase: '0-2'
    lagCandidatesMinutes: number[]
    estimatorVersion: string
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  phase0Audit: {
    source_database: string
    usage_event_shape: Record<string, unknown>
    quota_pct_interval_shape: Record<string, unknown>
    provider_lane_policy: Record<string, string[]>
    known_missing_fields: string[]
  }
  estimates: UsageReportQuotaEstimatorEstimate[]
}

export interface UsageReportToolActivityResponse {
  metadata: {
    from: string
    to: string
    generatedAt?: string
    degraded?: boolean
    degradedReason?: string
    degradedMessage?: string
    toolActivityRecentRowLimit?: number
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  toolActivity: UsageReportToolActivityRow[]
}

export interface UsageReportSessionDiagnosticsResponse {
  metadata: {
    from: string
    to: string
    limit: number
    generatedAt?: string
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  sessionDiagnostics: UsageReportSessionDiagnosticsRow[]
}

export interface UsageReportTokenTrendDayParams extends UsageReportFilterParams {
  from: string
  to: string
  date: string
  cacheBust?: string
}

export interface UsageReportTokenTrendSummaryParams extends UsageReportFilterParams {
  from: string
  to: string
  cacheBust?: string
}

export interface UsageReportTokenTrendSummaryResponse {
  metadata: {
    from: string
    to: string
    generatedAt?: string
    degraded?: boolean
    degradedReason?: string
    degradedMessage?: string
    timeout?: boolean
    timedOutSubquery?: string
    timedOutSubqueries?: string[]
    tokenTrendSummaryStatementTimeoutMs?: number
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  tokenTrendHours: UsageReportTokenTrendHourRow[]
  tokenTrendHealth?: UsageReportProviderLatencyHealthRow[]
  tokenTrendScores?: UsageReportTokenTrendScoreRow[]
  tokenTrendVersions: UsageReportTokenTrendVersionIntervalRow[]
  tokenTrendModelFirstSeen?: UsageReportTokenTrendModelFirstSeenRow[]
}

export interface UsageReportTokenTrendDayResponse {
  metadata: {
    date: string
    from: string
    to: string
    generatedAt?: string
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }
  date: string
  rows: UsageReportTokenTrendDayDetailRow[]
}

const zUsageJsonObject = z.record(z.string(), z.unknown())

function assertUsageReportSpotCheck(
  json: unknown,
  options: { requireSummary?: boolean; firstRowKey?: string }
): void {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid usage report response')
  }
  const record = json as Record<string, unknown>
  if (!zUsageJsonObject.safeParse(record.metadata).success) {
    throw new Error('Invalid usage report metadata')
  }
  if (options.requireSummary !== false) {
    if (!zUsageJsonObject.safeParse(record.summary).success) {
      throw new Error('Invalid usage report summary')
    }
    const rows = record.rows
    if (Array.isArray(rows) && rows.length > 0) {
      if (!zUsageJsonObject.safeParse(rows[0]).success) {
        throw new Error('Invalid usage report row')
      }
    }
  }
  const rowKey = options.firstRowKey
  if (rowKey !== undefined) {
    const rows = record[rowKey]
    if (Array.isArray(rows) && rows.length > 0) {
      if (!zUsageJsonObject.safeParse(rows[0]).success) {
        throw new Error(`Invalid usage report ${rowKey} row`)
      }
    }
  }
}

function appendUsageReportFilters(
  searchParams: URLSearchParams,
  params: UsageReportFilterParams
): void {
  // 15-D.1: Multi-value filters — encode each element so commas in values are safe.
  const filterKeys = [
    'provider',
    'repository',
    'client',
    'environment',
    'model',
    'inbound_model_alias',
    'agent_name',
    'agent_id',
  ] as const
  for (const key of filterKeys) {
    const values = params[key]
    if (values !== undefined && values.length > 0) {
      searchParams.set(
        key,
        values.map((value) => encodeURIComponent(value)).join(',')
      )
    }
  }

  const configChangeFilterKeys = [
    'changed_pre_commit_config',
    'changed_env_file',
    'changed_pyproject_toml',
    'changed_gitignore',
  ] as const
  for (const key of configChangeFilterKeys) {
    const values = params[key]
    if (values !== undefined && values.length > 0) {
      searchParams.set(
        key,
        values.map((value) => encodeURIComponent(value)).join(',')
      )
    }
  }
}

function appendStringArrayParam(
  searchParams: URLSearchParams,
  key: string,
  values: readonly string[] | undefined
): void {
  if (values !== undefined && values.length > 0) {
    searchParams.set(
      key,
      values.map((value) => encodeURIComponent(value)).join(',')
    )
  }
}

export async function fetchUsageReport(
  params: UsageReportParams,
  signal?: AbortSignal
): Promise<UsageReportResponse> {
  // Wave 24-D30: raised limit from 500 to 50000 to fix 30-day undercounting.
  // At 30-day daily grain with provider+model+repository groupBy, row count
  // exceeds 500 causing ~70% undercount in per-row surfaces (Master Ledger,
  // Repo Breakdown, Slicer Repo Options). The server MAX_LIMIT is now 50000.
  // Aggregate/KPI surfaces use report.summary and were always correct.
  // Future work: server-side pagination would be more scalable.
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
    grain: params.grain,
    group_by:
      params.groupBy?.join(',') ??
      'environment,client,repository,provider_model',
    limit: '50000',
    sort: 'period_end',
  })

  appendUsageReportFilters(searchParams, params)
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(`/api/shell/reports/usage?${searchParams}`, {
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Usage report request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, { requireSummary: true })
  return json as UsageReportResponse
}

export async function fetchShellHealth(
  signal?: AbortSignal
): Promise<ShellHealthResponse> {
  const response = await fetch('/api/shell/health', { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Shell health request failed with ${response.status}`
    throw new Error(message)
  }

  return response.json()
}

export async function fetchUsageReportQuotaRangeHistory(
  params: UsageReportQuotaRangeHistoryParams,
  signal?: AbortSignal
): Promise<UsageReportQuotaRangeHistoryResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  })
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/quota-range-history?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Quota range history request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'quotaRangeHistory',
  })
  return json as UsageReportQuotaRangeHistoryResponse
}

export async function fetchUsageReportQuotaHistory(
  params: UsageReportQuotaHistoryParams = {},
  signal?: AbortSignal
): Promise<UsageReportQuotaHistoryResponse> {
  const searchParams = new URLSearchParams()
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const queryString = searchParams.toString()
  const response = await fetch(
    `/api/shell/reports/usage/quota-history${
      queryString === '' ? '' : `?${queryString}`
    }`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Quota history request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'quotaHistory',
  })
  return json as UsageReportQuotaHistoryResponse
}

export async function fetchUsageReportQuotaEstimator(
  params: UsageReportQuotaEstimatorParams,
  signal?: AbortSignal
): Promise<UsageReportQuotaEstimatorResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  })
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/quota-estimator?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Quota estimator request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'estimates',
  })
  return json as UsageReportQuotaEstimatorResponse
}

export async function fetchUsageReportToolActivity(
  params: UsageReportToolActivityParams,
  signal?: AbortSignal
): Promise<UsageReportToolActivityResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  })
  appendUsageReportFilters(searchParams, params)
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/tool-activity?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Tool activity request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'toolActivity',
  })
  return json as UsageReportToolActivityResponse
}

export async function fetchUsageReportSessionDiagnostics(
  params: UsageReportSessionDiagnosticsParams,
  signal?: AbortSignal
): Promise<UsageReportSessionDiagnosticsResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  })
  appendUsageReportFilters(searchParams, params)
  appendStringArrayParam(searchParams, 'session_id', params.session_id)
  appendStringArrayParam(searchParams, 'trace_id', params.trace_id)
  appendStringArrayParam(
    searchParams,
    'litellm_call_id',
    params.litellm_call_id
  )
  if (
    params.grok_side_channel === true ||
    params.grok_side_channel === 'true' ||
    params.grok_side_channel === '1'
  ) {
    searchParams.set('grok_side_channel', 'true')
  }
  appendStringArrayParam(
    searchParams,
    'grok_side_channel_endpoint_type',
    params.grok_side_channel_endpoint_type
  )
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit))
  }
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/session-diagnostics?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Session diagnostics request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'sessionDiagnostics',
  })
  return json as UsageReportSessionDiagnosticsResponse
}

export async function fetchUsageReportTokenTrendSummary(
  params: UsageReportTokenTrendSummaryParams,
  signal?: AbortSignal
): Promise<UsageReportTokenTrendSummaryResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
  })
  appendUsageReportFilters(searchParams, params)
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/token-trend-summary?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Token trend summary request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'tokenTrendHours',
  })
  return json as UsageReportTokenTrendSummaryResponse
}

export async function fetchUsageReportTokenTrendDay(
  params: UsageReportTokenTrendDayParams,
  signal?: AbortSignal
): Promise<UsageReportTokenTrendDayResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
    date: params.date,
  })
  appendUsageReportFilters(searchParams, params)
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const response = await fetch(
    `/api/shell/reports/usage/token-trend-day?${searchParams}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Token trend day request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'rows',
  })
  return json as UsageReportTokenTrendDayResponse
}

export async function fetchUsageReportQuotas(
  params: UsageReportQuotasParams = {},
  signal?: AbortSignal
): Promise<UsageReportQuotasResponse> {
  const searchParams = new URLSearchParams()
  if (params.cacheBust !== undefined && params.cacheBust !== '') {
    searchParams.set('cache_bust', params.cacheBust)
  }

  const queryString = searchParams.toString()
  const response = await fetch(
    `/api/shell/reports/quotas${queryString === '' ? '' : `?${queryString}`}`,
    { signal }
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `Usage quota request failed with ${response.status}`
    throw new Error(message)
  }

  const json: unknown = await response.json()
  assertUsageReportSpotCheck(json, {
    requireSummary: false,
    firstRowKey: 'quotas',
  })
  return json as UsageReportQuotasResponse
}
