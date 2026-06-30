import { http, HttpResponse } from 'msw'
import { expectTypeOf } from 'vitest'
import { server } from '../../../test/setup'
import {
  type UsageReportTokenTrendSummaryResponse,
  fetchUsageReport,
  fetchUsageReportQuotaEstimator,
  fetchUsageReportQuotaHistory,
  fetchUsageReportQuotaRangeHistory,
  fetchUsageReportQuotas,
  fetchUsageReportSessionDiagnostics,
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
  fetchUsageReportToolActivity,
  usageReportQuotasQueryOptions,
} from './usage-report'

test('test_usageReportQuotasQueryOptions_disables_background_polling', () => {
  const options = usageReportQuotasQueryOptions({
    from: '2026-05-20',
    to: '2026-05-21',
  })

  expect(options.refetchInterval).toBe(60_000)
  expect(options.refetchIntervalInBackground).toBe(false)
})

test('test_fetchUsageReportTokenTrendSummary_sends_filters', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
        },
        tokenTrendHours: [],
        tokenTrendVersions: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
      model: ['claude-sonnet-4'],
    })
  ).resolves.toMatchObject({ tokenTrendHours: [], tokenTrendVersions: [] })

  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('model')).toBe('claude-sonnet-4')
})

test('test_fetchUsageReportTokenTrendSummary_sends_health_opt_in', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          includeTokenTrendHealth: true,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [],
        tokenTrendVersions: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
      includeHealth: true,
    })
  ).resolves.toMatchObject({
    metadata: { includeTokenTrendHealth: true },
    tokenTrendHealth: [],
  })

  expect(requestedUrl?.searchParams.get('include_health')).toBe('1')
})

test('test_fetchUsageReportTokenTrendSummary_preserves_degraded_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage: 'Token trend summary exceeded the bounded timeout.',
          timeout: true,
          timedOutSubquery: 'health',
          timedOutSubqueries: ['health'],
          tokenTrendSummaryStatementTimeoutMs: 15000,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [],
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      })
    )
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
    })
  ).resolves.toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'health',
      timedOutSubqueries: ['health'],
      tokenTrendSummaryStatementTimeoutMs: 15000,
    },
    tokenTrendHours: [],
    tokenTrendVersions: [],
  })
})

test('test_fetchUsageReportTokenTrendSummary_supports_partial_degraded_payload', async () => {
  let requestedUrl: URL | null = null
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Token trend summary subquery "hours" exceeded timeout; returning partial payload.',
          timeout: true,
          timedOutSubquery: 'hours',
          timedOutSubqueries: ['hours'],
          tokenTrendSummaryStatementTimeoutMs: 15000,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendScores: [{ score_bucket: 0 }],
        tokenTrendVersions: [{ provider: 'openai', model: 'gpt-5' }],
        tokenTrendModelFirstSeen: [{ date: '2026-05-20', provider: 'openai' }],
      })
    })
  )

  const response = await fetchUsageReportTokenTrendSummary({
    from: '2026-05-20',
    to: '2026-05-21',
    provider: ['anthropic'],
  })

  expect(response).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'hours',
      timedOutSubqueries: ['hours'],
      tokenTrendSummaryStatementTimeoutMs: 15000,
    },
    tokenTrendHours: [],
    tokenTrendHealth: [{ provider: 'openai', value: 1 }],
    tokenTrendScores: [{ score_bucket: 0 }],
    tokenTrendVersions: [{ provider: 'openai', model: 'gpt-5' }],
    tokenTrendModelFirstSeen: [{ date: '2026-05-20', provider: 'openai' }],
  })
  expect(requestedUrl?.searchParams.get('provider')).toBe('anthropic')
})

test('test_fetchUsageReportTokenTrendSummary_preserves_bounded_raw_lane_policy_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-01',
          to: '2026-06-01',
          degraded: true,
          degradedReason: 'bounded_raw_lane_policy',
          degradedMessage:
            'Token trend summary bounded raw-lane policy skipped lanes for broad range.',
          skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
          unavailableSubqueries: [
            'hours',
            'scores',
            'versions',
            'modelFirstSeen',
          ],
          tokenTrendSummaryRawLaneMaxDays: 7,
          tokenTrendSummaryRangeDays: 30,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      })
    )
  )

  const response = await fetchUsageReportTokenTrendSummary({
    from: '2026-05-01',
    to: '2026-06-01',
  })

  expect(response).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'bounded_raw_lane_policy',
      skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
      unavailableSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
      tokenTrendSummaryRawLaneMaxDays: 7,
      tokenTrendSummaryRangeDays: 30,
    },
    tokenTrendHours: [],
    tokenTrendHealth: [{ provider: 'openai', value: 1 }],
    tokenTrendVersions: [],
    tokenTrendModelFirstSeen: [],
  })
})

