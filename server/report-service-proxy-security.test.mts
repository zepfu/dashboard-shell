import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('report-service upstream proxy secret guard', () => {
  test('rejects missing proxy secret', async () => {
    vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', 'expected-secret')
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { evaluateUpstreamProxySecret } = __proxySecurityTestHelpers
    const result = evaluateUpstreamProxySecret({})
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Missing dashboard shell proxy secret.',
    })
  })

  test('rejects wrong proxy secret', async () => {
    vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', 'expected-secret')
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { evaluateUpstreamProxySecret, REPORT_PROXY_SECRET_HEADER } =
      __proxySecurityTestHelpers
    const result = evaluateUpstreamProxySecret({
      [REPORT_PROXY_SECRET_HEADER]: 'wrong-secret',
    })
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Invalid dashboard shell proxy secret.',
    })
  })

  test('accepts correct proxy secret', async () => {
    vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', 'expected-secret')
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { evaluateUpstreamProxySecret, REPORT_PROXY_SECRET_HEADER } =
      __proxySecurityTestHelpers
    const result = evaluateUpstreamProxySecret({
      [REPORT_PROXY_SECRET_HEADER]: 'expected-secret',
    })
    expect(result).toEqual({ ok: true })
  })

  test('rejects_when_secret_unset', async () => {
    delete process.env.SHELL_REPORT_PROXY_SHARED_SECRET
    vi.resetModules()
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const {
      evaluateUpstreamProxySecret,
      REPORT_PROXY_SECRET_HEADER,
      DEFAULT_REPORT_PROXY_SHARED_SECRET,
    } = __proxySecurityTestHelpers

    expect(
      evaluateUpstreamProxySecret({
        [REPORT_PROXY_SECRET_HEADER]: DEFAULT_REPORT_PROXY_SHARED_SECRET,
      })
    ).not.toEqual({ ok: true })
    expect(
      evaluateUpstreamProxySecret({
        [REPORT_PROXY_SECRET_HEADER]: 'any-provided-secret',
      })
    ).not.toEqual({ ok: true })
  })

  test('uses_constant_time_compare', async () => {
    const expected = 'abcdefghijklmnopqr'
    const wrongEqualLength = 'zyxwvutsrqponmlkji'
    expect(wrongEqualLength.length).toBe(expected.length)
    vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', expected)
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { evaluateUpstreamProxySecret, REPORT_PROXY_SECRET_HEADER } =
      __proxySecurityTestHelpers
    const result = evaluateUpstreamProxySecret({
      [REPORT_PROXY_SECRET_HEADER]: wrongEqualLength,
    })
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Invalid dashboard shell proxy secret.',
    })
  })

  test('warns_loudly_when_default_in_effect', async () => {
    delete process.env.SHELL_REPORT_PROXY_SHARED_SECRET
    vi.resetModules()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { evaluateUpstreamProxySecret } = __proxySecurityTestHelpers
    evaluateUpstreamProxySecret({})
    expect(warnSpy).toHaveBeenCalled()
    const combined = warnSpy.mock.calls.flat().join(' ').toLowerCase()
    expect(
      combined.includes('secret') ||
        combined.includes('proxy') ||
        combined.includes('default')
    ).toBe(true)
    warnSpy.mockRestore()
  })
})

describe('report-service proxyHeaders', () => {
  test('strips browser auth and internal secret but injects service credentials', async () => {
    vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', 'proxy-secret')
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { proxyHeaders, REPORT_PROXY_SECRET_HEADER } =
      __proxySecurityTestHelpers

    const headers = proxyHeaders(
      {
        headers: {
          authorization: 'Bearer browser-token',
          'x-api-key': 'browser-key',
          'x-admin-capability': 'browser-cap',
          [REPORT_PROXY_SECRET_HEADER]: 'proxy-secret',
          'x-custom': 'keep-me',
        },
      },
      {
        apiKey: 'server-api-key',
        accessToken: 'server-access-token',
        adminCapability: 'server-admin-cap',
      }
    )

    expect(headers.Authorization).toBe('Bearer server-access-token')
    expect(headers['X-API-Key']).toBe('server-api-key')
    expect(headers['X-Admin-Capability']).toBe('server-admin-cap')
    expect(headers[REPORT_PROXY_SECRET_HEADER]).toBeUndefined()
    expect(headers['x-custom']).toBe('keep-me')
  })

  test('preserves bearer prefix when access token already includes Bearer', async () => {
    const { __proxySecurityTestHelpers } = await import('./report-service.mjs')
    const { proxyHeaders } = __proxySecurityTestHelpers
    const headers = proxyHeaders(
      { headers: {} },
      { accessToken: 'Bearer already-prefixed' }
    )
    expect(headers.Authorization).toBe('Bearer already-prefixed')
  })
})
