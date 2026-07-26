import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('report-service env and date helpers', () => {
  test('normalizeDatabaseUrl returns original value for malformed URLs when host rewrite is set', async () => {
    vi.stubEnv('SHELL_REPORT_DATABASE_HOST_REWRITE', 'host.docker.internal')
    const malformed = 'postgresql://not valid url'
    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(__envTestHelpers.normalizeDatabaseUrl(malformed)).toBe(malformed)
  })

  test('normalizeDatabaseUrl rewrites localhost host and port when configured', async () => {
    vi.stubEnv('SHELL_REPORT_DATABASE_HOST_REWRITE', 'aawm-postgres18')
    vi.stubEnv('SHELL_REPORT_DATABASE_PORT_REWRITE', '5432')
    const { __envTestHelpers } = await import('./report-service.mjs')
    const input = 'postgresql://user:pass@localhost:5434/aawm_tristore'
    const out = __envTestHelpers.normalizeDatabaseUrl(input)
    expect(out).toContain('aawm-postgres18')
    expect(out).toContain(':5432/')
    expect(out).toContain('user:pass')
  })

  test('module load does not throw when DATABASE_URL is malformed under host rewrite', async () => {
    vi.stubEnv('SHELL_REPORT_DATABASE_HOST_REWRITE', 'host.docker.internal')
    vi.stubEnv('DATABASE_URL', '%%%not-a-valid-url%%%')
    await expect(import('./report-service.mjs')).resolves.toBeDefined()
  })

  test('boundedIntegerEnv falls back and clamps instead of producing NaN', async () => {
    vi.stubEnv('SHELL_REPORT_HEALTH_MAX_ROWS', 'not-a-number')
    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(
      __envTestHelpers.boundedIntegerEnv(
        'SHELL_REPORT_HEALTH_MAX_ROWS',
        20_000,
        {
          minimum: 100,
          maximum: 20_000,
        }
      )
    ).toBe(20_000)

    vi.stubEnv('SHELL_REPORT_HEALTH_MAX_ROWS', '999999')
    vi.resetModules()
    const mod2 = await import('./report-service.mjs')
    expect(
      mod2.__envTestHelpers.boundedIntegerEnv(
        'SHELL_REPORT_HEALTH_MAX_ROWS',
        20_000,
        {
          minimum: 100,
          maximum: 20_000,
        }
      )
    ).toBe(20_000)
  })

  test('boundedIntegerEnv keeps fallback finite when bounds are open-ended', async () => {
    vi.stubEnv('SHELL_REPORT_OPEN_ENDED_TEST', 'NaN')
    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(
      __envTestHelpers.boundedIntegerEnv('SHELL_REPORT_OPEN_ENDED_TEST', 'NaN')
    ).toBe(0)
  })

  test('positiveIntegerEnv rejects non-finite values', async () => {
    vi.stubEnv('SHELL_REPORT_TOOL_ACTIVITY_RECENT_ROW_LIMIT', 'NaN')
    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(
      __envTestHelpers.positiveIntegerEnv(
        'SHELL_REPORT_TOOL_ACTIVITY_RECENT_ROW_LIMIT',
        5_000,
        250
      )
    ).toBe(5_000)
  })

  test('parseBooleanEnv recognizes true/false tokens and preserves fallback', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    const { parseBooleanEnv } = __envTestHelpers

    vi.stubEnv('SHELL_REPORT_DB_DISABLE_PARALLELISM', 'yes')
    expect(parseBooleanEnv('SHELL_REPORT_DB_DISABLE_PARALLELISM', false)).toBe(
      true
    )

    vi.stubEnv('SHELL_REPORT_CACHE_PREWARM', 'off')
    expect(parseBooleanEnv('SHELL_REPORT_CACHE_PREWARM', true)).toBe(false)

    vi.stubEnv('SHELL_REPORT_CACHE_PREWARM', 'maybe')
    expect(parseBooleanEnv('SHELL_REPORT_CACHE_PREWARM', true)).toBe(true)
  })

  test('addDaysToDateString is leap-day safe for Feb 28 and Feb 29', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(__envTestHelpers.addDaysToDateString('2024-02-28', 1)).toBe(
      '2024-02-29'
    )
    expect(__envTestHelpers.addDaysToDateString('2024-02-29', 1)).toBe(
      '2024-03-01'
    )
  })

  test('resolveDefaultToDateString returns tomorrow in dashboard timezone', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    const reference = new Date('2024-02-28T17:00:00.000Z')
    expect(__envTestHelpers.formatDashboardDate(reference)).toBe('2024-02-28')
    expect(__envTestHelpers.resolveDefaultToDateString(reference)).toBe(
      '2024-02-29'
    )

    const leapReference = new Date('2024-02-29T17:00:00.000Z')
    expect(__envTestHelpers.formatDashboardDate(leapReference)).toBe(
      '2024-02-29'
    )
    expect(__envTestHelpers.resolveDefaultToDateString(leapReference)).toBe(
      '2024-03-01'
    )
  })

  test('parseDateParam rejects timestamps because report ranges are date-only', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    const fallback = () => '2026-07-05'

    expect(__envTestHelpers.parseDateParam(null, fallback)).toBe('2026-07-05')
    expect(__envTestHelpers.parseDateParam('2026-07-04', fallback)).toBe(
      '2026-07-04'
    )
    expect(() =>
      __envTestHelpers.parseDateParam('2026-07-04T12:34:56Z', fallback)
    ).toThrow('A valid date=YYYY-MM-DD parameter is required.')
  })

  test('providerDimensionForAlias builds from a provider column expression', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    const expression = __envTestHelpers.providerDimensionForAlias('sh_recent')

    expect(expression).toContain('sh_recent.provider')
    expect(expression).not.toContain('sh.provider')
  })

  test('sessionHistoryMetadataText escapes key and fallback literals', async () => {
    const { __envTestHelpers } = await import('./report-service.mjs')
    const expression = __envTestHelpers.sessionHistoryMetadataText(
      'sh',
      "unsafe'key",
      "unsafe'fallback"
    )

    expect(expression).toContain("sh.metadata->>'unsafe''key'")
    expect(expression).toContain("'unsafe''fallback'")
  })
})

