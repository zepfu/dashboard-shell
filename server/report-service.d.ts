export {}

declare module './report-service' {
  type SearchParamsLike = {
    get(name: string): string | null
  }

  type QueryResult = {
    sql: string
    values?: unknown[]
    metadata?: Record<string, unknown>
  }

  type QueryResultWithMetadata = QueryResult & {
    metadata: Record<string, unknown>
  }

  type RecordRow = Record<string, unknown>

  interface UpstreamApiProxyConfig {
    prefix: string
    displayName: string
    target: string
    [key: string]: unknown
  }

  interface TokenTrendErrorReportOptions {
    timedOutSubqueries?: readonly string[]
    skippedSubqueries?: readonly string[]
    tokenTrendSummaryRangeDays?: number
    tokenTrendSummaryRawLaneMaxDays?: number
    tokenTrendHours?: RecordRow[]
    tokenTrendHealth?: RecordRow[]
    tokenTrendScores?: RecordRow[]
    tokenTrendVersions?: RecordRow[]
    tokenTrendModelFirstSeen?: RecordRow[]
    degradedMessage?: string
  }

  interface UsageTrendReportPayload {
    metadata?: Record<string, unknown>
    tokenTrendHours: RecordRow[]
    tokenTrendHealth: RecordRow[]
    tokenTrendScores: RecordRow[]
    tokenTrendVersions: RecordRow[]
    tokenTrendModelFirstSeen: RecordRow[]
  }

  interface ProxyRequest {
    url: string
    headers: {
      host: string
    }
  }

  type ProviderAuthHealthState =
    | 'failed'
    | 'refreshed'
    | 'expired'
    | 'attempted'
    | 'skipped_expired'
    | 'skipped_valid'
    | 'unknown'

  interface ProviderAliasEntry {
    state_kind?: string
    state_source?: string
  }

  interface ProviderAuthReportRow {
    auth_health_state: string
    auth_file_hash_short: string | null
    status: string
    auth_file_source: string | null
    [key: string]: unknown
  }

  interface ProviderCreditSummaryRow {
    provider: string
    credit_family: string
    available_count: number
    used_count: number
    expired_count: number
    total_count: number
    [key: string]: unknown
  }

  interface ProviderCreditRow {
    status?: string
    environment?: string
    provider?: string
    credit_family?: string
    credit_identity?: string
    source?: string
    [key: string]: unknown
  }

  interface ProviderCreditLifecycleReport {
    data_source: string
    freshness_label: string
    generated_at: string
    entries: Array<ProviderCreditRow>
    summaries: Array<ProviderCreditSummaryRow>
    [key: string]: unknown
  }

  interface ProviderAuthHealthReport {
    data_source: string
    freshness_label: string
    generated_at: string
    entries: Array<ProviderAuthReportRow>
    [key: string]: unknown
  }

  type QuotaEstimatorEstimate = {
    estimate_kind: string
    feature: string
    coefficient_pct_per_mtok: number
  }

  interface QuotaEstimatorOperational {
    derivation: string
    lane_label: string
    lane_family: string
    warning_scope: string
    weight_source: string
    interval_censored: boolean
    state_space: boolean
    observation: {
      observed_at: string | null
      lag_assumption_minutes: number | null
      freshness: {
        stale: boolean
        observation_age_minutes: number | null
        trainable_interval_count: number
        sample_cap: number
        bounded_window?: boolean
      }
    }
    forecast: {
      status: string
      promoted: boolean
      promotion_blocked: boolean
      forecast_next_interval_burn_pct: number | null
      residual_pct: number | null
      predicted_interval_delta_pct: number | null
    }
    weights: Array<{
      model_family: string
      token_category: string
      coefficient_pct_per_mtok: number | null
      estimate_status: string
    }>
    cache_read_vs_uncached_input_ratios: Array<{
      model_family: string
      cache_read_vs_uncached_input_ratio: number | null
      status: string
    }>
    alerts: Array<{
      code: string
      severity: string
      suppressed: boolean
      detail: string
      warning_scope: string
    }>
    data_quality: {
      large_residual: boolean
      checks_ran: boolean
      promotion_blocked: boolean
      gate_residual_pct: number | null
    }
  }

