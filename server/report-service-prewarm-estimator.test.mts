import { afterEach, describe, expect, test, vi } from 'vitest'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function requireHelper<T>(value: unknown, validate: (v: unknown) => v is T): T {
  if (!validate(value)) {
    throw new TypeError('required report-service test helper is unavailable')
  }
  return value
}

type PrewarmWindow = {
  name: string
  from: string
  to: string
}

type PrewarmHelper = {
  buildPrewarmUsageWindows: () => PrewarmWindow[]
  prewarmReportCaches: (options?: {
    acquireLock?: (
      key: string,
      ttlMs: number,
      owner: string
    ) => Promise<string | null>
    redisReady?: boolean
  }) => Promise<void>
  setPrewarmCachedReportTestImpl: (impl: unknown) => void
  resetPrewarmCachedReportTestImpl: () => void
}

function isPrewarmHelper(value: unknown): value is PrewarmHelper {
  return (
    isRecord(value) &&
    typeof value.buildPrewarmUsageWindows === 'function' &&
    typeof value.prewarmReportCaches === 'function' &&
    typeof value.setPrewarmCachedReportTestImpl === 'function' &&
    typeof value.resetPrewarmCachedReportTestImpl === 'function'
  )
}

type EstimatorHelper = {
  buildQuotaEstimatorRowsFromReadModels: (
    observations: Array<Record<string, unknown>>,
    usageBuckets: Array<Record<string, unknown>>
  ) => Array<Record<string, unknown>>
  buildQuotaEstimatorReport: (
    rows: Array<Record<string, unknown>>
  ) => Record<string, unknown>
  quotaEstimatorWeights: (
    samples: Array<Record<string, unknown>>,
    halfLifeHours: number
  ) => number[]
}

function isEstimatorHelper(value: unknown): value is EstimatorHelper {
  return (
    isRecord(value) &&
    typeof value.buildQuotaEstimatorRowsFromReadModels === 'function' &&
    typeof value.buildQuotaEstimatorReport === 'function' &&
    typeof value.quotaEstimatorWeights === 'function'
  )
}

type UsageReportHelper = {
  loadUsageReport: (searchParams: URLSearchParams) => Promise<{
    metadata: Record<string, unknown>
    providerErrorObservations: Array<Record<string, unknown>>
  }>
  setQueryReportDatabaseTestImpl: (
    impl: (
      sql: string,
      values: unknown[],
      options: unknown
    ) => Promise<{ rows: Array<Record<string, unknown>> }>
  ) => void
  resetQueryReportDatabaseTestImpl: () => void
  setLoadDockerLogErrorsTestImpl: (
    impl: () => Promise<Array<Record<string, unknown>>>
  ) => void
  resetLoadDockerLogErrorsTestImpl: () => void
  setLoadLocalHealthTestImpl: (
    impl: () => Promise<Array<Record<string, unknown>>>
  ) => void
  resetLoadLocalHealthTestImpl: () => void
}

function isUsageReportHelper(value: unknown): value is UsageReportHelper {
  return (
    isRecord(value) &&
    typeof value.loadUsageReport === 'function' &&
    typeof value.setQueryReportDatabaseTestImpl === 'function' &&
    typeof value.resetQueryReportDatabaseTestImpl === 'function' &&
    typeof value.setLoadDockerLogErrorsTestImpl === 'function' &&
    typeof value.resetLoadDockerLogErrorsTestImpl === 'function' &&
    typeof value.setLoadLocalHealthTestImpl === 'function' &&
    typeof value.resetLoadLocalHealthTestImpl === 'function'
  )
}

const reportServiceRuntime = (await import('./report-service.mjs')) as Record<
  string,
  unknown
>
const prewarmHelpersValue = reportServiceRuntime.__prewarmReportTestHelpers
const quotaHelpersValue = reportServiceRuntime.__quotaReportTestHelpers
const usageHelpersValue = reportServiceRuntime.__usageReportTestHelpers
const usageReportHelper = requireHelper<UsageReportHelper>(
  usageHelpersValue,
  isUsageReportHelper
)

