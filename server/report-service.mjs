import crypto from 'node:crypto'
import http from 'node:http'
import process from 'node:process'
import { URL } from 'node:url'
import { promisify } from 'node:util'
import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib'
import pg from 'pg'
import { createClient } from 'redis'

const { Pool } = pg
const gzip = promisify(gzipCallback)
const gunzip = promisify(gunzipCallback)

const PORT = Number(process.env.SHELL_REPORT_PORT ?? 3010)
const DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL)
const UPSTREAM_API_PROXIES = [
  {
    prefix: '/api/aawm-tap',
    displayName: 'AAWM TAP',
    target: process.env.AAWM_TAP_API_TARGET ?? 'http://127.0.0.1:8000',
    apiKey: envSecret('AAWM_TAP_API_KEY', 'VITE_TAP_API_KEY', 'VITE_API_KEY'),
    accessToken: envSecret(
      'AAWM_TAP_ACCESS_TOKEN',
      'VITE_TAP_ACCESS_TOKEN',
      'VITE_ACCESS_TOKEN'
    ),
    adminCapability: envSecret(
      'AAWM_TAP_ADMIN_CAPABILITY',
      'VITE_TAP_ADMIN_CAPABILITY'
    ),
  },
  {
    prefix: '/api/aawm-observe',
    displayName: 'AAWM Observe',
    target:
      process.env.AAWM_OBSERVE_API_TARGET ??
      'http://host.docker.internal:34042',
    apiKey: envSecret('AAWM_OBSERVE_API_KEY'),
    accessToken: envSecret(
      'AAWM_OBSERVE_ACCESS_TOKEN',
      'AAWM_OBSERVE_API_TOKEN'
    ),
  },
  {
    prefix: '/api/aawm',
    displayName: 'AAWM',
    target: process.env.AAWM_API_TARGET ?? 'http://aawm-api:8000',
    apiKey: envSecret('AAWM_API_KEY'),
    accessToken: envSecret('AAWM_ACCESS_TOKEN', 'AAWM_API_TOKEN'),
  },
  {
    prefix: '/hook-api',
    displayName: 'AAWM Hook Server',
    target: process.env.AAWM_HOOK_API_TARGET ?? 'http://aawm-hook-server:8318',
    apiKey: envSecret('AAWM_HOOK_API_KEY'),
    accessToken: envSecret('AAWM_HOOK_ACCESS_TOKEN', 'AAWM_HOOK_API_TOKEN'),
  },
  {
    prefix: '/api/aegis',
    displayName: 'Aegis',
    target:
      process.env.AEGIS_API_TARGET ?? 'http://aegis-api:8001/api/v1',
    accessToken: envSecret('AEGIS_ACCESS_TOKEN', 'AEGIS_API_TOKEN'),
  },
  {
    prefix: '/api/sluice',
    displayName: 'Sluice',
    target:
      process.env.SLUICE_API_TARGET ?? 'http://host.docker.internal:8002/api/v1',
    accessToken: envSecret('SLUICE_ACCESS_TOKEN', 'SLUICE_API_TOKEN'),
  },
]
const DEFAULT_GROUP_BY = ['environment', 'client', 'repository', 'provider_model']
// Wave 24-D30: raised from 500 to 50000 to fix 30-day undercounting.
// At 30-day daily grain with provider+model+repository groupBy, row count
// exceeds 500. The aggregate-level surfaces (KPI strip, Aggregate Card)
// use report.summary and were always correct; this raise fixes the
// per-row surfaces (Master Ledger, Repo Breakdown, Slicer Repo Options).
// Future work: server-side pagination would be more scalable.
const MAX_LIMIT = 50000
// Wave 28-ServerCap: raised from 250 to 5000.
// At 30-day windows, deployments with many distinct (client_name,
// client_version) pairs were silently truncated, causing the Client
// Adoption surface to show an incomplete list. 5000 matches the order
// of magnitude of MAX_LIMIT and is safe for memory given that client
// rows are a small aggregate (6 columns per pair).
const MAX_CLIENT_ROWS = 5000
// Provider health strips are fixed 24-hour surfaces: 288 buckets × 5 minutes.
// Report date filters can span days/months, but the status bars should stay a
// bounded rolling window ending at "now" for live ranges, or the selected `to`
// boundary for fully historical/prior ranges.
const HEALTH_WINDOW_HOURS = 24
// Wave 35-C2: raised default from 8_000 to 20_000.
// At scale (many providers × models × environments) the 8k cap truncated the
// oldest fleet-pulse buckets silently; at current traffic (~2,529 rows) this
// was safe, but headroom was shrinking. The hard upper bound via env-override
// remains 20_000 — operators can lower it via SHELL_REPORT_HEALTH_MAX_ROWS.
// A >75% capacity warning is emitted at query time to surface truncation risk
// before it becomes a silent data loss.
const MAX_HEALTH_ROWS = Math.max(
  100,
  Math.min(Number(process.env.SHELL_REPORT_HEALTH_MAX_ROWS ?? 20_000), 20_000)
)
const MAX_PROVIDER_ERROR_ROWS = 2_000
const MAX_PROVIDER_STATUS_ROWS = 500
const STALE_RECORD_THRESHOLD_MINUTES = 120
const REPORT_DB_DISABLE_PARALLELISM =
  (process.env.SHELL_REPORT_DB_DISABLE_PARALLELISM ?? 'true').toLowerCase() !==
  'false'
const REPORT_SQL_FANOUT_CONCURRENCY = Math.max(
  1,
  Math.min(Number(process.env.SHELL_REPORT_SQL_FANOUT_CONCURRENCY ?? 2), 10)
)
// Cache up to 5 min — dashboard refreshes don't need real-time precision,
// and the cold DB query is too expensive to repeat (10–54 s observed at
// 2275×1280). A 30 s TTL meant every dashboard refresh hit the cold path.
// Operators can lower via SHELL_REPORT_CACHE_TTL_MS env-override if needed.
const REPORT_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_TTL_MS ?? 5 * 60 * 1000)
)
const REPORT_CACHE_STALE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_STALE_TTL_MS ?? 24 * 60 * 60 * 1000)
)
const REPORT_CACHE_REDIS_URL = process.env.SHELL_REPORT_REDIS_URL
const REPORT_CACHE_PREFIX =
  process.env.SHELL_REPORT_CACHE_PREFIX ?? 'dashboard-shell:reports'
const REPORT_CACHE_VERSION = process.env.SHELL_REPORT_CACHE_VERSION ?? 'v7'
const REPORT_CACHE_LOCK_TTL_MS = Math.max(
  1_000,
  Number(process.env.SHELL_REPORT_CACHE_LOCK_TTL_MS ?? 30 * 60 * 1000)
)
const REPORT_CACHE_LOCK_WAIT_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_LOCK_WAIT_MS ?? 60 * 1000)
)
const REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS ?? 2 * 1000)
)
const REPORT_CACHE_LOCK_POLL_MS = Math.max(
  100,
  Number(process.env.SHELL_REPORT_CACHE_LOCK_POLL_MS ?? 500)
)
const REPORT_CACHE_PREWARM =
  (process.env.SHELL_REPORT_CACHE_PREWARM ?? 'true').toLowerCase() !== 'false'
const REPORT_CACHE_PREWARM_INTERVAL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_PREWARM_INTERVAL_MS ?? 15 * 60 * 1000)
)
const REPORT_CACHE_PREWARM_LOCK_TTL_MS = Math.max(
  60_000,
  Number(process.env.SHELL_REPORT_CACHE_PREWARM_LOCK_TTL_MS ?? 2 * 60 * 60 * 1000)
)
const MAX_REPORT_CACHE_ENTRIES = 20
const QUOTA_VELOCITY_SEGMENT_COUNT = 100
const UPSTREAM_FETCH_TIMEOUT_MS = Number(
  process.env.SHELL_REPORT_UPSTREAM_TIMEOUT_MS ?? 30_000
)
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-admin-capability',
  'x-api-key',
])

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.SHELL_REPORT_DB_POOL_MAX ?? 12),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      options: REPORT_DB_DISABLE_PARALLELISM
        ? '-c max_parallel_workers_per_gather=0'
        : undefined,
    })
  : null
const reportCache = new Map()
const releaseCacheLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

const redisClient = REPORT_CACHE_REDIS_URL
  ? createClient({
      url: REPORT_CACHE_REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 5_000),
      },
    })
  : null
let prewarmTimer = null
let prewarmPromise = null

if (redisClient) {
  redisClient.on('error', (error) => {
    process.stderr.write(
      `[report-service] WARN: Redis cache error: ${formatError(error)}\n`
    )
  })
}

async function connectRedisCache() {
  if (!redisClient || redisClient.isOpen) return

  try {
    await redisClient.connect()
    process.stdout.write(
      `[report-service] Redis report cache connected at ${REPORT_CACHE_REDIS_URL}\n`
    )
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: Redis report cache unavailable; falling back to SQL/local cache: ${formatError(error)}\n`
    )
  }
}

async function cachedReport(scope, load, options = {}) {
  const identity = buildReportCacheIdentity(scope, options.searchParams)
  const decorateMetadata = options.decorateMetadata !== false

  if (REPORT_CACHE_TTL_MS <= 0) {
    const value = await load()
    return maybeDecorateCacheMetadata(value, {
      ...identity,
      backend: 'sql',
      status: 'bypass',
    }, decorateMetadata)
  }

  const redisEntry = await readRedisCacheEntry(identity)
  if (redisEntry.status === 'fresh') {
    setLocalReportCache(identity.cacheKey, redisEntry.entry)
    return maybeDecorateCacheMetadata(
      redisEntry.entry.payload,
      {
        ...identity,
        backend: 'redis',
        status: 'hit',
        entry: redisEntry.entry,
      },
      decorateMetadata
    )
  }

  if (redisEntry.status === 'stale') {
    setLocalReportCache(identity.cacheKey, redisEntry.entry)
    refreshReportCache(identity, load).catch((error) => {
      process.stderr.write(
        `[report-service] WARN: background cache refresh failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
      )
    })
    return maybeDecorateCacheMetadata(
      redisEntry.entry.payload,
      {
        ...identity,
        backend: 'redis',
        status: 'stale',
        refreshing: true,
        entry: redisEntry.entry,
      },
      decorateMetadata
    )
  }

  const localEntry = readLocalReportCache(identity.cacheKey)
  if (localEntry?.status === 'fresh' || localEntry?.status === 'stale') {
    if (localEntry.status === 'stale') {
      refreshReportCache(identity, load).catch((error) => {
        process.stderr.write(
          `[report-service] WARN: background cache refresh failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
        )
      })
    }
    return maybeDecorateCacheMetadata(
      localEntry.entry.payload,
      {
        ...identity,
        backend: 'local',
        status: localEntry.status === 'fresh' ? 'local_hit' : 'local_stale',
        refreshing: localEntry.status === 'stale',
        entry: localEntry.entry,
      },
      decorateMetadata
    )
  }

  if (redisEntry.status === 'error' || redisEntry.status === 'unavailable') {
    const localEntry = readLocalReportCache(identity.cacheKey)
    if (localEntry?.status === 'fresh' || localEntry?.status === 'stale') {
      if (localEntry.status === 'stale') {
        refreshReportCache(identity, load, { useRedis: false }).catch((error) => {
          process.stderr.write(
            `[report-service] WARN: local cache refresh failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
          )
        })
      }
      return maybeDecorateCacheMetadata(
        localEntry.entry.payload,
        {
          ...identity,
          backend: 'local',
          status: redisEntry.status === 'error' ? 'redis_error' : 'local_hit',
          refreshing: localEntry.status === 'stale',
          entry: localEntry.entry,
        },
        decorateMetadata
      )
    }
  }

  const refreshResult = await refreshReportCache(identity, load, {
    lockWaitMs: options.lockWaitMs ?? REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS,
    sharePromise: false,
  })
  return maybeDecorateCacheMetadata(
    refreshResult.entry.payload,
    {
      ...identity,
      backend: refreshResult.backend,
      status: refreshResult.status,
      entry: refreshResult.entry,
    },
    decorateMetadata
  )
}

function buildReportCacheIdentity(scope, searchParams) {
  const canonicalParams = searchParams
    ? canonicalizeSearchParams(searchParams)
    : ''
  const hash = crypto
    .createHash('sha256')
    .update(`${scope}\n${canonicalParams}`)
    .digest('hex')

  return {
    scope,
    canonicalParams,
    hash,
    cacheKey: `${REPORT_CACHE_PREFIX}:${REPORT_CACHE_VERSION}:${scope}:${hash}`,
    lockKey: `${REPORT_CACHE_PREFIX}:${REPORT_CACHE_VERSION}:${scope}:${hash}:lock`,
  }
}

function canonicalizeSearchParams(searchParams) {
  const entries = []
  const keys = [...new Set([...searchParams.keys()])].sort()

  for (const key of keys) {
    for (const value of searchParams.getAll(key)) {
      entries.push([key, value.trim()])
    }
  }

  return new URLSearchParams(entries).toString()
}

function readLocalReportCache(cacheKey) {
  const cached = reportCache.get(cacheKey)
  if (!cached?.entry) return null

  const status = classifyCacheEntry(cached.entry)
  if (status === 'fresh' || status === 'stale') {
    return { status, entry: cached.entry }
  }

  return null
}

