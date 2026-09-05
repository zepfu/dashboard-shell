import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.doUnmock('redis')
  vi.doUnmock('pg')
  vi.unstubAllEnvs()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('D1-444 /api/shell/health parallel health checks', () => {
  test('buildShellHealthPayload starts all four loaders before any resolves', async () => {
    vi.stubEnv('VITEST', 'true')
    delete process.env.DATABASE_URL

    const { buildShellHealthPayload } = await import('./report-service.mjs')

    const started: string[] = []
    const gates = {
      reportQueryPressure: deferred<Record<string, unknown>>(),
      pgBouncer: deferred<Record<string, unknown>>(),
      sourceTables: deferred<Record<string, unknown>>(),
      materializedViews: deferred<Record<string, unknown>>(),
    }

    const buildPayload = buildShellHealthPayload({
      loaders: {
        loadReportQueryPressure: async () => {
          started.push('reportQueryPressure')
          return gates.reportQueryPressure.promise
        },
        loadPgBouncerHealth: async () => {
          started.push('pgBouncer')
          return gates.pgBouncer.promise
        },
        loadSourceTableHealth: async () => {
          started.push('sourceTables')
          return gates.sourceTables.promise
        },
        loadMaterializedViewHealth: async () => {
          started.push('materializedViews')
          return gates.materializedViews.promise
        },
      },
    })

    const payloadPromise = buildPayload

    await vi.waitFor(() => {
      expect(started).toEqual([
        'reportQueryPressure',
        'pgBouncer',
        'sourceTables',
        'materializedViews',
      ])
    })

    gates.reportQueryPressure.resolve({
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      inProcess: { active: 0 },
      pgStatActivity: {
        connectionCount: 0,
        activeCount: 0,
        waitingCount: 0,
        maxActiveAgeMs: null,
        rows: [],
      },
    })
    gates.pgBouncer.resolve({ status: 'green', sidecars: [] })
    gates.sourceTables.resolve({
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      tables: [],
    })
    gates.materializedViews.resolve({
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      views: [],
      cronJobs: [],
    })

    const payload = await payloadPromise

    expect(payload).toMatchObject({
      ok: true,
      databaseConfigured: false,
      databaseEndpoint: null,
      databasePool: null,
      healthDatabasePool: null,
      redisPackageAvailable: true,
      redisConfigured: false,
      redisReady: false,
      redisStatus: 'unconfigured',
      reportQueryPressure: expect.objectContaining({ status: 'unconfigured' }),
      pgBouncerSidecars: { status: 'green', sidecars: [] },
      sourceTables: expect.objectContaining({ status: 'unconfigured' }),
      materializedViews: expect.objectContaining({ status: 'unconfigured' }),
    })
    expect(Object.keys(payload).sort()).toEqual(
      [
        'databaseConfigured',
        'databaseEndpoint',
        'databasePool',
        'healthDatabasePool',
        'materializedViews',
        'redisPackageAvailable',
        'ok',
        'pgBouncerSidecars',
        'redisStatus',
        'redisConfigured',
        'redisReady',
        'reportQueryPressure',
        'sourceTables',
      ].sort()
    )
  })

  test('buildShellHealthPayload preserves stable top-level keys with default loaders when unconfigured', async () => {
    vi.stubEnv('VITEST', 'true')
    delete process.env.DATABASE_URL

    const { buildShellHealthPayload } = await import('./report-service.mjs')
    const payload = await buildShellHealthPayload()

    expect(payload.ok).toBe(true)
    expect(payload).toHaveProperty('databaseConfigured')
    expect(payload).toHaveProperty('databaseEndpoint')
    expect(payload).toHaveProperty('databasePool')
    expect(payload).toHaveProperty('healthDatabasePool')
    expect(payload).toHaveProperty('redisPackageAvailable')
    expect(payload).toHaveProperty('redisConfigured')
    expect(payload).toHaveProperty('redisReady')
    expect(payload).toHaveProperty('redisStatus')
    expect(payload).toHaveProperty('reportQueryPressure')
    expect(payload).toHaveProperty('pgBouncerSidecars')
    expect(payload).toHaveProperty('sourceTables')
    expect(payload).toHaveProperty('materializedViews')

    expect(payload.reportQueryPressure).toMatchObject({
      status: 'unconfigured',
      pgStatActivity: expect.any(Object),
      inProcess: expect.any(Object),
    })
    expect(payload.pgBouncerSidecars).toMatchObject({
      status: expect.any(String),
      sidecars: expect.any(Array),
    })
    expect(payload.sourceTables).toMatchObject({
      status: 'unconfigured',
      tables: expect.any(Array),
    })
    expect(payload.materializedViews).toMatchObject({
      status: 'unconfigured',
      views: expect.any(Array),
      cronJobs: expect.any(Array),
    })
  })

  test('buildShellHealthPayload exposes redis package missing-state fallback on import', async () => {
    vi.stubEnv('VITEST', 'true')
    delete process.env.DATABASE_URL
    vi.resetModules()
    const warnSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    vi.doMock('redis', () => ({}))

    const { buildShellHealthPayload } = await import('./report-service.mjs')
    const payload = await buildShellHealthPayload()

    expect(payload).toMatchObject({
      redisPackageAvailable: false,
      redisConfigured: false,
      redisReady: false,
      redisStatus: 'missing-package',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[report-service] WARN: Redis package is unavailable; report-service is falling back to local/SQL cache:'
      )
    )
    warnSpy.mockRestore()
  })
})