function usageBucket(provider: 'anthropic' | 'openai', bucketStart: string) {
  const scale = provider === 'openai' ? 1 : 100
  return {
    provider,
    model_family: provider === 'openai' ? 'codex' : 'sonnet',
    bucket_start_at: bucketStart,
    traces: scale,
    uncached_input_tokens: 2 * scale,
    output_tokens: 3 * scale,
    cache_read_tokens: 4 * scale,
    cache_create_tokens: 5 * scale,
    reasoning_tokens: 6 * scale,
    usd_cost: 0.7 * scale,
    tool_calls: 8 * scale,
  }
}

function makeBuckets(minutes = 300) {
  const buckets = []
  for (let minute = 0; minute < minutes; minute += 5) {
    const bucketStart = new Date(Date.UTC(2025, 3, 10, 0, minute)).toISOString()
    buckets.push(usageBucket('openai', bucketStart))
    buckets.push(usageBucket('anthropic', bucketStart))
  }
  return buckets
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  const prewarmHelper = requireHelper<PrewarmHelper>(
    prewarmHelpersValue,
    isPrewarmHelper
  )
  prewarmHelper.resetPrewarmCachedReportTestImpl()
  usageReportHelper.resetQueryReportDatabaseTestImpl()
  usageReportHelper.resetLoadDockerLogErrorsTestImpl()
  usageReportHelper.resetLoadLocalHealthTestImpl()
})

const testLock = async () => 'test-prewarm-lock'