function setLocalReportCache(cacheKey, entry) {
  const existing = reportCache.get(cacheKey)
  reportCache.set(cacheKey, {
    ...existing,
    entry,
  })
  pruneReportCache()
}

function buildReportCacheEntry(payload) {
  const now = Date.now()
  const freshUntil = now + REPORT_CACHE_TTL_MS
  const staleUntil = freshUntil + REPORT_CACHE_STALE_TTL_MS

  return {
    cacheVersion: REPORT_CACHE_VERSION,
    generatedAt: new Date(now).toISOString(),
    freshUntil,
    staleUntil,
    payload,
  }
}

function classifyCacheEntry(entry) {
  if (!entry || entry.cacheVersion !== REPORT_CACHE_VERSION) return 'invalid'
  if (!Number.isFinite(entry.freshUntil) || !Number.isFinite(entry.staleUntil)) {
    return 'invalid'
  }

  const now = Date.now()
  if (entry.freshUntil > now) return 'fresh'
  if (entry.staleUntil > now) return 'stale'
  return 'expired'
}

async function readRedisCacheEntry(identity) {
  if (!redisClient) return { status: 'unavailable' }
  if (!redisClient.isReady) return { status: 'unavailable' }

  try {
    const encoded = await redisClient.get(identity.cacheKey)
    if (!encoded) return { status: 'miss' }

    const entry = JSON.parse(
      (await gunzip(Buffer.from(encoded, 'base64'))).toString('utf8')
    )
    const status = classifyCacheEntry(entry)
    if (status === 'fresh' || status === 'stale') return { status, entry }

    redisClient.del(identity.cacheKey).catch(() => {})
    return { status }
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: Redis cache read failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
    )
    return { status: 'error', error }
  }
}

async function writeRedisCacheEntry(identity, entry) {
  if (!redisClient?.isReady) return false

  const ttlMs = Math.max(1_000, entry.staleUntil - Date.now())
  const encoded = (await gzip(Buffer.from(JSON.stringify(entry)))).toString(
    'base64'
  )

  await redisClient.set(identity.cacheKey, encoded, {
    expiration: { type: 'PX', value: ttlMs },
  })
  return true
}

async function refreshReportCache(identity, load, options = {}) {
  const existing = reportCache.get(identity.cacheKey)
  if (existing?.promise && options.sharePromise !== false) return existing.promise

  const promise = refreshReportCacheUnshared(identity, load, options)
    .then((result) => {
      const current = reportCache.get(identity.cacheKey)
      if (current?.promise === promise) {
        if (result.entry) {
          reportCache.set(identity.cacheKey, { entry: result.entry })
        } else {
          const next = { ...current }
          delete next.promise
          reportCache.set(identity.cacheKey, next)
        }
        pruneReportCache()
      }
      return result
    })
    .catch((error) => {
      if (reportCache.get(identity.cacheKey)?.promise === promise) {
        reportCache.delete(identity.cacheKey)
      }
      throw error
    })

  reportCache.set(identity.cacheKey, { ...existing, promise })
  pruneReportCache()
  return promise
}

async function refreshReportCacheUnshared(identity, load, options) {
  const useRedis = options.useRedis !== false && Boolean(redisClient?.isReady)
  let lockToken = null

  try {
    if (useRedis) {
      lockToken = await acquireRedisCacheLock(identity)
      if (!lockToken) {
        if (options.skipSqlOnLockMiss) {
          return {
            backend: 'redis',
            status: 'skipped',
            entry: null,
          }
        }
        const waitedEntry = await waitForRedisCacheEntry(
          identity,
          options.lockWaitMs
        )
        if (waitedEntry) {
          setLocalReportCache(identity.cacheKey, waitedEntry.entry)
          return {
            backend: 'redis',
            status: waitedEntry.status === 'fresh' ? 'hit' : 'stale',
            entry: waitedEntry.entry,
          }
        }
      }
    }

    const payload = await load()
    const entry = buildReportCacheEntry(payload)
    setLocalReportCache(identity.cacheKey, entry)

    let backend = 'sql'
    if (useRedis) {
      try {
        if (redisClient?.isReady) {
          await writeRedisCacheEntry(identity, entry)
          backend = 'redis'
        }
      } catch (error) {
        backend = 'sql'
        process.stderr.write(
          `[report-service] WARN: Redis cache write failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
        )
      }
    }

    return { backend, status: 'miss', entry }
  } finally {
    if (lockToken) {
      await releaseRedisCacheLock(identity, lockToken)
    }

    const cached = reportCache.get(identity.cacheKey)
    if (cached?.promise) {
      delete cached.promise
      reportCache.set(identity.cacheKey, cached)
    }
  }
}

async function acquireRedisCacheLock(identity) {
  return acquireRedisNamedLock(
    identity.lockKey,
    REPORT_CACHE_LOCK_TTL_MS,
    `${identity.scope}:${identity.hash}`
  )
}

async function acquireRedisNamedLock(lockKey, ttlMs, label) {
  if (!redisClient?.isReady) return null

  const token = crypto.randomUUID()
  try {
    const response = await redisClient.set(lockKey, token, {
      expiration: { type: 'PX', value: ttlMs },
      condition: 'NX',
    })
    return response === 'OK' ? token : null
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: Redis cache lock failed for ${label}: ${formatError(error)}\n`
    )
    return null
  }
}

async function releaseRedisCacheLock(identity, token) {
  await releaseRedisNamedLock(
    identity.lockKey,
    token,
    `${identity.scope}:${identity.hash}`
  )
}

async function releaseRedisNamedLock(lockKey, token, label) {
  if (!redisClient?.isReady) return

  try {
    await redisClient.eval(releaseCacheLockScript, {
      keys: [lockKey],
      arguments: [token],
    })
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: Redis cache lock release failed for ${label}: ${formatError(error)}\n`
    )
  }
}

async function waitForRedisCacheEntry(
  identity,
  waitMs = REPORT_CACHE_LOCK_WAIT_MS
) {
  const effectiveWaitMs = Math.max(
    0,
    Number(waitMs ?? REPORT_CACHE_LOCK_WAIT_MS)
  )
  if (!redisClient?.isReady || effectiveWaitMs <= 0) return null

  const deadline = Date.now() + effectiveWaitMs
  while (Date.now() < deadline) {
    await sleep(Math.min(REPORT_CACHE_LOCK_POLL_MS, deadline - Date.now()))
    const redisEntry = await readRedisCacheEntry(identity)
    if (redisEntry.status === 'fresh' || redisEntry.status === 'stale') {
      return redisEntry
    }
  }

  process.stderr.write(
    `[report-service] WARN: timed out waiting for Redis cache refresh for ${identity.scope}:${identity.hash}; falling back to SQL.\n`
  )
  return null
}

function maybeDecorateCacheMetadata(value, cacheDetails, decorateMetadata) {
  if (
    !decorateMetadata ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value
  }

  const metadata =
    value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
      ? value.metadata
      : {}

  return {
    ...value,
    metadata: {
      ...metadata,
      cacheBackend: cacheDetails.backend,
      cacheFreshUntil: cacheDetails.entry
        ? new Date(cacheDetails.entry.freshUntil).toISOString()
        : null,
      cacheGeneratedAt: cacheDetails.entry?.generatedAt ?? null,
      cacheKeyHash: cacheDetails.hash,
      cacheScope: cacheDetails.scope,
      cacheStaleUntil: cacheDetails.entry
        ? new Date(cacheDetails.entry.staleUntil).toISOString()
        : null,
      cacheStatus: cacheDetails.status,
      cacheRefreshing: Boolean(cacheDetails.refreshing),
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runTasksWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await tasks[currentIndex]()
    }
  }

  const workerCount = Math.min(concurrency, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function formatError(error) {
  return error instanceof Error && error.message ? error.message : String(error)
}

function pruneReportCache() {
  while (reportCache.size > MAX_REPORT_CACHE_ENTRIES) {
    const oldestKey = reportCache.keys().next().value
    if (oldestKey === undefined) return
    reportCache.delete(oldestKey)
  }
}

function normalizeDatabaseUrl(value) {
  if (!value) return value

  const hostRewrite = process.env.SHELL_REPORT_DATABASE_HOST_REWRITE
  if (!hostRewrite) return value

  const databaseUrl = new URL(value)
  const shouldRewrite =
    databaseUrl.hostname === '127.0.0.1' ||
    databaseUrl.hostname === 'localhost'

  if (!shouldRewrite) return value

  const portRewrite = process.env.SHELL_REPORT_DATABASE_PORT_REWRITE
  if (portRewrite) {
    databaseUrl.port = portRewrite
  }

  databaseUrl.hostname = hostRewrite
  return databaseUrl.toString()
}

function envSecret(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return undefined
}

const createdAtEastern = "(sh.created_at AT TIME ZONE 'America/New_York')"
const providerDimension = `
CASE
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(sh.provider, 'unknown')
END`

const grains = {
  day: `${createdAtEastern}::date`,
  week: `date_trunc('week', ${createdAtEastern})::date`,
  month: `date_trunc('month', ${createdAtEastern})::date`,
}

const dimensions = {
  environment:
    "COALESCE(sh.litellm_environment, 'unknown') || ' [' || COALESCE(sh.litellm_version, '0.0.0') || ']'",
  client:
    "COALESCE(sh.client_name, 'unknown') || ' [' || COALESCE(sh.client_version, '0.0.0') || ']'",
  repository: "COALESCE(sh.tenant_id, 'unknown')",
  provider: providerDimension,
  model: "COALESCE(sh.model, 'unknown')",
  provider_model:
    `${providerDimension} || '/' || COALESCE(sh.model, 'unknown')`,
}

const filterColumns = {
  environment: dimensions.environment,
  client: dimensions.client,
  repository: "COALESCE(sh.tenant_id, 'unknown')",
  provider: providerDimension,
  model: "COALESCE(sh.model, 'unknown')",
  provider_model: dimensions.provider_model,
}

const sortColumns = {
  period_end: 'period_end',
  traces: 'traces',
  usd_cost: 'usd_cost',
  token_total: 'token_total',
}
const createdAtDateRangeWhere = [
  "sh.created_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')",
  "sh.created_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')",
]

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function parseDateParam(value, fallback) {
  if (!value) return fallback()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }
  return date.toISOString()
}

function parseDateOnlyParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('A valid date=YYYY-MM-DD parameter is required.')
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date: ${value}`)
  }
  return value
}

function defaultFromDate() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  ).toISOString()
}

function defaultToDate() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString()
}

function resolveHealthWindow(from, to) {
  const nowMs = Date.now()
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  const fallbackToMs = Number.isFinite(toMs) ? toMs : nowMs
  const healthToMs = Math.min(fallbackToMs, nowMs)
  const fallbackFromMs = Number.isFinite(fromMs)
    ? fromMs
    : healthToMs - HEALTH_WINDOW_HOURS * 60 * 60 * 1000
  const healthFromMs = Math.max(
    fallbackFromMs,
    healthToMs - HEALTH_WINDOW_HOURS * 60 * 60 * 1000
  )

  return {
    from: new Date(healthFromMs).toISOString(),
    to: new Date(healthToMs).toISOString(),
  }
}

function parseCsv(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseLimit(value) {
  const parsed = Number(value ?? 200)
  if (!Number.isFinite(parsed) || parsed < 1) return 200
  return Math.min(Math.floor(parsed), MAX_LIMIT)
}

function parseGroupBy(value) {
  const requested = parseCsv(value)
  const groupBy = requested.length ? requested : DEFAULT_GROUP_BY
  const invalid = groupBy.filter((key) => !dimensions[key])
  if (invalid.length) {
    throw new Error(`Unsupported group_by value: ${invalid.join(', ')}`)
  }
  return [...new Set(groupBy)]
}

function appendMultiValueFilter(searchParams, key, whereParts, values) {
  const selected = parseCsv(searchParams.get(key))
  if (!selected.length) return

  const column = filterColumns[key]
  values.push(selected)
  whereParts.push(`${column} = ANY($${values.length}::text[])`)
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function firstRow(result) {
  return result.rows[0] ?? {}
}

function normalizeRow(row) {
  const numericKeys = [
    'min_weekly_pct',
    'max_weekly_pct',
    'min_short_pct',
    'max_short_pct',
    'min_weekly_pct_special',
    'max_weekly_pct_special',
    'min_short_pct_special',
    'max_short_pct_special',
    'traces',
    'token_in',
    'token_out',
    'token_cache_input',
    'token_cache_creation',
    'token_reasoning_reported',
    'token_reasoning_estimated',
    'token_cache_miss',
    'token_total',
    'cache_miss_usd_cost',
    'usd_cost',
    'tool_calls',
    'git_commit',
    'git_push',
    'litellm_processing_total_ms',
    'litellm_processing_average_ms',
    'llm_upstream_elapsed_total_ms',
    'llm_upstream_elapsed_average_ms',
  ]

  const normalized = { ...row }
  for (const key of numericKeys) {
    normalized[key] = normalizeNumber(normalized[key])
  }
  return normalized
}

function buildFilteredWhere(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = [from, to]
  const whereParts = [...createdAtDateRangeWhere]

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }

  return { from, to, values, whereParts }
}

function buildSummaryQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)

  const sql = `
SELECT
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0))::double precision AS token_in,
    SUM(COALESCE(sh.output_tokens, 0))::double precision AS token_out,
    SUM(COALESCE(sh.cache_read_input_tokens, 0))::double precision AS token_cache_input,
    SUM(COALESCE(sh.cache_creation_input_tokens, 0))::double precision AS token_cache_creation,
    SUM(COALESCE(sh.reasoning_tokens_reported, 0))::double precision AS token_reasoning_reported,
    SUM(COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_reasoning_estimated,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.provider_cache_miss_cost_usd, 0))::double precision AS cache_miss_usd_cost,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push,
    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end,
    MAX(sh.created_at) AS latest_record_at
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')};
`

  return { sql, values }
}