test('test_usageReportTokenTrendSummaryMetadataContract_allows_timeoutFields', () => {
  expectTypeOf<
    UsageReportTokenTrendSummaryResponse['metadata']
  >().toEqualTypeOf<{
    from: string
    to: string
    generatedAt?: string
    degraded?: boolean
    degradedReason?: string
    degradedMessage?: string
    timeout?: boolean
    timedOutSubquery?: string
    timedOutSubqueries?: string[]
    skippedSubqueries?: string[]
    unavailableSubqueries?: string[]
    tokenTrendSummaryRawLaneMaxDays?: number
    tokenTrendSummaryRangeDays?: number
    tokenTrendSummaryStatementTimeoutMs?: number
    cacheBackend?: string
    cacheFreshUntil?: string | null
    cacheGeneratedAt?: string | null
    cacheKeyHash?: string
    cacheScope?: string
    cacheStaleUntil?: string | null
    cacheStatus?: string
    cacheRefreshing?: boolean
  }>()
})

test('test_fetchUsageReportTokenTrendDay_sends_date_filters_and_signal', async () => {
  let requestedUrl: URL | null = null
  const controller = new AbortController()

  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
      requestedUrl = new URL(request.url)
      expect(controller.signal.aborted).toBe(false)
      return HttpResponse.json({
        metadata: {
          date: '2026-05-20',
          from: '2026-05-20',
          to: '2026-05-21',
        },
        date: '2026-05-20',
        rows: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendDay(
      {
        from: '2026-05-20',
        to: '2026-05-21',
        date: '2026-05-20',
        provider: ['anthropic', 'openai'],
        repository: ['dashboard-shell'],
        client: ['codex-tui'],
      },
      controller.signal
    )
  ).resolves.toMatchObject({ date: '2026-05-20', rows: [] })

  expect(requestedUrl?.searchParams.get('date')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('provider')).toBe('anthropic,openai')
  expect(requestedUrl?.searchParams.get('repository')).toBe('dashboard-shell')
  expect(requestedUrl?.searchParams.get('client')).toBe('codex-tui')
})

test('test_fetchUsageReportTokenTrendDay_uses_server_error_message', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', () =>
      HttpResponse.json({ error: 'bad day' }, { status: 400 })
    )
  )

  await expect(
    fetchUsageReportTokenTrendDay({
      from: '2026-05-20',
      to: '2026-05-21',
      date: '2026-05-20',
    })
  ).rejects.toThrow('bad day')
})

test('test_fetchUsageReport_preserves_providerAliasRouting_contract', async () => {
  const future = new Date(Date.now() + 120_000).toISOString()
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
          groupBy: ['provider', 'model'],
          limit: 50000,
          generatedAt: '2026-05-21T00:00:00.000Z',
          latestRecordAt: null,
          latestRecordAgeMinutes: null,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        summary: {
          traces: 1,
          token_in: 1,
          token_out: 1,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          token_total: 2,
          usd_cost: 0,
          cache_miss_usd_cost: 0,
          tool_calls: 0,
          git_commit: 0,
          git_push: 0,
        },
        trend: [],
        clients: [],
        providerLatencyHealth: [],
        providerErrorObservations: [],
        providerStatusUsage: [],
        providerAliasRouting: {
          data_source: 'recent_observed_session_history',
          freshness_label:
            'Recent observed routing from session history (not live Redis/DualCache)',
          generated_at: '2026-05-21T00:00:00.000Z',
          lookback_hours: 24,
          families: [
            { family: 'codex', observed: true },
            { family: 'anthropic', observed: false },
          ],
          entries: [
            {
              family: 'codex',
              alias_label: 'aawm-code',
              provider: 'openai',
              model: 'gpt-5',
              route_family: 'codex_primary',
              state_kind: 'affinity',
              state_source: 'durable_cache',
              observed_at: '2026-05-21T00:00:00.000Z',
              expires_at: future,
              remaining_seconds: 120,
              is_active: true,
              skipped_candidates: [],
            },
          ],
        },
        quotas: [],
        quotaHistory: [],
        toolActivity: [],
        rows: [],
      })
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerAliasRouting?.entries[0]?.state_kind).toBe('affinity')
  expect(report.providerAliasRouting?.data_source).toBe(
    'recent_observed_session_history'
  )
})