describe('D1-489 materialized view health degradation', () => {
  test('keeps sibling views observable and splits cron catalog routing', async () => {
    vi.stubEnv('VITEST', 'true')

    const { __shellHealthTestHelpers } = await import('./report-service.mjs')
    const loadMaterializedViewHealthFromDatabase = Reflect.get(
      __shellHealthTestHelpers,
      'loadMaterializedViewHealthFromDatabase'
    ) as (
      queryDatabase: (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: Array<Record<string, unknown>> }>,
      queryCronDatabase?: (
        sql: string,
        values?: unknown[]
      ) => Promise<{ rows: Array<Record<string, unknown>> }>
    ) => Promise<Record<string, unknown>>

    const appCalls: string[] = []
    const cronCalls: string[] = []
    const queryDatabase = vi.fn(
      async (
        sql: string
      ): Promise<{ rows: Array<Record<string, unknown>> }> => {
        appCalls.push(sql)
        if (sql.includes('to_regclass(relation_name)')) {
          return {
            rows: [
              {
                view_name: 'rate_limit_intervals',
                resolved_relation_name: null,
              },
              {
                view_name: 'provider_latency_health_5m',
                resolved_relation_name: 'public.provider_latency_health_5m',
              },
            ],
          }
        }
        if (sql.includes('MAX(bucket_start)')) {
          return {
            rows: [
              {
                latest_data_at: new Date().toISOString(),
                row_count: '12',
              },
            ],
          }
        }
        if (sql.includes('FROM pg_stat_activity')) return { rows: [] }
        throw new Error(`unexpected health query: ${sql}`)
      }
    )
    const queryCronDatabase = vi.fn(
      async (
        sql: string
      ): Promise<{ rows: Array<Record<string, unknown>> }> => {
        cronCalls.push(sql)
        if (sql.includes('FROM cron.job')) return { rows: [] }
        throw new Error(`unexpected cron health query: ${sql}`)
      }
    )

    const report = await loadMaterializedViewHealthFromDatabase(
      queryDatabase,
      queryCronDatabase
    )
    const views = report.views as Array<Record<string, unknown>>

    expect(report.status).toBe('unknown')
    expect(views).toEqual([
      expect.objectContaining({
        viewName: 'rate_limit_intervals',
        category: 'quota',
        status: 'unknown',
        present: false,
        latestDataAt: null,
        rowCount: null,
      }),
      expect.objectContaining({
        viewName: 'provider_latency_health_5m',
        category: 'provider_health',
        status: 'ok',
        present: true,
        rowCount: 12,
      }),
    ])
    expect(appCalls[0]).toContain('to_regclass(relation_name)')
    expect(appCalls[0]).not.toContain('::regclass')
    expect(appCalls.some((sql) => sql.includes('MAX(fromdate)'))).toBe(false)
    expect(appCalls.some((sql) => sql.includes('FROM pg_stat_activity'))).toBe(
      true
    )
    expect(appCalls.some((sql) => sql.includes('FROM cron.job'))).toBe(false)
    expect(cronCalls).toHaveLength(1)
    expect(cronCalls[0]).toContain('FROM cron.job')
    expect(cronCalls[0]).toContain('FROM cron.job_run_details')
  })
})