function buildTrendQuery(searchParams) {
  const grain = searchParams.get('grain') ?? 'day'
  if (!grains[grain]) {
    throw new Error(`Unsupported grain: ${grain}`)
  }

  const { values, whereParts } = buildFilteredWhere(searchParams)
  const bucketExpression = grains[grain]

  const sql = `
SELECT
    ${bucketExpression} AS bucket,
    ${providerDimension} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    COALESCE(sh.tenant_id, 'unknown') AS repository,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${bucketExpression},
    ${providerDimension},
    COALESCE(sh.model, 'unknown'),
    COALESCE(sh.tenant_id, 'unknown')
ORDER BY
    ${bucketExpression} ASC,
    ${providerDimension} ASC,
    token_total DESC;
`

  return { sql, values }
}

function buildTokenTrendHoursQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  const dayExpression = `${createdAtEastern}::date`
  const hourExpression = `EXTRACT(hour FROM ${createdAtEastern})::int`

  const sql = `
SELECT
    to_char(${dayExpression}, 'YYYY-MM-DD') AS day,
    ${hourExpression} AS hour,
    ${providerDimension} AS provider,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${dayExpression},
    ${hourExpression},
    ${providerDimension}
ORDER BY
    ${dayExpression} ASC,
    ${hourExpression} ASC,
    ${providerDimension} ASC;
`

  return { sql, values }
}

function buildTokenTrendVersionIntervalsQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  const localTimestampExpression = `${createdAtEastern}`

  const sql = `
WITH version_usage AS (
  SELECT
      ${providerDimension} AS provider,
      COALESCE(NULLIF(sh.client_name, ''), 'unknown') AS client_name,
      COALESCE(NULLIF(sh.client_version, ''), '0.0.0') AS client_version,
      MIN(sh.created_at) AS first_seen_at,
      MAX(sh.created_at) AS last_seen_at,
      MIN(${localTimestampExpression}) AS first_seen_local,
      MAX(${localTimestampExpression}) AS last_seen_local,
      COUNT(*)::double precision AS traces,
      SUM(COALESCE(sh.input_tokens, 0)
        + COALESCE(sh.output_tokens, 0)
        + COALESCE(sh.cache_read_input_tokens, 0)
        + COALESCE(sh.cache_creation_input_tokens, 0)
        + COALESCE(sh.reasoning_tokens_reported, 0)
        + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
      SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
  FROM public.session_history sh
  WHERE ${whereParts.join('\n    AND ')}
    AND COALESCE(NULLIF(sh.client_name, ''), 'unknown') <> 'unknown'
    AND COALESCE(NULLIF(sh.client_version, ''), '0.0.0') <> '0.0.0'
  GROUP BY
      ${providerDimension},
      COALESCE(NULLIF(sh.client_name, ''), 'unknown'),
      COALESCE(NULLIF(sh.client_version, ''), '0.0.0')
)
SELECT
    provider,
    client_name,
    client_version,
    first_seen_at,
    last_seen_at,
    to_char(first_seen_local::date, 'YYYY-MM-DD') AS first_seen_day,
    EXTRACT(hour FROM first_seen_local)::int AS first_seen_hour,
    to_char(last_seen_local::date, 'YYYY-MM-DD') AS last_seen_day,
    EXTRACT(hour FROM last_seen_local)::int AS last_seen_hour,
    traces,
    token_total,
    usd_cost
FROM version_usage
ORDER BY
    first_seen_at ASC,
    token_total DESC,
    client_name ASC,
    client_version ASC;
`

  return { sql, values }
}

function buildTokenTrendDayDetailQuery(searchParams) {
  const date = parseDateOnlyParam(searchParams.get('date'))
  const { from, to, values, whereParts } = buildFilteredWhere(searchParams)
  values.push(date)
  const dayExpression = `${createdAtEastern}::date`
  const hourExpression = `EXTRACT(hour FROM ${createdAtEastern})::int`
  whereParts.push(`${dayExpression} = $${values.length}::date`)

  const sql = `
SELECT
    to_char(${dayExpression}, 'YYYY-MM-DD') AS day,
    ${hourExpression} AS hour,
    ${providerDimension} AS provider,
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') AS client_name,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') AS client_version,
    MIN(sh.created_at) AS first_seen_at,
    MAX(sh.created_at) AS last_seen_at,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${dayExpression},
    ${hourExpression},
    ${providerDimension},
    COALESCE(NULLIF(sh.client_name, ''), 'unknown'),
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0')
ORDER BY
    ${hourExpression} ASC,
    token_total DESC,
    ${providerDimension} ASC,
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') ASC,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') ASC;
`

  return { sql, values, metadata: { date, from, to } }
}

function buildClientUsageQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  values.push(MAX_CLIENT_ROWS)

  const sql = `
SELECT
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') AS client_name,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') AS client_version,
    MIN(sh.created_at) AS first_seen_at,
    MAX(sh.created_at) AS last_seen_at,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    COALESCE(NULLIF(sh.client_name, ''), 'unknown'),
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0')
ORDER BY
    token_total DESC,
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') ASC,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') ASC
LIMIT $${values.length};
`

  return { sql, values }
}

// Scope provider health rows to the 24-hour status-bar window inside the
// caller's selected range. Current/live ranges end at now even though the
// default report `to` date is tomorrow; historical/prior ranges end at their
// requested `to`, so comparison windows still remain distinct.
function buildProviderLatencyHealthQuery(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const healthWindow = resolveHealthWindow(from, to)

  const sql = `
WITH local_request_latency AS (
    SELECT
        date_bin(
            '00:05:00'::interval,
            COALESCE(sh.start_time, sh.created_at),
            '2000-01-01 00:00:00+00'::timestamptz
        ) AS bucket_start,
        'all'::text AS environment,
        'local'::text AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        COALESCE(NULLIF(sh.model_group, ''), 'unknown') AS model_group,
        COUNT(*) AS requests,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY sh.llm_upstream_elapsed_ms)
            FILTER (WHERE sh.llm_upstream_elapsed_ms IS NOT NULL) AS upstream_p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY sh.llm_upstream_elapsed_ms)
            FILTER (WHERE sh.llm_upstream_elapsed_ms IS NOT NULL) AS upstream_p95_ms,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY sh.llm_upstream_elapsed_ms)
            FILTER (WHERE sh.llm_upstream_elapsed_ms IS NOT NULL) AS upstream_p99_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY sh.total_server_elapsed_ms)
            FILTER (WHERE sh.total_server_elapsed_ms IS NOT NULL) AS total_p95_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY sh.litellm_processing_ms)
            FILTER (WHERE sh.litellm_processing_ms IS NOT NULL) AS proxy_processing_p95_ms,
        COUNT(*) FILTER (WHERE sh.llm_upstream_elapsed_ms IS NULL) AS missing_upstream_latency,
        MIN(COALESCE(sh.start_time, sh.created_at)) AS request_period_start,
        MAX(COALESCE(sh.end_time, sh.created_at)) AS request_period_end
    FROM public.session_history sh
    WHERE sh.created_at >= $2::timestamptz
      AND sh.created_at < $3::timestamptz
      AND COALESCE(sh.start_time, sh.created_at) >= $2::timestamptz
      AND COALESCE(sh.start_time, sh.created_at) < $3::timestamptz
      AND (
          lower(COALESCE(sh.provider, 'unknown')) = 'local'
          OR lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%'
          OR lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%'
      )
    GROUP BY
        date_bin(
            '00:05:00'::interval,
            COALESCE(sh.start_time, sh.created_at),
            '2000-01-01 00:00:00+00'::timestamptz
        ),
        COALESCE(sh.model, 'unknown'),
        COALESCE(NULLIF(sh.model_group, ''), 'unknown')
), health_rows AS (
SELECT
    bucket_start,
    COALESCE(environment, 'unknown') AS environment,
    CASE
        WHEN lower(COALESCE(provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
        WHEN lower(COALESCE(provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
        WHEN lower(COALESCE(provider, 'unknown')) = 'local' THEN 'local'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'local/%' THEN 'local'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'local_%' THEN 'local'
        ELSE COALESCE(provider, 'unknown')
    END AS provider,
    COALESCE(model, 'unknown') AS model,
    COALESCE(model_group, 'unknown') AS model_group,
    requests,
    passive_latency_sample_status,
    upstream_p50_ms,
    upstream_p95_ms,
    upstream_p99_ms,
    total_p95_ms,
    proxy_processing_p95_ms,
    missing_upstream_latency,
    provider_error_events,
    rate_limit_events,
    capacity_events,
    provider_5xx_events,
    provider_timeout_events,
    network_error_events,
    auth_failed_events,
    adapter_error_events,
    status_probe_count,
    status_probe_success_pct,
    status_probe_p95_ms,
    provider_ping_avg_ms,
    provider_ping_packet_loss_pct,
    control_ping_avg_ms,
    control_packet_loss_pct,
    control_probe_success_pct,
    provider_ping_minus_control_ms,
    dns_failures,
    tcp_failures,
    tls_failures,
    icmp_failures,
    probed_endpoints,
    status_error_classes,
    min_remaining_pct,
    max_remaining_pct,
    next_expected_reset_at,
    quota_keys,
    request_period_start,
    request_period_end
FROM public.provider_latency_health_5m
WHERE bucket_start >= $2::timestamptz
  AND bucket_start < $3::timestamptz
UNION ALL
SELECT
    bucket_start,
    environment,
    provider,
    model,
    model_group,
    requests,
    CASE
        WHEN requests = 0 THEN 'no_traffic'
        WHEN requests < 5 THEN 'low_sample'
        ELSE 'normal'
    END AS passive_latency_sample_status,
    upstream_p50_ms,
    upstream_p95_ms,
    upstream_p99_ms,
    total_p95_ms,
    proxy_processing_p95_ms,
    missing_upstream_latency,
    0::bigint AS provider_error_events,
    0::bigint AS rate_limit_events,
    0::bigint AS capacity_events,
    0::bigint AS provider_5xx_events,
    0::bigint AS provider_timeout_events,
    0::bigint AS network_error_events,
    0::bigint AS auth_failed_events,
    0::bigint AS adapter_error_events,
    0::bigint AS status_probe_count,
    NULL::numeric AS status_probe_success_pct,
    NULL::double precision AS status_probe_p95_ms,
    NULL::numeric AS provider_ping_avg_ms,
    NULL::numeric AS provider_ping_packet_loss_pct,
    NULL::numeric AS control_ping_avg_ms,
    NULL::numeric AS control_packet_loss_pct,
    NULL::numeric AS control_probe_success_pct,
    NULL::numeric AS provider_ping_minus_control_ms,
    0::bigint AS dns_failures,
    0::bigint AS tcp_failures,
    0::bigint AS tls_failures,
    0::bigint AS icmp_failures,
    NULL::text AS probed_endpoints,
    NULL::text AS status_error_classes,
    NULL::double precision AS min_remaining_pct,
    NULL::double precision AS max_remaining_pct,
    NULL::timestamp with time zone AS next_expected_reset_at,
    NULL::text AS quota_keys,
    request_period_start,
    request_period_end
FROM local_request_latency
)
SELECT *
FROM health_rows
ORDER BY bucket_start DESC, environment, provider, model
LIMIT $1;
`

  return { sql, values: [MAX_HEALTH_ROWS, healthWindow.from, healthWindow.to] }
}

// Wave 35-C2 (⚠-1): accept searchParams and scope observations to the
// user-selected date window instead of a hardcoded 14-day lookback.
// W34-C made computeFleetErrors() window-aware client-side, but the server
// was still capping at "now() - 14 days", causing silent under-counting for
// any window > 14d (e.g. the default 30-day view). Now mirrors the same
// from/to parameterisation used by buildSummaryQuery / buildClientUsageQuery.
// MAX_PROVIDER_ERROR_ROWS remains 2_000 — at daily grain a 30-day window
// with typical error rates stays well below this cap.
function buildProviderErrorObservationQuery(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)

  const sql = `
SELECT
    observed_at,
    COALESCE(environment, 'unknown') AS environment,
    COALESCE(provider, 'unknown') AS provider,
    COALESCE(model, 'unknown') AS model,
    COALESCE(model_group, 'unknown') AS model_group,
    COALESCE(route_family, 'unknown') AS route_family,
    status_code,
    COALESCE(error_type, 'unknown') AS error_type,
    COALESCE(error_code, 'unknown') AS error_code,
    COALESCE(error_class, 'unknown') AS error_class,
    LEFT(
        COALESCE(
            NULLIF(metadata->>'normalized_error_text', ''),
            NULLIF(metadata->>'error_message', ''),
            NULLIF(metadata->>'message', ''),
            NULLIF(metadata #>> '{error,message}', ''),
            NULLIF(metadata #>> '{error,error,message}', ''),
            NULLIF(metadata #>> '{response,error,message}', '')
        ),
        280
    ) AS error_message,
    retry_after_seconds,
    expected_reset_at
FROM public.provider_error_observations
WHERE observed_at >= $2::timestamptz
  AND observed_at < $3::timestamptz
ORDER BY observed_at DESC
LIMIT $1;
`

  return { sql, values: [MAX_PROVIDER_ERROR_ROWS, from, to] }
}