test('test_fetchUsageReport_preserves_providerAuthHealth_contract', async () => {
  const future = new Date(Date.now() + 180_000).toISOString()
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
          groupBy: ['provider', 'model'],
          limit: 50000,
          generatedAt: '2026-05-21T00:00:00.000Z',
          latestRecordAt: null,
          latestRecordAgeMinutes: null,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        summary: {
          traces: 0,
          token_in: 0,
          token_out: 0,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          token_total: 0,
          usd_cost: 0,
          cache_miss_usd_cost: 0,
          tool_calls: 0,
          git_commit: 0,
          git_push: 0,
        },
        trend: [],
        clients: [],
        providerLatencyHealth: [],
        providerErrorObservations: [],
        providerStatusUsage: [],
        providerAuthHealth: {
          data_source: 'provider_auth_current',
          freshness_label: 'Current provider credential refresh state',
          generated_at: '2026-05-21T00:00:00.000Z',
          entries: [
            {
              observed_at: '2026-05-21T00:00:00.000Z',
              environment: 'production',
              provider: 'xai',
              auth_family: 'grok_oidc',
              status: 'refreshed',
              attempted: true,
              refreshed: true,
              skipped: false,
              expires_at: future,
              remaining_seconds: 180,
              auth_health_state: 'refreshed',
              source_task: 'grok_oidc_refresh',
              auth_file_hash_short: 'abcd1234',
            },
          ],
        },
        quotas: [],
        quotaHistory: [],
        toolActivity: [],
        rows: [],
      })
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerAuthHealth?.data_source).toBe('provider_auth_current')
  expect(report.providerAuthHealth?.entries[0]?.auth_family).toBe('grok_oidc')
  expect(report.providerAuthHealth?.entries[0]?.auth_health_state).toBe(
    'refreshed'
  )
})

test('test_fetchUsageReport_preserves_providerCreditLifecycle_contract', async () => {
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
          groupBy: ['provider', 'model'],
          limit: 50000,
          generatedAt: '2026-05-21T00:00:00.000Z',
          latestRecordAt: null,
          latestRecordAgeMinutes: null,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        summary: {
          traces: 0,
          token_in: 0,
          token_out: 0,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          token_total: 0,
          usd_cost: 0,
          cache_miss_usd_cost: 0,
          tool_calls: 0,
          git_commit: 0,
          git_push: 0,
        },
        trend: [],
        clients: [],
        providerLatencyHealth: [],
        providerErrorObservations: [],
        providerStatusUsage: [],
        providerCreditLifecycle: {
          data_source: 'provider_credit_current',
          freshness_label: 'Current provider credit lifecycle',
          generated_at: '2026-05-21T00:00:00.000Z',
          summaries: [
            {
              environment: 'production',
              provider: 'openai',
              credit_family: 'codex_rate_limit_reset',
              label: 'openai codex_rate_limit_reset credits',
              available_count: 2,
              used_count: 1,
              expired_count: 0,
              total_count: 3,
            },
          ],
          entries: [
            {
              observed_at: '2026-05-21T00:00:00.000Z',
              environment: 'production',
              provider: 'openai',
              account_hash_short: '8e928548',
              credit_family: 'codex_rate_limit_reset',
              status: 'available',
              available_count: 1,
              credit_identity: 'codex-1',
            },
          ],
        },
        quotas: [],
        quotaHistory: [],
        toolActivity: [],
        rows: [],
      })
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerCreditLifecycle?.data_source).toBe(
    'provider_credit_current'
  )
  expect(report.providerCreditLifecycle?.summaries[0]?.available_count).toBe(2)
  expect(report.providerCreditLifecycle?.entries[0]?.credit_identity).toBe(
    'codex-1'
  )
})

test('test_fetchUsageReportQuotaHistory_preserves_degraded_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: '2026-05-21T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage: 'Quota history exceeded the bounded timeout.',
          quotaHistoryStatementTimeoutMs: 15000,
        },
        quotaHistory: [],
      })
    )
  )

  await expect(fetchUsageReportQuotaHistory()).resolves.toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      quotaHistoryStatementTimeoutMs: 15000,
    },
    quotaHistory: [],
  })
})

