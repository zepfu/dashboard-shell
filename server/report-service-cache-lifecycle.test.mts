import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
} from './report-cache-identity.mjs'
import { __reportCacheInternals } from './report-service.mjs'

const {
  resetReportCache,
  getReportCacheEntry,
  getReportCacheEntryKeys,
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
  readLocalReportCache,
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
    generatedAt: new Date(Date.now() - 70_000).toISOString(),
    freshUntil: Date.now() - 10_000,
    staleUntil: Date.now() + 60_000,
  }
}

afterEach(() => {
  vi.useRealTimers()
  resetReportCache()
  resetMaxReportCacheEntriesForTests()
  setReadRedisCacheEntryImpl(null)
  setWriteRedisCacheEntryImpl(null)
  vi.restoreAllMocks()
})

describe('report-service cache lifecycle', () => {
  test('read-report-cache recency tracks reads for LRU eviction', () => {
    setMaxReportCacheEntriesForTests(2)
    const oldKey = testIdentity('lru-old').cacheKey
    const recentlyReadKey = testIdentity('lru-read').cacheKey
    const newKey = testIdentity('lru-new').cacheKey

    setLocalReportCache(oldKey, freshLocalEntry({ id: 'old' }))
    setLocalReportCache(recentlyReadKey, freshLocalEntry({ id: 'read' }))
    expect(
      readLocalReportCache(recentlyReadKey, { scope: TEST_SCOPE })
    ).toMatchObject({ status: 'fresh' })
    setLocalReportCache(newKey, freshLocalEntry({ id: 'new' }))

    expect(getReportCacheEntry(oldKey)).toBeUndefined()
    expect(getReportCacheEntry(recentlyReadKey)).toBeDefined()
    expect([...getReportCacheEntryKeys()]).toEqual([recentlyReadKey, newKey])
  })

  test('pruneReportCache preserves active refreshes while evicting true LRU', () => {
    setMaxReportCacheEntriesForTests(2)
    const inFlightIdentity = testIdentity('lru-in-flight')
    const evictableIdentity = testIdentity('lru-evictable')
    const newestIdentity = testIdentity('lru-newest')

    setLocalReportCache(
      evictableIdentity.cacheKey,
      freshLocalEntry({ id: 'old' })
    )
    setLocalReportCache(
      inFlightIdentity.cacheKey,
      freshLocalEntry({ id: 'in-flight' })
    )
    const inFlight = getReportCacheEntry(inFlightIdentity.cacheKey)
    const blocked = new Promise(() => {})
    if (inFlight) {
      ;(inFlight as { promise?: Promise<unknown> }).promise = blocked
    }
    setLocalReportCache(
      newestIdentity.cacheKey,
      freshLocalEntry({ id: 'newest' })
    )

    pruneReportCache()

    expect(getReportCacheEntry(inFlightIdentity.cacheKey)?.promise).toBe(
      blocked
    )
    expect(getReportCacheEntry(inFlightIdentity.cacheKey)).toBeDefined()
    expect(getReportCacheEntry(evictableIdentity.cacheKey)).toBeUndefined()
    expect(getReportCacheEntry(newestIdentity.cacheKey)).toBeDefined()
  })

  test('local cache freshness follows the current request TTL', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'))
    const identity = testIdentity('local-current-ttl')
    setLocalReportCache(
      identity.cacheKey,
      freshLocalEntry({ id: 'ttl' }, 60_000)
    )

    vi.advanceTimersByTime(10_000)
    expect(
      readLocalReportCache(identity.cacheKey, {
        scope: TEST_SCOPE,
        cacheTtlMs: 20_000,
      })
    ).toMatchObject({ status: 'fresh' })

    vi.advanceTimersByTime(11_000)
    expect(
      readLocalReportCache(identity.cacheKey, {
        scope: TEST_SCOPE,
        cacheTtlMs: 20_000,
      })
    ).toMatchObject({ status: 'stale' })

    expect(
      readLocalReportCache(identity.cacheKey, {
        scope: TEST_SCOPE,
        cacheTtlMs: 40_000,
      })
    ).toMatchObject({ status: 'fresh' })
  })

  test('cachedReport reclassifies a local entry when the request TTL changes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'))
    const identity = testIdentity('cached-current-ttl')
    setLocalReportCache(
      identity.cacheKey,
      freshLocalEntry({ metric: 'old' }, 60_000)
    )
    setReadRedisCacheEntryImpl(async () => ({
      status: 'error',
      error: new Error('redis down'),
    }))
    let releaseRefresh: ((value: { metric: string }) => void) | undefined
    const refreshGate = new Promise<{ metric: string }>((resolve) => {
      releaseRefresh = resolve
    })
    const load = vi.fn(() => refreshGate)

    vi.advanceTimersByTime(31_000)
    const staleBody = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({ q: 'cached-current-ttl' }),
      cacheTtlMs: 20_000,
      decorateMetadata: true,
    })
    expect(staleBody).toMatchObject({
      metric: 'old',
      metadata: {
        cacheStatus: 'redis_error',
        cacheRefreshing: true,
      },
    })

    releaseRefresh!({ metric: 'refreshed' })
    await refreshGate
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1)
      expect(getReportCacheEntry(identity.cacheKey)?.entry?.payload).toEqual({
        metric: 'refreshed',
      })
      expect(getReportCacheEntry(identity.cacheKey)?.promise).toBeUndefined()
    })

    const freshBody = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({ q: 'cached-current-ttl' }),
      cacheTtlMs: 40_000,
      decorateMetadata: true,
    })
    expect(freshBody).toMatchObject({
      metric: 'refreshed',
      metadata: {
        cacheStatus: 'redis_error',
        cacheRefreshing: false,
      },
    })
  })

  test('Redis reads reclassify entries using the requested TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'))
    const identity = testIdentity('redis-current-ttl')
    const entry = freshLocalEntry({ id: 'redis-ttl' }, 60_000)
    const redis = {
      isReady: true,
      async get() {
        return await encodeRedisReportCachePayload(entry)
      },
      async del() {
        throw new Error('a TTL change should not delete the entry')
      },
    }

    vi.advanceTimersByTime(10_000)
    await expect(
      readRedisCacheEntryFromClient(identity, redis, {
        scope: identity.scope,
        cacheTtlMs: 20_000,
      })
    ).resolves.toMatchObject({
      status: 'fresh',
      entry: { payload: { id: 'redis-ttl' } },
    })

    vi.advanceTimersByTime(11_000)
    await expect(
      readRedisCacheEntryFromClient(identity, redis, {
        scope: identity.scope,
        cacheTtlMs: 20_000,
      })
    ).resolves.toMatchObject({
      status: 'stale',
      entry: { payload: { id: 'redis-ttl' } },
    })

    await expect(
      readRedisCacheEntryFromClient(identity, redis, {
        scope: identity.scope,
        cacheTtlMs: 40_000,
      })
    ).resolves.toMatchObject({
      status: 'fresh',
      entry: { payload: { id: 'redis-ttl' } },
    })

    vi.advanceTimersByTime(20_000)
    await expect(
      readRedisCacheEntryFromClient(identity, redis, {
        scope: identity.scope,
        cacheTtlMs: 40_000,
      })
    ).resolves.toMatchObject({
      status: 'stale',
      entry: { payload: { id: 'redis-ttl' } },
    })
  })

  test('non-empty cache_bust refreshes the base entry without identity flooding', async () => {
    const identity = testIdentity('cache-bust')
    setLocalReportCache(
      identity.cacheKey,
      freshLocalEntry({ metric: 'cached' })
    )
    const load = vi
      .fn()
      .mockResolvedValueOnce({ metric: 'fresh-1' })
      .mockResolvedValueOnce({ metric: 'fresh-2' })

    const first = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({
        q: 'cache-bust',
        cache_bust: ' manual-1 ',
      }),
      decorateMetadata: true,
    })
    const second = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({
        q: 'cache-bust',
        cache_bust: 'manual-2',
      }),
      decorateMetadata: true,
    })

    expect(first).toMatchObject({ metric: 'fresh-1' })
    expect(second).toMatchObject({ metric: 'fresh-2' })
    expect(load).toHaveBeenCalledTimes(2)
    expect([...getReportCacheEntryKeys()]).toEqual([identity.cacheKey])
    expect(getReportCacheEntry(identity.cacheKey)?.entry?.payload).toEqual({
      metric: 'fresh-2',
    })
  })

  test('empty cache_bust does not bypass a fresh local entry', async () => {
    const identity = testIdentity('empty-cache-bust')
    setLocalReportCache(
      identity.cacheKey,
      freshLocalEntry({ metric: 'cached' })
    )
    setReadRedisCacheEntryImpl(async () => ({
      status: 'error',
      error: new Error('redis down'),
    }))
    const load = vi.fn(async () => ({ metric: 'loaded' }))

    const body = await cachedReport(TEST_SCOPE, load, {
      searchParams: new URLSearchParams({
        q: 'empty-cache-bust',
        cache_bust: '   ',
      }),
      decorateMetadata: true,
    })

    expect(load).not.toHaveBeenCalled()
    expect(body).toMatchObject({
      metric: 'cached',
      metadata: {
        cacheStatus: 'redis_error',
        cacheRefreshing: false,
      },
    })
    expect([...getReportCacheEntryKeys()]).toEqual([identity.cacheKey])
  })

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

  test('rejected refreshes clear in-flight state so a later refresh can run', async () => {
    const identity = testIdentity('rejected-refresh')
    const failure = new Error('refresh failed')
    const failedLoad = vi.fn().mockRejectedValueOnce(failure)

    await expect(
      refreshReportCache(identity, failedLoad, {
        cacheTtlMs: 60_000,
        useRedis: false,
      })
    ).rejects.toBe(failure)

    expect(getReportCacheEntry(identity.cacheKey)).toBeUndefined()

    const retryLoad = vi.fn(async () => ({ rows: [2] }))
    const retry = await refreshReportCache(identity, retryLoad, {
      cacheTtlMs: 60_000,
      useRedis: false,
    })

    expect(retryLoad).toHaveBeenCalledTimes(1)
    expect(retry.entry?.payload).toEqual({ rows: [2] })
    expect(getReportCacheEntry(identity.cacheKey)?.promise).toBeUndefined()
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