// Wave 28-ServerCap: added searchParams parameter to thread the user's
// selected date range (from/to) into the WHERE clause.
// Previously this query hardcoded `now() - interval '24 hours'`, which
// caused the Model Ledger to always display only the last 24 h of
// provider/model data regardless of the operator's selected period
// (operator F#11). Now uses the same parameterised from/to pattern as
// buildClientUsageQuery and buildSummaryQuery, keyed on start_time for
// consistency with the rest of the providerStatusUsage surface.
function buildProviderStatusUsageQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  values.push(MAX_PROVIDER_STATUS_ROWS)

  const sql = `
SELECT
    ${providerDimension} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    MIN(COALESCE(sh.start_time, sh.created_at)) AS period_start,
    MAX(COALESCE(sh.end_time, sh.start_time, sh.created_at)) AS period_end
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${providerDimension},
    COALESCE(sh.model, 'unknown')
ORDER BY
    ${providerDimension} ASC,
    token_total DESC
LIMIT $${values.length};
`

  return { sql, values }
}

function buildQuotaQuery() {
  const sql = `
WITH normalized AS (
    SELECT
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local/%' THEN 'local'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'
            ELSE COALESCE(ri.provider, 'unknown')
        END AS provider,
        CASE
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END AS model,
        CASE
            WHEN ri.quota_type = 'requests'
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN 'monthly'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        CASE
            WHEN ri.fromDate <= now() AND ri.toDate > now() THEN true
            ELSE false
        END AS active
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'short', 'weekly_special', 'short_special', 'requests', 'monthly')
),
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type
            ORDER BY active DESC, interval_start DESC, interval_end DESC
        ) AS quota_rank
    FROM normalized
),
selected AS (
    SELECT *
    FROM ranked
    WHERE quota_rank = 1
),
selected_with_fallbacks AS (
    SELECT *
    FROM selected
    UNION ALL
    SELECT
        weekly.provider,
        weekly.model,
        'special' AS quota_type,
        weekly.expected_reset_at,
        0::double precision AS remaining_pct,
        weekly.interval_start,
        weekly.interval_end,
        weekly.active,
        weekly.quota_rank
    FROM selected weekly
    WHERE weekly.provider = 'openai'
      AND weekly.model IS NULL
      AND weekly.quota_type = 'weekly'
      AND NOT EXISTS (
          SELECT 1
          FROM selected special
          WHERE special.provider = weekly.provider
            AND special.model IS NOT DISTINCT FROM weekly.model
            AND special.quota_type = 'special'
      )
    UNION ALL
    SELECT
        short.provider,
        short.model,
        'short_special' AS quota_type,
        short.expected_reset_at,
        0::double precision AS remaining_pct,
        short.interval_start,
        short.interval_end,
        short.active,
        short.quota_rank
    FROM selected short
    WHERE short.provider = 'openai'
      AND short.model IS NULL
      AND short.quota_type = 'short'
      AND NOT EXISTS (
          SELECT 1
          FROM selected short_special
          WHERE short_special.provider = short.provider
            AND short_special.model IS NOT DISTINCT FROM short.model
            AND short_special.quota_type = 'short_special'
      )
),
usage_by_type AS (
    SELECT
        s.provider,
        s.model,
        s.quota_type,
        COALESCE(SUM(model_usage.token_total), 0)::double precision AS usage_tokens,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'model', model_usage.model,
                    'tokens', model_usage.token_total,
                    'cost', model_usage.usd_cost,
                    'traces', model_usage.traces
                )
                ORDER BY model_usage.token_total DESC
            ) FILTER (WHERE model_usage.model IS NOT NULL),
            '[]'::jsonb
        ) AS usage_breakdown
    FROM selected_with_fallbacks s
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(sh.model, 'unknown') AS model,
            COUNT(*)::double precision AS traces,
            SUM(COALESCE(sh.input_tokens, 0)
              + COALESCE(sh.output_tokens, 0)
              + COALESCE(sh.cache_read_input_tokens, 0)
              + COALESCE(sh.cache_creation_input_tokens, 0)
              + COALESCE(sh.reasoning_tokens_reported, 0)
              + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
            SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
        FROM public.session_history sh
        WHERE s.expected_reset_at IS NOT NULL
          AND sh.start_time >= s.expected_reset_at - CASE
              WHEN s.provider = 'google' THEN INTERVAL '24 hours'
              WHEN s.quota_type = 'monthly' THEN INTERVAL '1 month'
              WHEN s.quota_type IN ('short', 'short_special') THEN INTERVAL '5 hours'
              ELSE INTERVAL '7 days'
          END
          AND sh.start_time < CASE
              WHEN s.expected_reset_at > now() THEN now()
              ELSE s.expected_reset_at
          END
          AND (
              (s.provider = 'google'
                AND ${providerDimension} = 'google'
                AND COALESCE(sh.model, 'unknown') = COALESCE(s.model, 'unknown'))
              OR
              (s.provider <> 'google'
                AND ${providerDimension} = s.provider)
          )
          AND (
              s.provider <> 'openai'
              OR s.quota_type NOT IN ('weekly', 'short')
              OR COALESCE(sh.model, '') NOT ILIKE '%spark%'
          )
          AND (
              s.provider <> 'openai'
              OR s.quota_type NOT IN ('special', 'short_special')
              OR COALESCE(sh.model, '') ILIKE '%spark%'
          )
          AND (
              s.provider <> 'anthropic'
              OR s.quota_type <> 'special'
              OR COALESCE(sh.model, '') ILIKE '%sonnet%'
          )
        GROUP BY COALESCE(sh.model, 'unknown')
    ) model_usage ON true
    GROUP BY s.provider, s.model, s.quota_type
)
SELECT
    s.provider,
    s.model,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'weekly') AS weekly_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'weekly') AS weekly_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'weekly') AS weekly_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'weekly'))[1] AS weekly_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'short')::double precision AS short_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'short') AS short_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'short') AS short_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'short') AS short_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'short')::double precision AS short_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'short')::double precision AS short_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'short'))[1] AS short_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'special')::double precision AS special_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'special') AS special_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'special') AS special_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'special') AS special_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'special')::double precision AS special_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'special')::double precision AS special_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'special'))[1] AS special_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'short_special') AS short_special_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'short_special') AS short_special_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'short_special') AS short_special_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'short_special'))[1] AS short_special_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'monthly') AS monthly_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'monthly') AS monthly_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'monthly') AS monthly_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'monthly'))[1] AS monthly_usage_breakdown
FROM selected_with_fallbacks s
LEFT JOIN usage_by_type usage
  ON usage.provider = s.provider
 AND usage.model IS NOT DISTINCT FROM s.model
 AND usage.quota_type = s.quota_type
GROUP BY s.provider, s.model
ORDER BY s.provider ASC, s.model ASC NULLS FIRST;
`

  return { sql, values: [] }
}


function buildQuotaVelocityQuery() {
  const sql = `
WITH
quota_key_gaps AS (
    SELECT
        provider,
        quota_key,
        quota_type,
        EXTRACT(EPOCH FROM (
            expected_reset_at
            - LAG(expected_reset_at) OVER (
                PARTITION BY provider, quota_key
                ORDER BY expected_reset_at
            )
        )) / 3600.0 AS gap_hours
    FROM (
        SELECT DISTINCT provider, quota_key, quota_type, expected_reset_at
        FROM public.rate_limit_intervals
        WHERE quota_type IN ('weekly', 'weekly_special', 'short', 'short_special', 'requests', 'monthly')
          AND expected_reset_at IS NOT NULL
          AND quota_key IS NOT NULL
    ) distinct_resets
),
quota_key_interval_hours AS (
    SELECT
        provider,
        quota_key,
        quota_type,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_hours) AS interval_hours,
        COUNT(*) AS gap_count
    FROM quota_key_gaps
    WHERE gap_hours >= 1.0
    GROUP BY provider, quota_key, quota_type
),
normalized AS (
    SELECT
        ri.provider AS raw_provider,
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local/%' THEN 'local'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'
            ELSE COALESCE(ri.provider, 'unknown')
        END AS provider,
        CASE
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END AS model,
        CASE
            WHEN ri.quota_type = 'requests'
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN 'monthly'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.quota_type AS raw_quota_type,
        ri.quota_key,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        CASE
            WHEN ri.fromDate <= now() AND ri.toDate > now() THEN true
            ELSE false
        END AS active
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'short', 'weekly_special', 'short_special', 'requests', 'monthly')
),
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type
            ORDER BY active DESC, interval_start DESC, interval_end DESC
        ) AS quota_rank
    FROM normalized
),
selected AS (
    SELECT *
    FROM ranked
    WHERE quota_rank = 1
),
selected_with_fallbacks AS (
    SELECT *
    FROM selected
    UNION ALL
    SELECT
        weekly.raw_provider,
        weekly.provider,
        weekly.model,
        'special' AS quota_type,
        'weekly_special' AS raw_quota_type,
        NULL::text AS quota_key,
        weekly.expected_reset_at,
        0::double precision AS remaining_pct,
        weekly.interval_start,
        weekly.interval_end,
        weekly.active,
        weekly.quota_rank
    FROM selected weekly
    WHERE weekly.provider = 'openai'
      AND weekly.model IS NULL
      AND weekly.quota_type = 'weekly'
      AND NOT EXISTS (
          SELECT 1
          FROM selected special
          WHERE special.provider = weekly.provider
            AND special.model IS NOT DISTINCT FROM weekly.model
            AND special.quota_type = 'special'
      )
    UNION ALL
    SELECT
        short.raw_provider,
        short.provider,
        short.model,
        'short_special' AS quota_type,
        'short_special' AS raw_quota_type,
        NULL::text AS quota_key,
        short.expected_reset_at,
        0::double precision AS remaining_pct,
        short.interval_start,
        short.interval_end,
        short.active,
        short.quota_rank
    FROM selected short
    WHERE short.provider = 'openai'
      AND short.model IS NULL
      AND short.quota_type = 'short'
      AND NOT EXISTS (
          SELECT 1
          FROM selected short_special
          WHERE short_special.provider = short.provider
            AND short_special.model IS NOT DISTINCT FROM short.model
            AND short_special.quota_type = 'short_special'
      )
),
selected_with_duration AS (
    SELECT
        s.*,
        COALESCE(
            CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
            CASE
                WHEN s.provider = 'google' AND s.raw_quota_type = 'requests' THEN 24.0
                WHEN s.quota_type = 'monthly' THEN 720.0
                WHEN s.quota_type IN ('short', 'short_special') THEN 5.0
                WHEN s.quota_type IN ('weekly', 'special') THEN 168.0
                ELSE 168.0
            END
        ) AS interval_hours
    FROM selected_with_fallbacks s
    LEFT JOIN quota_key_interval_hours kh
           ON kh.provider = s.raw_provider
          AND kh.quota_key = s.quota_key
),
observations AS (
    SELECT
        s.provider,
        s.model,
        s.quota_type,
        s.interval_hours,
        o.observed_at,
        MAX(GREATEST(0, LEAST(100, 100 - o.remaining_pct))) AS consumed_pct
    FROM selected_with_duration s
    JOIN public.rate_limit_observations o
      ON s.quota_key IS NOT NULL
     AND s.expected_reset_at IS NOT NULL
     AND o.provider = s.raw_provider
     AND o.quota_key = s.quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM s.expected_reset_at
     AND o.remaining_pct IS NOT NULL
     AND o.remaining_pct >= 0
     AND o.observed_at IS NOT NULL
     AND o.observed_at <= now() + INTERVAL '5 minutes'
    GROUP BY s.provider, s.model, s.quota_type, s.interval_hours, o.observed_at
),
ordered_observations AS (
    SELECT
        *,
        LAG(consumed_pct) OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type
            ORDER BY observed_at ASC
        ) AS prev_consumed_pct,
        LAG(observed_at) OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type
            ORDER BY observed_at ASC
        ) AS prev_observed_at
    FROM observations
),
velocity_segments AS (
    SELECT
        provider,
        model,
        quota_type,
        segment.segment_index,
        MAX(
            (o.consumed_pct - o.prev_consumed_pct)
            * o.interval_hours
            * 36.0
            / NULLIF(EXTRACT(EPOCH FROM (o.observed_at - o.prev_observed_at)), 0)
        )::double precision AS velocity_score
    FROM ordered_observations o
    CROSS JOIN LATERAL generate_series(
        GREATEST(0, FLOOR(o.prev_consumed_pct)::int),
        LEAST(${QUOTA_VELOCITY_SEGMENT_COUNT - 1}, CEIL(o.consumed_pct)::int - 1)
    ) AS segment(segment_index)
    WHERE o.prev_observed_at IS NOT NULL
      AND o.observed_at > o.prev_observed_at
      AND o.consumed_pct > o.prev_consumed_pct
    GROUP BY provider, model, quota_type, segment.segment_index
),
samples_by_lane AS (
    SELECT
        provider,
        model,
        quota_type,
        COUNT(*) AS sample_count
    FROM observations
    GROUP BY provider, model, quota_type
)
SELECT
    s.provider,
    s.model,
    s.quota_type,
    COALESCE(samples.sample_count, 0)::double precision AS velocity_sample_count,
    jsonb_agg((COALESCE(velocity.velocity_score, 0) > 1.0) ORDER BY segment.segment_index) AS velocity_segments,
    jsonb_agg(LEAST(COALESCE(velocity.velocity_score, 0), 10000.0) ORDER BY segment.segment_index) AS velocity_scores
FROM selected_with_duration s
CROSS JOIN generate_series(0, ${QUOTA_VELOCITY_SEGMENT_COUNT - 1}) AS segment(segment_index)
LEFT JOIN velocity_segments velocity
       ON velocity.provider = s.provider
      AND velocity.model IS NOT DISTINCT FROM s.model
      AND velocity.quota_type = s.quota_type
      AND velocity.segment_index = segment.segment_index
LEFT JOIN samples_by_lane samples
       ON samples.provider = s.provider
      AND samples.model IS NOT DISTINCT FROM s.model
      AND samples.quota_type = s.quota_type
GROUP BY s.provider, s.model, s.quota_type, samples.sample_count
ORDER BY s.provider ASC, s.model ASC NULLS FIRST, s.quota_type ASC;
`

  return { sql, values: [] }
}

