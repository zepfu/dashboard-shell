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

/**
 * Multi-value dimension filters supported by the usage report API.
 *
 * 15-D.1: The server uses parseCsv() on each param, so values are joined as
 * comma-separated strings in the query string (e.g. `provider=openai,anthropic`).
 * The server's filterColumns map accepts: provider, repository, client,
 * environment, model, provider_model. Empty arrays → no filter applied (all
 * values returned).
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

export interface UsageReportRow extends UsageReportLatencyFields {
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

export interface UsageReportProviderStatusUsageRow extends UsageReportLatencyFields {
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
   * 'short_special' | 'monthly'
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
  calls: number
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

export interface UsageReportTokenTrendDayParams extends UsageReportFilterParams {
  from: string
  to: string
  date: string
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

function appendUsageReportFilters(
  searchParams: URLSearchParams,
  params: UsageReportFilterParams
): void {
  // 15-D.1: Append multi-value dimension filters as comma-separated params.
  // The server's appendMultiValueFilter() calls parseCsv(searchParams.get(key))
  // which splits on commas. Empty arrays → param omitted → no server-side filter.
  const filterKeys = [
    'provider',
    'repository',
    'client',
    'environment',
    'model',
  ] as const
  for (const key of filterKeys) {
    const values = params[key]
    if (values !== undefined && values.length > 0) {
      searchParams.set(key, values.join(','))
    }
  }
}

export async function fetchUsageReport(
  params: UsageReportParams
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

  return response.json()
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

  return response.json()
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

  return response.json()
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

  return response.json()
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

  return response.json()
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

  return response.json()
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

  return response.json()
}
