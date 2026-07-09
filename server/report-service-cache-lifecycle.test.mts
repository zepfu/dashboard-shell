import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
} from './report-cache-identity.mjs'
import { __reportCacheInternals } from './report-service.mjs'

const {
  resetReportCache,
  getReportCacheEntry,
  setMaxReportCacheEntriesForTests,
  resetMaxReportCacheEntriesForTests,
  setReadRedisCacheEntryImpl,
  setWriteRedisCacheEntryImpl,
  encodeRedisReportCachePayload,
  decodeRedisReportCachePayload,
  readRedisCacheEntryFromClient,
  writeRedisCacheEntry,
  createRedisCacheClient,
  cachedReport,
  refreshReportCache,
  setLocalReportCache,
  pruneReportCache,
} = __reportCacheInternals

const TEST_SCOPE = 'cache-lifecycle-test'

function testIdentity(suffix = 'default') {
  return buildReportCacheIdentity(
    TEST_SCOPE,
    new URLSearchParams({ q: suffix })
  )
}

function freshLocalEntry(payload: unknown, cacheTtlMs = 60_000) {
  return buildReportCacheEntry(payload, { scope: TEST_SCOPE, cacheTtlMs })
}

function staleLocalEntry(payload: unknown, cacheTtlMs = 1) {
  const entry = buildReportCacheEntry(payload, {
    scope: TEST_SCOPE,
    cacheTtlMs,
  })
  return {
    ...entry,
    freshUntil: Date.now() - 10_000,
    staleUntil: Date.now() + 60_000,
  }
}

afterEach(() => {
  resetReportCache()
  resetMaxReportCacheEntriesForTests()
  setReadRedisCacheEntryImpl(null)
  setWriteRedisCacheEntryImpl(null)
  vi.restoreAllMocks()
})