test('test_fetchUsageReportQuotaHistory_preserves_partial_payload', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: '2026-06-01T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Quota history history_enrichment exceeded the bounded database timeout; returning partial payload from base rows.',
          timeout: true,
          timedOutSubquery: 'history_enrichment',
          timedOutSubqueries: ['history_enrichment'],
          quotaHistoryStatementTimeoutMs: 15000,
        },
        quotaHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
            expected_reset_at: '2026-06-01T00:00:00.000Z',
            interval_start: '2026-05-25T00:00:00.000Z',
            interval_end: '2026-06-01T00:00:00.000Z',
            min_remaining_pct: 10,
            max_remaining_pct: 100,
            velocity_segments: [true, false],
            velocity_scores: [0.4, 0.6],
            velocity_sample_count: 2,
            usage_tokens: 1234,
            usage_breakdown: [
              {
                model: 'gpt-5',
                tokens: 1234,
                cost: 1.23,
                traces: 5,
                recent_traces_90m: 2,
              },
            ],
          },
        ],
      })
    )
  )

  const report = await fetchUsageReportQuotaHistory()
  expect(report).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'history_enrichment',
      timedOutSubqueries: ['history_enrichment'],
      quotaHistoryStatementTimeoutMs: 15000,
    },
  })
  expect(report.quotaHistory).toHaveLength(1)
  expect(report.quotaHistory?.[0]?.provider).toBe('openai')
})

test('test_fetchUsageReportQuotaRangeHistory_preserves_partial_payload', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-range-history', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: url.searchParams.get('from') ?? '2026-06-01',
          to: url.searchParams.get('to') ?? '2026-06-08',
          generatedAt: '2026-06-01T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Quota range history subquery "history_enrichment" exceeded the bounded database timeout; returning partial payload from base rows.',
          timeout: true,
          timedOutSubquery: 'history_enrichment',
          timedOutSubqueries: ['history_enrichment'],
          quotaRangeHistoryStatementTimeoutMs: 15000,
        },
        quotaRangeHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
            expected_reset_at: '2026-06-08T00:00:00.000Z',
            interval_start: '2026-06-01T00:00:00.000Z',
            interval_end: '2026-06-08T00:00:00.000Z',
            min_remaining_pct: 10,
            max_remaining_pct: 100,
            velocity_segments: [],
            velocity_scores: [],
            velocity_sample_count: 0,
            usage_tokens: 0,
            usage_breakdown: [],
          },
        ],
      })
    })
  )

  const report = await fetchUsageReportQuotaRangeHistory({
    from: '2026-06-01',
    to: '2026-06-08',
    cacheBust: 'manual-1',
  })

  expect(report).toMatchObject({
    metadata: {
      from: '2026-06-01',
      to: '2026-06-08',
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'history_enrichment',
      timedOutSubqueries: ['history_enrichment'],
      quotaRangeHistoryStatementTimeoutMs: 15000,
    },
  })
  expect(report.quotaRangeHistory).toHaveLength(1)
  expect(report.quotaRangeHistory[0]?.usage_tokens).toBe(0)
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-1, S4-5: Boundary-validation and malformed-payload tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-1 / S4-5: Parameterized over all 9 fetchers.
 *
 * Each fetcher returns a response where the top-level `metadata` key has been
 * renamed to `_metadata_broken`. The test asserts that the caller receives a
 * thrown Error (boundary quarantine), NOT silent undefined/NaN propagation.
 *
 * This is RED until the engineer adds zod spot-check validation at each fetch
 * boundary.
 */
describe('test_fetchers_validate_metadata_summary_firstrow', () => {
  // Payload with renamed metadata key — no valid `metadata` field present.
  const malformedMetadata = {
    _metadata_broken: { from: '2026-05-20', to: '2026-05-21' },
    summary: {
      traces: 10,
      token_in: 100,
      token_out: 50,
      usd_cost: 0.1,
    },
    rows: [],
    trend: [],
    clients: [],
    providerLatencyHealth: [],
    providerErrorObservations: [],
    providerStatusUsage: [],
    quotas: [],
    quotaHistory: [],
    toolActivity: [],
  }

  test('fetchUsageReport rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json(malformedMetadata)
      )
    )
    await expect(
      fetchUsageReport({ from: '2026-05-20', to: '2026-05-21', grain: 'day' })
    ).rejects.toThrow()
  })

  test('fetchUsageReportTokenTrendSummary rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          _metadata_broken: {},
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      )
    )
    await expect(
      fetchUsageReportTokenTrendSummary({
        from: '2026-05-20',
        to: '2026-05-21',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportTokenTrendDay rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-day', () =>
        HttpResponse.json({
          _metadata_broken: {},
          date: '2026-05-20',
          rows: [],
        })
      )
    )
    await expect(
      fetchUsageReportTokenTrendDay({
        from: '2026-05-20',
        to: '2026-05-21',
        date: '2026-05-20',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportQuotas rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({ _metadata_broken: {}, quotas: [] })
      )
    )
    await expect(fetchUsageReportQuotas()).rejects.toThrow()
  })

  test('fetchUsageReportQuotaRangeHistory rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-range-history', () =>
        HttpResponse.json({ _metadata_broken: {}, quotaRangeHistory: [] })
      )
    )
    await expect(
      fetchUsageReportQuotaRangeHistory({
        from: '2026-05-20',
        to: '2026-05-21',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportQuotaHistory rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-history', () =>
        HttpResponse.json({ _metadata_broken: {}, quotaHistory: [] })
      )
    )
    await expect(fetchUsageReportQuotaHistory()).rejects.toThrow()
  })

  test('fetchUsageReportQuotaEstimator rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-estimator', () =>
        HttpResponse.json({
          _metadata_broken: {},
          coefficients: [],
          lagSensitivity: [],
          cacheReadRatios: [],
          diagnostics: [],
          estimates: [],
        })
      )
    )
    await expect(
      fetchUsageReportQuotaEstimator({ from: '2026-05-20', to: '2026-05-21' })
    ).rejects.toThrow()
  })

  test('fetchUsageReportToolActivity rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/tool-activity', () =>
        HttpResponse.json({ _metadata_broken: {}, toolActivity: [] })
      )
    )
    await expect(
      fetchUsageReportToolActivity({ from: '2026-05-20', to: '2026-05-21' })
    ).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-3: cacheBust forwarded by fetchUsageReportTokenTrendDay
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-3: The `cacheBust` parameter must be forwarded as `cache_bust` in the
 * query string. This is RED until the engineer adds the cacheBust→cache_bust
 * forwarding to `fetchUsageReportTokenTrendDay`.
 */