  interface QuotaEstimatorReport {
    metadata: {
      phase: string
      derivation?: string
      intervalCensored?: boolean
      stateSpace?: boolean
      operationalPhase?: string
      confidenceModel?: string
    }
    estimates: Array<{
      provider: string
      quota_type: string
      quota_lane: string
      coefficients: QuotaEstimatorEstimate[]
      cache_read_vs_uncached_workload_ratio: number
      selected_lag_minutes: number
      backtest: { status: string }
      cache_read_ratios: Array<{
        model_family: string
        cache_read_vs_uncached_workload_ratio: number
      }>
      operational: QuotaEstimatorOperational
    }>
    phase0Audit: { known_missing_fields: string[] }
  }

  export const USAGE_TOKEN_TREND_SUMMARY_SUBQUERY_KEYS: readonly string[]
  export const USAGE_REPORT_CACHE_SCOPE: string
  export const buildAegisPgBouncerAdminDatabaseUrl: (
    env?: NodeJS.ProcessEnv
  ) => string | undefined
  export const buildPgBouncerAdminDatabaseUrl: (
    databaseUrl?: string
  ) => string | undefined
  export const buildQuotaEstimatorObservationQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildQuotaEstimatorReport: (
    rows: Array<RecordRow>,
    metadata?: Record<string, unknown>
  ) => QuotaEstimatorReport
  export const buildQuotaEstimatorUsageBucketQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildQuotaHistoryQuery: (
    searchParams?: SearchParamsLike
  ) => QueryResult
  export const buildQuotaHistoryFallbackQuery: (
    searchParams?: SearchParamsLike
  ) => QueryResult
  export const buildQuotaRangeHistoryFallbackQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildQuotaQuery: () => QueryResult
  export const buildCohereLocalUsagePresenceQuery: () => QueryResult
  export const buildCohereLocalUsageQuery: () => QueryResult
  export const normalizeCohereLocalUsageReport: (
    row: RecordRow | null,
    options?: { staleAfterMinutes?: number }
  ) => RecordRow
  export const unavailableCohereLocalUsageReport: (reason?: string) => RecordRow
  export const normalizeQuotaRow: (row: RecordRow) => RecordRow & {
    provider: string
    model: string | null
    billing_details: RecordRow
  }
  export const buildQuotaVelocityQuery: () => QueryResult
  export const buildQuotaRangeHistoryQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildDegradedUsageQuotaHistoryReport: (opts?: {
    searchParams?: SearchParamsLike
    timedOutSubqueries?: readonly string[]
    quotaHistory?: RecordRow[]
    degradedMessage?: string
  }) => {
    metadata: RecordRow
    quotaHistory: RecordRow[]
  } & QueryResult
  export const buildDegradedUsageQuotaRangeHistoryReport: (opts?: {
    searchParams?: SearchParamsLike
    timedOutSubqueries?: readonly string[]
    quotaRangeHistory?: RecordRow[]
    degradedMessage?: string
  }) => {
    metadata: RecordRow
    quotaRangeHistory: RecordRow[]
  } & QueryResult
  export const buildDegradedQuotaReport: () => {
    metadata: RecordRow
    quotas: RecordRow[]
    cohereLocalUsage: RecordRow
  } & QueryResult
  export const buildDegradedUsageTokenTrendSummaryReport: (
    searchParams: SearchParamsLike,
    options?: TokenTrendErrorReportOptions
  ) => UsageTrendReportPayload & { metadata: RecordRow } & QueryResult
  export const buildDegradedUsageToolActivityReport: (
    searchParams: SearchParamsLike
  ) => {
    metadata: RecordRow
    toolActivity: RecordRow[]
  } & QueryResult
  export const buildReportQueryPressureQuery: () => QueryResult
  export const buildSessionDiagnosticsQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildSessionDiagnosticsAuditTerminalQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildProviderAliasRoutingQuery: (
    searchParams?: SearchParamsLike
  ) => QueryResult
  export const normalizeProviderAliasRoutingReport: (
    rows: readonly RecordRow[],
    options?: { generatedAt?: string }
  ) => {
    data_source: string
    freshness_label: string
    generated_at: string
    entries: ProviderAliasEntry[]
    [key: string]: unknown
  }
  export const buildProviderAuthHealthQuery: (
    searchParams?: SearchParamsLike
  ) => QueryResult
  export const classifyProviderAuthHealthState: (
    row: RecordRow,
    options?: { nowMs?: number; generatedAt?: string }
  ) => ProviderAuthHealthState
  export const normalizeProviderAuthHealthRow: (
    row: RecordRow,
    options?: { nowMs?: number; generatedAt?: string }
  ) => ProviderAuthReportRow
  export const normalizeProviderAuthHealthReport: (
    rows: readonly RecordRow[],
    options?: { nowMs?: number; generatedAt?: string }
  ) => ProviderAuthHealthReport
  export const buildProviderCreditLifecycleQuery: (
    searchParams?: SearchParamsLike
  ) => QueryResult
  export const filterLegacyProviderCreditAggregateRows: (
    rows: readonly ProviderCreditRow[]
  ) => ProviderCreditRow[]
  export const buildProviderCreditLifecycleSummaries: (
    entries: readonly ProviderCreditRow[]
  ) => ProviderCreditSummaryRow[]
  export const normalizeProviderCreditLifecycleRow: (
    row: RecordRow,
    options?: { generatedAt?: string }
  ) => ProviderCreditRow
  export const normalizeProviderCreditLifecycleReport: (
    rows: readonly ProviderCreditRow[],
    options?: { generatedAt?: string }
  ) => ProviderCreditLifecycleReport
  export const buildSourceTableHealthQuery: () => QueryResult
  export const buildTokenTrendHealthQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildTokenTrendHoursQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildTokenTrendModelFirstSeenQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildTokenTrendScoreQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildTokenTrendDayDetailQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildToolActivityQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildUsageQuery: (
    searchParams: SearchParamsLike
  ) => QueryResultWithMetadata
  export const buildProviderErrorObservationQuery: (
    searchParams: SearchParamsLike
  ) => QueryResultWithMetadata
  export const buildUsageScoreReasonsQuery: (
    searchParams: SearchParamsLike
  ) => QueryResultWithMetadata
  export const buildUsageDiagnosticStringsQuery: (
    searchParams: SearchParamsLike
  ) => QueryResultWithMetadata
  export const buildUsageScoreReasonsMergeKey: (
    row: Record<string, unknown>,
    groupBy: string[]
  ) => string
  export const parseUsageReportSort: (searchParams: SearchParamsLike) => {
    sort: string
    sortDirection: 'ASC' | 'DESC'
  }
  export const shouldIncludeTokenTrendHealth: (
    searchParams: SearchParamsLike
  ) => boolean
  export const applyTokenTrendSummaryHealthInclusion: (
    searchParams: SearchParamsLike,
    report: UsageTrendReportPayload
  ) => UsageTrendReportPayload
  export const findUpstreamApiProxy: (
    pathname: string
  ) => UpstreamApiProxyConfig | undefined
  export const shouldSuppressCacheRefreshFailureDuringShutdown: (
    error: unknown,
    shuttingDown?: boolean
  ) => boolean
  export const normalizePgBouncerPoolRow: (row: RecordRow) => RecordRow
  export const normalizePgBouncerStatsRow: (row: RecordRow) => RecordRow
  export const compactUsageRow: (row: unknown) => unknown
  export const shouldIncludeEmptyUsageRowFields: (
    searchParams: SearchParamsLike
  ) => boolean
  export const buildUsageReportRowSerializationMetadata: (
    searchParams: SearchParamsLike
  ) => {
    compactRows: boolean
    rowNullFieldsOmitted: boolean
    includeEmptyRowFields: boolean
  }
  export const proxyTargetUrl: (
    req: ProxyRequest,
    proxyConfig: UpstreamApiProxyConfig
  ) => URL

  export const __usageReportTestHelpers: {
    setQueryReportDatabaseTestImpl(
      impl: (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: Record<string, unknown>[] }>
    ): void
    resetQueryReportDatabaseTestImpl(): void
    loadUsageSessionDiagnostics(searchParams: SearchParamsLike): Promise<{
      metadata: {
        requestWaitCheckpointFreshnessSeconds?: number
        [key: string]: unknown
      }
      sessionDiagnostics: Record<string, unknown>[]
      requestWaitCheckpoints: Array<{
        record_attribution?: string
        qualifying_session_history?: boolean
        activity?: string
        durations_ms?: Record<string, number>
        summed_duration_ms?: number | null
        provider_content_outcome?: string
        final_delivery_outcome?: string
      }>
    }>
  }

  export const buildSummaryQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildTrendQuery: (searchParams: SearchParamsLike) => QueryResult
  export const buildClientUsageQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
  export const buildProviderStatusUsageQuery: (
    searchParams: SearchParamsLike
  ) => QueryResult
}
