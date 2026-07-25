import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }
const RANDOM_CREDENTIAL = 'unlabeled-credential-7f4d9c2a'

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  vi.unstubAllEnvs()
})

async function loadReportService() {
  vi.stubEnv('VITEST', 'true')
  delete process.env.DATABASE_URL
  return import('./report-service.mjs')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function staleEntry(cacheVersion: string, payload: unknown) {
  return {
    cacheVersion,
    generatedAt: new Date(Date.now() - 120_000).toISOString(),
    freshUntil: Date.now() - 60_000,
    staleUntil: Date.now() + 60_000,
    payload,
  }
}

function sensitiveErrorMessage() {
  return [
    'request failed',
    'Bearer bearer-secret',
    'postgresql://db-user:db-password@localhost:5432/report',
    'token=plain-token',
    'password=plain-password',
    'secret=plain-secret',
    'apiKey=plain-api-key',
    'authorization=plain-authorization',
    '{"token":"json-token","password":"json-password","secret":"json-secret","apiKey":"json-api-key","authorization":"json-authorization"}',
    RANDOM_CREDENTIAL,
    'x'.repeat(500),
  ].join(' ')
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

const foregroundContext = {
  requestId: 'request-42',
  endpoint: '/api/shell/reports/usage',
  cacheScope: 'usage-v2',
  cacheKeyHash: 'a'.repeat(64),
  refreshKind: 'foreground',
  dateIdentity: 'from=2026-07-01&to=2026-07-25&grain=day',
}

describe('D1-490 bounded correlation metadata', () => {
  test('allows correlation resolution without an options object', async () => {
    const { __queryCorrelationTestHelpers } = await loadReportService()

    expect(
      __queryCorrelationTestHelpers.resolveQueryCorrelationContext()
    ).toEqual({
      requestId: null,
      endpoint: null,
      cacheScope: null,
      cacheKeyHash: null,
      refreshKind: null,
      dateIdentity: null,
      usageTaskKey: null,
    })
  })

  test('builds an allowlisted bounded request identity without unknown or secret params', async () => {
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const {
      buildNormalizedReportRequestIdentity,
      QUERY_CORRELATION_DATE_IDENTITY_MAX,
    } = __queryCorrelationTestHelpers
    const searchParams = new URLSearchParams({
      from: '2026-07-01',
      to: '2026-07-25',
      grain: 'day',
      group_by: `provider,model,${'repository'.repeat(100)}`,
      direction: 'desc',
      password: 'correct-horse-battery-staple',
      authorization: 'Bearer private-token',
      cache_bust: 'private-cache-value',
      unknown: 'x'.repeat(5_000),
    })

    const identity = buildNormalizedReportRequestIdentity(searchParams)

    expect(identity).toContain('from=2026-07-01')
    expect(identity).toContain('to=2026-07-25')
    expect(identity).toContain('grain=day')
    expect(identity).toContain('group_by=')
    expect(identity).not.toContain('password')
    expect(identity).not.toContain('authorization')
    expect(identity).not.toContain('private-token')
    expect(identity).not.toContain('cache_bust')
    expect(identity).not.toContain('unknown')
    expect(identity?.length).toBeLessThanOrEqual(
      QUERY_CORRELATION_DATE_IDENTITY_MAX
    )
  })

  test('sanitizes and bounds request, endpoint, and task strings', async () => {
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const {
      buildRequestIdReference,
      reportQueryCorrelationStorage,
      resolveQueryCorrelationContext,
      QUERY_CORRELATION_REQUEST_ID_MAX,
    } = __queryCorrelationTestHelpers

    const context = await reportQueryCorrelationStorage.run(
      {
        ...foregroundContext,
        requestId: `request\r\n${'x'.repeat(500)}`,
        endpoint: `/api/shell/reports/usage\u0000${'y'.repeat(500)}`,
      },
      async () =>
        resolveQueryCorrelationContext({
          usageReportTaskKey: `summary\n${'z'.repeat(500)}`,
        })
    )

    const expectedRequestId = buildRequestIdReference(
      `request\r\n${'x'.repeat(500)}`
    )
    expect(context.requestId).toBe(expectedRequestId)
    expect(context.requestId).toMatch(/^req:[0-9a-f]{24}$/)
    expect(context.requestId).not.toContain('request')
    expect(context.requestId?.length).toBe(QUERY_CORRELATION_REQUEST_ID_MAX)
    expect(context.endpoint).not.toMatch(/[\r\n\u0000]/)
    expect(context.endpoint?.length).toBeLessThanOrEqual(180)
    expect(context.usageTaskKey).not.toMatch(/[\r\n\u0000]/)
    expect(context.usageTaskKey?.length).toBeLessThanOrEqual(96)
  })
})

describe('D1-490 scheduled refresh context', () => {
  test.each([
    ['redis stale', 'background'],
    ['local stale', 'local'],
  ])(
    'runs the raw loader once under %s refresh metadata',
    async (cachePath, expectedRefreshKind) => {
      const mod = await loadReportService()
      const {
        __reportCacheInternals,
        __queryCorrelationTestHelpers,
        buildReportCacheIdentity,
        REPORT_CACHE_VERSION,
      } = mod
      const searchParams = new URLSearchParams({
        from: '2026-07-01',
        to: '2026-07-25',
        grain: 'day',
      })
      const identity = buildReportCacheIdentity('usage-v2', searchParams)
      const entry = staleEntry(REPORT_CACHE_VERSION, { stale: true })
      const observedContext = deferred<Record<string, unknown>>()
      const load = vi.fn(async () => {
        observedContext.resolve(
          __queryCorrelationTestHelpers.resolveQueryCorrelationContext({
            usageReportTaskKey: 'usage_rows',
          })
        )
        return { fresh: true }
      })

      if (cachePath === 'redis stale') {
        __reportCacheInternals.setReadRedisCacheEntryImpl(async () => ({
          status: 'stale',
          entry,
        }))
      } else {
        __reportCacheInternals.setReadRedisCacheEntryImpl(async () => ({
          status: 'unavailable',
        }))
        __reportCacheInternals.setLocalReportCache(identity.cacheKey, entry)
      }

      const result = await __reportCacheInternals.cachedReport(
        'usage-v2',
        load,
        {
          searchParams,
          endpoint: '/api/shell/reports/usage',
          requestId: 'request-from-stale-response',
          decorateMetadata: false,
        }
      )
      const context = await observedContext.promise

      expect(result).toEqual({ stale: true })
      expect(load).toHaveBeenCalledTimes(1)
      expect(context).toMatchObject({
        requestId: __queryCorrelationTestHelpers.buildRequestIdReference(
          'request-from-stale-response'
        ),
        endpoint: '/api/shell/reports/usage',
        cacheScope: 'usage-v2',
        cacheKeyHash: identity.hash,
        refreshKind: expectedRefreshKind,
        dateIdentity: 'from=2026-07-01&to=2026-07-25&grain=day',
        usageTaskKey: 'usage_rows',
      })
      expect(context.refreshKind).not.toBe('foreground')

      await vi.waitFor(() => {
        expect(
          __reportCacheInternals.getReportCacheEntry(identity.cacheKey)?.promise
        ).toBeUndefined()
      })
    }
  )
})

describe('D1-490 real query metric lifecycle', () => {
  test('captures a 57014 timeout with bounded metadata and cleans up active state', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-07-25T01:00:00.000Z')
    vi.setSystemTime(startedAt)
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const {
      queryReportDatabase,
      reportQueryCorrelationStorage,
      reportQueryMetricsSnapshot,
      setExecuteReportQueryTestImpl,
    } = __queryCorrelationTestHelpers
    const timeoutError = Object.assign(
      new Error(
        'canceling statement due to statement timeout\n{"token":"token-value","password":"password-value","secret":"secret-value","apiKey":"api-value","authorization":"Bearer auth-value"}\u0000'
      ),
      { code: '57014' }
    )
    setExecuteReportQueryTestImpl(
      async (_sql, _values, { statementTimeoutMs }) => {
        expect(statementTimeoutMs).toBe(120_000)
        vi.setSystemTime(startedAt.getTime() + 250)
        throw timeoutError
      }
    )

    await expect(
      reportQueryCorrelationStorage.run(foregroundContext, () =>
        queryReportDatabase('SELECT $1::text', ['raw-secret-value'], {
          usageReportTaskKey: 'usage_rows',
        })
      )
    ).rejects.toBe(timeoutError)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot).toMatchObject({
      started: 1,
      completed: 0,
      errors: 1,
      timeouts: 1,
      active: 0,
      lastStartedAt: '2026-07-25T01:00:00.000Z',
      lastErrorAt: '2026-07-25T01:00:00.250Z',
      lastTimeoutAt: '2026-07-25T01:00:00.250Z',
      lastDurationMs: 250,
      maxDurationMs: 250,
      activeQueries: [],
    })
    expect(snapshot.recentErrors).toEqual([])
    expect(snapshot.recentTimeouts).toHaveLength(1)
    expect(snapshot.recentTimeouts[0]).toMatchObject({
      queryId: 1,
      requestId:
        __queryCorrelationTestHelpers.buildRequestIdReference('request-42'),
      label: 'SELECT $1::text',
      endpoint: '/api/shell/reports/usage',
      cacheScope: 'usage-v2',
      cacheKeyHash: 'a'.repeat(64),
      usageTaskKey: 'usage_rows',
      refreshKind: 'foreground',
      dateIdentity: 'from=2026-07-01&to=2026-07-25&grain=day',
      statementTimeoutMs: 120_000,
      startedAt: '2026-07-25T01:00:00.000Z',
      finishedAt: '2026-07-25T01:00:00.250Z',
      durationMs: 250,
      errorCode: '57014',
      errorSummary: 'database statement timeout',
      errorMessage: 'database statement timeout',
    })
    const serialized = JSON.stringify(snapshot.recentTimeouts[0])
    expect(serialized).not.toContain('raw-secret-value')
    expect(serialized).not.toContain('request-42')
    expect(serialized).not.toContain('token-value')
    expect(serialized).not.toContain('password-value')
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain('api-value')
    expect(serialized).not.toContain('auth-value')
    expect(serialized).not.toContain(RANDOM_CREDENTIAL)
  })

  test('identifies a direct query without a task key and cleans up after error', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-07-25T02:00:00.000Z')
    vi.setSystemTime(startedAt)
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const {
      queryReportDatabase,
      reportQueryCorrelationStorage,
      reportQueryMetricsSnapshot,
      setExecuteReportQueryTestImpl,
    } = __queryCorrelationTestHelpers
    const execution = deferred<{ rows: unknown[] }>()
    setExecuteReportQueryTestImpl(() => execution.promise)

    const queryPromise = reportQueryCorrelationStorage.run(
      {
        ...foregroundContext,
        requestId: 'active-request',
      },
      () =>
        queryReportDatabase(
          'SELECT count(*) FROM usage_events WHERE occurred_at >= $1',
          ['never-exposed'],
          {
            statementTimeoutMs: 15_000,
          }
        )
    )

    expect(reportQueryMetricsSnapshot()).toMatchObject({
      active: 1,
      activeQueries: [
        {
          id: 1,
          requestId:
            __queryCorrelationTestHelpers.buildRequestIdReference(
              'active-request'
            ),
          endpoint: '/api/shell/reports/usage',
          cacheScope: 'usage-v2',
          usageTaskKey: null,
          refreshKind: 'foreground',
          statementTimeoutMs: 15_000,
          label: 'SELECT count(*) FROM usage_events WHERE occurred_at >= $1',
        },
      ],
    })

    const databaseError = Object.assign(new Error('connection reset\u0000'), {
      code: 'ECONNRESET\r\n',
    })
    const rejection = expect(queryPromise).rejects.toBe(databaseError)
    vi.setSystemTime(startedAt.getTime() + 75)
    execution.reject(databaseError)
    await rejection

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.active).toBe(0)
    expect(snapshot.activeQueries).toEqual([])
    expect(snapshot.recentTimeouts).toEqual([])
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      queryId: 1,
      usageTaskKey: null,
      label: 'SELECT count(*) FROM usage_events WHERE occurred_at >= $1',
      statementTimeoutMs: 15_000,
      durationMs: 75,
      errorCode: 'ECONNRESET',
      errorSummary: 'report query failure (ECONNRESET)',
      errorMessage: 'report query failure (ECONNRESET)',
    })
    expect(JSON.stringify(snapshot.recentErrors[0])).not.toContain(
      'never-exposed'
    )
  })

  test('evicts timeout records beyond 20 through the real catch/finally path', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-25T03:00:00.000Z')
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const {
      queryReportDatabase,
      reportQueryCorrelationStorage,
      reportQueryMetricsSnapshot,
      setExecuteReportQueryTestImpl,
      QUERY_CORRELATION_MAX_RECENT,
    } = __queryCorrelationTestHelpers
    let attempt = 0
    setExecuteReportQueryTestImpl(async () => {
      attempt += 1
      vi.setSystemTime(Date.now() + 1)
      throw Object.assign(new Error(`statement timeout ${attempt}`), {
        code: '57014',
      })
    })

    for (let index = 0; index < 25; index += 1) {
      await expect(
        reportQueryCorrelationStorage.run(foregroundContext, () =>
          queryReportDatabase('SELECT 1', [], {
            usageReportTaskKey: 'trend',
          })
        )
      ).rejects.toThrow('statement timeout')
    }

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentTimeouts).toHaveLength(QUERY_CORRELATION_MAX_RECENT)
    expect(snapshot.recentTimeouts[0].queryId).toBe(6)
    expect(snapshot.recentTimeouts[19].queryId).toBe(25)
    expect(snapshot.active).toBe(0)
    expect(snapshot.timeouts).toBe(25)
  })

  test('rejects and ignores the test executor outside test runtime', async () => {
    const { __queryCorrelationTestHelpers } = await loadReportService()
    const { queryReportDatabase, setExecuteReportQueryTestImpl } =
      __queryCorrelationTestHelpers
    const executor = vi.fn(async () => ({ rows: [] }))
    setExecuteReportQueryTestImpl(executor)

    vi.stubEnv('VITEST', 'false')
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => setExecuteReportQueryTestImpl(executor)).toThrow(
      'Report query test executor is only available in test runtime.'
    )
    await expect(queryReportDatabase('SELECT 1', [])).rejects.toThrow(
      'DATABASE_URL is not configured for the shell report service.'
    )
    expect(executor).not.toHaveBeenCalled()
  })
})