test('test_token_trend_day_forwards_cache_bust', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: { date: '2026-05-20', from: '2026-05-20', to: '2026-05-21' },
        date: '2026-05-20',
        rows: [],
      })
    })
  )

  await fetchUsageReportTokenTrendDay({
    from: '2026-05-20',
    to: '2026-05-21',
    date: '2026-05-20',
    cacheBust: 'bust-abc',
  } as Parameters<typeof fetchUsageReportTokenTrendDay>[0])

  // Must be present — RED until engineer adds forwarding
  expect(capturedUrl?.searchParams.get('cache_bust')).toBe('bust-abc')
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-2: Comma in filter value round-trips without splitting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-2: A repository name containing a comma (e.g. "acme,corp") must arrive
 * at the server as a single value, not split into two filters.
 *
 * Currently `appendUsageReportFilters` uses `.join(',')` which produces
 * "acme,corp" — indistinguishable from two separate values on the server.
 * The fix is `encodeURIComponent` per element. This is RED until the engineer
 * adds that encoding.
 */
test('test_filter_values_comma_escaped', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
          groupBy: [],
          limit: 50_000,
          generatedAt: '2026-05-21T00:00:00.000Z',
          latestRecordAt: null,
          latestRecordAgeMinutes: null,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        summary: {
          traces: 0,
          token_in: 0,
          token_out: 0,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          token_total: 0,
          usd_cost: 0,
          cache_miss_usd_cost: 0,
          tool_calls: 0,
          git_commit: 0,
          git_push: 0,
          period_start: '2026-05-20',
          period_end: '2026-05-21',
          latest_record_at: null,
        },
        trend: [],
        clients: [],
        providerLatencyHealth: [],
        providerErrorObservations: [],
        providerStatusUsage: [],
        quotas: [],
        quotaHistory: [],
        toolActivity: [],
        rows: [],
      })
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    repository: ['acme,corp'],
  })

  // The raw repository param value must NOT be split on the comma.
  // With proper percent-encoding the server sees "acme%2Ccorp" as one value.
  const repoParam = capturedUrl?.searchParams.get('repository') ?? ''
  // If the engineer encodes per-element, decoding once gives back the original name.
  expect(decodeURIComponent(repoParam)).toBe('acme,corp')
  // The un-encoded comma would split "acme,corp" into two entries on the server.
  // Confirm the raw string is NOT the plain comma-joined form.
  expect(repoParam).not.toBe('acme,corp')
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-5: AbortSignal propagation — controller.abort() must reject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-5: When the caller aborts the AbortController before the response
 * arrives, the promise must reject with an AbortError.
 *
 * This is GREEN for fetchers that already accept a signal parameter, but RED
 * for any fetcher where the signal is wired but the abort isn't propagated
 * (and RED for `fetchUsageReport` which currently has no `signal` param at
 * all — the engineer must add it).
 */
test('test_real_abort_rejects_with_AbortError', async () => {
  const controller = new AbortController()

  server.use(
    http.get('/api/shell/reports/usage/quota-range-history', async () => {
      // Hang forever — the abort will cancel the request
      await new Promise<never>(() => undefined)
    })
  )

  const fetchPromise = fetchUsageReportQuotaRangeHistory(
    { from: '2026-05-20', to: '2026-05-21' },
    controller.signal
  )

  // Abort immediately
  controller.abort()

  await expect(fetchPromise).rejects.toSatisfy(
    (err: unknown) =>
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
  )
})