function buildQuotaHistoryQuery(_searchParams) {
  // Wave 40: lookback is interval-multiplier-driven (1.5× the reset period),
  // not dashboard date-range-driven. The from/to search params are intentionally
  // ignored — each (provider, quota_key) pair looks back exactly 1.5× its own
  // actual reset cadence from now(), so short intervals (5 hr), weekly intervals
  // (7 day), and daily intervals (24 h) each get a proportional, sensible history
  // window regardless of what the operator has selected as their reporting date range.
  //
  // Bug fix: the previous implementation derived lookback from quota_type labels
  // (e.g. 'short' → 7.5 h), which was wrong for Google whose 'short' (requests)
  // quota resets every 24 h, not every 5 h like Anthropic/OpenAI short quotas.
  // Now interval_hours is computed from the median gap between consecutive
  // expected_reset_at values per (provider, quota_key), making lookback
  // proportional to the actual cadence rather than the type label.

  const sql = `
WITH
-- Derive the canonical interval duration for each (provider, quota_key) by
-- computing the gap between consecutive expected_reset_at timestamps.  We
-- use the MEDIAN of observed gaps (PERCENTILE_CONT 0.5) so that anomalous
-- back-to-back changes or multi-day silent gaps don't skew the window.
-- The result drives the 1.5× lookback rule per-row instead of relying on
-- quota_type string matching, which broke for providers (e.g. Google) that
-- share a quota_type label but use a different reset cadence from the
-- hard-coded expectation (e.g. Google short=24h vs Anthropic short=5h).
-- Step 1: compute per-row gap (hours) between consecutive expected_reset_at
-- timestamps for each (provider, quota_key) pair.
-- Sub-minute gaps (< 1 h) arise when multiple rapid observations land in the
-- same reset window with slightly different timestamps (e.g. 1-2 s apart).
-- These near-zero gaps must be excluded BEFORE the percentile computation;
-- otherwise, when a key has many same-window duplicates, the median falls
-- in the near-zero bucket and the computed interval collapses to ~0 h
-- (floored to 1 h), producing a ~1.5 h lookback for a weekly key.
quota_key_gaps AS (
    SELECT
        provider,
        quota_key,
        quota_type,
        EXTRACT(EPOCH FROM (
            expected_reset_at
            - LAG(expected_reset_at) OVER (
                PARTITION BY provider, quota_key
                ORDER BY expected_reset_at
            )
        )) / 3600.0 AS gap_hours
    FROM (
        SELECT DISTINCT provider, quota_key, quota_type, expected_reset_at
        FROM public.rate_limit_intervals
        WHERE quota_type IN ('weekly', 'weekly_special', 'short', 'short_special', 'requests', 'monthly')
          AND expected_reset_at IS NOT NULL
    ) distinct_resets
),
-- Step 2: aggregate to the median gap per (provider, quota_key).
-- Only gaps >= 1 h are considered — this excludes sub-minute noise from
-- rapid duplicate observations within the same reset window.
-- We also track gap_count so the caller can require >= 2 qualifying samples
-- before trusting the median (fewer samples → fall back to quota_type default).
quota_key_interval_hours AS (
    SELECT
        provider,
        quota_key,
        quota_type,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_hours) AS interval_hours,
        COUNT(*) AS gap_count
    FROM quota_key_gaps
    WHERE gap_hours >= 1.0   -- skip first-row NULLs and sub-minute noise gaps
    GROUP BY provider, quota_key, quota_type
),
normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ri.quota_type AS raw_quota_type,
        ri.quota_key,
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local/%' THEN 'local'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'
            ELSE COALESCE(ri.provider, 'unknown')
        END AS provider,
        CASE
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END AS model,
        CASE
            WHEN ri.quota_type = 'requests'
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN 'monthly'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start,
        -- interval_hours drives all lookback/upper-bound arithmetic below so
        -- that every provider × quota_key uses its own actual reset cadence.
        -- Two-tier fallback strategy:
        --   1. Use the median observed gap when >= 2 qualifying (>= 1 h) gaps
        --      exist — this is robust for both well-sampled and sparse keys.
        --   2. Fall back to a hardcoded quota_type-based default otherwise
        --      (brand-new key with 0-1 qualifying gaps, e.g. first week of a
        --      weekly quota that has only one real reset observed so far, or
        --      a key whose median was dominated by sub-minute noise gaps).
        -- The CASE WHEN gap_count >= 2 guard ensures we never use a median
        -- derived from a single data point, which could be an outlier.
        COALESCE(
            CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
            CASE
                WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                WHEN ri.quota_type = 'monthly'                    THEN 720.0
                ELSE                                                   168.0
            END
        ) AS interval_hours
    FROM public.rate_limit_intervals ri
    LEFT JOIN quota_key_interval_hours kh
           ON kh.provider  = ri.provider
          AND kh.quota_key = ri.quota_key
    -- 1.5× per-row interval lookback: each bar window is sized to 1.5× its own
    -- actual reset cadence, regardless of quota_type label.  Examples:
    --   Anthropic short (5 h)  → look back  7.5 h
    --   Anthropic weekly (7 d) → look back 10.5 d
    --   Google short (24 h)    → look back 36 h   ← was broken at 10.5 d
    --   xAI monthly (30 d)     → look back 45 d
    -- Upper bound: allow up to 2.0× interval_hours into the future.  This is
    -- intentionally generous so that prior-interval rows whose expected_reset_at
    -- sits in the near-future (e.g. a weekly cycle whose reset got pushed out
    -- from May 24 → May 26 while observations still carry the May 24 timestamp)
    -- are captured as prior bars.  The current bar is sourced from the live
    -- buildQuotaQuery() result, not from this history query; the client-side
    -- ±30 min dedup against the live current bar's reset time prevents any
    -- overlap from appearing as a spurious extra bar.
    --   Anthropic short (5 h)   → upper +10 h
    --   OpenAI/Anthropic weekly → upper +14 d
    --   Google short (24 h)     → upper +48 h
    --   xAI monthly (30 d)      → upper +60 d
    WHERE ri.quota_type IN ('weekly', 'weekly_special', 'short', 'short_special', 'requests', 'monthly')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.expected_reset_at >= now() - (
              COALESCE(
                  CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                  CASE
                      WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                      WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                      WHEN ri.quota_type = 'monthly'                    THEN 720.0
                      ELSE                                                   168.0
                  END
              ) * 1.5 * INTERVAL '1 hour'
          )
      AND ri.expected_reset_at < now() + (
              COALESCE(
                  CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                  CASE
                      WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                      WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                      WHEN ri.quota_type = 'monthly'                    THEN 720.0
                      ELSE                                                   168.0
                  END
              ) * 2.0 * INTERVAL '1 hour'
          )
),
history_observations AS (
    SELECT
        n.provider,
        n.model,
        n.quota_type,
        n.expected_reset_at,
        MAX(n.interval_hours)::double precision AS interval_hours,
        o.observed_at,
        MAX(GREATEST(0, LEAST(100, 100 - o.remaining_pct))) AS consumed_pct
    FROM normalized n
    JOIN public.rate_limit_observations o
      ON n.quota_key IS NOT NULL
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.remaining_pct IS NOT NULL
     AND o.remaining_pct >= 0
     AND o.observed_at IS NOT NULL
     AND o.observed_at >= n.interval_start - INTERVAL '5 minutes'
     AND o.observed_at <= n.expected_reset_at + INTERVAL '5 minutes'
    GROUP BY n.provider, n.model, n.quota_type, n.expected_reset_at, o.observed_at
),
ordered_history_observations AS (
    SELECT
        *,
        LAG(consumed_pct) OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type, expected_reset_at
            ORDER BY observed_at ASC
        ) AS prev_consumed_pct,
        LAG(observed_at) OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type, expected_reset_at
            ORDER BY observed_at ASC
        ) AS prev_observed_at
    FROM history_observations
),
history_velocity_segments AS (
    SELECT
        provider,
        model,
        quota_type,
        expected_reset_at,
        segment.segment_index,
        MAX(
            (o.consumed_pct - o.prev_consumed_pct)
            * o.interval_hours
            * 36.0
            / NULLIF(EXTRACT(EPOCH FROM (o.observed_at - o.prev_observed_at)), 0)
        )::double precision AS velocity_score
    FROM ordered_history_observations o
    CROSS JOIN LATERAL generate_series(
        GREATEST(0, FLOOR(o.prev_consumed_pct)::int),
        LEAST(${QUOTA_VELOCITY_SEGMENT_COUNT - 1}, CEIL(o.consumed_pct)::int - 1)
    ) AS segment(segment_index)
    WHERE o.prev_observed_at IS NOT NULL
      AND o.observed_at > o.prev_observed_at
      AND o.consumed_pct > o.prev_consumed_pct
    GROUP BY provider, model, quota_type, expected_reset_at, segment.segment_index
),
history_velocity_samples AS (
    SELECT
        provider,
        model,
        quota_type,
        expected_reset_at,
        COUNT(*) AS sample_count
    FROM history_observations
    GROUP BY provider, model, quota_type, expected_reset_at
),
history_velocity_arrays AS (
    SELECT
        lanes.provider,
        lanes.model,
        lanes.quota_type,
        lanes.expected_reset_at,
        COALESCE(samples.sample_count, 0)::double precision AS velocity_sample_count,
        jsonb_agg((COALESCE(velocity.velocity_score, 0) > 1.0) ORDER BY segment.segment_index) AS velocity_segments,
        jsonb_agg(LEAST(COALESCE(velocity.velocity_score, 0), 10000.0) ORDER BY segment.segment_index) AS velocity_scores
    FROM (
        SELECT DISTINCT provider, model, quota_type, expected_reset_at
        FROM normalized
    ) lanes
    CROSS JOIN generate_series(0, ${QUOTA_VELOCITY_SEGMENT_COUNT - 1}) AS segment(segment_index)
    LEFT JOIN history_velocity_segments velocity
           ON velocity.provider = lanes.provider
          AND velocity.model IS NOT DISTINCT FROM lanes.model
          AND velocity.quota_type = lanes.quota_type
          AND velocity.expected_reset_at IS NOT DISTINCT FROM lanes.expected_reset_at
          AND velocity.segment_index = segment.segment_index
    LEFT JOIN history_velocity_samples samples
           ON samples.provider = lanes.provider
          AND samples.model IS NOT DISTINCT FROM lanes.model
          AND samples.quota_type = lanes.quota_type
          AND samples.expected_reset_at IS NOT DISTINCT FROM lanes.expected_reset_at
    GROUP BY lanes.provider, lanes.model, lanes.quota_type, lanes.expected_reset_at, samples.sample_count
),
window_bounds AS (
    SELECT
        provider,
        model,
        quota_type,
        expected_reset_at,
        MIN(interval_start) AS interval_start,
        MIN(remaining_pct)::double precision AS min_remaining_pct,
        MAX(remaining_pct)::double precision AS max_remaining_pct
    FROM normalized
    GROUP BY provider, model, quota_type, expected_reset_at
),
per_model_usage AS (
    SELECT
        wb.provider,
        wb.model AS quota_model,
        wb.quota_type,
        wb.expected_reset_at,
        COALESCE(sh.model, 'unknown') AS sh_model,
        SUM(
            COALESCE(sh.input_tokens, 0)
            + COALESCE(sh.output_tokens, 0)
            + COALESCE(sh.cache_read_input_tokens, 0)
            + COALESCE(sh.cache_creation_input_tokens, 0)
            + COALESCE(sh.reasoning_tokens_reported, 0)
            + COALESCE(sh.reasoning_tokens_estimated, 0)
        )::double precision AS tokens,
        SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS cost,
        COUNT(*)::double precision AS traces
    FROM window_bounds wb
    JOIN public.session_history sh
      ON (
              CASE
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
                  ELSE COALESCE(sh.provider, 'unknown')
              END
          ) = wb.provider
      -- Wave 35-C2 (⚠-7): use start_time (with created_at fallback) to match
      -- the live quota query (buildQuotaQuery), which also anchors on
      -- sh.start_time. Using created_at here caused sessions near quota-reset
      -- boundaries to appear in the wrong historical interval because
      -- created_at (record persistence time) can lag start_time by minutes.
      AND COALESCE(sh.start_time, sh.created_at) >= wb.interval_start
      AND COALESCE(sh.start_time, sh.created_at) < wb.expected_reset_at
      AND (wb.model IS NULL OR sh.model = wb.model)
    GROUP BY wb.provider, wb.model, wb.quota_type, wb.expected_reset_at, COALESCE(sh.model, 'unknown')
)
SELECT
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.expected_reset_at,
    wb.interval_start,
    wb.expected_reset_at AS interval_end,
    wb.min_remaining_pct,
    wb.max_remaining_pct,
    COALESCE(hv.velocity_sample_count, 0)::double precision AS velocity_sample_count,
    COALESCE(hv.velocity_segments, '[]'::jsonb) AS velocity_segments,
    COALESCE(hv.velocity_scores, '[]'::jsonb) AS velocity_scores,
    COALESCE(SUM(pmu.tokens), 0)::double precision AS usage_tokens,
    COALESCE(
        json_agg(
            json_build_object(
                'model', pmu.sh_model,
                'tokens', pmu.tokens,
                'cost', pmu.cost,
                'traces', pmu.traces
            )
            ORDER BY pmu.tokens DESC
        ) FILTER (WHERE pmu.sh_model IS NOT NULL),
        '[]'::json
    ) AS usage_breakdown
FROM window_bounds wb
LEFT JOIN per_model_usage pmu
  ON pmu.provider = wb.provider
  AND pmu.quota_type = wb.quota_type
  AND pmu.expected_reset_at = wb.expected_reset_at
  AND (pmu.quota_model IS NOT DISTINCT FROM wb.model)
LEFT JOIN history_velocity_arrays hv
  ON hv.provider = wb.provider
  AND hv.model IS NOT DISTINCT FROM wb.model
  AND hv.quota_type = wb.quota_type
  AND hv.expected_reset_at IS NOT DISTINCT FROM wb.expected_reset_at
GROUP BY
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.expected_reset_at,
    wb.interval_start,
    wb.min_remaining_pct,
    wb.max_remaining_pct,
    hv.velocity_sample_count,
    hv.velocity_segments,
    hv.velocity_scores
ORDER BY wb.expected_reset_at DESC;
`

  return { sql, values: [] }
}

