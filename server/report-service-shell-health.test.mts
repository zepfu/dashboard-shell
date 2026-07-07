import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.doUnmock('redis')
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

describe('D1-444 PgBouncer admin pool cache', () => {
  test('reuses one Pool per sidecar/admin URL across repeated admin summary calls', async () => {
    vi.stubEnv('VITEST', 'true')

    const connect = vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        if (sql === 'SHOW POOLS;') return { rows: [] }
        if (sql === 'SHOW STATS;') return { rows: [] }
        if (sql === 'SHOW SERVERS;') return { rows: [] }
        throw new Error(`unexpected query: ${sql}`)
      }),
      release: vi.fn(),
    }))
    const on = vi.fn()
    const end = vi.fn(async () => {})
    const Pool = vi.fn(function Pool(
      this: { connect: typeof connect; on: typeof on; end: typeof end },
      _opts: unknown
    ) {
      this.connect = connect
      this.on = on
      this.end = end
    })

    vi.doMock('pg', () => ({ default: { Pool }, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const {
      cleanupPgBouncerAdminPools,
      getPgBouncerAdminPoolCacheSize,
      loadPgBouncerAdminSummaryForTests,
    } = __pgBouncerAdminTestHelpers

    const sidecar = {
      key: 'aawm-pgbouncer',
      adminDatabaseUrl: 'postgresql://admin:secret@127.0.0.1:6432/pgbouncer',
    }

    await loadPgBouncerAdminSummaryForTests(sidecar)
    await loadPgBouncerAdminSummaryForTests(sidecar)

    expect(Pool).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(1)

    await cleanupPgBouncerAdminPools()
    expect(end).toHaveBeenCalledTimes(1)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(0)
  })

  test('creates distinct Pools for distinct sidecars/admin URLs', async () => {
    vi.stubEnv('VITEST', 'true')

    const connect = vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    }))
    const on = vi.fn()
    const end = vi.fn(async () => {})
    const Pool = vi.fn(function Pool(
      this: { connect: typeof connect; on: typeof on; end: typeof end },
      _opts: unknown
    ) {
      this.connect = connect
      this.on = on
      this.end = end
    })

    vi.doMock('pg', () => ({ default: { Pool }, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const {
      cleanupPgBouncerAdminPools,
      getPgBouncerAdminPoolCacheSize,
      loadPgBouncerAdminSummaryForTests,
    } = __pgBouncerAdminTestHelpers

    await loadPgBouncerAdminSummaryForTests({
      key: 'aawm-pgbouncer',
      adminDatabaseUrl: 'postgresql://admin:secret@127.0.0.1:6432/pgbouncer',
    })
    await loadPgBouncerAdminSummaryForTests({
      key: 'aegis-pgbouncer',
      adminDatabaseUrl: 'postgresql://admin:secret@127.0.0.1:6433/pgbouncer',
    })

    expect(Pool).toHaveBeenCalledTimes(2)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(2)

    await cleanupPgBouncerAdminPools()
    expect(end).toHaveBeenCalledTimes(2)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(0)
  })

  test('preserves missing admin DSN behavior without creating a Pool', async () => {
    vi.stubEnv('VITEST', 'true')

    const Pool = vi.fn()
    vi.doMock('pg', () => ({ default: { Pool }, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const {
      loadPgBouncerAdminSummaryForTests,
      getPgBouncerAdminPoolCacheSize,
    } = __pgBouncerAdminTestHelpers

    const summary = await loadPgBouncerAdminSummaryForTests({
      key: 'aawm-pgbouncer',
      adminDatabaseUrl: undefined,
    })

    expect(summary).toMatchObject({
      configured: false,
      status: 'unconfigured',
      error: 'PgBouncer admin database URL is not configured.',
    })
    expect(Pool).not.toHaveBeenCalled()
    expect(getPgBouncerAdminPoolCacheSize()).toBe(0)
  })
})