describe('report-service cache lifecycle', () => {
  test('concurrent refreshReportCache calls share one loader and clear promise after resolve', async () => {
    const identity = testIdentity('shared-refresh')
    let loadCount = 0
    const load = async () => {
      loadCount += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { rows: [loadCount] }
    }

    const [a, b] = await Promise.all([
      refreshReportCache(identity, load, {
        cacheTtlMs: 60_000,
        useRedis: false,
      }),
      refreshReportCache(identity, load, {
        cacheTtlMs: 60_000,
        useRedis: false,
      }),
    ])

    expect(loadCount).toBe(1)
    expect(a.entry?.payload).toEqual({ rows: [1] })
    expect(b.entry?.payload).toEqual({ rows: [1] })

    const cached = getReportCacheEntry(identity.cacheKey)
    expect(cached?.entry?.payload).toEqual({ rows: [1] })
    expect(cached?.promise).toBeUndefined()
  })

  test('pruneReportCache does not evict entries with an active refresh promise', async () => {
    setMaxReportCacheEntriesForTests(2)
    const inFlightIdentity = testIdentity('in-flight')
    const evictableIdentity = testIdentity('evictable')
    const keepIdentity = testIdentity('keep')

    setLocalReportCache(
      evictableIdentity.cacheKey,
      freshLocalEntry({ id: 'old' })
    )
    setLocalReportCache(keepIdentity.cacheKey, freshLocalEntry({ id: 'keep' }))

    let releaseLoad: (() => void) | undefined
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const load = async () => {
      await loadGate
      return { id: 'in-flight-result' }
    }

    const refreshPromise = refreshReportCache(inFlightIdentity, load, {
      cacheTtlMs: 60_000,
      useRedis: false,
    })

    expect(
      getReportCacheEntry(inFlightIdentity.cacheKey)?.promise
    ).toBeDefined()

    pruneReportCache()

    expect(
      getReportCacheEntry(inFlightIdentity.cacheKey)?.promise
    ).toBeDefined()
    expect(getReportCacheEntry(evictableIdentity.cacheKey)).toBeUndefined()
    expect(getReportCacheEntry(keepIdentity.cacheKey)).toBeDefined()

    releaseLoad!()
    await refreshPromise

    const after = getReportCacheEntry(inFlightIdentity.cacheKey)
    expect(after?.entry?.payload).toEqual({ id: 'in-flight-result' })
    expect(after?.promise).toBeUndefined()
  })

  test('cachedReport serves fresh local cache with redis_error when Redis read errors', async () => {
    const identity = testIdentity('redis-error-fresh')
    const payload = { metric: 42 }
    setLocalReportCache(identity.cacheKey, freshLocalEntry(payload))
    setReadRedisCacheEntryImpl(async () => ({
      status: 'error',
      error: new Error('redis down'),
    }))

    const body = await cachedReport(TEST_SCOPE, async () => ({ metric: 999 }), {
      searchParams: new URLSearchParams({ q: 'redis-error-fresh' }),
      decorateMetadata: true,
    })

    expect(body).toMatchObject({
      metric: 42,
      metadata: {
        cacheBackend: 'local',
        cacheStatus: 'redis_error',
        cacheRefreshing: false,
      },
    })
  })

  test('cachedReport serves stale local cache with redis_error and schedules local-only refresh', async () => {
    const identity = testIdentity('redis-error-stale')
    const payload = { metric: 'stale' }
    setLocalReportCache(identity.cacheKey, staleLocalEntry(payload))
    setReadRedisCacheEntryImpl(async () => ({
      status: 'error',
      error: new Error('redis down'),
    }))

    let loadCount = 0
    const load = async () => {
      loadCount += 1
      return { metric: 'refreshed' }
    }

    const body = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({ q: 'redis-error-stale' }),
      decorateMetadata: true,
    })

    expect(body).toMatchObject({
      metric: 'stale',
      metadata: {
        cacheBackend: 'local',
        cacheStatus: 'redis_error',
        cacheRefreshing: true,
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(loadCount).toBe(1)

    const cached = getReportCacheEntry(identity.cacheKey)
    expect(cached?.entry?.payload).toEqual({ metric: 'refreshed' })
    expect(cached?.promise).toBeUndefined()
  })
})

describe('Redis report cache binary gzip storage', () => {
  test('createRedisCacheClient maps Redis blob strings to Buffer replies', () => {
    const createdOptions: unknown[] = []
    let mappedTypes: Record<PropertyKey, unknown> | null = null
    const mappedClient = { mapped: true }
    const baseClient = {
      withTypeMapping(types: Record<PropertyKey, unknown>) {
        mappedTypes = types
        return mappedClient
      },
    }

    const client = createRedisCacheClient(
      'redis://cache.example:6379',
      (options: unknown) => {
        createdOptions.push(options)
        return baseClient
      },
      { BLOB_STRING: 36 }
    )

    expect(client).toBe(mappedClient)
    expect(createdOptions).toHaveLength(1)
    expect(createdOptions[0]).toMatchObject({
      url: 'redis://cache.example:6379',
      socket: {
        reconnectStrategy: expect.any(Function),
      },
    })
    expect(mappedTypes).toEqual({ 36: Buffer })
  })

  test('encodeRedisReportCachePayload returns explicit base64 text for Redis set', async () => {
    const entry = freshLocalEntry({ rows: [1, 2, 3] })
    const encoded = await encodeRedisReportCachePayload(entry)

    expect(typeof encoded).toBe('string')
    expect(encoded.length).toBeGreaterThan(0)
    // Decoded base64 should be a gzip payload (magic 1f 8b).
    const binary = Buffer.from(String(encoded), 'base64')
    expect(binary[0]).toBe(0x1f)
    expect(binary[1]).toBe(0x8b)
  })

  test('decodeRedisReportCachePayload reads base64-encoded gzip payloads', async () => {
    const entry = freshLocalEntry({ metric: 'binary' })
    const encoded = await encodeRedisReportCachePayload(entry)
    const decoded = await decodeRedisReportCachePayload(encoded)

    expect(decoded).toEqual(entry)
  })

  test('decodeRedisReportCachePayload reads legacy base64 gzip string payloads', async () => {
    const entry = freshLocalEntry({ metric: 'legacy' })
    const { gzipSync } = await import('node:zlib')
    const legacy = gzipSync(Buffer.from(JSON.stringify(entry))).toString(
      'base64'
    )
    const decoded = await decodeRedisReportCachePayload(legacy)

    expect(decoded).toEqual(entry)
  })

  test('decodeRedisReportCachePayload reads legacy base64 gzip values returned as Buffer', async () => {
    const entry = freshLocalEntry({ metric: 'legacy-buffer' })
    const { gzipSync } = await import('node:zlib')
    const legacy = Buffer.from(
      gzipSync(Buffer.from(JSON.stringify(entry))).toString('base64'),
      'utf8'
    )

    const decoded = await decodeRedisReportCachePayload(legacy)

    expect(decoded).toEqual(entry)
  })

  test('readRedisCacheEntryFromClient decodes gzip Buffer values returned by Redis', async () => {
    const identity = testIdentity('read-buffer')
    const entry = freshLocalEntry({ id: 'read-buffer' })
    const encoded = await encodeRedisReportCachePayload(entry)
    let requestedKey = ''

    const redis = {
      isReady: true,
      async get(cacheKey: string) {
        requestedKey = cacheKey
        return encoded
      },
      async del() {
        throw new Error('fresh entry should not be deleted')
      },
    }

    await expect(
      readRedisCacheEntryFromClient(identity, redis)
    ).resolves.toEqual({
      status: 'fresh',
      entry,
    })
    expect(requestedKey).toBe(identity.cacheKey)
  })

  test('writeRedisCacheEntry passes base64 gzip string through write seam', async () => {
    const identity = testIdentity('write-buffer')
    const entry = freshLocalEntry({ id: 'write' })
    let storedValue: unknown = null

    setWriteRedisCacheEntryImpl(async (_identity, cacheEntry) => {
      storedValue = await encodeRedisReportCachePayload(cacheEntry)
      return true
    })

    const ok = await writeRedisCacheEntry(identity, entry)
    expect(ok).toBe(true)
    expect(typeof storedValue).toBe('string')
    expect(await decodeRedisReportCachePayload(storedValue)).toEqual(entry)
  })
})

describe('Wave 1 F04 usage-quota-history cache identity', () => {
  const USAGE_QUOTA_HISTORY_SCOPE = 'usage-quota-history-v2'

  test('test_quota_history_cache_key_ignores_from_to', () => {
    const historyA = buildReportCacheIdentity(
      USAGE_QUOTA_HISTORY_SCOPE,
      new URLSearchParams({ from: '2026-01-01', to: '2026-01-31' })
    )
    const historyB = buildReportCacheIdentity(
      USAGE_QUOTA_HISTORY_SCOPE,
      new URLSearchParams({ from: '2026-06-01', to: '2026-06-30' })
    )

    expect(historyA.hash).toBe(historyB.hash)
    expect(historyA.cacheKey).toBe(historyB.cacheKey)
    expect(historyA.canonicalParams).toBe('')

    const rangeA = buildReportCacheIdentity(
      'usage-quota-range-history',
      new URLSearchParams({ from: '2026-01-01', to: '2026-01-31' })
    )
    const rangeB = buildReportCacheIdentity(
      'usage-quota-range-history',
      new URLSearchParams({ from: '2026-06-01', to: '2026-06-30' })
    )

    expect(rangeA.hash).not.toBe(rangeB.hash)
    expect(rangeA.canonicalParams).not.toBe(rangeB.canonicalParams)
  })
})
