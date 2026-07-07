import { describe, expect, test, vi } from 'vitest'

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: () => ({
      render: vi.fn(),
    }),
  },
}))

vi.mock('./routeTree.gen', () => ({
  routeTree: {
    init: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    createRouter: vi.fn(() => ({})),
    RouterProvider: () => null,
  }
})

describe('QueryClient retry predicate (Wave 2 M1)', () => {
  test('test_query_retry_skips_4xx_retries_408_429_5xx', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const mainModule = await import('./main')
    const shouldRetryQuery = (
      mainModule as {
        shouldRetryQuery?: (failureCount: number, error: unknown) => boolean
      }
    ).shouldRetryQuery

    expect(shouldRetryQuery).toBeTypeOf('function')

    const makeError = (status: number) =>
      Object.assign(new Error(`HTTP ${status}`), { status })

    const originalDev = import.meta.env.DEV
    const originalProd = import.meta.env.PROD
    try {
      ;(import.meta.env as { DEV: boolean }).DEV = false
      ;(import.meta.env as { PROD: boolean }).PROD = true

      expect(shouldRetryQuery!(0, makeError(401))).toBe(false)
      expect(shouldRetryQuery!(0, makeError(403))).toBe(false)
      expect(shouldRetryQuery!(0, makeError(404))).toBe(false)

      expect(shouldRetryQuery!(0, makeError(408))).toBe(true)
      expect(shouldRetryQuery!(0, makeError(429))).toBe(true)
      expect(shouldRetryQuery!(0, makeError(500))).toBe(true)
      expect(shouldRetryQuery!(2, makeError(503))).toBe(true)
      expect(shouldRetryQuery!(3, makeError(502))).toBe(true)
      expect(shouldRetryQuery!(4, makeError(500))).toBe(false)
      ;(import.meta.env as { DEV: boolean }).DEV = true
      expect(shouldRetryQuery!(0, makeError(500))).toBe(false)
    } finally {
      ;(import.meta.env as { DEV: boolean }).DEV = originalDev
      ;(import.meta.env as { PROD: boolean }).PROD = originalProd
    }
  })
})
