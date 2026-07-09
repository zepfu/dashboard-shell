export {}

declare module './report-service.mjs' {
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

  interface QuotaEstimatorReport {
    estimates: Array<{
      coefficients: QuotaEstimatorEstimate[]
      cache_read_vs_uncached_workload_ratio: number
      selected_lag_minutes: number
      backtest: { status: string }
      cache_read_ratios: Array<{
        model_family: string
        cache_read_vs_uncached_workload_ratio: number
      }>
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

  export function classifyRedisPingProbeResponse(
    accumulated: string
  ): { status: string; detail?: string } | null

  export function buildUsageReportAuxiliaryDegradedMetadata(
    unavailable?: readonly string[]
  ): Record<string, unknown>

  type ProxySecretCheckResult =
    | { ok: true }
    | { ok: false; status: number; error: string }

  type TtlMemoizer = {
    load: <T>(loader: () => Promise<T>) => Promise<T>
    resetForTests: () => void
  }

  type ReportCacheIdentityLike = {
    scope: string
    canonicalParams: string
    hash: string
    cacheKey: string
    lockKey: string
  }

  export const __ttlMemoizerTestHelpers: {
    createTtlMemoizer: (
      ttlMs: number,
      onError?: (error: unknown) => unknown
    ) => TtlMemoizer
    resetHealthLoaderCachesForTests: () => void
  }

  export const __reportCacheInternals: {
    resetReportCache: () => void
    getReportCacheEntry: (cacheKey: string) =>
      | {
          entry?: { payload?: unknown; [key: string]: unknown }
          promise?: Promise<unknown>
        }
      | undefined
    setMaxReportCacheEntriesForTests: (maxEntries: number) => void
    resetMaxReportCacheEntriesForTests: () => void
    setReadRedisCacheEntryImpl: (
      impl:
        | ((
            identity: ReportCacheIdentityLike,
            client: unknown
          ) => Promise<unknown>)
        | null
    ) => void
    setWriteRedisCacheEntryImpl: (
      impl:
        | ((
            identity: ReportCacheIdentityLike,
            cacheEntry: unknown
          ) => Promise<boolean>)
        | null
    ) => void
    encodeRedisReportCachePayload: (cacheEntry: unknown) => Promise<Buffer>
    decodeRedisReportCachePayload: (value: unknown) => Promise<unknown>
    readRedisCacheEntryFromClient: (
      identity: ReportCacheIdentityLike,
      client: unknown
    ) => Promise<unknown>
    writeRedisCacheEntry: (
      identity: ReportCacheIdentityLike,
      entry: unknown
    ) => Promise<boolean>
    createRedisCacheClient: (
      url?: string,
      createClient?: (options: unknown) => unknown,
      typeMapping?: Record<string | number, unknown>
    ) => unknown
    cachedReport: (...args: unknown[]) => Promise<{
      entry?: { payload?: unknown }
      [key: string]: unknown
    }>
    refreshReportCache: (
      identity: ReportCacheIdentityLike,
      load: () => Promise<unknown>,
      options?: Record<string, unknown>
    ) => Promise<{ entry?: { payload?: unknown }; [key: string]: unknown }>
    setLocalReportCache: (cacheKey: string, entry: unknown) => void
    pruneReportCache: () => void
  }

  export const __localHealthTestHelpers: {
    classifyRedisPingProbeResponse: (
      accumulated: string
    ) => Record<string, unknown>
    probeRedisHealth: (
      ...args: unknown[]
    ) => Promise<{ status: string; detail?: string; [key: string]: unknown }>
  }

  export const __responseTestHelpers: {
    acceptsGzipEncoding: (req: { headers: Record<string, unknown> }) => boolean
    sendJson: (
      req: { headers: Record<string, unknown> },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => void
        end: (chunk?: Buffer | string) => void
      },
      status: number,
      body: unknown
    ) => Promise<void>
  }

  export const __proxySecurityTestHelpers: {
    evaluateUpstreamProxySecret: (
      headers: Record<string, string | string[] | undefined>
    ) => ProxySecretCheckResult
    resolveReportProxySharedSecret: () => string | null
    REPORT_PROXY_SECRET_HEADER: string
    DEFAULT_REPORT_PROXY_SHARED_SECRET: string
    proxyHeaders: (
      req: { headers: Record<string, unknown> },
      proxyConfig: Record<string, unknown>
    ) => Record<string, string | undefined>
  }

  export const __envTestHelpers: {
    boundedIntegerEnv: (
      name: string,
      fallback: number | string,
      bounds?: { minimum?: number; maximum?: number }
    ) => number
    positiveIntegerEnv: (
      name: string,
      fallback: number,
      minimum?: number
    ) => number
    parseBooleanEnv: (name: string, fallback: boolean) => boolean
    parseFiniteNumberEnv: (name: string, fallback: number) => number
    normalizeDatabaseUrl: (value: string) => string
    parseDateParam: (value: string | null, fallback: () => string) => string
    resolveDefaultToDateString: (referenceDate?: Date) => string
    addDaysToDateString: (date: string, days: number) => string
    formatDashboardDate: (date: Date) => string
    providerDimensionExpression: (...args: unknown[]) => string
    providerDimensionForAlias: (alias: string) => string
    sessionHistoryMetadataText: (
      alias: string,
      key: string,
      fallback: string
    ) => string
  }