describe('D1-490 health and background failure reporting', () => {
  test('publishes compatibility counters and recent timeout/error arrays in health', async () => {
    const mod = await loadReportService()
    const {
      queryReportDatabase,
      reportQueryCorrelationStorage,
      setExecuteReportQueryTestImpl,
    } = mod.__queryCorrelationTestHelpers
    const errors = [
      Object.assign(new Error('statement timeout'), { code: '57014' }),
      Object.assign(new Error(`upstream exploded ${RANDOM_CREDENTIAL}`), {
        code: 'ECONNRESET',
      }),
      new TypeError('fetch failed'),
    ]
    setExecuteReportQueryTestImpl(async () => {
      throw errors.shift()
    })

    for (const usageTaskKey of ['usage_rows', 'summary', 'fetch_task']) {
      await expect(
        reportQueryCorrelationStorage.run(foregroundContext, () =>
          queryReportDatabase('SELECT 1', [], {
            usageReportTaskKey: usageTaskKey,
          })
        )
      ).rejects.toThrow()
    }

    const payload = await mod.buildShellHealthPayload()
    const reportQueryPressure = requireRecord(
      payload.reportQueryPressure,
      'reportQueryPressure'
    )
    const inProcess = requireRecord(
      reportQueryPressure.inProcess,
      'reportQueryPressure.inProcess'
    )
    expect(inProcess).toMatchObject({
      started: 3,
      completed: 0,
      errors: 3,
      timeouts: 1,
      active: 0,
      lastErrorAt: expect.any(String),
      lastErrorMessage: 'fetch failed',
      lastTimeoutAt: expect.any(String),
      lastDurationMs: expect.any(Number),
      maxDurationMs: expect.any(Number),
      activeQueries: [],
      recentTimeouts: [
        expect.objectContaining({
          errorCode: '57014',
          usageTaskKey: 'usage_rows',
        }),
      ],
      recentErrors: [
        expect.objectContaining({
          errorCode: 'ECONNRESET',
          usageTaskKey: 'summary',
          errorSummary: 'report query failure (ECONNRESET)',
        }),
        expect.objectContaining({
          errorCode: null,
          usageTaskKey: 'fetch_task',
          errorSummary: 'fetch failed',
        }),
      ],
    })
    expect(JSON.stringify(inProcess)).not.toContain('request-42')
    expect(JSON.stringify(inProcess)).not.toContain(RANDOM_CREDENTIAL)
  })

  test('redacts and bounds foreground cache refresh logging', async () => {
    const mod = await loadReportService()
    const {
      __reportCacheInternals,
      buildReportCacheIdentity,
      REPORT_CACHE_VERSION,
    } = mod
    const searchParams = new URLSearchParams({
      from: '2026-07-01',
      to: '2026-07-25',
      grain: 'day',
    })
    const identity = buildReportCacheIdentity('usage-v2', searchParams)
    __reportCacheInternals.setReadRedisCacheEntryImpl(async () => ({
      status: 'stale',
      entry: staleEntry(REPORT_CACHE_VERSION, { stale: true }),
    }))
    const originalError = new Error(sensitiveErrorMessage())
    const load = vi
      .fn()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce({ fresh: true })
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    const result = await __reportCacheInternals.cachedReport('usage-v2', load, {
      searchParams,
      endpoint: '/api/shell/reports/usage',
      requestId: 'foreground-request',
      refreshStaleInForeground: true,
      decorateMetadata: false,
    })

    expect(result).toEqual({ stale: true })
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2)
      expect(
        __reportCacheInternals.getReportCacheEntry(identity.cacheKey)?.promise
      ).toBeUndefined()
    })
    const log = stderrSpy.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('foreground cache refresh failed'))

    expect(log).toBeDefined()
    for (const secret of [
      'bearer-secret',
      'db-user',
      'db-password',
      'plain-token',
      'plain-password',
      'plain-secret',
      'plain-api-key',
      'plain-authorization',
      'json-token',
      'json-password',
      'json-secret',
      'json-api-key',
      'json-authorization',
      RANDOM_CREDENTIAL,
    ]) {
      expect(log).not.toContain(secret)
    }
    expect(log).toContain('report query failure')
    expect(log?.length).toBeLessThanOrEqual(400)
    expect(originalError.message).toContain('bearer-secret')
  })

  test('logs a query label when a background direct query has no task key', async () => {
    const mod = await loadReportService()
    const {
      __reportCacheInternals,
      __queryCorrelationTestHelpers,
      buildReportCacheIdentity,
      REPORT_CACHE_VERSION,
    } = mod
    const searchParams = new URLSearchParams({
      from: '2026-07-01',
      to: '2026-07-25',
      grain: 'day',
    })
    const identity = buildReportCacheIdentity('usage-v2', searchParams)
    __reportCacheInternals.setLocalReportCache(
      identity.cacheKey,
      staleEntry(REPORT_CACHE_VERSION, { stale: true })
    )
    __reportCacheInternals.setReadRedisCacheEntryImpl(async () => ({
      status: 'unavailable',
    }))
    __queryCorrelationTestHelpers.setExecuteReportQueryTestImpl(async () => {
      throw Object.assign(new Error(`upstream exploded ${RANDOM_CREDENTIAL}`), {
        code: 'EUPSTREAM',
      })
    })
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    const result = await __reportCacheInternals.cachedReport(
      'usage-v2',
      () =>
        __queryCorrelationTestHelpers.queryReportDatabase(
          'SELECT count(*) FROM usage_events WHERE occurred_at >= $1',
          ['not-logged'],
          {}
        ),
      {
        searchParams,
        endpoint: '/api/shell/reports/usage',
        requestId: 'background-request',
        decorateMetadata: false,
      }
    )

    expect(result).toEqual({ stale: true })
    await vi.waitFor(() => {
      expect(
        stderrSpy.mock.calls.some(([message]) =>
          String(message).includes('cache refresh failed')
        )
      ).toBe(true)
    })
    const log = stderrSpy.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('cache refresh failed'))

    expect(log).toContain(`for usage-v2:${identity.hash}`)
    expect(log).toContain('refreshKind=local')
    expect(log).toContain('queryId=1')
    expect(log).toContain('usageTaskKey=none')
    expect(log).toContain(
      'queryLabel="SELECT count(*) FROM usage_events WHERE occurred_at >= $1"'
    )
    expect(log).toContain('endpoint=/api/shell/reports/usage')
    expect(log).toContain(
      'dateIdentity=from=2026-07-01&to=2026-07-25&grain=day'
    )
    expect(log).toContain('report query failure (EUPSTREAM)')
    expect(log).not.toContain('not-logged')
    expect(log).not.toContain(RANDOM_CREDENTIAL)
    expect(log?.length).toBeLessThanOrEqual(500)
  })
})

