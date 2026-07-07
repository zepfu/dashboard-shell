import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

function makeReq(
  url = 'http://localhost/api/shell/reports/usage?from=2026-01-01&to=2026-01-08'
) {
  return {
    url: new URL(url).pathname + new URL(url).search,
    headers: { host: 'localhost' },
  }
}

describe('D1-444 handleCachedUsageSubreport', () => {
  test('returns 503 when pool is missing', async () => {
    vi.stubEnv('VITEST', 'true')
    delete process.env.DATABASE_URL
    const { __cachedUsageSubreportTestHelpers } =
      await import('./report-service.mjs')
    const { handleCachedUsageSubreport } = __cachedUsageSubreportTestHelpers

    const sendJson = vi.fn(async () => {})
    const cachedReport = vi.fn()
    const load = vi.fn()

    await handleCachedUsageSubreport(makeReq(), {}, 'usage-v2', load, {
      pool: null,
      sendJson,
      cachedReport,
    })

    expect(sendJson).toHaveBeenCalledTimes(1)
    expect(sendJson).toHaveBeenCalledWith(expect.anything(), {}, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    expect(cachedReport).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  test('loads via cachedReport and responds 200 with body', async () => {
    vi.stubEnv('VITEST', 'true')
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5432/testdb')
    const { __cachedUsageSubreportTestHelpers } =
      await import('./report-service.mjs')
    const { handleCachedUsageSubreport } = __cachedUsageSubreportTestHelpers

    const fakePool = {}
    const reportBody = { metadata: { scope: 'test' }, rows: [] }
    const cachedReport = vi.fn(async (_scope, loader, options) => {
      expect(_scope).toBe('usage-tool-activity')
      expect(options).toEqual({
        searchParams: expect.any(URLSearchParams),
      })
      expect(options.searchParams.get('from')).toBe('2026-01-01')
      expect(options.searchParams.get('to')).toBe('2026-01-08')
      const loaded = await loader()
      expect(loaded).toEqual({ loaded: true })
      return reportBody
    })
    const sendJson = vi.fn(async () => {})
    const load = vi.fn(async (searchParams: URLSearchParams) => {
      expect(searchParams.get('from')).toBe('2026-01-01')
      return { loaded: true }
    })

    await handleCachedUsageSubreport(
      makeReq(),
      {},
      'usage-tool-activity',
      load,
      { pool: fakePool, sendJson, cachedReport }
    )

    expect(cachedReport).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(sendJson).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { host: 'localhost' } }),
      {},
      200,
      reportBody
    )
  })
})