  export const __dockerLogScanTestHelpers: {
    capDockerJsonLogSourcesForScan: (
      sources: readonly unknown[],
      options?: Record<string, unknown>
    ) => Array<{ tailBytes?: number; [key: string]: unknown }>
    isDockerLogScanCacheFresh: (...args: unknown[]) => boolean
    scanDockerLogErrorsFromSources: (...args: unknown[]) => Promise<unknown>
    loadDockerLogErrors: (...args: unknown[]) => Promise<unknown[]>
    resetDockerLogScanCachesForTests: () => void
    resetDockerLogErrorIntakeSeenFingerprintsForTests: () => void
    dockerLogErrorIntakeSeenFingerprintsSizeForTests: () => number
    seedDockerLogErrorIntakeFingerprintsForTests: (
      keys?: readonly string[]
    ) => void
    DOCKER_LOG_SCAN_MAX_SOURCES: number
    DOCKER_LOG_SCAN_MAX_TOTAL_BYTES: number
    DOCKER_LOG_INTAKE_FINGERPRINT_MAX: number
    getDockerLogTailReadCountForTests: () => number
  }
  export const __cachedUsageSubreportTestHelpers: {
    handleCachedUsageSubreport: (...args: unknown[]) => Promise<unknown>
  }

  export const __usageReportTestHelpers: {
    loadUsageReport: (
      searchParams: URLSearchParams
    ) => Promise<Record<string, unknown>>
    runUsageReportFanoutTasks: (...args: unknown[]) => Promise<unknown>
    buildUsageReportAuxiliaryDegradedMetadata: (
      unavailable?: readonly string[]
    ) => Record<string, unknown>
    USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEYS: readonly string[]
    normalizeRow: (row: unknown) => RecordRow
    AGENT_SCORE_REASON_RECENT_ROW_LIMIT: number
    setQueryReportDatabaseTestImpl: (
      impl:
        | ((
            sql: string,
            values: unknown,
            options?: { usageReportTaskKey?: string }
          ) => Promise<{ rows: unknown[] }>)
        | null
    ) => void
    resetQueryReportDatabaseTestImpl: () => void
    setLoadDockerLogErrorsTestImpl: (
      impl: (() => Promise<unknown[]>) | null
    ) => void
    resetLoadDockerLogErrorsTestImpl: () => void
    setLoadLocalHealthTestImpl: (
      impl: (() => Promise<unknown[]>) | null
    ) => void
    resetLoadLocalHealthTestImpl: () => void
  }

  export function buildShellHealthPayload(
    options?: Record<string, unknown>
  ): Promise<Record<string, unknown>>

  export const __shellHealthTestHelpers: {
    buildShellHealthPayload: typeof buildShellHealthPayload
  }

  export const __pgBouncerAdminTestHelpers: {
    cleanupPgBouncerAdminPools: () => void
    getOrCreatePgBouncerAdminPool: (...args: unknown[]) => Promise<unknown>
    getPgBouncerAdminPoolCacheSize: () => number
    loadPgBouncerAdminSummaryForTests: (...args: unknown[]) => Promise<unknown>
  }

  export const __serverRuntimeTestHelpers: {
    GENERIC_INTERNAL_SERVER_ERROR_BODY: Record<string, unknown>
    isHttpResponseCommitted: (res: Record<string, unknown>) => boolean
    logUnhandledRequestError: (...args: unknown[]) => void
    respondWithGenericServerError: (
      req: Record<string, unknown>,
      res: Record<string, unknown>,
      error: unknown
    ) => Promise<void>
    resolveBoundedShutdownGraceMs: (value: number) => number
    scheduleShutdownForceExit: (
      server: Record<string, unknown>,
      graceMs: number,
      options?: {
        setTimeoutFn?: (
          handler: () => void,
          ms: number
        ) => { unref: () => void }
        exitFn?: (code: number) => void
      }
    ) => void
    beginHttpServerShutdown: (
      server: Record<string, unknown>,
      onClosed: () => void
    ) => void
    closeHttpServer: (server: {
      close: (cb?: () => void) => void
      closeIdleConnections?: () => void
    }) => Promise<void>
    runBoundedShutdownSequence: (
      server: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<void>
  }

  export function classifyCacheEntry(entry: {
    freshUntil?: number
    staleUntil?: number
  }): 'fresh' | 'stale' | 'expired' | string

  export {
    buildReportCacheEntry,
    buildReportCacheIdentity,
    buildReportCachePrewarmLockKey,
    canonicalizeSearchParams,
    REPORT_CACHE_PREFIX,
    REPORT_CACHE_VERSION,
    resolveReportCacheConfig,
    resolveReportCacheTtlMs,
  } from './report-cache-identity.mjs'
  export {
    resolveDockerLogContainerNames,
    extractDockerLogErrorsFromTail,
    selectNewDockerLogErrors,
    capDockerLogErrorsForDashboard,
    inferLogLevel,
    isActionableErrorLog,
  } from './docker-log-error-intake.mjs'
}