describe('D1-489 PgBouncer admin direct client and weighted stats', () => {
  test('opens and closes one direct Client per admin summary call', async () => {
    vi.stubEnv('VITEST', 'true')

    const connect = vi.fn(async () => undefined)
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SHOW POOLS;') return { rows: [] }
      if (sql === 'SHOW STATS;') return { rows: [] }
      if (sql === 'SHOW SERVERS;') return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const on = vi.fn()
    const end = vi.fn(async () => {})
    const Client = vi.fn(function Client(
      this: {
        connect: typeof connect
        query: typeof query
        on: typeof on
        end: typeof end
      },
      _options: unknown
    ) {
      this.connect = connect
      this.query = query
      this.on = on
      this.end = end
    })
    const Pool = vi.fn()

    vi.doMock('pg', () => ({ default: { Client, Pool }, Client, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const { loadPgBouncerAdminSummaryForTests } = __pgBouncerAdminTestHelpers

    const sidecar = {
      key: 'aawm-pgbouncer',
      adminDatabaseUrl:
        'postgresql://admin:secret@pgbouncer-aawm-dev:6432/pgbouncer',
    }

    await loadPgBouncerAdminSummaryForTests(sidecar)
    await loadPgBouncerAdminSummaryForTests(sidecar)

    expect(Client).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(2)
    expect(Pool).not.toHaveBeenCalled()
    expect(Client).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionString: sidecar.adminDatabaseUrl,
        application_name: 'dashboard-shell-pgbouncer-health',
        connectionTimeoutMillis: 2_000,
        query_timeout: 2_000,
      })
    )
  })

  test('weights aggregate averages by the matching PgBouncer traffic totals', async () => {
    vi.stubEnv('VITEST', 'true')

    const statsRows = [
      {
        database: 'busy',
        total_xact_count: '100',
        total_query_count: '200',
        total_server_assignment_count: '10',
        avg_xact_count: '10',
        avg_query_count: '20',
        avg_wait_time: '4',
      },
      {
        database: 'idle',
        total_xact_count: '1',
        total_query_count: '2',
        avg_xact_count: '100',
        avg_query_count: '200',
        avg_wait_time: '100',
      },
    ]
    const query = vi.fn(async (sql: string) => {
      if (sql === 'SHOW POOLS;') return { rows: [] }
      if (sql === 'SHOW STATS;') return { rows: statsRows }
      if (sql === 'SHOW SERVERS;') return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const Client = vi.fn(function Client(
      this: {
        connect: () => Promise<void>
        query: typeof query
        on: () => void
        end: () => Promise<void>
      },
      _options: unknown
    ) {
      this.connect = async () => undefined
      this.query = query
      this.on = () => undefined
      this.end = async () => undefined
    })
    const Pool = vi.fn()
    vi.doMock('pg', () => ({ default: { Client, Pool }, Client, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const { loadPgBouncerAdminSummaryForTests } = __pgBouncerAdminTestHelpers
    const summary = (await loadPgBouncerAdminSummaryForTests({
      key: 'aawm-pgbouncer',
      adminDatabaseUrl:
        'postgresql://admin:secret@pgbouncer-aawm-dev:6432/pgbouncer',
    })) as {
      statsSummary: Record<string, number>
    }

    expect(summary.statsSummary).toMatchObject({
      totalXactCount: 101,
      totalQueryCount: 202,
      avgXactCount: 11,
      avgQueryCount: 22,
      avgWaitTime: 13,
    })
    expect(Pool).not.toHaveBeenCalled()
  })

  test('preserves missing admin DSN behavior without creating a Client', async () => {
    vi.stubEnv('VITEST', 'true')

    const Client = vi.fn()
    const Pool = vi.fn()
    vi.doMock('pg', () => ({ default: { Client, Pool }, Client, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const { loadPgBouncerAdminSummaryForTests } = __pgBouncerAdminTestHelpers

    const summary = await loadPgBouncerAdminSummaryForTests({
      key: 'aawm-pgbouncer',
      adminDatabaseUrl: undefined,
    })

    expect(summary).toMatchObject({
      configured: false,
      status: 'unconfigured',
      error: 'PgBouncer admin database URL is not configured.',
    })
    expect(Client).not.toHaveBeenCalled()
    expect(Pool).not.toHaveBeenCalled()
  })
})

describe('D1-496 health reports sql fanout concurrency', () => {
  test('databasePool includes sqlFanoutConcurrency matching default 4', async () => {
    vi.stubEnv('VITEST', 'true')
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://user:pass@127.0.0.1:1/dashboard_shell_test'
    )
    delete process.env.SHELL_REPORT_SQL_FANOUT_CONCURRENCY
    delete process.env.SHELL_REPORT_DB_POOL_MAX

    class Pool {
      totalCount = 0
      idleCount = 0
      waitingCount = 0
      on = vi.fn()
      end = vi.fn(async () => undefined)
    }
    vi.doMock('pg', () => ({ default: { Pool }, Pool }))
    vi.doMock('redis', () => ({
      createClient: vi.fn(() => ({
        isReady: false,
        connect: vi.fn(async () => undefined),
        quit: vi.fn(async () => undefined),
        on: vi.fn(),
      })),
    }))

    const { buildShellHealthPayload } = await import('./report-service.mjs')
    const payload = await buildShellHealthPayload({
      loaders: {
        loadReportQueryPressure: async () => ({
          status: 'unconfigured',
          inProcess: { active: 0 },
          pgStatActivity: {
            connectionCount: 0,
            activeCount: 0,
            waitingCount: 0,
            maxActiveAgeMs: null,
            rows: [],
          },
        }),
        loadPgBouncerHealth: async () => ({ status: 'green', sidecars: [] }),
        loadSourceTableHealth: async () => ({
          status: 'unconfigured',
          tables: [],
        }),
        loadMaterializedViewHealth: async () => ({
          status: 'unconfigured',
          views: [],
          cronJobs: [],
        }),
      },
    })

    expect(payload.databaseConfigured).toBe(true)
    expect(payload.databasePool).toMatchObject({
      max: 4,
      total: 0,
      idle: 0,
      waiting: 0,
      sqlFanoutConcurrency: 4,
    })
    expect(payload.healthDatabasePool).toMatchObject({ max: 1 })
  })
})