function buildFreshnessQuery() {
  return {
    sql: 'SELECT MAX(sh.created_at) AS latest_record_at FROM public.session_history sh;',
    values: [],
  }
}

// Wave 33: per-(provider, model) tool-activity breakdown.
// CTE 1 (outer_counts): raw call counts keyed by (provider, model, tool_kind, tool_name).
// CTE 2 (shell_labels): normalized command labels for tool_kind='command' rows,
//   skipping noise tokens and stripping flag-only second words.
// Final SELECT emits two kinds of rows:
//   kind='outer' — one row per (provider, model, tool_name)
//   kind='shell' — one row per (provider, model, cmd_label) for command rows
// Both are filtered to the caller's from/to date window via session_history.created_at.
function buildToolActivityQuery(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = [from, to]

  // Inline the same provider-normalisation CASE that providerDimension uses,
  // but referenced against sh.provider (the authoritative join column).
  const providerExpr = `
CASE
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(sh.provider, 'unknown')
END`

  const sql = `
WITH outer_counts AS (
    SELECT
        ${providerExpr} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        COALESCE(a.tool_kind, 'other') AS tool_kind,
        a.tool_name,
        COUNT(*)::bigint AS calls
    FROM public.session_history_tool_activity a
    JOIN public.session_history sh ON a.litellm_call_id = sh.litellm_call_id
    WHERE ${createdAtDateRangeWhere.join('\n      AND ')}
    GROUP BY
        ${providerExpr},
        COALESCE(sh.model, 'unknown'),
        COALESCE(a.tool_kind, 'other'),
        a.tool_name
),
shell_labels AS (
    SELECT
        ${providerExpr} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        trim(
            CASE
                WHEN lower(split_part(trim(a.command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(a.command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(a.command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(a.command_text), ' ', 1))
            END
        ) AS cmd_label,
        COUNT(*)::bigint AS calls
    FROM public.session_history_tool_activity a
    JOIN public.session_history sh ON a.litellm_call_id = sh.litellm_call_id
    WHERE ${createdAtDateRangeWhere.join('\n      AND ')}
      AND a.tool_kind = 'command'
      AND a.command_text IS NOT NULL
      AND a.command_text <> ''
      AND lower(split_part(trim(a.command_text), ' ', 1)) NOT IN (
          'cd','pwd','echo',':','true','false','exit'
      )
    GROUP BY
        ${providerExpr},
        COALESCE(sh.model, 'unknown'),
        trim(
            CASE
                WHEN lower(split_part(trim(a.command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(a.command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(a.command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(a.command_text), ' ', 1))
            END
        )
)
SELECT
    provider,
    model,
    'outer' AS kind,
    tool_name AS label,
    calls
FROM outer_counts
UNION ALL
SELECT
    provider,
    model,
    'shell' AS kind,
    cmd_label AS label,
    calls
FROM shell_labels
ORDER BY provider ASC, model ASC, kind ASC, calls DESC;
`

  return { sql, values }
}

function normalizeToolActivityRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    kind: row.kind,
    label: row.label,
    calls: normalizeNumber(row.calls) ?? 0,
  }
}

async function loadQuotaReport(options = {}) {
  return cachedReport('quotas', loadQuotaReportFromDatabase, {
    decorateMetadata: options.decorateMetadata,
  })
}

async function loadQuotaReportFromDatabase() {
  const quotaQuery = buildQuotaQuery()
  const quotaVelocityQuery = buildQuotaVelocityQuery()
  const freshnessQuery = buildFreshnessQuery()
  const [quotaResult, quotaVelocityResult, freshnessResult] = await Promise.all([
    pool.query(quotaQuery.sql, quotaQuery.values),
    pool.query(quotaVelocityQuery.sql, quotaVelocityQuery.values),
    pool.query(freshnessQuery.sql, freshnessQuery.values),
  ])
  const freshness = buildFreshnessMetadata(
    firstRow(freshnessResult).latest_record_at
  )
  const quotaVelocityRowsByLane = buildQuotaVelocityRowsByLane(
    quotaVelocityResult.rows
  )

  return {
    metadata: {
      ...freshness,
      staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
    },
    quotas: quotaResult.rows
      .map((row) => attachQuotaVelocityRows(row, quotaVelocityRowsByLane))
      .map(normalizeQuotaRow),
  }
}

function normalizeSummary(row) {
  return {
    traces: normalizeNumber(row.traces) ?? 0,
    token_in: normalizeNumber(row.token_in) ?? 0,
    token_out: normalizeNumber(row.token_out) ?? 0,
    token_cache_input: normalizeNumber(row.token_cache_input) ?? 0,
    token_cache_creation: normalizeNumber(row.token_cache_creation) ?? 0,
    token_reasoning_reported:
      normalizeNumber(row.token_reasoning_reported) ?? 0,
    token_reasoning_estimated:
      normalizeNumber(row.token_reasoning_estimated) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    cache_miss_usd_cost: normalizeNumber(row.cache_miss_usd_cost) ?? 0,
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
    git_commit: normalizeNumber(row.git_commit) ?? 0,
    git_push: normalizeNumber(row.git_push) ?? 0,
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    latest_record_at: row.latest_record_at ?? null,
  }
}