describe('D1-496 sql fanout concurrency defaults', () => {
  test('defaults fanout concurrency to 4 with max clamp 4, pool max 4, parallelism disabled, 120s timeout', async () => {
    vi.stubEnv('VITEST', 'true')
    delete process.env.SHELL_REPORT_SQL_FANOUT_CONCURRENCY
    delete process.env.SHELL_REPORT_DB_POOL_MAX
    delete process.env.SHELL_REPORT_DB_DISABLE_PARALLELISM
    delete process.env.SHELL_REPORT_DB_STATEMENT_TIMEOUT_MS

    const { __envTestHelpers } = await import('./report-service.mjs')
    expect(__envTestHelpers.REPORT_SQL_FANOUT_CONCURRENCY).toBe(4)
    expect(__envTestHelpers.REPORT_DB_POOL_MAX).toBe(4)
    expect(__envTestHelpers.REPORT_DB_DISABLE_PARALLELISM).toBe(true)
    expect(__envTestHelpers.REPORT_DB_STATEMENT_TIMEOUT_MS).toBe(120_000)
    expect(__envTestHelpers.REPORT_DB_STATEMENT_TIMEOUT_CEILING_MS).toBe(
      120_000
    )
    expect(__envTestHelpers.USAGE_REPORT_REQUEST_BUDGET_MS).toBe(115_000)
    expect(__envTestHelpers.USAGE_REPORT_RESPONSE_HEADROOM_MS).toBe(5_000)
    expect(__envTestHelpers.buildPostgresLocalSettings()).toEqual([
      ['max_parallel_workers_per_gather', '0'],
      ['statement_timeout', '120000ms'],
    ])
    expect(__envTestHelpers.buildPostgresLocalSettings(115_000)).toEqual([
      ['max_parallel_workers_per_gather', '0'],
      ['statement_timeout', '115000ms'],
    ])
    expect(__envTestHelpers.buildPostgresLocalSettings(999_999)).toEqual([
      ['max_parallel_workers_per_gather', '0'],
      ['statement_timeout', '120000ms'],
    ])
  })

  test('clamps SHELL_REPORT_SQL_FANOUT_CONCURRENCY above 4 down to 4 and accepts 1', async () => {
    vi.stubEnv('VITEST', 'true')
    vi.stubEnv('SHELL_REPORT_SQL_FANOUT_CONCURRENCY', '99')
    let mod = await import('./report-service.mjs')
    expect(mod.__envTestHelpers.REPORT_SQL_FANOUT_CONCURRENCY).toBe(4)

    vi.resetModules()
    vi.stubEnv('SHELL_REPORT_SQL_FANOUT_CONCURRENCY', '1')
    mod = await import('./report-service.mjs')
    expect(mod.__envTestHelpers.REPORT_SQL_FANOUT_CONCURRENCY).toBe(1)
  })
})
