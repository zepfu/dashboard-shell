import { afterEach, describe, expect, test, vi } from 'vitest'
import { __ttlMemoizerTestHelpers } from './report-service.mjs'

const { createTtlMemoizer, resetHealthLoaderCachesForTests } =
  __ttlMemoizerTestHelpers

afterEach(() => {
  resetHealthLoaderCachesForTests()
  vi.restoreAllMocks()
})

describe('createTtlMemoizer', () => {
  test('fresh cache bypasses loader', async () => {
    const ttlMs = 60_000
    const memo = createTtlMemoizer(ttlMs, () => ({ status: 'fallback' }))
    let loadCount = 0
    const loader = async () => {
      loadCount += 1
      return { status: 'ok', n: loadCount }
    }

    const first = await memo.load(loader)
    const second = await memo.load(loader)

    expect(loadCount).toBe(1)
    expect(first).toEqual({ status: 'ok', n: 1 })
    expect(second).toEqual({ status: 'ok', n: 1 })
  })

  test('concurrent calls share one in-flight promise', async () => {
    const memo = createTtlMemoizer(60_000, () => ({ status: 'fallback' }))
    let loadCount = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loader = async () => {
      loadCount += 1
      await gate
      return { id: loadCount }
    }

    const p1 = memo.load(loader)
    const p2 = memo.load(loader)
    release!()
    const [a, b] = await Promise.all([p1, p2])

    expect(loadCount).toBe(1)
    expect(a).toEqual({ id: 1 })
    expect(b).toEqual({ id: 1 })
  })

  test('rejected loader stores fallback, returns it, and allows retry after reset', async () => {
    const ttlMs = 30_000
    const onError = vi.fn((error: unknown) => ({
      status: 'unknown',
      error: String(error),
    }))
    const memo = createTtlMemoizer(ttlMs, onError)
    let loadCount = 0
    const failLoader = async () => {
      loadCount += 1
      throw new Error('db down')
    }

    const first = await memo.load(failLoader)
    const cached = await memo.load(failLoader)

    expect(loadCount).toBe(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ status: 'unknown', error: 'Error: db down' })
    expect(cached).toEqual(first)

    memo.resetForTests()
    const okLoader = async () => {
      loadCount += 1
      return { status: 'ok' }
    }
    const recovered = await memo.load(okLoader)
    expect(loadCount).toBe(2)
    expect(recovered).toEqual({ status: 'ok' })
  })
})