function normalizeTrendRow(row) {
  return {
    bucket: row.bucket,
    provider: row.provider,
    model: row.model,
    repository: row.repository,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeTokenTrendHourRow(row) {
  return {
    day: row.day,
    hour: normalizeNumber(row.hour) ?? 0,
    provider: row.provider,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeTokenTrendVersionIntervalRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    client_name: row.client_name ?? 'unknown',
    client_version: row.client_version ?? '0.0.0',
    first_seen_at: row.first_seen_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    first_seen_day: row.first_seen_day ?? null,
    first_seen_hour: normalizeNumber(row.first_seen_hour),
    last_seen_day: row.last_seen_day ?? null,
    last_seen_hour: normalizeNumber(row.last_seen_hour),
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeTokenTrendDayDetailRow(row) {
  return {
    day: row.day,
    hour: normalizeNumber(row.hour) ?? 0,
    provider: row.provider ?? 'unknown',
    client_name: row.client_name ?? 'unknown',
    client_version: row.client_version ?? '0.0.0',
    first_seen_at: row.first_seen_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeClientUsageRow(row) {
  return {
    client_name: row.client_name ?? 'unknown',
    client_version: row.client_version ?? '0.0.0',
    first_seen_at: row.first_seen_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeTextList(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || null
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value).trim()
  return text || null
}

function normalizeProviderLatencyHealthRow(row) {
  return {
    bucket_start: row.bucket_start ?? null,
    environment: row.environment ?? 'unknown',
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    model_group: row.model_group ?? 'unknown',
    requests: normalizeNumber(row.requests) ?? 0,
    passive_latency_sample_status:
      normalizeTextList(row.passive_latency_sample_status) ?? 'unknown',
    upstream_p50_ms: normalizeNumber(row.upstream_p50_ms),
    upstream_p95_ms: normalizeNumber(row.upstream_p95_ms),
    upstream_p99_ms: normalizeNumber(row.upstream_p99_ms),
    total_p95_ms: normalizeNumber(row.total_p95_ms),
    proxy_processing_p95_ms: normalizeNumber(row.proxy_processing_p95_ms),
    missing_upstream_latency:
      normalizeNumber(row.missing_upstream_latency) ?? 0,
    provider_error_events: normalizeNumber(row.provider_error_events) ?? 0,
    rate_limit_events: normalizeNumber(row.rate_limit_events) ?? 0,
    capacity_events: normalizeNumber(row.capacity_events) ?? 0,
    provider_5xx_events: normalizeNumber(row.provider_5xx_events) ?? 0,
    provider_timeout_events: normalizeNumber(row.provider_timeout_events) ?? 0,
    network_error_events: normalizeNumber(row.network_error_events) ?? 0,
    auth_failed_events: normalizeNumber(row.auth_failed_events) ?? 0,
    adapter_error_events: normalizeNumber(row.adapter_error_events) ?? 0,
    status_probe_count: normalizeNumber(row.status_probe_count) ?? 0,
    status_probe_success_pct: normalizeNumber(row.status_probe_success_pct),
    status_probe_p95_ms: normalizeNumber(row.status_probe_p95_ms),
    provider_ping_avg_ms: normalizeNumber(row.provider_ping_avg_ms),
    provider_ping_packet_loss_pct: normalizeNumber(
      row.provider_ping_packet_loss_pct
    ),
    control_ping_avg_ms: normalizeNumber(row.control_ping_avg_ms),
    control_packet_loss_pct: normalizeNumber(row.control_packet_loss_pct),
    control_probe_success_pct: normalizeNumber(row.control_probe_success_pct),
    provider_ping_minus_control_ms: normalizeNumber(
      row.provider_ping_minus_control_ms
    ),
    dns_failures: normalizeNumber(row.dns_failures) ?? 0,
    tcp_failures: normalizeNumber(row.tcp_failures) ?? 0,
    tls_failures: normalizeNumber(row.tls_failures) ?? 0,
    icmp_failures: normalizeNumber(row.icmp_failures) ?? 0,
    probed_endpoints: normalizeTextList(row.probed_endpoints),
    status_error_classes: normalizeTextList(row.status_error_classes),
    min_remaining_pct: normalizeNumber(row.min_remaining_pct),
    max_remaining_pct: normalizeNumber(row.max_remaining_pct),
    next_expected_reset_at: row.next_expected_reset_at ?? null,
    quota_keys: normalizeTextList(row.quota_keys),
    request_period_start: row.request_period_start ?? null,
    request_period_end: row.request_period_end ?? null,
  }
}

function normalizeProviderErrorObservationRow(row) {
  return {
    observed_at: row.observed_at ?? null,
    environment: row.environment ?? 'unknown',
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    model_group: row.model_group ?? 'unknown',
    route_family: row.route_family ?? 'unknown',
    status_code: normalizeNumber(row.status_code),
    error_type: row.error_type ?? 'unknown',
    error_code: row.error_code ?? 'unknown',
    error_class: row.error_class ?? 'unknown',
    error_message: row.error_message ?? null,
    retry_after_seconds: normalizeNumber(row.retry_after_seconds),
    expected_reset_at: row.expected_reset_at ?? null,
  }
}

function normalizeProviderStatusUsageRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
  }
}

function normalizeUsageBreakdown(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    model: item?.model ?? 'unknown',
    tokens: normalizeNumber(item?.tokens) ?? 0,
    cost: normalizeNumber(item?.cost) ?? 0,
    traces: normalizeNumber(item?.traces) ?? 0,
  }))
}


function normalizeQuotaVelocityScores(value) {
  if (!Array.isArray(value)) return []

  return value.slice(0, QUOTA_VELOCITY_SEGMENT_COUNT).map((entry) => {
    const score = normalizeNumber(entry) ?? 0
    return Math.max(0, Math.min(10000, score))
  })
}

function normalizeQuotaVelocitySegments(value) {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, QUOTA_VELOCITY_SEGMENT_COUNT)
    .map((entry) => Boolean(entry))
}

function quotaVelocityLaneKey(provider, model, quotaType) {
  return [provider ?? 'unknown', model ?? '', quotaType].join('\u0000')
}

function buildQuotaVelocityRowsByLane(rows) {
  const byLane = new Map()
  for (const row of rows) {
    byLane.set(
      quotaVelocityLaneKey(row.provider, row.model, row.quota_type),
      row
    )
  }
  return byLane
}

function attachQuotaVelocityRows(row, quotaVelocityRowsByLane) {
  const merged = { ...row }
  for (const quotaType of [
    'weekly',
    'short',
    'special',
    'short_special',
    'monthly',
  ]) {
    const velocityRow = quotaVelocityRowsByLane.get(
      quotaVelocityLaneKey(row.provider, row.model, quotaType)
    )
    merged[`${quotaType}_velocity_segments`] =
      velocityRow?.velocity_segments ?? []
    merged[`${quotaType}_velocity_scores`] = velocityRow?.velocity_scores ?? []
    merged[`${quotaType}_velocity_sample_count`] =
      velocityRow?.velocity_sample_count ?? 0
  }
  return merged
}

function normalizeQuotaRow(row) {
  return {
    provider: row.provider,
    model: row.model ?? null,
    weekly_remaining_pct: normalizeNumber(row.weekly_remaining_pct),
    weekly_reset_at: row.weekly_reset_at ?? null,
    weekly_interval_start: row.weekly_interval_start ?? null,
    weekly_interval_end: row.weekly_interval_end ?? null,
    weekly_active: Boolean(normalizeNumber(row.weekly_active)),
    weekly_usage_tokens: normalizeNumber(row.weekly_usage_tokens) ?? 0,
    weekly_usage_breakdown: normalizeUsageBreakdown(
      row.weekly_usage_breakdown
    ),
    weekly_velocity_segments: normalizeQuotaVelocitySegments(
      row.weekly_velocity_segments
    ),
    weekly_velocity_scores: normalizeQuotaVelocityScores(
      row.weekly_velocity_scores
    ),
    weekly_velocity_sample_count:
      normalizeNumber(row.weekly_velocity_sample_count) ?? 0,
    short_remaining_pct: normalizeNumber(row.short_remaining_pct),
    short_reset_at: row.short_reset_at ?? null,
    short_interval_start: row.short_interval_start ?? null,
    short_interval_end: row.short_interval_end ?? null,
    short_active: Boolean(normalizeNumber(row.short_active)),
    short_usage_tokens: normalizeNumber(row.short_usage_tokens) ?? 0,
    short_usage_breakdown: normalizeUsageBreakdown(row.short_usage_breakdown),
    short_velocity_segments: normalizeQuotaVelocitySegments(
      row.short_velocity_segments
    ),
    short_velocity_scores: normalizeQuotaVelocityScores(
      row.short_velocity_scores
    ),
    short_velocity_sample_count:
      normalizeNumber(row.short_velocity_sample_count) ?? 0,
    special_remaining_pct: normalizeNumber(row.special_remaining_pct),
    special_reset_at: row.special_reset_at ?? null,
    special_interval_start: row.special_interval_start ?? null,
    special_interval_end: row.special_interval_end ?? null,
    special_active: Boolean(normalizeNumber(row.special_active)),
    special_usage_tokens: normalizeNumber(row.special_usage_tokens) ?? 0,
    special_usage_breakdown: normalizeUsageBreakdown(
      row.special_usage_breakdown
    ),
    special_velocity_segments: normalizeQuotaVelocitySegments(
      row.special_velocity_segments
    ),
    special_velocity_scores: normalizeQuotaVelocityScores(
      row.special_velocity_scores
    ),
    special_velocity_sample_count:
      normalizeNumber(row.special_velocity_sample_count) ?? 0,
    short_special_remaining_pct: normalizeNumber(
      row.short_special_remaining_pct
    ),
    short_special_reset_at: row.short_special_reset_at ?? null,
    short_special_interval_start: row.short_special_interval_start ?? null,
    short_special_interval_end: row.short_special_interval_end ?? null,
    short_special_active: Boolean(normalizeNumber(row.short_special_active)),
    short_special_usage_tokens:
      normalizeNumber(row.short_special_usage_tokens) ?? 0,
    short_special_usage_breakdown: normalizeUsageBreakdown(
      row.short_special_usage_breakdown
    ),
    short_special_velocity_segments: normalizeQuotaVelocitySegments(
      row.short_special_velocity_segments
    ),
    short_special_velocity_scores: normalizeQuotaVelocityScores(
      row.short_special_velocity_scores
    ),
    short_special_velocity_sample_count:
      normalizeNumber(row.short_special_velocity_sample_count) ?? 0,
    monthly_remaining_pct: normalizeNumber(row.monthly_remaining_pct),
    monthly_reset_at: row.monthly_reset_at ?? null,
    monthly_interval_start: row.monthly_interval_start ?? null,
    monthly_interval_end: row.monthly_interval_end ?? null,
    monthly_active: Boolean(normalizeNumber(row.monthly_active)),
    monthly_usage_tokens: normalizeNumber(row.monthly_usage_tokens) ?? 0,
    monthly_usage_breakdown: normalizeUsageBreakdown(
      row.monthly_usage_breakdown
    ),
    monthly_velocity_segments: normalizeQuotaVelocitySegments(
      row.monthly_velocity_segments
    ),
    monthly_velocity_scores: normalizeQuotaVelocityScores(
      row.monthly_velocity_scores
    ),
    monthly_velocity_sample_count:
      normalizeNumber(row.monthly_velocity_sample_count) ?? 0,
  }
}

function normalizeQuotaHistoryRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? null,
    quota_type: row.quota_type ?? 'unknown',
    expected_reset_at: row.expected_reset_at ?? null,
    interval_start: row.interval_start ?? null,
    interval_end: row.interval_end ?? null,
    min_remaining_pct: normalizeNumber(row.min_remaining_pct),
    max_remaining_pct: normalizeNumber(row.max_remaining_pct),
    velocity_segments: normalizeQuotaVelocitySegments(row.velocity_segments),
    velocity_scores: normalizeQuotaVelocityScores(row.velocity_scores),
    velocity_sample_count: normalizeNumber(row.velocity_sample_count) ?? 0,
    usage_tokens: normalizeNumber(row.usage_tokens) ?? 0,
    usage_breakdown: Array.isArray(row.usage_breakdown)
      ? row.usage_breakdown.map((b) => ({
          model: b.model ?? 'unknown',
          tokens: normalizeNumber(b.tokens) ?? 0,
          cost: normalizeNumber(b.cost) ?? 0,
          traces: normalizeNumber(b.traces) ?? 0,
        }))
      : [],
  }
}

function buildFreshnessMetadata(latestRecordAt) {
  const generatedAt = new Date()
  if (!latestRecordAt) {
    return {
      generatedAt: generatedAt.toISOString(),
      latestRecordAt: null,
      latestRecordAgeMinutes: null,
      latestRecordStale: true,
    }
  }

  const latest = new Date(latestRecordAt)
  const ageMinutes = Math.max(
    0,
    Math.round((generatedAt.getTime() - latest.getTime()) / 60_000)
  )

  return {
    generatedAt: generatedAt.toISOString(),
    latestRecordAt: latest.toISOString(),
    latestRecordAgeMinutes: ageMinutes,
    latestRecordStale: ageMinutes > STALE_RECORD_THRESHOLD_MINUTES,
  }
}

function proxyTargetUrl(req, proxyConfig) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const base = new URL(proxyConfig.target)
  const prefixPattern = new RegExp(`^${escapeRegExp(proxyConfig.prefix)}\\/?`)
  const rewrittenPath = requestUrl.pathname.replace(prefixPattern, '/')
  base.pathname = joinUrlPath(base.pathname, rewrittenPath)
  base.search = requestUrl.search
  return base
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function joinUrlPath(basePath, requestPath) {
  const normalizedBase = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath
  const normalizedRequest = requestPath.startsWith('/')
    ? requestPath
    : `/${requestPath}`
  return `${normalizedBase}${normalizedRequest}`
}

function proxyHeaders(req, proxyConfig) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || CLIENT_AUTH_HEADERS.has(lowerKey)) {
      continue
    }
    if (Array.isArray(value)) {
      headers[key] = value.join(', ')
    } else if (value !== undefined) {
      headers[key] = value
    }
  }

  if (proxyConfig.apiKey) {
    headers['X-API-Key'] = proxyConfig.apiKey
  }
  if (proxyConfig.accessToken) {
    headers.Authorization = proxyConfig.accessToken.toLowerCase().startsWith(
      'bearer '
    )
      ? proxyConfig.accessToken
      : `Bearer ${proxyConfig.accessToken}`
  }
  if (proxyConfig.adminCapability) {
    headers['X-Admin-Capability'] = proxyConfig.adminCapability
  }

  return headers
}

function responseHeaders(upstreamHeaders) {
  const headers = {}
  upstreamHeaders.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (!HOP_BY_HOP_HEADERS.has(lowerKey) && lowerKey !== 'set-cookie') {
      headers[key] = value
    }
  })
  headers['cache-control'] = headers['cache-control'] ?? 'no-store'
  return headers
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function buildUsageQuery(searchParams) {
  const grain = searchParams.get('grain') ?? 'day'
  if (!grains[grain]) {
    throw new Error(`Unsupported grain: ${grain}`)
  }

  const groupBy = parseGroupBy(searchParams.get('group_by'))
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const limit = parseLimit(searchParams.get('limit'))
  const sort = sortColumns[searchParams.get('sort') ?? 'period_end']
  if (!sort) {
    throw new Error(`Unsupported sort: ${searchParams.get('sort')}`)
  }

  const sortDirection =
    searchParams.get('direction')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const values = [from, to]
  const whereParts = [...createdAtDateRangeWhere]

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }

  values.push(limit)

  const bucketExpression = grains[grain]
  const dimensionSelects = groupBy.map(
    (key) => `${dimensions[key]} AS ${key}`
  )
  const dimensionGroups = groupBy.map((key) => dimensions[key])
  const selectParts = [`${bucketExpression} AS bucket`, ...dimensionSelects]
  const groupParts = [bucketExpression, ...dimensionGroups]

  const sql = `
SELECT
    ${selectParts.join(',\n    ')},

    MIN(weekly.expected_reset_at) AS weekly_reset_first,
    MAX(weekly.expected_reset_at) AS weekly_reset_last,
    MIN(weekly.remaining_pct) AS min_weekly_pct,
    MAX(weekly.remaining_pct) AS max_weekly_pct,

    MIN(COALESCE(short.expected_reset_at, requests.expected_reset_at)) AS short_reset_first,
    MAX(COALESCE(short.expected_reset_at, requests.expected_reset_at)) AS short_reset_last,
    MIN(COALESCE(short.remaining_pct, requests.remaining_pct)) AS min_short_pct,
    MAX(COALESCE(short.remaining_pct, requests.remaining_pct)) AS max_short_pct,

    MIN(weekly_special.expected_reset_at) AS weekly_reset_special_first,
    MAX(weekly_special.expected_reset_at) AS weekly_reset_special_last,
    MIN(weekly_special.remaining_pct) AS min_weekly_pct_special,
    MAX(weekly_special.remaining_pct) AS max_weekly_pct_special,

    MIN(short_special.expected_reset_at) AS short_reset_special_first,
    MAX(short_special.expected_reset_at) AS short_reset_special_last,
    MIN(short_special.remaining_pct) AS min_short_pct_special,
    MAX(short_special.remaining_pct) AS max_short_pct_special,

    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0))::double precision AS token_in,
    SUM(COALESCE(sh.output_tokens, 0))::double precision AS token_out,
    SUM(COALESCE(sh.cache_read_input_tokens, 0))::double precision AS token_cache_input,
    SUM(COALESCE(sh.cache_creation_input_tokens, 0))::double precision AS token_cache_creation,

    STRING_AGG(DISTINCT
        CASE WHEN sh.reasoning_tokens_source = 'not_applicable'
             THEN NULL
             ELSE sh.reasoning_tokens_source
        END, ', ') AS reasoning_tokens_sources,

    SUM(COALESCE(sh.reasoning_tokens_reported, 0))::double precision AS token_reasoning_reported,
    SUM(COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_reasoning_estimated,

    MAX(CASE WHEN sh.provider_cache_attempted THEN 'attempted' ELSE NULL END) AS cache_attempted_summary,
    MAX(CASE WHEN sh.provider_cache_miss THEN 'miss' ELSE NULL END) AS cache_miss_summary,

    STRING_AGG(DISTINCT
        CASE WHEN sh.provider_cache_miss_reason IS NOT NULL
                  AND sh.provider_cache_miss_reason <> 'null'
             THEN sh.provider_cache_miss_reason
             ELSE NULL
        END, ', ') AS cache_miss_reasons,

    SUM(COALESCE(sh.provider_cache_miss_token_count, 0))::double precision AS token_cache_miss,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.provider_cache_miss_cost_usd, 0))::double precision AS cache_miss_usd_cost,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push,

    ROUND(CAST(SUM(COALESCE(sh.litellm_processing_ms, 0)) AS numeric), 2)::double precision AS litellm_processing_total_ms,
    ROUND(CAST(AVG(sh.litellm_processing_ms) AS numeric), 2)::double precision AS litellm_processing_average_ms,

    ROUND(CAST(SUM(COALESCE(sh.llm_upstream_elapsed_ms, 0)) AS numeric), 2)::double precision AS llm_upstream_elapsed_total_ms,
    ROUND(CAST(AVG(sh.llm_upstream_elapsed_ms) AS numeric), 2)::double precision AS llm_upstream_elapsed_average_ms,

    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end
FROM public.session_history sh
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'weekly'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) weekly ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'short'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) short ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'weekly_special'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) weekly_special ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'short_special'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) short_special ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = replace(sh.provider, 'gemini', 'google')
      AND ri.quota_type = 'requests'
      AND ri.model = sh.model
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) requests ON true
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${groupParts.join(',\n    ')}
ORDER BY ${sort} ${sortDirection}
LIMIT $${values.length};
`

  return { sql, values, metadata: { from, to, grain, groupBy, limit } }
}