describe('D1-490 request-level unhandled error correlation', () => {
  test('correlates TypeError(fetch failed) into recentErrors through respondWithGenericServerError', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-25T04:15:00.000Z')
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const {
      recentQueryErrors,
      resetQueryCorrelationForTests,
      buildRequestIdReference,
      reportQueryMetricsSnapshot,
    } = mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const rawRequestId = 'req-live-fetch-failed-42'
    const expectedRequestId = buildRequestIdReference(rawRequestId)
    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25&grain=day&password=super-secret&authorization=Bearer%20private-token&unknown=cache-bust-xyz',
      headers: {
        host: 'localhost',
        'x-request-id': rawRequestId,
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const error = new TypeError('fetch failed')

    await respondWithGenericServerError(req, res, error)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      queryId: null,
      label: null,
      requestId: expectedRequestId,
      endpoint: '/api/shell/reports/usage',
      cacheScope: null,
      cacheKeyHash: null,
      refreshKind: null,
      dateIdentity: 'from=2026-07-01&to=2026-07-25&grain=day',
      usageTaskKey: null,
      statementTimeoutMs: null,
      startedAt: null,
      finishedAt: '2026-07-25T04:15:00.000Z',
      durationMs: null,
      errorCode: null,
      errorSummary: 'fetch failed',
      errorMessage: 'fetch failed',
    })
    const serialized = JSON.stringify(snapshot.recentErrors[0])
    expect(serialized).not.toContain(rawRequestId)
    expect(serialized).not.toContain('super-secret')
    expect(serialized).not.toContain('private-token')
    expect(serialized).not.toContain('cache-bust-xyz')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('authorization')
    expect(serialized).not.toContain('unknown')

    const log = String(stderrSpy.mock.calls[0]?.[0])
    expect(log).toContain(`requestId=${expectedRequestId}`)
    expect(log).toContain('endpoint=/api/shell/reports/usage')
    expect(log).toContain('fetch failed')
    expect(log).not.toContain(rawRequestId)
    expect(log).not.toContain('super-secret')
    expect(log).not.toContain('private-token')
    expect(log).not.toContain('cache-bust-xyz')
    expect(log).not.toContain('password=')
    expect(log).not.toContain('authorization=')
    expect(
      (error as TypeError & { reportRequestFailure?: unknown })
        .reportRequestFailure
    ).toBeDefined()
    expect(recentQueryErrors).toHaveLength(1)
  })

  test('does not duplicate a request failure record on repeated handling', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const { resetQueryCorrelationForTests, reportQueryMetricsSnapshot } =
      mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
      headers: {
        host: 'localhost',
        'x-request-id': 'repeat-request-id',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const error = new TypeError('fetch failed')

    await respondWithGenericServerError(req, res, error)
    await respondWithGenericServerError(req, res, error)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      errorSummary: 'fetch failed',
    })
    expect(
      (error as TypeError & { reportRequestFailure?: unknown })
        .reportRequestFailure
    ).toBe(snapshot.recentErrors[0])
    expect(stderrSpy).toHaveBeenCalledTimes(2)
  })

  test('dedupes frozen TypeError(fetch failed) via side-table and still logs twice', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const { resetQueryCorrelationForTests, reportQueryMetricsSnapshot } =
      mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
      headers: {
        host: 'localhost',
        'x-request-id': 'frozen-fetch-failed',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const error = Object.freeze(new TypeError('fetch failed'))

    await respondWithGenericServerError(req, res, error)
    await respondWithGenericServerError(req, res, error)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      errorSummary: 'fetch failed',
    })
    expect(
      Object.prototype.hasOwnProperty.call(error, 'reportRequestFailure')
    ).toBe(false)
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    for (const call of stderrSpy.mock.calls) {
      const log = String(call[0])
      expect(log).toContain('fetch failed')
      expect(log).not.toContain('frozen-fetch-failed')
    }
  })

  test('dedupes non-extensible object errors via side-table', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const { resetQueryCorrelationForTests, reportQueryMetricsSnapshot } =
      mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
      headers: {
        host: 'localhost',
        'x-request-id': 'non-extensible-error',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const error = Object.preventExtensions(
      Object.assign(new Error('connection dropped'), { code: 'ECONNRESET' })
    )

    await respondWithGenericServerError(req, res, error)
    await respondWithGenericServerError(req, res, error)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      errorCode: 'ECONNRESET',
      errorSummary: 'request failure (ECONNRESET)',
    })
    expect(stderrSpy).toHaveBeenCalledTimes(2)
  })

  test('dedupes primitive string and null throws per request without retaining raw text', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const { resetQueryCorrelationForTests, reportQueryMetricsSnapshot } =
      mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
      headers: {
        host: 'localhost',
        'x-request-id': 'primitive-throw-req',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const secretPrimitive = 'raw-primitive-secret-token-9f3a1c'

    await respondWithGenericServerError(req, res, secretPrimitive)
    await respondWithGenericServerError(req, res, secretPrimitive)
    await respondWithGenericServerError(req, res, null)
    await respondWithGenericServerError(req, res, null)

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(2)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      errorSummary: 'request failure',
      errorMessage: 'request failure',
      errorCode: null,
    })
    expect(snapshot.recentErrors[1]).toMatchObject({
      failureKind: 'request',
      errorSummary: 'request failure',
      errorMessage: 'request failure',
      errorCode: null,
    })

    const serialized = JSON.stringify(snapshot.recentErrors)
    expect(serialized).not.toContain(secretPrimitive)
    expect(serialized).not.toContain('primitive-throw-req')
    // Records must stay generic; do not leak primitive type labels as summaries.
    expect(serialized).not.toContain('"errorSummary":"null"')
    expect(serialized).not.toContain('"errorMessage":"null"')

    expect(stderrSpy).toHaveBeenCalledTimes(4)
    for (const call of stderrSpy.mock.calls) {
      const log = String(call[0])
      expect(log).toContain('request failure')
      expect(log).not.toContain(secretPrimitive)
      expect(log).not.toContain('primitive-throw-req')
    }
  })

  test('malformed req.url/host yield null endpoint/dateIdentity without secondary throw', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const { resetQueryCorrelationForTests, reportQueryMetricsSnapshot } =
      mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const error = new TypeError('fetch failed')

    await expect(
      respondWithGenericServerError(
        {
          url: 'http://[::1',
          headers: {
            host: 'bad host with spaces',
            'x-request-id': 'malformed-url-host',
          },
        },
        res,
        error
      )
    ).resolves.toBeUndefined()

    const snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      endpoint: null,
      dateIdentity: null,
      errorSummary: 'fetch failed',
    })
    expect(snapshot.recentErrors[0]?.requestId).toMatch(/^req:[0-9a-f]{24}$/)

    const log = String(stderrSpy.mock.calls[0]?.[0])
    expect(log).toContain('endpoint=none')
    expect(log).toContain('fetch failed')
    expect(log).not.toContain('malformed-url-host')
  })

  test('x-request-id array hashes first string and ignores leading non-string', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const {
      resetQueryCorrelationForTests,
      reportQueryMetricsSnapshot,
      buildRequestIdReference,
    } = mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }
    const rawRequestId = 'array-request-id-first-string'
    const expectedRequestId = buildRequestIdReference(rawRequestId)

    await respondWithGenericServerError(
      {
        url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
        headers: {
          host: 'localhost',
          'x-request-id': [rawRequestId, 'second-id'],
        },
      },
      res,
      new TypeError('fetch failed')
    )

    let snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      requestId: expectedRequestId,
    })
    expect(JSON.stringify(snapshot.recentErrors[0])).not.toContain(rawRequestId)

    resetQueryCorrelationForTests()
    stderrSpy.mockClear()

    await respondWithGenericServerError(
      {
        url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25',
        headers: {
          host: 'localhost',
          'x-request-id': [42 as unknown as string, rawRequestId],
        },
      },
      res,
      new TypeError('fetch failed')
    )

    snapshot = reportQueryMetricsSnapshot()
    expect(snapshot.recentErrors).toHaveLength(1)
    expect(snapshot.recentErrors[0]).toMatchObject({
      failureKind: 'request',
      requestId: null,
    })
    const log = String(stderrSpy.mock.calls[0]?.[0])
    expect(log).toContain('requestId=none')
    expect(log).not.toContain(rawRequestId)
  })

  test('reuses an attached query failure instead of creating a request failure', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const {
      resetQueryCorrelationForTests,
      reportQueryMetricsSnapshot,
      queryReportDatabase,
      reportQueryCorrelationStorage,
      setExecuteReportQueryTestImpl,
      buildRequestIdReference,
    } = mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const queryError = Object.assign(new Error('connection reset'), {
      code: 'ECONNRESET',
    })
    setExecuteReportQueryTestImpl(async () => {
      throw queryError
    })

    await expect(
      reportQueryCorrelationStorage.run(foregroundContext, () =>
        queryReportDatabase('SELECT 1', [], {
          usageReportTaskKey: 'usage_rows',
        })
      )
    ).rejects.toBe(queryError)

    expect(
      (queryError as Error & { reportQueryFailure?: unknown })
        .reportQueryFailure
    ).toMatchObject({
      failureKind: 'query',
      queryId: 1,
      errorCode: 'ECONNRESET',
    })

    const before = reportQueryMetricsSnapshot().recentErrors
    expect(before).toHaveLength(1)

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25&password=should-not-appear',
      headers: {
        host: 'localhost',
        'x-request-id': 'query-already-attached',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }

    await respondWithGenericServerError(req, res, queryError)

    const after = reportQueryMetricsSnapshot().recentErrors
    expect(after).toHaveLength(1)
    expect(after[0]).toBe(before[0])
    expect(after[0]).toMatchObject({
      failureKind: 'query',
      queryId: 1,
      errorCode: 'ECONNRESET',
    })
    expect(
      (queryError as Error & { reportRequestFailure?: unknown })
        .reportRequestFailure
    ).toBeUndefined()

    const logCalls = stderrSpy.mock.calls
    const log = String(logCalls[logCalls.length - 1]?.[0])
    expect(log).toContain(`requestId=${buildRequestIdReference('request-42')}`)
    expect(log).toContain('endpoint=/api/shell/reports/usage')
    expect(log).toContain('code=ECONNRESET')
    expect(log).toContain('report query failure (ECONNRESET)')
    expect(log).not.toContain('query-already-attached')
    expect(log).not.toContain('should-not-appear')
    expect(log).not.toContain('request-42')
  })

  test('reuses frozen/non-extensible query failures via object-identity side-table', async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const mod = await loadReportService()
    const {
      resetQueryCorrelationForTests,
      reportQueryMetricsSnapshot,
      queryReportDatabase,
      reportQueryCorrelationStorage,
      setExecuteReportQueryTestImpl,
      buildRequestIdReference,
    } = mod.__queryCorrelationTestHelpers
    const { respondWithGenericServerError } = mod.__serverRuntimeTestHelpers
    resetQueryCorrelationForTests()

    const queryError = Object.freeze(
      Object.assign(new Error('connection reset'), {
        code: 'ECONNRESET',
      })
    )
    setExecuteReportQueryTestImpl(async () => {
      throw queryError
    })

    await expect(
      reportQueryCorrelationStorage.run(foregroundContext, () =>
        queryReportDatabase('SELECT 1', [], {
          usageReportTaskKey: 'usage_rows',
        })
      )
    ).rejects.toBe(queryError)

    expect(
      Object.prototype.hasOwnProperty.call(queryError, 'reportQueryFailure')
    ).toBe(false)

    const before = reportQueryMetricsSnapshot().recentErrors
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({
      failureKind: 'query',
      queryId: 1,
      errorCode: 'ECONNRESET',
      usageTaskKey: 'usage_rows',
    })

    const req = {
      url: '/api/shell/reports/usage?from=2026-07-01&to=2026-07-25&password=should-not-appear',
      headers: {
        host: 'localhost',
        'x-request-id': 'frozen-query-already-recorded',
      },
    }
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      end: vi.fn(),
    }

    await respondWithGenericServerError(req, res, queryError)
    await respondWithGenericServerError(req, res, queryError)

    const after = reportQueryMetricsSnapshot().recentErrors
    expect(after).toHaveLength(1)
    expect(after[0]).toBe(before[0])
    expect(after[0]).toMatchObject({
      failureKind: 'query',
      queryId: 1,
      errorCode: 'ECONNRESET',
      usageTaskKey: 'usage_rows',
    })
    expect(
      Object.prototype.hasOwnProperty.call(queryError, 'reportRequestFailure')
    ).toBe(false)

    expect(stderrSpy).toHaveBeenCalledTimes(2)
    for (const call of stderrSpy.mock.calls) {
      const log = String(call[0])
      expect(log).toContain(
        `requestId=${buildRequestIdReference('request-42')}`
      )
      expect(log).toContain('endpoint=/api/shell/reports/usage')
      expect(log).toContain('code=ECONNRESET')
      expect(log).toContain('report query failure (ECONNRESET)')
      expect(log).not.toContain('frozen-query-already-recorded')
      expect(log).not.toContain('should-not-appear')
      expect(log).not.toContain('request-42')
    }
  })
})
