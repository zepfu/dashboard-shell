import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  fetchUsageReport,
  fetchUsageReportQuotaEstimator,
  fetchUsageReportQuotaHistory,
  fetchUsageReportQuotaRangeHistory,
  fetchUsageReportQuotas,
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
  fetchUsageReportToolActivity,
} from './usage-report'

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