async function loadUsageReport(searchParams) {
  const { sql, values, metadata } = buildUsageQuery(searchParams)
  const summaryQuery = buildSummaryQuery(searchParams)
  const trendQuery = buildTrendQuery(searchParams)
  const clientUsageQuery = buildClientUsageQuery(searchParams)
  const providerLatencyHealthQuery = buildProviderLatencyHealthQuery(searchParams)
  const providerErrorObservationQuery =
    buildProviderErrorObservationQuery(searchParams)
  const providerStatusUsageQuery = buildProviderStatusUsageQuery(searchParams)
  const quotaHistoryQuery = buildQuotaHistoryQuery(searchParams)
  const toolActivityQuery = buildToolActivityQuery(searchParams)

  const [
    result,
    summaryResult,
    trendResult,
    clientUsageResult,
    providerLatencyHealthResult,
    providerErrorObservationResult,
    providerStatusUsageResult,
    quotaHistoryResult,
    toolActivityResult,
    quotaReport,
  ] = await runTasksWithConcurrency(
    [
      () => pool.query(sql, values),
      () => pool.query(summaryQuery.sql, summaryQuery.values),
      () => pool.query(trendQuery.sql, trendQuery.values),
      () => pool.query(clientUsageQuery.sql, clientUsageQuery.values),
      () =>
        pool.query(
          providerLatencyHealthQuery.sql,
          providerLatencyHealthQuery.values
        ),
      () =>
        pool.query(
          providerErrorObservationQuery.sql,
          providerErrorObservationQuery.values
        ),
      () => pool.query(providerStatusUsageQuery.sql, providerStatusUsageQuery.values),
      () => pool.query(quotaHistoryQuery.sql, quotaHistoryQuery.values),
      () => pool.query(toolActivityQuery.sql, toolActivityQuery.values),
      () => loadQuotaReport({ decorateMetadata: false }),
    ],
    REPORT_SQL_FANOUT_CONCURRENCY
  )

  const rows = result.rows.map(normalizeRow)
  const summary = normalizeSummary(firstRow(summaryResult))

  // Wave 35-C2 (⚠-8): warn when health rows approach MAX_HEALTH_ROWS cap.
  // At >75% utilisation the oldest fleet-pulse buckets risk silent truncation
  // as provider/model diversity grows. Surface this before it becomes data loss.
  const healthRowCount = providerLatencyHealthResult.rows.length
  if (healthRowCount > MAX_HEALTH_ROWS * 0.75) {
    process.stderr.write(
      `[report-service] WARN: providerLatencyHealth returned ${healthRowCount} rows` +
        ` (${Math.round((healthRowCount / MAX_HEALTH_ROWS) * 100)}% of MAX_HEALTH_ROWS=${MAX_HEALTH_ROWS}).` +
        ` Oldest fleet-pulse buckets may be truncated.` +
        ` Raise SHELL_REPORT_HEALTH_MAX_ROWS env var to increase the cap (hard max 20000).\n`
    )
  }

  return {
    metadata: {
      ...metadata,
      ...quotaReport.metadata,
      staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
    },
    summary,
    trend: trendResult.rows.map(normalizeTrendRow),
    clients: clientUsageResult.rows.map(normalizeClientUsageRow),
    providerLatencyHealth: providerLatencyHealthResult.rows.map(
      normalizeProviderLatencyHealthRow
    ),
    providerErrorObservations: providerErrorObservationResult.rows.map(
      normalizeProviderErrorObservationRow
    ),
    providerStatusUsage: providerStatusUsageResult.rows.map(
      normalizeProviderStatusUsageRow
    ),
    quotas: quotaReport.quotas,
    quotaHistory: quotaHistoryResult.rows.map(normalizeQuotaHistoryRow),
    toolActivity: toolActivityResult.rows.map(normalizeToolActivityRow),
    rows,
  }
}

async function loadUsageTokenTrendSummary(searchParams) {
  const hoursQuery = buildTokenTrendHoursQuery(searchParams)
  const versionsQuery = buildTokenTrendVersionIntervalsQuery(searchParams)
  const [hoursResult, versionsResult] = await runTasksWithConcurrency(
    [
      () => pool.query(hoursQuery.sql, hoursQuery.values),
      () => pool.query(versionsQuery.sql, versionsQuery.values),
    ],
    REPORT_SQL_FANOUT_CONCURRENCY
  )

  return {
    metadata: {
      from: parseDateParam(searchParams.get('from'), defaultFromDate),
      to: parseDateParam(searchParams.get('to'), defaultToDate),
    },
    tokenTrendHours: hoursResult.rows.map(normalizeTokenTrendHourRow),
    tokenTrendVersions: versionsResult.rows.map(
      normalizeTokenTrendVersionIntervalRow
    ),
  }
}

async function loadUsageTokenTrendDay(searchParams) {
  const { sql, values, metadata } = buildTokenTrendDayDetailQuery(searchParams)
  const result = await pool.query(sql, values)

  return {
    metadata,
    date: metadata.date,
    rows: result.rows.map(normalizeTokenTrendDayDetailRow),
  }
}

async function handleUsageReport(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport('usage', () => loadUsageReport(requestUrl.searchParams), {
    searchParams: requestUrl.searchParams,
  })

  sendJson(res, 200, body)
}

async function handleUsageTokenTrendSummary(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-token-trend-summary',
    () => loadUsageTokenTrendSummary(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

  sendJson(res, 200, body)
}

async function handleUsageTokenTrendDay(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-token-trend-day',
    () => loadUsageTokenTrendDay(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

  sendJson(res, 200, body)
}

async function handleUsageQuotas(_req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  sendJson(res, 200, await loadQuotaReport())
}

function startReportCachePrewarm() {
  if (!pool || !redisClient || !REPORT_CACHE_PREWARM || prewarmTimer) return

  const run = () => {
    if (prewarmPromise) return
    prewarmPromise = prewarmReportCaches()
      .catch((error) => {
        process.stderr.write(
          `[report-service] WARN: Redis report cache prewarm failed: ${formatError(error)}\n`
        )
      })
      .finally(() => {
        prewarmPromise = null
      })
  }

  const firstRun = setTimeout(run, 1_000)
  firstRun.unref?.()

  if (REPORT_CACHE_PREWARM_INTERVAL_MS > 0) {
    prewarmTimer = setInterval(run, REPORT_CACHE_PREWARM_INTERVAL_MS)
    prewarmTimer.unref?.()
  }
}

async function prewarmReportCaches() {
  if (!redisClient?.isReady) return

  const lockKey = `${REPORT_CACHE_PREFIX}:${REPORT_CACHE_VERSION}:prewarm:lock`
  const lockToken = await acquireRedisNamedLock(
    lockKey,
    REPORT_CACHE_PREWARM_LOCK_TTL_MS,
    'prewarm'
  )
  if (!lockToken) {
    process.stdout.write(
      '[report-service] Redis report cache prewarm skipped; another report service owns the prewarm lock\n'
    )
    return
  }

  try {
    const windows = buildPrewarmUsageWindows()
    process.stdout.write(
      `[report-service] prewarming Redis report cache for ${windows.length} usage windows\n`
    )

    for (const window of windows) {
      try {
        const searchParams = buildPrewarmUsageSearchParams(window.from, window.to)
        const status = await prewarmCachedReport('usage', searchParams, () =>
          loadUsageReport(searchParams)
        )
        process.stdout.write(
          `[report-service] prewarm usage cache window=${window.name} status=${status} from=${window.from} to=${window.to}\n`
        )
      } catch (error) {
        process.stderr.write(
          `[report-service] WARN: prewarm usage cache failed window=${window.name} from=${window.from} to=${window.to}: ${formatError(error)}\n`
        )
        break
      }
    }

    try {
      const quotaStatus = await prewarmCachedReport(
        'quotas',
        undefined,
        loadQuotaReportFromDatabase
      )
      process.stdout.write(
        `[report-service] prewarm quota cache status=${quotaStatus}\n`
      )
    } catch (error) {
      process.stderr.write(
        `[report-service] WARN: prewarm quota cache failed: ${formatError(error)}\n`
      )
    }
  } finally {
    await releaseRedisNamedLock(lockKey, lockToken, 'prewarm')
  }
}

async function prewarmCachedReport(scope, searchParams, load) {
  const identity = buildReportCacheIdentity(scope, searchParams)
  const redisEntry = await readRedisCacheEntry(identity)
  if (redisEntry.status === 'fresh') return 'fresh'

  const result = await refreshReportCache(identity, load, {
    skipSqlOnLockMiss: true,
  })
  return result.status
}

function buildPrewarmUsageWindows() {
  const today = utcDateOnly(new Date())
  const tomorrow = addUtcDays(today, 1)
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  const twoYearStart = new Date(today)
  twoYearStart.setUTCFullYear(today.getUTCFullYear() - 2)

  return [
    {
      name: 'last-7-days',
      from: toDateParam(addUtcDays(today, -6)),
      to: toDateParam(tomorrow),
    },
    {
      name: 'last-30-days',
      from: toDateParam(addUtcDays(today, -30)),
      to: toDateParam(tomorrow),
    },
    {
      name: 'ytd',
      from: toDateParam(yearStart),
      to: toDateParam(tomorrow),
    },
    {
      name: 'trailing-2-years',
      from: toDateParam(twoYearStart),
      to: toDateParam(tomorrow),
    },
  ]
}

function buildPrewarmUsageSearchParams(from, to) {
  return new URLSearchParams({
    from,
    to,
    grain: 'day',
    group_by: 'provider,model,repository',
    limit: String(MAX_LIMIT),
    sort: 'period_end',
  })
}

function utcDateOnly(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
}

function addUtcDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function toDateParam(date) {
  return date.toISOString().slice(0, 10)
}

function findUpstreamApiProxy(pathname) {
  return UPSTREAM_API_PROXIES.find(
    (proxyConfig) =>
      pathname === proxyConfig.prefix ||
      pathname.startsWith(`${proxyConfig.prefix}/`)
  )
}

async function handleUpstreamApiProxy(req, res, proxyConfig) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_FETCH_TIMEOUT_MS)
  let upstreamResponse
  try {
    upstreamResponse = await fetch(proxyTargetUrl(req, proxyConfig), {
      method: req.method,
      headers: proxyHeaders(req, proxyConfig),
      signal: controller.signal,
      body:
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : await readRequestBody(req),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(res, 504, {
        error: `${proxyConfig.displayName} upstream timed out after ${UPSTREAM_FETCH_TIMEOUT_MS}ms.`,
      })
      return
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const body = Buffer.from(await upstreamResponse.arrayBuffer())
  res.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers))
  res.end(body)
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && requestUrl.pathname === '/api/shell/health') {
    sendJson(res, 200, {
      ok: true,
      databaseConfigured: Boolean(pool),
      redisConfigured: Boolean(redisClient),
      redisReady: Boolean(redisClient?.isReady),
    })
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage'
  ) {
    await handleUsageReport(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage/token-trend-summary'
  ) {
    await handleUsageTokenTrendSummary(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage/token-trend-day'
  ) {
    await handleUsageTokenTrendDay(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/quotas'
  ) {
    await handleUsageQuotas(req, res)
    return
  }

  const upstreamApiProxy = findUpstreamApiProxy(requestUrl.pathname)
  if (upstreamApiProxy !== undefined) {
    await handleUpstreamApiProxy(req, res, upstreamApiProxy)
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message =
      error instanceof Error && error.message ? error.message : 'Unexpected error'
    sendJson(res, 500, {
      error: message,
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`dashboard-shell report service listening on ${PORT}\n`)
  connectRedisCache()
    .then(startReportCachePrewarm)
    .catch((error) => {
      process.stderr.write(
        `[report-service] WARN: Redis startup failed: ${formatError(error)}\n`
      )
    })
})

async function shutdown() {
  if (prewarmTimer) {
    clearInterval(prewarmTimer)
    prewarmTimer = null
  }
  if (redisClient?.isOpen) {
    await redisClient.quit()
  }
  await pool?.end()
  server.close(() => process.exit(0))
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})