test('test_fetchUsageReportSessionDiagnostics_forwards_grok_side_channel_filters', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/session-diagnostics', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          limit: 25,
          generatedAt: '2026-05-21T00:00:00.000Z',
        },
        sessionDiagnostics: [
          {
            provider: 'xai',
            model: 'grok-composer-2.5-fast',
            diagnostic_flags: ['grok_side_channel'],
            grok_side_channel: {
              enabled: true,
              endpoint_type: 'register',
              endpoint_template: '/grok/v1/sessions/register',
              content_type: 'application/json',
              body_byte_length: 128,
              body_sha256: 'abc123deadbeef',
              digest_source: 'request_body',
              json_container_type: 'object',
              top_level_key_types: { session: 'object' },
              array_length: null,
            },
          },
        ],
      })
    })
  )

  const response = await fetchUsageReportSessionDiagnostics({
    from: '2026-05-20',
    to: '2026-05-21',
    grok_side_channel: true,
    grok_side_channel_endpoint_type: ['register'],
    limit: 25,
  })

  expect(capturedUrl?.searchParams.get('grok_side_channel')).toBe('true')
  expect(capturedUrl?.searchParams.get('grok_side_channel_endpoint_type')).toBe(
    'register'
  )
  expect(response.sessionDiagnostics[0]?.grok_side_channel).toMatchObject({
    endpoint_type: 'register',
    body_sha256: 'abc123deadbeef',
    digest_source: 'request_body',
  })
  const grok = response.sessionDiagnostics[0]?.grok_side_channel
  expect(grok).toBeDefined()
  expect(grok).not.toHaveProperty('request_body')
  expect(grok).not.toHaveProperty('body_raw')
  expect(grok).not.toHaveProperty('raw_body')
  expect(JSON.stringify(grok)).not.toContain('RAW_SECRET')
})

// ---------------------------------------------------------------------------
// D1-212/215/213/178/221/222 session diagnostics API contracts
// ---------------------------------------------------------------------------