describe('D1-489 R4a prewarm and estimator boundaries', () => {
  test('trailing two-year start is safe when dashboard today is Feb 29', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-02-29T12:00:00.000-05:00'))

    const prewarmHelper = requireHelper<PrewarmHelper>(
      prewarmHelpersValue,
      isPrewarmHelper
    )
    const windows = prewarmHelper.buildPrewarmUsageWindows()
    const trailing = windows.find(
      (window) => window.name === 'trailing-2-years'
    )

    expect(trailing).toEqual({
      name: 'trailing-2-years',
      from: '2022-03-01',
      to: '2024-03-01',
    })
  })

  test('prewarm continues independent windows after one failure and reports a bounded summary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000-04:00'))
    const prewarmHelper = requireHelper<PrewarmHelper>(
      prewarmHelpersValue,
      isPrewarmHelper
    )
    const calls: string[] = []
    const stderrMessages: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrMessages.push(String(chunk))
      return true
    }) as typeof process.stderr.write)

    prewarmHelper.setPrewarmCachedReportTestImpl(
      async (_scope: string, searchParams?: URLSearchParams) => {
        calls.push(searchParams?.get('from') ?? 'quotas')
        if (searchParams?.get('from') === '2026-07-31') {
          throw new Error('window database unavailable')
        }
        return 'refreshed'
      }
    )
    try {
      await prewarmHelper.prewarmReportCaches({
        acquireLock: testLock,
        redisReady: true,
      })
    } finally {
      prewarmHelper.resetPrewarmCachedReportTestImpl()
    }

    expect(calls).toEqual([
      '2026-08-24',
      '2026-07-31',
      '2026-01-01',
      '2024-08-30',
      'quotas',
    ])
    expect(stderrMessages).toHaveLength(2)
    expect(stderrMessages[0]).toContain('failed window=last-30-days')
    expect(stderrMessages[1]).toContain(
      'completed with 1/4 failed windows: last-30-days: window database unavailable'
    )
  })

  test('provider-error cap exposes truncation and preserves the configured row limit', async () => {
    const providerErrorRows = Array.from({ length: 2_001 }, (_, index) => ({
      observed_at: '2026-05-08T00:00:00.000Z',
      environment: 'test',
      provider: 'openai',
      model: 'gpt-5',
      model_group: 'codex',
      route_family: 'primary',
      status_code: 429,
      error_type: 'rate_limit',
      error_code: `error-${index}`,
      error_class: 'provider',
      error_message: `error-${index}`,
      retry_after_seconds: null,
      expected_reset_at: null,
      provider_error_observation_row_limit: 2_000,
      provider_error_observation_cap_active: true,
      provider_error_observation_cap_truncates_requested_window: true,
    }))

    usageReportHelper.setQueryReportDatabaseTestImpl(
      async (_sql, values, options) => {
        if (
          typeof options === 'object' &&
          options !== null &&
          (options as { usageReportTaskKey?: string }).usageReportTaskKey ===
            'provider_error_observations'
        ) {
          expect(values[0]).toBe(2_000)
          return { rows: providerErrorRows.slice(0, 2_000) }
        }
        return { rows: [] }
      }
    )
    usageReportHelper.setLoadDockerLogErrorsTestImpl(async () => [])
    usageReportHelper.setLoadLocalHealthTestImpl(async () => [])

    const report = await usageReportHelper.loadUsageReport(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
      })
    )

    expect(report.metadata.providerErrorObservationRowLimit).toBe(2_000)
    expect(
      report.metadata.providerErrorObservationCapTruncatesRequestedWindow
    ).toBe(true)
    expect(report.providerErrorObservations).toHaveLength(2_000)
    expect(report.providerErrorObservations[1_999]?.error_code).toBe(
      'error-1999'
    )
  })

  test('estimator read models are equivalent for sorted and shuffled buckets with bounded interval lookup', async () => {
    const helper = requireHelper<EstimatorHelper>(
      quotaHelpersValue,
      isEstimatorHelper
    )
    const observations = [
      {
        provider: 'openai',
        quota_key: 'codex-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T01:00:00.000Z',
        consumed_pct: 10,
      },
      {
        provider: 'openai',
        quota_key: 'codex-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T03:00:00.000Z',
        consumed_pct: 20,
      },
      {
        provider: 'anthropic',
        quota_key: 'claude-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T01:00:00.000Z',
        consumed_pct: 15,
      },
      {
        provider: 'anthropic',
        quota_key: 'claude-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T03:00:00.000Z',
        consumed_pct: 30,
      },
    ]
    const buckets = makeBuckets()
    const shuffledBuckets = [...buckets]
    for (let index = shuffledBuckets.length - 1; index > 0; index -= 1) {
      const swap = (index * 7) % (index + 1)
      ;[shuffledBuckets[index], shuffledBuckets[swap]] = [
        shuffledBuckets[swap],
        shuffledBuckets[index],
      ]
    }

    const rows = helper.buildQuotaEstimatorRowsFromReadModels(
      observations,
      buckets
    )
    const shuffledRows = helper.buildQuotaEstimatorRowsFromReadModels(
      observations,
      shuffledBuckets
    )

    expect(shuffledRows).toEqual(rows)
    const codexRows = rows.filter(
      (row) => row.provider === 'openai' && row.model_family === 'codex'
    )
    const anthropicRows = rows.filter(
      (row) => row.provider === 'anthropic' && row.model_family === 'sonnet'
    )
    expect(codexRows).toHaveLength(6)
    expect(anthropicRows).toHaveLength(6)
    expect(codexRows[0]).toMatchObject({
      interval_start_at: '2025-04-10T01:00:00.000Z',
      interval_end_at: '2025-04-10T03:00:00.000Z',
      lag_minutes: 0,
      traces: 24,
      uncached_input_tokens: 48,
      output_tokens: 72,
      cache_read_tokens: 96,
      cache_create_tokens: 120,
      reasoning_tokens: 144,
      usd_cost: expect.closeTo(16.8),
      tool_calls: 192,
    })
    expect(anthropicRows[0]).toMatchObject({
      interval_start_at: '2025-04-10T01:00:00.000Z',
      interval_end_at: '2025-04-10T03:00:00.000Z',
      lag_minutes: 0,
      traces: 2400,
      uncached_input_tokens: 4800,
      output_tokens: 7200,
      cache_read_tokens: 9600,
      cache_create_tokens: 12000,
      reasoning_tokens: 14400,
      usd_cost: 1680,
      tool_calls: 19200,
    })
  })

  test('estimator rolling weights keep null and invalid interval ends finite', () => {
    const helper = requireHelper<EstimatorHelper>(
      quotaHelpersValue,
      isEstimatorHelper
    )
    const weights = helper.quotaEstimatorWeights(
      [
        { intervalEndAt: null },
        { intervalEndAt: 'not-a-date' },
        { intervalEndAt: '2026-05-01T00:00:00.000Z' },
        { intervalEndAt: '2026-05-02T00:00:00.000Z' },
      ],
      72
    )

    expect(weights).toHaveLength(4)
    expect(weights.slice(0, 2)).toEqual([0, 0])
    expect(weights.every(Number.isFinite)).toBe(true)

    const rows = Array.from({ length: 6 }, (_, index) => ({
      lag_minutes: 0,
      provider: 'anthropic',
      quota_key: 'anthropic_unified_7d:7d',
      quota_type: 'weekly',
      quota_lane: 'anthropic_weekly_all_model',
      expected_reset_at: '2026-05-08T00:00:00.000Z',
      reset_start_at: '2026-05-01T00:00:00.000Z',
      reset_end_at: '2026-05-08T00:00:00.000Z',
      interval_start_at: `2026-05-0${index + 1}T00:00:00.000Z`,
      interval_end_at:
        index === 0
          ? null
          : index === 1
            ? 'not-a-date'
            : `2026-05-0${index + 1}T01:00:00.000Z`,
      previous_consumed_pct: 10 + index,
      current_consumed_pct: 11 + index,
      delta_pct: 1,
      is_reset_boundary: false,
      is_capped_at_100: false,
      trainable: true,
      exclude_reason: null,
      model_family: 'sonnet',
      traces: 1,
      uncached_input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      reasoning_tokens: 0,
      usd_cost: 0,
      tool_calls: 0,
    }))
    const report = helper.buildQuotaEstimatorReport(rows)
    const estimate = (report.estimates as Array<Record<string, unknown>>)[0]
    const rollingResiduals = (
      estimate.residuals as Record<string, Record<string, unknown>>
    ).rolling_exponential
    const rollingCoefficients = (
      estimate.coefficients as Array<Record<string, unknown>>
    ).filter(
      (coefficient) => coefficient.estimate_kind === 'rolling_exponential'
    )

    expect(Number.isFinite(rollingResiduals.rmse_pct)).toBe(true)
    expect(Number.isFinite(rollingResiduals.mae_pct)).toBe(true)
    expect(
      rollingCoefficients.every((coefficient) =>
        Number.isFinite(coefficient.coefficient_pct_per_mtok)
      )
    ).toBe(true)
  })

  test('estimator lookup boundaries preserve the half-open interval for each lag', () => {
    const helper = requireHelper<EstimatorHelper>(
      quotaHelpersValue,
      isEstimatorHelper
    )
    const observations = [
      {
        provider: 'openai',
        quota_key: 'codex-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T01:00:00.000Z',
        consumed_pct: 10,
      },
      {
        provider: 'openai',
        quota_key: 'codex-short',
        quota_type: 'short',
        quota_lane: 'short',
        expected_reset_at: '2025-04-11T00:00:00.000Z',
        observed_at: '2025-04-10T01:05:00.000Z',
        consumed_pct: 20,
      },
    ]
    const boundaryBucket = (bucketStart: string) => ({
      ...usageBucket('openai', bucketStart),
      traces:
        Number(bucketStart.slice(14, 16)) +
        100 * Number(bucketStart.slice(11, 13)),
    })
    const rows = helper.buildQuotaEstimatorRowsFromReadModels(observations, [
      boundaryBucket('2025-04-10T00:55:00.000Z'),
      boundaryBucket('2025-04-10T01:00:00.000Z'),
      boundaryBucket('2025-04-10T01:05:00.000Z'),
    ])

    const tracesByLag = Object.fromEntries(
      rows.map((row) => [row.lag_minutes, row.traces])
    )
    expect(tracesByLag[0]).toBe(100)
    expect(tracesByLag[5]).toBe(55)
    expect(tracesByLag[10]).toBe(0)
  })
})