describe('D1-212/215/213/178/221/222 session diagnostics API contracts', () => {
  const diagnosticTypeFields = [
    'diagnostic_flags',
    'diagnostic_categories',
    'grok_oauth',
    'grok_side_channel',
    'output_contract',
    'xai_sanitizer',
    'transcript_attribution',
    'tool_definitions',
    'alias_route_events',
  ] as const

  test('test_usage_report_types_expose_session_diagnostics_response_and_row_shapes', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), './usage-report.ts'),
      'utf8'
    )

    expect(source).toContain(
      'export interface UsageReportSessionDiagnosticsParams'
    )
    expect(source).toContain(
      'export interface UsageReportSessionDiagnosticsRow'
    )
    expect(source).toContain(
      'export interface UsageReportSessionDiagnosticsResponse'
    )
    expect(source).toContain(
      'export async function fetchUsageReportSessionDiagnostics'
    )

    for (const field of diagnosticTypeFields) {
      expect(source).toContain(`${field}?:`)
    }

    expect(source).toContain('credential_family?:')
    expect(source).toContain('grok_native_oauth_managed?:')
    expect(source).toContain('grok_native_entrypoint?:')
    expect(source).toContain('endpoint_template?:')
    expect(source).toContain('body_sha256?:')
    expect(source).toContain('grok_side_channel?:')
    expect(source).toContain('usage_output_contract_required_final_phrase?:')
    expect(source).toContain(
      'usage_output_contract_required_final_phrase_present?:'
    )
    expect(source).toContain('usage_output_contract_failure_class?:')
    expect(source).toContain('usage_output_contract_setup_only_detected?:')
    expect(source).toContain('xai_responses_request_sanitized?:')
    expect(source).toContain('xai_responses_sanitized_removed_params?:')
    expect(source).toContain('xai_responses_sanitized_tool_count?:')
    expect(source).toContain('xai_responses_sanitized_tool_types?:')
    expect(source).toContain('xai_tool_choice_without_tools_removed?:')
    expect(source).toContain('xai_tool_choice_without_tools_removed_reason?:')
    expect(source).toContain('session_history_transcript_attribution_status?:')
    expect(source).toContain('session_history_transcript_attribution_source?:')
    expect(source).toContain('reason?:')
    expect(source).toContain('match_rule?:')
    expect(source).toContain('updated_at?:')
    expect(source).toContain('session_history_transcript_attribution?:')
    expect(source).toContain('tool_definition_snapshot?:')
    expect(source).toContain('alias_route_events?:')
  })

  test('test_fetchUsageReportSessionDiagnostics_forwards_filters_and_returns_diagnostic_rows', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get(
        '/api/shell/reports/usage/session-diagnostics',
        ({ request }) => {
          capturedUrl = new URL(request.url)
          return HttpResponse.json({
            metadata: {
              from: '2026-05-20',
              to: '2026-05-21',
              limit: 100,
              generatedAt: '2026-05-21T00:00:00.000Z',
            },
            sessionDiagnostics: [
              {
                session_id: 'sess-1',
                litellm_call_id: 'call-1',
                provider: 'xai',
                model: 'grok-composer-2.5-fast',
                repository: 'dashboard-shell',
                client: 'grok-build',
                diagnostic_flags: ['grok_oauth', 'xai_sanitizer'],
                diagnostic_categories: ['route_identity', 'request_shape'],
                grok_oauth: {
                  credential_family: 'xai_grok_oidc',
                  grok_native_oauth_managed: true,
                  grok_native_entrypoint: 'openai_responses',
                },
                output_contract: {
                  usage_output_contract_required_final_phrase: 'done',
                  usage_output_contract_required_final_phrase_present: true,
                  usage_output_contract_failure_class: null,
                  usage_output_contract_setup_only_detected: false,
                },
                xai_sanitizer: {
                  xai_responses_request_sanitized: true,
                  xai_responses_sanitized_removed_params: ['instructions'],
                  xai_responses_sanitized_tool_count: 2,
                  xai_responses_sanitized_tool_types: ['web_search'],
                  xai_tool_choice_without_tools_removed: {
                    name: 'Bash',
                    type: 'function',
                  },
                  xai_tool_choice_without_tools_removed_reason: 'missing_tools',
                },
                transcript_attribution: {
                  session_history_transcript_attribution_status: 'recoverable',
                  session_history_transcript_attribution_source:
                    'd1-229-claude-raw-transcript-attribution',
                  session_history_transcript_attribution: {
                    status: 'recoverable',
                    match_rule: 'transcript_model_event',
                  },
                },
                tool_definitions: {
                  snapshot_hash: 'abc123',
                  tool_definition_snapshot: [
                    { name: 'Bash', type: 'function' },
                  ],
                },
                alias_route_events: [
                  {
                    observed_at: '2026-05-20T12:00:00.000Z',
                    alias_model: 'aawm-code',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-6',
                    event_type: 'candidate_selected',
                    redispatch_required: false,
                  },
                ],
              },
            ],
          })
        }
      )
    )

    const response = await fetchUsageReportSessionDiagnostics({
      from: '2026-05-20',
      to: '2026-05-21',
      provider: ['xai', 'anthropic'],
      model: ['grok-composer-2.5-fast'],
      repository: ['dashboard-shell'],
      client: ['grok-build'],
      limit: 100,
    } as Parameters<typeof fetchUsageReportSessionDiagnostics>[0])

    expect(capturedUrl?.searchParams.get('from')).toBe('2026-05-20')
    expect(capturedUrl?.searchParams.get('to')).toBe('2026-05-21')
    expect(capturedUrl?.searchParams.get('provider')).toBe('xai,anthropic')
    expect(capturedUrl?.searchParams.get('model')).toBe(
      'grok-composer-2.5-fast'
    )
    expect(capturedUrl?.searchParams.get('repository')).toBe('dashboard-shell')
    expect(capturedUrl?.searchParams.get('client')).toBe('grok-build')
    expect(capturedUrl?.searchParams.get('limit')).toBe('100')

    expect(response.sessionDiagnostics[0]).toMatchObject({
      provider: 'xai',
      model: 'grok-composer-2.5-fast',
      diagnostic_flags: ['grok_oauth', 'xai_sanitizer'],
      grok_oauth: {
        credential_family: 'xai_grok_oidc',
        grok_native_oauth_managed: true,
      },
      output_contract: {
        usage_output_contract_required_final_phrase_present: true,
      },
      xai_sanitizer: {
        xai_tool_choice_without_tools_removed_reason: 'missing_tools',
      },
      transcript_attribution: {
        session_history_transcript_attribution_status: 'recoverable',
      },
      tool_definitions: {
        snapshot_hash: 'abc123',
      },
      alias_route_events: [
        {
          alias_model: 'aawm-code',
          event_type: 'candidate_selected',
        },
      ],
    })
  })
})

// ---------------------------------------------------------------------------
// D1-223/224/225 usage identity and billing contracts
// ---------------------------------------------------------------------------

describe('D1-223/224/225 usage identity and billing contracts', () => {
  const usageIdentityDimensions = [
    'inbound_model_alias',
    'agent_name',
    'agent_id',
  ] as const

  const usageIdentityFilters = [
    'inbound_model_alias',
    'agent_name',
    'agent_id',
  ] as const

  const billingDetailFields = [
    'quota_limit',
    'quota_used',
    'quota_remaining',
    'billing_period_start_at',
    'billing_period_end_at',
    'raw_provider_fields',
    'evidence',
  ] as const

  test('test_usage_report_types_expose_inbound_model_alias_agent_name_and_agent_id', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), './usage-report.ts'),
      'utf8'
    )

    for (const dimension of usageIdentityDimensions) {
      expect(source).toContain(`${dimension}?:`)
    }
    for (const filter of usageIdentityFilters) {
      expect(source).toContain(`${filter}?: readonly string[]`)
    }
    expect(source).toContain('inbound_model_alias?: string | null')
    expect(source).toContain('agent_name?: string | null')
    expect(source).toContain('agent_id?: string | null')
  })

  test('test_fetchUsageReport_forwards_inbound_model_alias_agent_name_and_agent_id_filters', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            grain: 'day',
            groupBy: [
              'repository',
              'inbound_model_alias',
              'agent_name',
              'agent_id',
            ],
            limit: 50_000,
            generatedAt: '2026-05-21T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          summary: {
            traces: 0,
            token_in: 0,
            token_out: 0,
            token_cache_input: 0,
            token_cache_creation: 0,
            token_reasoning_reported: 0,
            token_reasoning_estimated: 0,
            token_total: 0,
            usd_cost: 0,
            cache_miss_usd_cost: 0,
            tool_calls: 0,
            git_commit: 0,
            git_push: 0,
            period_start: '2026-05-20',
            period_end: '2026-05-21',
            latest_record_at: null,
          },
          trend: [],
          clients: [],
          providerLatencyHealth: [],
          providerErrorObservations: [],
          providerStatusUsage: [],
          quotas: [],
          quotaHistory: [],
          toolActivity: [],
          rows: [],
        })
      })
    )

    await fetchUsageReport({
      from: '2026-05-20',
      to: '2026-05-21',
      grain: 'day',
      groupBy: ['repository', 'inbound_model_alias', 'agent_name', 'agent_id'],
      inbound_model_alias: ['aawm-read-anthropic'],
      agent_name: ['orchestrator'],
      agent_id: ['agent_harness'],
    } as Parameters<typeof fetchUsageReport>[0])

    expect(capturedUrl?.searchParams.get('group_by')).toBe(
      'repository,inbound_model_alias,agent_name,agent_id'
    )
    expect(capturedUrl?.searchParams.get('inbound_model_alias')).toBe(
      'aawm-read-anthropic'
    )
    expect(capturedUrl?.searchParams.get('agent_name')).toBe('orchestrator')
    expect(capturedUrl?.searchParams.get('agent_id')).toBe('agent_harness')
  })

  test('test_fetchUsageReportToolActivity_forwards_agent_id_filter_and_returns_grouped_rows', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get('/api/shell/reports/usage/tool-activity', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            generatedAt: '2026-05-21T00:00:00.000Z',
            degraded: true,
            degradedReason: 'database_timeout',
            toolActivityRecentRowLimit: 5000,
          },
          toolActivity: [
            {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              agent_names: ['orchestrator'],
              agent_ids: ['agent_harness'],
              kind: 'outer',
              label: 'Bash',
              calls: 3,
            },
          ],
        })
      })
    )

    const response = await fetchUsageReportToolActivity({
      from: '2026-05-20',
      to: '2026-05-21',
      agent_id: ['agent_harness'],
    } as Parameters<typeof fetchUsageReportToolActivity>[0])

    expect(capturedUrl?.searchParams.get('agent_id')).toBe('agent_harness')
    expect(response.metadata).toMatchObject({
      degraded: true,
      degradedReason: 'database_timeout',
      toolActivityRecentRowLimit: 5000,
    })
    expect(response.toolActivity[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      agent_names: ['orchestrator'],
      agent_ids: ['agent_harness'],
      kind: 'outer',
      label: 'Bash',
      calls: 3,
    })
  })

  test('test_quota_response_contract_surfaces_billing_detail_fields', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const source = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), './usage-report.ts'),
      'utf8'
    )

    for (const field of billingDetailFields) {
      expect(source).toContain(`${field}?:`)
    }
    expect(source).toContain('raw_provider_fields?: Record<string, unknown>')
    expect(source).toContain('evidence?: Record<string, unknown>')
  })
})
