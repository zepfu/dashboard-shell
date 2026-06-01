import crypto from 'node:crypto'
import { open, readdir, readFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
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
const MAX_DOCKER_LOG_ERROR_ROWS = Math.max(
  0,
  Math.min(Number(process.env.SHELL_REPORT_DOCKER_LOG_ERROR_ROWS ?? 200), 1_000)
)
const DOCKER_LOG_TAIL_BYTES = Math.max(
  64 * 1024,
  Math.min(
    Number(process.env.SHELL_REPORT_DOCKER_LOG_TAIL_BYTES ?? 4 * 1024 * 1024),
    32 * 1024 * 1024
  )
)
const DOCKER_LOG_ROOT =
  process.env.SHELL_REPORT_DOCKER_LOG_ROOT ?? '/host/docker/containers'
const DOCKER_LOG_CONTAINER_NAMES = parseCsv(
  process.env.SHELL_REPORT_DOCKER_LOG_CONTAINERS ?? 'aawm-litellm,litellm-dev'
)
const LOCAL_HEALTH_TIMEOUT_MS = Math.max(
  250,
  Math.min(Number(process.env.SHELL_REPORT_LOCAL_HEALTH_TIMEOUT_MS ?? 900), 5_000)
)
const LOCAL_CONTAINER_HEALTH_PROBES = [
  {
    key: 'aawm-litellm',
    label: 'LiteLLM',
    kind: 'http',
    url: 'http://aawm-litellm:4000/health/liveliness',
  },
  {
    key: 'litellm-dev',
    label: 'LiteLLM Dev',
    kind: 'http',
    url: 'http://host.docker.internal:4001/health/liveliness',
  },
  {
    key: 'aawm-langfuse-web',
    label: 'Langfuse Web',
    kind: 'http',
    url: 'http://langfuse-web:3000/api/public/health',
  },
  {
    key: 'aawm-langfuse-worker',
    label: 'Langfuse Worker',
    kind: 'http',
    url: 'http://langfuse-worker:3030/api/health',
  },
  {
    key: 'aawm-langfuse-redis',
    label: 'Langfuse Redis',
    kind: 'redis',
    host: 'langfuse-redis',
    port: 6379,
  },
  {
    key: 'aawm-clickhouse',
    label: 'ClickHouse',
    kind: 'http',
    url: 'http://clickhouse:8123/ping',
  },
  {
    key: 'aawm-minio',
    label: 'MinIO',
    kind: 'http',
    url: 'http://minio:9000/minio/health/live',
  },
]
const LOCAL_MODEL_HEALTH_PROBES = [
  ['nomic-code-gguf', 'Nomic Code', 8082],
  ['tei-medcpt-article', 'MedCPT Article', 8083],
  ['tei-medcpt-query', 'MedCPT Query', 8084],
  ['specter2-adapter', 'SPECTER2', 8086],
  ['tei-indus', 'Indus', 8087],
  ['tei-sapbert', 'SapBERT', 8088],
  ['tei-reranker', 'Reranker', 8090],
  ['qwen3-heretic-gguf', 'Qwen3 Heretic', 8093],
  ['biomed-scispacy', 'SciSpacy', 8094],
  ['biomed-tinybern2', 'TinyBERT/BERN2', 8095],
  ['ministral3-adjudicator-gguf', 'Ministral Adjudicator', 8096],
  ['aawm-tap-grobid', 'GROBID', 8070, '/api/isalive'],
].map(([key, label, port, healthPath = '/health']) => ({
  key,
  label,
  kind: 'http',
  url: `http://host.docker.internal:${port}${healthPath}`,
}))
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
// and the cold DB query is too expensive to repeat on every render. Keep the
// default aligned with the live dashboard's 60 s polling cadence so new session
// rows can surface on the next scheduled refresh instead of waiting 5 minutes.
// Operators can override via SHELL_REPORT_CACHE_TTL_MS when needed.
const REPORT_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_TTL_MS ?? 60 * 1000)
)
const REPORT_CACHE_STALE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_STALE_TTL_MS ?? 24 * 60 * 60 * 1000)
)
const REPORT_CACHE_REDIS_URL = process.env.SHELL_REPORT_REDIS_URL
const REPORT_CACHE_PREFIX =
  process.env.SHELL_REPORT_CACHE_PREFIX ?? 'dashboard-shell:reports'
const REPORT_CACHE_VERSION = process.env.SHELL_REPORT_CACHE_VERSION ?? 'v14'
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
  (process.env.SHELL_REPORT_CACHE_PREWARM ?? 'false').toLowerCase() !== 'false'
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
const QUOTA_ESTIMATOR_LAG_MINUTES = [0, 1, 5, 10, 30, 60]
const QUOTA_ESTIMATOR_MIN_TRAINING_ROWS = 4
const QUOTA_ESTIMATOR_HIGH_CONFIDENCE_ROWS = 20
const QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE = Math.max(
  10,
  Math.min(
    Number(process.env.SHELL_REPORT_QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE ?? 40),
    500
  )
)
const QUOTA_ESTIMATOR_ROLLING_HALF_LIFE_HOURS = {
  short: 5,
  short_special: 5,
  weekly: 72,
  special: 72,
  monthly: 168,
}
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
      application_name: 'dashboard-shell-report-service',
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

const DASHBOARD_TIME_ZONE = 'America/New_York'
const createdAtEastern = "(sh.created_at AT TIME ZONE 'America/New_York')"
const providerDimension = `
CASE
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(sh.provider, 'unknown')
END`
const providerDimensionRecent = providerDimension.replaceAll('sh.', 'sh_recent.')
const healthProviderDimension = providerDimension.replaceAll('sh.', 'h.')

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
const startTimeDateRangeWhere = [
  "sh.start_time >= ($1::date::timestamp AT TIME ZONE 'America/New_York')",
  "sh.start_time < ($2::date::timestamp AT TIME ZONE 'America/New_York')",
]

function appendStartTimeDateRangeWhere(whereParts, values, from, to) {
  const fromIndex = values.length + 1
  values.push(from)
  const toIndex = values.length + 1
  values.push(to)
  whereParts.push(
    `sh.start_time >= ($${fromIndex.toString()}::date::timestamp AT TIME ZONE 'America/New_York')`,
    `sh.start_time < ($${toIndex.toString()}::date::timestamp AT TIME ZONE 'America/New_York')`
  )
}

function appendCreatedAtDateRangeWhere(whereParts, values, from, to) {
  const fromIndex = values.length + 1
  values.push(from)
  const toIndex = values.length + 1
  values.push(to)
  whereParts.push(
    `sh.created_at >= ($${fromIndex.toString()}::date::timestamp AT TIME ZONE 'America/New_York')`,
    `sh.created_at < ($${toIndex.toString()}::date::timestamp AT TIME ZONE 'America/New_York')`
  )
}

const agentPassScoreFamilies = {
  quality: [
    'trace_quality_score',
    'response_meaningfulness_score',
    'answer_completeness_score',
    'evidence_fidelity_score',
    'context_retention_score',
  ],
  instruction: [
    'instruction_adherence_score',
    'read_only_policy_compliance_score',
    'scope_control_score',
    'destructive_action_policy_score',
  ],
  tool: [
    'tool_use_validity_score',
    'tool_result_fidelity_score',
    'tool_error_recovery_score',
    'error_attribution_quality_score',
  ],
  contract: ['output_contract_compliance_score'],
  progress: ['task_progress_score'],
}

const agentRiskScoreColumns = [
  'repetition_loop_risk_score',
  'stall_risk_score',
]

function buildLatencyMetricSelects(column, alias) {
  return [
    `percentile_cont(0.50) WITHIN GROUP (ORDER BY sh.${column})
        FILTER (WHERE sh.${column} IS NOT NULL) AS ${alias}_p50_ms`,
    `percentile_cont(0.95) WITHIN GROUP (ORDER BY sh.${column})
        FILTER (WHERE sh.${column} IS NOT NULL) AS ${alias}_p95_ms`,
    `percentile_cont(0.99) WITHIN GROUP (ORDER BY sh.${column})
        FILTER (WHERE sh.${column} IS NOT NULL) AS ${alias}_p99_ms`,
    `COUNT(sh.${column})::double precision AS ${alias}_count`,
  ]
}

const latencyMetricSelectParts = [
  'COUNT(*)::double precision AS latency_sample_rows',
  ...buildLatencyMetricSelects('litellm_pre_send_ms', 'litellm_pre_send'),
  ...buildLatencyMetricSelects(
    'litellm_post_response_ms',
    'litellm_post_response'
  ),
  ...buildLatencyMetricSelects('litellm_processing_ms', 'litellm_processing'),
  ...buildLatencyMetricSelects(
    'llm_upstream_time_to_first_byte_ms',
    'llm_upstream_time_to_first_byte'
  ),
  ...buildLatencyMetricSelects(
    'llm_upstream_elapsed_ms',
    'llm_upstream_elapsed'
  ),
  ...buildLatencyMetricSelects('llm_upstream_stream_ms', 'llm_upstream_stream'),
  ...buildLatencyMetricSelects('ttft_ms', 'ttft'),
  ...buildLatencyMetricSelects(
    'total_server_elapsed_ms',
    'total_server_elapsed'
  ),
  ...buildLatencyMetricSelects(
    'latency_unclassified_ms',
    'latency_unclassified'
  ),
  ...buildLatencyMetricSelects(
    'previous_response_to_current_request_ms',
    'previous_response_to_current_request'
  ),
  `percentile_cont(0.50) WITHIN GROUP (
        ORDER BY (COALESCE(sh.output_tokens, 0) / NULLIF(sh.llm_upstream_elapsed_ms / 1000.0, 0))
    ) FILTER (WHERE sh.llm_upstream_elapsed_ms > 0) AS llm_upstream_output_tokens_per_second_p50`,
  `percentile_cont(0.95) WITHIN GROUP (
        ORDER BY (COALESCE(sh.output_tokens, 0) / NULLIF(sh.llm_upstream_elapsed_ms / 1000.0, 0))
    ) FILTER (WHERE sh.llm_upstream_elapsed_ms > 0) AS llm_upstream_output_tokens_per_second_p95`,
  `COUNT(*) FILTER (WHERE sh.llm_upstream_elapsed_ms > 0)::double precision AS llm_upstream_output_tokens_per_second_count`,
  `percentile_cont(0.50) WITHIN GROUP (
        ORDER BY (COALESCE(sh.output_tokens, 0) / NULLIF(sh.llm_upstream_stream_ms / 1000.0, 0))
    ) FILTER (WHERE sh.llm_upstream_stream_ms > 0) AS llm_stream_output_tokens_per_second_p50`,
  `percentile_cont(0.95) WITHIN GROUP (
        ORDER BY (COALESCE(sh.output_tokens, 0) / NULLIF(sh.llm_upstream_stream_ms / 1000.0, 0))
    ) FILTER (WHERE sh.llm_upstream_stream_ms > 0) AS llm_stream_output_tokens_per_second_p95`,
  `COUNT(*) FILTER (WHERE sh.llm_upstream_stream_ms > 0)::double precision AS llm_stream_output_tokens_per_second_count`,
]

function buildAgentPassScoreSelects(family, columns) {
  const scoreSum = columns
    .map(
      (column) =>
        `COALESCE(SUM(sh.${column}) FILTER (WHERE sh.${column} IS NOT NULL), 0)`
    )
    .join(' + ')
  const evaluated = columns.map((column) => `COUNT(sh.${column})`).join(' + ')
  const failures = columns
    .map((column) => `COUNT(*) FILTER (WHERE sh.${column} = 0)`)
    .join(' + ')

  return [
    `ROUND(CAST(((${scoreSum}) / NULLIF((${evaluated}), 0)) AS numeric), 4)::double precision AS agent_${family}_score`,
    `((${evaluated}))::double precision AS agent_${family}_evaluated`,
    `(COUNT(*) * ${columns.length.toString()})::double precision AS agent_${family}_possible`,
    `((${failures}))::double precision AS agent_${family}_failures`,
  ]
}

function buildAgentRiskScoreSelects() {
  const scoreSum = agentRiskScoreColumns
    .map(
      (column) =>
        `COALESCE(SUM(sh.${column}) FILTER (WHERE sh.${column} IS NOT NULL), 0)`
    )
    .join(' + ')
  const evaluated = agentRiskScoreColumns
    .map((column) => `COUNT(sh.${column})`)
    .join(' + ')
  const risks = agentRiskScoreColumns
    .map((column) => `COUNT(*) FILTER (WHERE sh.${column} = 1)`)
    .join(' + ')

  return [
    `ROUND(CAST(((${scoreSum}) / NULLIF((${evaluated}), 0)) AS numeric), 4)::double precision AS agent_risk_score`,
    `((${evaluated}))::double precision AS agent_risk_evaluated`,
    `(COUNT(*) * ${agentRiskScoreColumns.length.toString()})::double precision AS agent_risk_possible`,
    `((${risks}))::double precision AS agent_risk_events`,
  ]
}

const agentScoreSelectParts = [
  'COUNT(*)::double precision AS agent_score_rows',
  ...Object.entries(agentPassScoreFamilies).flatMap(([family, columns]) =>
    buildAgentPassScoreSelects(family, columns)
  ),
  ...buildAgentRiskScoreSelects(),
  ...buildAgentPassScoreSelects('discovery_inventory_coverage', [
    'discovery_inventory_coverage_score',
  ]),
  'SUM(COALESCE(sh.discovery_inventory_missing_count, 0))::double precision AS agent_discovery_inventory_missing_count',
  ...buildAgentPassScoreSelects('terminal_completion', [
    'terminal_completion_score',
  ]),
  "COUNT(*) FILTER (WHERE sh.empty_completion_failure IS TRUE)::double precision AS agent_empty_completion_failures",
  "COUNT(*) FILTER (WHERE sh.invalid_tool_call_error IS TRUE)::double precision AS agent_invalid_tool_call_errors",
  "COUNT(*) FILTER (WHERE sh.destructive_checkout_after_work IS TRUE)::double precision AS agent_destructive_checkout_failures",
  "COUNT(*) FILTER (WHERE sh.large_tool_result_payload_risk IS TRUE)::double precision AS agent_large_payload_risks",
  'SUM(COALESCE(sh.read_only_policy_violation_count, 0))::double precision AS agent_read_only_policy_violations',
  'AVG(sh.ignored_path_tracking_policy_score)::double precision AS agent_ignored_path_tracking_policy_score',
  'COUNT(sh.ignored_path_tracking_policy_score)::double precision AS agent_ignored_path_tracking_policy_evaluated',
  'COUNT(*)::double precision AS agent_ignored_path_tracking_policy_possible',
  'SUM(COALESCE(sh.ignored_path_tracking_violation_count, 0))::double precision AS agent_ignored_path_tracking_violation_count',
  'AVG(sh.baseline_deflection_attempted_score)::double precision AS agent_baseline_deflection_attempted_score',
  'COUNT(sh.baseline_deflection_attempted_score)::double precision AS agent_baseline_deflection_attempted_evaluated',
  'COUNT(*) FILTER (WHERE sh.baseline_deflection_attempted_score = 1)::double precision AS agent_baseline_deflection_attempted_incidents',
  'AVG(sh.baseline_deflection_incident_score)::double precision AS agent_baseline_deflection_incident_score',
  'COUNT(sh.baseline_deflection_incident_score)::double precision AS agent_baseline_deflection_incident_evaluated',
  'COUNT(*) FILTER (WHERE sh.baseline_deflection_incident_score = 1)::double precision AS agent_baseline_deflection_incidents',
  'SUM(COALESCE(sh.baseline_deflection_attempt_count, 0))::double precision AS agent_baseline_deflection_attempt_count',
  'SUM(COALESCE(sh.baseline_deflection_tool_call_count, 0))::double precision AS agent_baseline_deflection_tool_call_count',
  'SUM(COALESCE(sh.baseline_deflection_input_tokens, 0))::double precision AS agent_baseline_deflection_input_tokens',
  'SUM(COALESCE(sh.baseline_deflection_elapsed_ms, 0))::double precision AS agent_baseline_deflection_elapsed_ms',
  'SUM(COALESCE(sh.quality_gate_trigger_count, 0))::double precision AS agent_quality_gate_trigger_count',
  'SUM(COALESCE(sh.quality_gate_fix_attempt_count, 0))::double precision AS agent_quality_gate_fix_attempt_count',
  'SUM(COALESCE(sh.quality_gate_rerun_count, 0))::double precision AS agent_quality_gate_rerun_count',
  'AVG(sh.sleep_wellness_interruption_attempted_score)::double precision AS agent_sleep_wellness_interruption_attempted_score',
  'COUNT(sh.sleep_wellness_interruption_attempted_score)::double precision AS agent_sleep_wellness_interruption_attempted_evaluated',
  'COUNT(*) FILTER (WHERE sh.sleep_wellness_interruption_attempted_score = 1)::double precision AS agent_sleep_wellness_interruption_attempted_incidents',
  'AVG(sh.sleep_wellness_interruption_incident_score)::double precision AS agent_sleep_wellness_interruption_incident_score',
  'COUNT(sh.sleep_wellness_interruption_incident_score)::double precision AS agent_sleep_wellness_interruption_incident_evaluated',
  'COUNT(*) FILTER (WHERE sh.sleep_wellness_interruption_incident_score = 1)::double precision AS agent_sleep_wellness_interruption_incidents',
  'SUM(COALESCE(sh.sleep_wellness_interruption_count, 0))::double precision AS agent_sleep_wellness_interruption_count',
  'SUM(COALESCE(sh.sleep_wellness_interruption_output_tokens, 0))::double precision AS agent_sleep_wellness_interruption_output_tokens',
  'SUM(COALESCE(sh.sleep_wellness_interruption_input_tokens, 0))::double precision AS agent_sleep_wellness_interruption_input_tokens',
  'SUM(COALESCE(sh.sleep_wellness_interruption_elapsed_ms, 0))::double precision AS agent_sleep_wellness_interruption_elapsed_ms',
  'SUM(COALESCE(sh.sleep_wellness_interruption_after_user_pushback_count, 0))::double precision AS agent_sleep_wellness_interruption_after_user_pushback_count',
  'SUM(COALESCE(sh.sleep_wellness_interruption_repeated_count, 0))::double precision AS agent_sleep_wellness_interruption_repeated_count',
  'COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE)::double precision AS agent_compact_summary_events',
  "COUNT(DISTINCT (COALESCE(sh.session_id::text, 'unknown') || ':' || sh.compact_summary_id)) FILTER (WHERE sh.is_compact_summary IS TRUE AND sh.compact_summary_id IS NOT NULL AND sh.compact_summary_id <> '')::double precision AS agent_compact_summary_thread_count",
  "COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE AND sh.compact_summary_id IS NOT NULL AND sh.compact_summary_id <> '')::double precision AS agent_compact_summary_id_count",
  "COUNT(*) FILTER (WHERE sh.is_compact_summary IS NOT TRUE AND sh.compact_summary_role = 'resume_context')::double precision AS agent_compact_summary_resume_contexts",
  "COUNT(*) FILTER (WHERE sh.is_compact_summary IS NOT TRUE AND sh.compact_summary_role = 'verify')::double precision AS agent_compact_summary_verify_contexts",
  `jsonb_build_object(
      'claude-code', COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE AND sh.compact_summary_source = 'claude-code'),
      'codex', COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE AND sh.compact_summary_source = 'codex'),
      'gemini-cli', COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE AND sh.compact_summary_source = 'gemini-cli')
  ) AS agent_compact_summary_source_counts`,
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateOnlyParam(value)
  }
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

function datePartsInDashboardTimeZone(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    hour: Number(byType.get('hour')),
    minute: Number(byType.get('minute')),
    second: Number(byType.get('second')),
  }
}

function formatDashboardDate(date) {
  const parts = datePartsInDashboardTimeZone(date)
  return [
    parts.year.toString().padStart(4, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.day.toString().padStart(2, '0'),
  ].join('-')
}

function addDaysToDateString(value, days) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

function dashboardDateToUtcIso(value) {
  const [year, month, day] = value.split('-').map(Number)
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0)
  let candidate = targetAsUtc
  for (let i = 0; i < 4; i += 1) {
    const parts = datePartsInDashboardTimeZone(new Date(candidate))
    const localAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
    const delta = targetAsUtc - localAsUtc
    candidate += delta
    if (delta === 0) break
  }
  return new Date(candidate).toISOString()
}

function parseSearchDateOnly(value, fallback) {
  if (!value) return fallback()
  return parseDateOnlyParam(value)
}

function defaultFromDate() {
  return addDaysToDateString(formatDashboardDate(new Date()), -6)
}

function defaultToDate() {
  return addDaysToDateString(formatDashboardDate(new Date()), 1)
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

const latencyAggregateNumericKeys = [
  'latency_sample_rows',
  'litellm_pre_send_p50_ms',
  'litellm_pre_send_p95_ms',
  'litellm_pre_send_p99_ms',
  'litellm_pre_send_count',
  'litellm_post_response_p50_ms',
  'litellm_post_response_p95_ms',
  'litellm_post_response_p99_ms',
  'litellm_post_response_count',
  'litellm_processing_p50_ms',
  'litellm_processing_p95_ms',
  'litellm_processing_p99_ms',
  'litellm_processing_count',
  'llm_upstream_time_to_first_byte_p50_ms',
  'llm_upstream_time_to_first_byte_p95_ms',
  'llm_upstream_time_to_first_byte_p99_ms',
  'llm_upstream_time_to_first_byte_count',
  'llm_upstream_elapsed_p50_ms',
  'llm_upstream_elapsed_p95_ms',
  'llm_upstream_elapsed_p99_ms',
  'llm_upstream_elapsed_count',
  'llm_upstream_stream_p50_ms',
  'llm_upstream_stream_p95_ms',
  'llm_upstream_stream_p99_ms',
  'llm_upstream_stream_count',
  'ttft_p50_ms',
  'ttft_p95_ms',
  'ttft_p99_ms',
  'ttft_count',
  'total_server_elapsed_p50_ms',
  'total_server_elapsed_p95_ms',
  'total_server_elapsed_p99_ms',
  'total_server_elapsed_count',
  'latency_unclassified_p50_ms',
  'latency_unclassified_p95_ms',
  'latency_unclassified_p99_ms',
  'latency_unclassified_count',
  'previous_response_to_current_request_p50_ms',
  'previous_response_to_current_request_p95_ms',
  'previous_response_to_current_request_p99_ms',
  'previous_response_to_current_request_count',
  'llm_upstream_output_tokens_per_second_p50',
  'llm_upstream_output_tokens_per_second_p95',
  'llm_upstream_output_tokens_per_second_count',
  'llm_stream_output_tokens_per_second_p50',
  'llm_stream_output_tokens_per_second_p95',
  'llm_stream_output_tokens_per_second_count',
]

function normalizeLatencyAggregateFields(row) {
  return Object.fromEntries(
    latencyAggregateNumericKeys.map((key) => [key, normalizeNumber(row[key])])
  )
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
    'latency_sample_rows',
    'litellm_pre_send_p50_ms',
    'litellm_pre_send_p95_ms',
    'litellm_pre_send_p99_ms',
    'litellm_pre_send_count',
    'litellm_post_response_p50_ms',
    'litellm_post_response_p95_ms',
    'litellm_post_response_p99_ms',
    'litellm_post_response_count',
    'litellm_processing_p50_ms',
    'litellm_processing_p95_ms',
    'litellm_processing_p99_ms',
    'litellm_processing_count',
    'llm_upstream_time_to_first_byte_p50_ms',
    'llm_upstream_time_to_first_byte_p95_ms',
    'llm_upstream_time_to_first_byte_p99_ms',
    'llm_upstream_time_to_first_byte_count',
    'llm_upstream_elapsed_p50_ms',
    'llm_upstream_elapsed_p95_ms',
    'llm_upstream_elapsed_p99_ms',
    'llm_upstream_elapsed_count',
    'llm_upstream_stream_p50_ms',
    'llm_upstream_stream_p95_ms',
    'llm_upstream_stream_p99_ms',
    'llm_upstream_stream_count',
    'ttft_p50_ms',
    'ttft_p95_ms',
    'ttft_p99_ms',
    'ttft_count',
    'total_server_elapsed_p50_ms',
    'total_server_elapsed_p95_ms',
    'total_server_elapsed_p99_ms',
    'total_server_elapsed_count',
    'latency_unclassified_p50_ms',
    'latency_unclassified_p95_ms',
    'latency_unclassified_p99_ms',
    'latency_unclassified_count',
    'previous_response_to_current_request_p50_ms',
    'previous_response_to_current_request_p95_ms',
    'previous_response_to_current_request_p99_ms',
    'previous_response_to_current_request_count',
    'llm_upstream_output_tokens_per_second_p50',
    'llm_upstream_output_tokens_per_second_p95',
    'llm_upstream_output_tokens_per_second_count',
    'llm_stream_output_tokens_per_second_p50',
    'llm_stream_output_tokens_per_second_p95',
    'llm_stream_output_tokens_per_second_count',
    'agent_score_rows',
    'agent_quality_score',
    'agent_quality_evaluated',
    'agent_quality_possible',
    'agent_quality_failures',
    'agent_instruction_score',
    'agent_instruction_evaluated',
    'agent_instruction_possible',
    'agent_instruction_failures',
    'agent_tool_score',
    'agent_tool_evaluated',
    'agent_tool_possible',
    'agent_tool_failures',
    'agent_contract_score',
    'agent_contract_evaluated',
    'agent_contract_possible',
    'agent_contract_failures',
    'agent_progress_score',
    'agent_progress_evaluated',
    'agent_progress_possible',
    'agent_progress_failures',
    'agent_risk_score',
    'agent_risk_evaluated',
    'agent_risk_possible',
    'agent_risk_events',
    'agent_empty_completion_failures',
    'agent_invalid_tool_call_errors',
    'agent_destructive_checkout_failures',
    'agent_large_payload_risks',
    'agent_read_only_policy_violations',
    'agent_ignored_path_tracking_policy_score',
    'agent_ignored_path_tracking_policy_evaluated',
    'agent_ignored_path_tracking_policy_possible',
    'agent_ignored_path_tracking_violation_count',
    'agent_baseline_deflection_attempted_score',
    'agent_baseline_deflection_attempted_evaluated',
    'agent_baseline_deflection_attempted_incidents',
    'agent_baseline_deflection_incident_score',
    'agent_baseline_deflection_incident_evaluated',
    'agent_baseline_deflection_incidents',
    'agent_baseline_deflection_attempt_count',
    'agent_baseline_deflection_tool_call_count',
    'agent_baseline_deflection_input_tokens',
    'agent_baseline_deflection_elapsed_ms',
    'agent_quality_gate_trigger_count',
    'agent_quality_gate_fix_attempt_count',
    'agent_quality_gate_rerun_count',
    'agent_sleep_wellness_interruption_attempted_score',
    'agent_sleep_wellness_interruption_attempted_evaluated',
    'agent_sleep_wellness_interruption_attempted_incidents',
    'agent_sleep_wellness_interruption_incident_score',
    'agent_sleep_wellness_interruption_incident_evaluated',
    'agent_sleep_wellness_interruption_incidents',
    'agent_sleep_wellness_interruption_count',
    'agent_sleep_wellness_interruption_output_tokens',
    'agent_sleep_wellness_interruption_input_tokens',
    'agent_sleep_wellness_interruption_elapsed_ms',
    'agent_sleep_wellness_interruption_after_user_pushback_count',
    'agent_sleep_wellness_interruption_repeated_count',
    'agent_discovery_inventory_coverage_score',
    'agent_discovery_inventory_coverage_evaluated',
    'agent_discovery_inventory_coverage_possible',
    'agent_discovery_inventory_coverage_failures',
    'agent_discovery_inventory_missing_count',
    'agent_terminal_completion_score',
    'agent_terminal_completion_evaluated',
    'agent_terminal_completion_possible',
    'agent_terminal_completion_failures',
    'agent_compact_summary_events',
    'agent_compact_summary_thread_count',
    'agent_compact_summary_id_count',
    'agent_compact_summary_resume_contexts',
    'agent_compact_summary_verify_contexts',
  ]

  const normalized = { ...row }
  for (const key of numericKeys) {
    normalized[key] = normalizeNumber(normalized[key])
  }
  return normalized
}

function buildFilteredWhere(searchParams, options = {}) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = options.values ?? []
  const whereParts = []

  if (options.includeDateRange !== false) {
    appendStartTimeDateRangeWhere(whereParts, values, from, to)
  }

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }

  return { from, to, values, whereParts }
}

function buildTokenTrendFilteredWhere(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = []
  const whereParts = []

  appendCreatedAtDateRangeWhere(whereParts, values, from, to)

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
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push
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

export function buildTokenTrendHoursQuery(searchParams) {
  const { values, whereParts } = buildTokenTrendFilteredWhere(searchParams)
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
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push
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

export function buildTokenTrendHealthQuery(searchParams) {
  const fromDate = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const toDate = parseSearchDateOnly(searchParams.get('to'), defaultToDate)
  const values = [dashboardDateToUtcIso(fromDate), dashboardDateToUtcIso(toDate)]
  const whereParts = [
    'h.bucket_start >= $1::timestamptz',
    'h.bucket_start < $2::timestamptz',
  ]

  const filterMap = {
    environment: "COALESCE(h.environment, 'unknown')",
    provider: healthProviderDimension,
    model: "COALESCE(h.model, 'unknown')",
  }
  for (const [key, column] of Object.entries(filterMap)) {
    const selected = parseCsv(searchParams.get(key))
    if (!selected.length) continue
    values.push(selected)
    whereParts.push(`${column} = ANY($${values.length.toString()}::text[])`)
  }

  const bucketExpression = `date_trunc('hour', h.bucket_start AT TIME ZONE 'America/New_York')`

  const sql = `
SELECT
    to_char(${bucketExpression}, 'YYYY-MM-DD"T"HH24:00:00') AS bucket_start,
    COALESCE(h.environment, 'unknown') AS environment,
    ${healthProviderDimension} AS provider,
    COALESCE(h.model, 'unknown') AS model,
    COALESCE(h.model_group, 'unknown') AS model_group,
    SUM(COALESCE(h.requests, 0))::double precision AS requests,
    CASE
        WHEN SUM(COALESCE(h.requests, 0)) = 0 THEN 'no_traffic'
        WHEN SUM(COALESCE(h.requests, 0)) < 5 THEN 'low_sample'
        ELSE 'normal'
    END AS passive_latency_sample_status,
    AVG(h.upstream_p50_ms) FILTER (WHERE h.upstream_p50_ms IS NOT NULL)::double precision AS upstream_p50_ms,
    AVG(h.upstream_p95_ms) FILTER (WHERE h.upstream_p95_ms IS NOT NULL)::double precision AS upstream_p95_ms,
    AVG(h.upstream_p99_ms) FILTER (WHERE h.upstream_p99_ms IS NOT NULL)::double precision AS upstream_p99_ms,
    AVG(h.total_p95_ms) FILTER (WHERE h.total_p95_ms IS NOT NULL)::double precision AS total_p95_ms,
    AVG(h.proxy_processing_p95_ms) FILTER (WHERE h.proxy_processing_p95_ms IS NOT NULL)::double precision AS proxy_processing_p95_ms,
    SUM(COALESCE(h.missing_upstream_latency, 0))::double precision AS missing_upstream_latency,
    SUM(COALESCE(h.provider_error_events, 0))::double precision AS provider_error_events,
    SUM(COALESCE(h.rate_limit_events, 0))::double precision AS rate_limit_events,
    SUM(COALESCE(h.capacity_events, 0))::double precision AS capacity_events,
    SUM(COALESCE(h.provider_5xx_events, 0))::double precision AS provider_5xx_events,
    SUM(COALESCE(h.provider_timeout_events, 0))::double precision AS provider_timeout_events,
    SUM(COALESCE(h.network_error_events, 0))::double precision AS network_error_events,
    SUM(COALESCE(h.auth_failed_events, 0))::double precision AS auth_failed_events,
    SUM(COALESCE(h.adapter_error_events, 0))::double precision AS adapter_error_events,
    SUM(COALESCE(h.status_probe_count, 0))::double precision AS status_probe_count,
    AVG(h.status_probe_success_pct) FILTER (WHERE h.status_probe_success_pct IS NOT NULL)::double precision AS status_probe_success_pct,
    AVG(h.status_probe_p95_ms) FILTER (WHERE h.status_probe_p95_ms IS NOT NULL)::double precision AS status_probe_p95_ms,
    AVG(h.provider_ping_avg_ms) FILTER (WHERE h.provider_ping_avg_ms IS NOT NULL)::double precision AS provider_ping_avg_ms,
    AVG(h.provider_ping_packet_loss_pct) FILTER (WHERE h.provider_ping_packet_loss_pct IS NOT NULL)::double precision AS provider_ping_packet_loss_pct,
    AVG(h.control_ping_avg_ms) FILTER (WHERE h.control_ping_avg_ms IS NOT NULL)::double precision AS control_ping_avg_ms,
    AVG(h.control_packet_loss_pct) FILTER (WHERE h.control_packet_loss_pct IS NOT NULL)::double precision AS control_packet_loss_pct,
    AVG(h.control_probe_success_pct) FILTER (WHERE h.control_probe_success_pct IS NOT NULL)::double precision AS control_probe_success_pct,
    AVG(h.provider_ping_minus_control_ms) FILTER (WHERE h.provider_ping_minus_control_ms IS NOT NULL)::double precision AS provider_ping_minus_control_ms,
    SUM(COALESCE(h.dns_failures, 0))::double precision AS dns_failures,
    SUM(COALESCE(h.tcp_failures, 0))::double precision AS tcp_failures,
    SUM(COALESCE(h.tls_failures, 0))::double precision AS tls_failures,
    SUM(COALESCE(h.icmp_failures, 0))::double precision AS icmp_failures,
    string_agg(DISTINCT NULLIF(h.probed_endpoints, ''), ', ') AS probed_endpoints,
    string_agg(DISTINCT NULLIF(h.status_error_classes, ''), ', ') AS status_error_classes,
    MIN(h.min_remaining_pct)::double precision AS min_remaining_pct,
    MAX(h.max_remaining_pct)::double precision AS max_remaining_pct,
    MIN(h.next_expected_reset_at) AS next_expected_reset_at,
    string_agg(DISTINCT NULLIF(h.quota_keys, ''), ', ') AS quota_keys,
    MIN(h.request_period_start) AS request_period_start,
    MAX(h.request_period_end) AS request_period_end
FROM public.provider_latency_health_5m h
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${bucketExpression},
    COALESCE(h.environment, 'unknown'),
    ${healthProviderDimension},
    COALESCE(h.model, 'unknown'),
    COALESCE(h.model_group, 'unknown')
ORDER BY
    ${bucketExpression} ASC,
    ${healthProviderDimension} ASC,
    COALESCE(h.model, 'unknown') ASC;
`

  return { sql, values }
}

const tokenTrendScoreSelectParts = [
  'COUNT(*)::double precision AS agent_score_rows',
  ...Object.entries(agentPassScoreFamilies).flatMap(([family, columns]) =>
    buildAgentPassScoreSelects(family, columns)
  ),
  ...buildAgentRiskScoreSelects(),
]

const tokenTrendScoreSourceColumns = [
  ...Object.values(agentPassScoreFamilies).flat(),
  ...agentRiskScoreColumns,
]

const tokenTrendVersionClientNames = [
  'claude-cli',
  'claude-code',
  'codex-tui',
  'gemini-cli',
  'GeminiCLI-tui',
  'grok-build',
  'grok-cli',
  'xai-cli',
]

function sqlTextLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const tokenTrendVersionClientNameList = tokenTrendVersionClientNames
  .map(sqlTextLiteral)
  .join(', ')

export function buildTokenTrendScoreQuery(searchParams) {
  const { values, whereParts } = buildTokenTrendFilteredWhere(searchParams)
  const bucketExpression = `date_trunc('hour', ${createdAtEastern})`
  const scorePresence = tokenTrendScoreSourceColumns
    .map((column) => `COUNT(sh.${column}) > 0`)
    .join('\n    OR ')
  const scorePresenceWhere = tokenTrendScoreSourceColumns
    .map((column) => `sh.${column} IS NOT NULL`)
    .join('\n    OR ')

  const sql = `
SELECT
    to_char(${bucketExpression}, 'YYYY-MM-DD"T"HH24:00:00') AS bucket,
    ${providerDimension} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    ${tokenTrendScoreSelectParts.join(',\n    ')}
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
  AND (${scorePresenceWhere})
GROUP BY
    ${bucketExpression},
    ${providerDimension},
    COALESCE(sh.model, 'unknown')
HAVING
    ${scorePresence}
ORDER BY
    ${bucketExpression} ASC,
    ${providerDimension} ASC,
    COALESCE(sh.model, 'unknown') ASC;
`

  return { sql, values }
}

function buildTokenTrendVersionIntervalsQuery(searchParams) {
  const { values, whereParts } = buildTokenTrendFilteredWhere(searchParams)
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
      SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
      SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
      SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
      SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push
  FROM public.session_history sh
  WHERE ${whereParts.join('\n    AND ')}
    AND sh.client_name IN (${tokenTrendVersionClientNameList})
    AND COALESCE(NULLIF(sh.client_name, ''), 'unknown') <> 'unknown'
    AND (
      COALESCE(NULLIF(sh.client_version, ''), '0.0.0') <> '0.0.0'
      OR ${providerDimension} = 'xai'
    )
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
    usd_cost,
    tool_calls
FROM version_usage
ORDER BY
    first_seen_at ASC,
    token_total DESC,
    client_name ASC,
    client_version ASC;
`

  return { sql, values }
}

export function buildTokenTrendModelFirstSeenQuery(searchParams) {
  const { from, to, values, whereParts } = buildFilteredWhere(searchParams, {
    includeDateRange: false,
  })
  const modelExpression = "COALESCE(NULLIF(sh.model, ''), 'unknown')"
  values.push(from)
  const visibleFromIndex = values.length
  values.push(to)
  const visibleToIndex = values.length
  const modelWhereParts = [
    ...whereParts,
    `${providerDimension} IN ('anthropic', 'openai', 'xai', 'google')`,
    `${modelExpression} <> 'unknown'`,
  ]

  const sql = `
WITH model_usage AS (
  SELECT
      ${providerDimension} AS provider,
      ${modelExpression} AS model,
      MIN(sh.created_at) AS first_seen_at,
      MIN(${createdAtEastern}) AS first_seen_local,
      COUNT(*)::double precision AS observations,
      SUM(COALESCE(sh.input_tokens, 0)
        + COALESCE(sh.output_tokens, 0)
        + COALESCE(sh.cache_read_input_tokens, 0)
        + COALESCE(sh.cache_creation_input_tokens, 0)
        + COALESCE(sh.reasoning_tokens_reported, 0)
        + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total
  FROM public.session_history sh
  WHERE ${modelWhereParts.join('\n    AND ')}
  GROUP BY
      ${providerDimension},
      ${modelExpression}
)
SELECT
    provider,
    model,
    first_seen_at,
    to_char(first_seen_local::date, 'YYYY-MM-DD') AS first_seen_day,
    EXTRACT(hour FROM first_seen_local)::int AS first_seen_hour,
    observations,
    token_total
FROM model_usage
WHERE first_seen_local::date >= $${visibleFromIndex.toString()}::date
  AND first_seen_local::date < $${visibleToIndex.toString()}::date
ORDER BY
    first_seen_at ASC,
    provider ASC,
    model ASC;
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
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push
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
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push
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
  const fromDate = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const toDate = parseSearchDateOnly(searchParams.get('to'), defaultToDate)
  const healthWindow = resolveHealthWindow(
    dashboardDateToUtcIso(fromDate),
    dashboardDateToUtcIso(toDate)
  )

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
    WHERE sh.start_time >= $2::timestamptz
      AND sh.start_time < $3::timestamptz
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
        WHEN lower(COALESCE(provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
        WHEN lower(COALESCE(provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
        WHEN lower(COALESCE(provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
  const fromDate = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const toDate = parseSearchDateOnly(searchParams.get('to'), defaultToDate)
  const from = dashboardDateToUtcIso(fromDate)
  const to = dashboardDateToUtcIso(toDate)

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
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push,
    ${latencyMetricSelectParts.join(',\n    ')},
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
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
                    'traces', model_usage.traces,
                    'recent_traces_90m', model_usage.recent_traces_90m
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
            ,
            (
                SELECT COUNT(*)::double precision
                FROM public.session_history sh_recent
                WHERE COALESCE(sh_recent.start_time, sh_recent.created_at) >= now() - INTERVAL '90 minutes'
                  AND COALESCE(sh_recent.start_time, sh_recent.created_at) < now()
                  AND (
                      (s.provider = 'google'
                        AND ${providerDimensionRecent} = 'google'
                        AND COALESCE(sh_recent.model, 'unknown') = COALESCE(s.model, 'unknown'))
                      OR
                      (s.provider <> 'google'
                        AND ${providerDimensionRecent} = s.provider)
                  )
                  AND COALESCE(sh_recent.model, 'unknown') = COALESCE(sh.model, 'unknown')
                  AND (
                      s.provider <> 'openai'
                      OR s.quota_type NOT IN ('weekly', 'short')
                      OR COALESCE(sh_recent.model, '') NOT ILIKE '%spark%'
                  )
                  AND (
                      s.provider <> 'openai'
                      OR s.quota_type NOT IN ('special', 'short_special')
                      OR COALESCE(sh_recent.model, '') ILIKE '%spark%'
                  )
                  AND (
                      s.provider <> 'anthropic'
                      OR s.quota_type <> 'special'
                      OR COALESCE(sh_recent.model, '') ILIKE '%sonnet%'
                  )
            ) AS recent_traces_90m
        FROM public.session_history sh
        WHERE s.expected_reset_at IS NOT NULL
          AND sh.start_time >= s.expected_reset_at - CASE
              WHEN s.provider IN ('google', 'openrouter')
                AND s.quota_type = 'short'
              THEN INTERVAL '24 hours'
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
        GROUP BY COALESCE(sh.model, 'unknown'), sh.model
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
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
                WHEN s.provider <> 'xai' AND s.raw_quota_type = 'requests' THEN 24.0
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
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
                WHEN ri.quota_type = 'requests'
                  AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                  AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                THEN 24.0
                WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                WHEN ri.quota_type = 'requests'
                  AND (
                      lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                      OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                  )
                THEN 720.0
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
                      WHEN ri.quota_type = 'requests'
                        AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                        AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                      THEN 24.0
                      WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                      WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                      WHEN ri.quota_type = 'requests'
                        AND (
                            lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                            OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                        )
                      THEN 720.0
                      WHEN ri.quota_type = 'monthly'                    THEN 720.0
                      ELSE                                                   168.0
                  END
              ) * 1.5 * INTERVAL '1 hour'
          )
      AND ri.expected_reset_at < now() + (
              COALESCE(
                  CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                  CASE
                      WHEN ri.quota_type = 'requests'
                        AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                        AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                      THEN 24.0
                      WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                      WHEN ri.quota_type IN ('weekly', 'weekly_special') THEN 168.0
                      WHEN ri.quota_type = 'requests'
                        AND (
                            lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                            OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                        )
                      THEN 720.0
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
        COUNT(*)::double precision AS traces,
        (
            SELECT COUNT(*)::double precision
            FROM public.session_history sh_recent
            WHERE COALESCE(sh_recent.start_time, sh_recent.created_at) >= now() - INTERVAL '90 minutes'
              AND COALESCE(sh_recent.start_time, sh_recent.created_at) < now()
              AND ${providerDimensionRecent} = wb.provider
              AND COALESCE(sh_recent.model, 'unknown') = COALESCE(sh.model, 'unknown')
              AND (wb.model IS NULL OR sh_recent.model = wb.model)
        ) AS recent_traces_90m
    FROM window_bounds wb
    JOIN public.session_history sh
      ON (
              CASE
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
    GROUP BY wb.provider, wb.model, wb.quota_type, wb.expected_reset_at, COALESCE(sh.model, 'unknown'), sh.model
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
                'traces', pmu.traces,
                'recent_traces_90m', pmu.recent_traces_90m
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

export function buildQuotaRangeHistoryQuery(searchParams) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)

  const sql = `
WITH normalized AS (
    SELECT
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'weekly_special', 'short', 'short_special', 'requests', 'monthly')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.fromDate < ($2::date::timestamp AT TIME ZONE 'America/New_York')
      AND ri.expected_reset_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
),
window_bounds AS (
    SELECT
        provider,
        model,
        quota_type,
        expected_reset_at,
        MIN(interval_start) AS interval_start,
        MAX(interval_end) AS interval_end,
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
      ON ${providerDimension} = wb.provider
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
    0::double precision AS velocity_sample_count,
    '[]'::jsonb AS velocity_segments,
    '[]'::jsonb AS velocity_scores,
    COALESCE(SUM(pmu.tokens), 0)::double precision AS usage_tokens,
    COALESCE(
        json_agg(
            json_build_object(
                'model', pmu.sh_model,
                'tokens', pmu.tokens,
                'cost', pmu.cost,
                'traces', pmu.traces,
                'recent_traces_90m', 0
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
GROUP BY
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.expected_reset_at,
    wb.interval_start,
    wb.interval_end,
    wb.min_remaining_pct,
    wb.max_remaining_pct
ORDER BY wb.provider ASC, wb.expected_reset_at DESC, wb.quota_type ASC;
`

  return { sql, values: [from, to] }
}

export function buildQuotaEstimatorDatasetQuery(searchParams, lagMinutes = 0) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)
  const lag = Number(lagMinutes)
  if (!Number.isFinite(lag) || lag < 0 || lag > 24 * 60) {
    throw new Error(`Unsupported quota estimator lag: ${lagMinutes}`)
  }
  const lagInterval = `${lag.toString()} minutes`

  const sql = `
WITH reset_windows AS (
    SELECT
        ri.provider AS raw_provider,
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'openai' THEN 'openai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'openai/%' THEN 'openai'
            ELSE lower(COALESCE(ri.provider, 'unknown'))
        END AS provider,
        ri.quota_key,
        CASE
            WHEN ri.provider = 'anthropic' AND ri.quota_key = 'anthropic_unified_5h:5h' THEN 'short'
            WHEN ri.provider = 'anthropic' AND ri.quota_key = 'anthropic_unified_7d:7d' THEN 'weekly'
            WHEN ri.provider = 'anthropic' AND ri.quota_key = 'anthropic_unified_7d_sonnet:7d_sonnet' THEN 'special'
            WHEN ri.provider = 'openai' AND ri.quota_key = 'codex:primary' THEN 'short'
            WHEN ri.provider = 'openai' AND ri.quota_key = 'codex:secondary' THEN 'weekly'
            WHEN ri.provider = 'openai' AND ri.quota_key = 'codex_bengalfox:primary' THEN 'short_special'
            WHEN ri.provider = 'openai' AND ri.quota_key = 'codex_bengalfox:secondary' THEN 'special'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.quota_type AS raw_interval_quota_type,
        ri.expected_reset_at,
        MIN(ri.fromDate) AS reset_start_at,
        MAX(ri.toDate) AS reset_end_at
    FROM public.rate_limit_intervals ri
    WHERE ri.provider IN ('anthropic', 'openai')
      AND ri.quota_key IN (
          'anthropic_unified_5h:5h',
          'anthropic_unified_7d:7d',
          'anthropic_unified_7d_sonnet:7d_sonnet',
          'codex:primary',
          'codex:secondary',
          'codex_bengalfox:primary',
          'codex_bengalfox:secondary'
      )
      AND ri.expected_reset_at IS NOT NULL
    GROUP BY
        ri.provider,
        ri.quota_key,
        ri.quota_type,
        ri.expected_reset_at
),
observations AS (
    SELECT
        o.provider AS raw_provider,
        CASE
            WHEN lower(COALESCE(o.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) = 'openai' THEN 'openai'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'openai/%' THEN 'openai'
            ELSE lower(COALESCE(o.provider, 'unknown'))
        END AS provider,
        o.quota_key,
        CASE
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_5h:5h' THEN 'short'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d:7d' THEN 'weekly'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d_sonnet:7d_sonnet' THEN 'special'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:primary' THEN 'short'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:secondary' THEN 'weekly'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:primary' THEN 'short_special'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:secondary' THEN 'special'
            ELSE NULL
        END AS quota_type,
        o.quota_type AS raw_observation_quota_type,
        o.expected_reset_at,
        o.observed_at,
        MAX(GREATEST(0, LEAST(100, 100 - o.remaining_pct)))::double precision AS consumed_pct
    FROM public.rate_limit_observations o
    WHERE o.provider IN ('anthropic', 'openai')
      AND o.quota_key IN (
          'anthropic_unified_5h:5h',
          'anthropic_unified_7d:7d',
          'anthropic_unified_7d_sonnet:7d_sonnet',
          'codex:primary',
          'codex:secondary',
          'codex_bengalfox:primary',
          'codex_bengalfox:secondary'
      )
      AND o.remaining_pct IS NOT NULL
      AND o.remaining_pct >= 0
      AND o.observed_at IS NOT NULL
      AND o.observed_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
      AND o.observed_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')
    GROUP BY
        o.provider,
        o.quota_key,
        o.quota_type,
        o.expected_reset_at,
        o.observed_at
),
ordered_observations AS (
    SELECT
        o.*,
        LAG(o.consumed_pct) OVER (
            PARTITION BY o.provider, o.quota_key, o.expected_reset_at
            ORDER BY o.observed_at ASC
        ) AS previous_consumed_pct,
        LAG(o.observed_at) OVER (
            PARTITION BY o.provider, o.quota_key, o.expected_reset_at
            ORDER BY o.observed_at ASC
        ) AS previous_observed_at
    FROM observations o
),
quota_pct_interval AS (
    SELECT
        o.provider,
        o.raw_provider,
        o.quota_key,
        o.quota_type,
        CASE
            WHEN o.provider = 'anthropic' AND o.quota_type = 'short' THEN 'anthropic_5h_all_model'
            WHEN o.provider = 'anthropic' AND o.quota_type = 'weekly' THEN 'anthropic_weekly_all_model'
            WHEN o.provider = 'anthropic' AND o.quota_type = 'special' THEN 'anthropic_weekly_sonnet'
            WHEN o.provider = 'openai' AND o.quota_type = 'short' THEN 'openai_5h_all_model'
            WHEN o.provider = 'openai' AND o.quota_type = 'weekly' THEN 'openai_weekly_all_model'
            WHEN o.provider = 'openai' AND o.quota_type = 'short_special' THEN 'openai_codex_spark_5h'
            WHEN o.provider = 'openai' AND o.quota_type = 'special' THEN 'openai_codex_spark_weekly'
            ELSE o.provider || '_' || COALESCE(o.quota_type, 'unknown')
        END AS quota_lane,
        o.raw_observation_quota_type,
        rw.raw_interval_quota_type,
        o.expected_reset_at,
        rw.reset_start_at,
        COALESCE(rw.reset_end_at, o.expected_reset_at) AS reset_end_at,
        o.previous_observed_at AS interval_start_at,
        o.observed_at AS interval_end_at,
        o.previous_consumed_pct,
        o.consumed_pct AS current_consumed_pct,
        (o.consumed_pct - o.previous_consumed_pct)::double precision AS delta_pct,
        CASE
            WHEN o.previous_observed_at IS NULL THEN true
            WHEN o.consumed_pct < o.previous_consumed_pct THEN true
            ELSE false
        END AS is_reset_boundary,
        CASE
            WHEN o.previous_consumed_pct >= 99.5 OR o.consumed_pct >= 99.5 THEN true
            ELSE false
        END AS is_capped_at_100,
        CASE
            WHEN o.previous_observed_at IS NULL THEN false
            WHEN o.consumed_pct <= o.previous_consumed_pct THEN false
            WHEN o.previous_consumed_pct >= 99.5 OR o.consumed_pct >= 99.5 THEN false
            ELSE true
        END AS trainable,
        CASE
            WHEN o.previous_observed_at IS NULL THEN 'first_observation_in_reset_period'
            WHEN o.consumed_pct < o.previous_consumed_pct THEN 'reset_or_measurement_boundary'
            WHEN o.consumed_pct = o.previous_consumed_pct THEN 'plateau_no_positive_delta'
            WHEN o.previous_consumed_pct >= 99.5 OR o.consumed_pct >= 99.5 THEN 'capped_at_100'
            ELSE NULL
        END AS exclude_reason
    FROM ordered_observations o
    LEFT JOIN reset_windows rw
           ON rw.provider = o.provider
          AND rw.quota_key = o.quota_key
          AND rw.expected_reset_at IS NOT DISTINCT FROM o.expected_reset_at
    WHERE o.quota_type IS NOT NULL
),
ranked_quota_interval AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY provider, quota_key, quota_type
            ORDER BY interval_end_at DESC
        ) AS interval_rank
    FROM quota_pct_interval
),
llm_usage_event AS (
    SELECT
        ${providerDimension} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        CASE
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%haiku%' THEN 'haiku'
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%sonnet%' THEN 'sonnet'
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%opus%' THEN 'opus'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE '%spark%' THEN 'spark'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE '%codex%' THEN 'codex'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE 'gpt%' THEN 'gpt'
            ELSE 'other'
        END AS model_family,
        COALESCE(sh.end_time, sh.start_time, sh.created_at) + INTERVAL '${lagInterval}' AS effective_request_at,
        COALESCE(sh.input_tokens, 0)::double precision AS uncached_input_tokens,
        COALESCE(sh.output_tokens, 0)::double precision AS output_tokens,
        COALESCE(sh.cache_read_input_tokens, 0)::double precision AS cache_read_tokens,
        COALESCE(sh.cache_creation_input_tokens, 0)::double precision AS cache_create_tokens,
        (COALESCE(sh.reasoning_tokens_reported, 0)
          + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS reasoning_tokens,
        COALESCE(sh.response_cost_usd, 0)::double precision AS usd_cost,
        COALESCE(sh.tool_call_count, 0)::double precision AS tool_calls
    FROM public.session_history sh
    WHERE COALESCE(sh.end_time, sh.start_time, sh.created_at) >= ($1::date::timestamp AT TIME ZONE 'America/New_York') - INTERVAL '1 hour'
      AND COALESCE(sh.end_time, sh.start_time, sh.created_at) < ($2::date::timestamp AT TIME ZONE 'America/New_York') + INTERVAL '1 hour'
      AND ${providerDimension} IN ('anthropic', 'openai')
),
aggregated AS (
    SELECT
        q.provider,
        q.quota_key,
        q.quota_type,
        q.quota_lane,
        q.raw_observation_quota_type,
        q.raw_interval_quota_type,
        q.expected_reset_at,
        q.reset_start_at,
        q.reset_end_at,
        q.interval_start_at,
        q.interval_end_at,
        q.previous_consumed_pct,
        q.current_consumed_pct,
        q.delta_pct,
        q.is_reset_boundary,
        q.is_capped_at_100,
        q.trainable,
        q.exclude_reason,
        COALESCE(u.model_family, 'no_usage') AS model_family,
        COUNT(u.model)::double precision AS traces,
        SUM(COALESCE(u.uncached_input_tokens, 0))::double precision AS uncached_input_tokens,
        SUM(COALESCE(u.output_tokens, 0))::double precision AS output_tokens,
        SUM(COALESCE(u.cache_read_tokens, 0))::double precision AS cache_read_tokens,
        SUM(COALESCE(u.cache_create_tokens, 0))::double precision AS cache_create_tokens,
        SUM(COALESCE(u.reasoning_tokens, 0))::double precision AS reasoning_tokens,
        SUM(COALESCE(u.usd_cost, 0))::double precision AS usd_cost,
        SUM(COALESCE(u.tool_calls, 0))::double precision AS tool_calls
    FROM ranked_quota_interval q
    LEFT JOIN llm_usage_event u
      ON u.provider = q.provider
     AND u.effective_request_at >= q.interval_start_at
     AND u.effective_request_at < q.interval_end_at
     AND (
          q.provider <> 'openai'
          OR (q.quota_type IN ('short', 'weekly') AND u.model_family <> 'spark')
          OR (q.quota_type IN ('short_special', 'special') AND u.model_family = 'spark')
     )
    WHERE q.interval_rank <= ${QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE}
    GROUP BY
        q.provider,
        q.quota_key,
        q.quota_type,
        q.quota_lane,
        q.raw_observation_quota_type,
        q.raw_interval_quota_type,
        q.expected_reset_at,
        q.reset_start_at,
        q.reset_end_at,
        q.interval_start_at,
        q.interval_end_at,
        q.previous_consumed_pct,
        q.current_consumed_pct,
        q.delta_pct,
        q.is_reset_boundary,
        q.is_capped_at_100,
        q.trainable,
        q.exclude_reason,
        COALESCE(u.model_family, 'no_usage')
)
SELECT
    ${lag}::double precision AS lag_minutes,
    provider,
    quota_key,
    quota_type,
    quota_lane,
    raw_observation_quota_type,
    raw_interval_quota_type,
    expected_reset_at,
    reset_start_at,
    reset_end_at,
    interval_start_at,
    interval_end_at,
    previous_consumed_pct,
    current_consumed_pct,
    delta_pct,
    is_reset_boundary,
    is_capped_at_100,
    trainable,
    exclude_reason,
    model_family,
    traces,
    uncached_input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_create_tokens,
    reasoning_tokens,
    usd_cost,
    tool_calls
FROM aggregated
ORDER BY provider ASC, quota_type ASC, quota_key ASC, interval_end_at ASC, model_family ASC;
`

  return { sql, values: [from, to], metadata: { from, to, lagMinutes: lag } }
}

export function buildQuotaEstimatorObservationQuery(searchParams) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)

  const sql = `
WITH reset_windows AS (
    SELECT
        ri.provider AS raw_provider,
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'openai' THEN 'openai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'openai/%' THEN 'openai'
            ELSE lower(COALESCE(ri.provider, 'unknown'))
        END AS provider,
        ri.quota_key,
        ri.quota_type AS raw_interval_quota_type,
        ri.expected_reset_at,
        MIN(ri.fromDate) AS reset_start_at,
        MAX(ri.toDate) AS reset_end_at
    FROM public.rate_limit_intervals ri
    WHERE ri.provider IN ('anthropic', 'openai')
      AND ri.quota_key IN (
          'anthropic_unified_5h:5h',
          'anthropic_unified_7d:7d',
          'anthropic_unified_7d_sonnet:7d_sonnet',
          'codex:primary',
          'codex:secondary',
          'codex_bengalfox:primary',
          'codex_bengalfox:secondary'
      )
      AND ri.expected_reset_at IS NOT NULL
    GROUP BY ri.provider, ri.quota_key, ri.quota_type, ri.expected_reset_at
),
observations AS (
    SELECT
        o.provider AS raw_provider,
        CASE
            WHEN lower(COALESCE(o.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
            WHEN lower(COALESCE(o.provider, 'unknown')) = 'openai' THEN 'openai'
            WHEN lower(COALESCE(o.provider, 'unknown')) LIKE 'openai/%' THEN 'openai'
            ELSE lower(COALESCE(o.provider, 'unknown'))
        END AS provider,
        o.quota_key,
        CASE
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_5h:5h' THEN 'short'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d:7d' THEN 'weekly'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d_sonnet:7d_sonnet' THEN 'special'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:primary' THEN 'short'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:secondary' THEN 'weekly'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:primary' THEN 'short_special'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:secondary' THEN 'special'
            ELSE NULL
        END AS quota_type,
        CASE
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_5h:5h' THEN 'anthropic_5h_all_model'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d:7d' THEN 'anthropic_weekly_all_model'
            WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d_sonnet:7d_sonnet' THEN 'anthropic_weekly_sonnet'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:primary' THEN 'openai_5h_all_model'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex:secondary' THEN 'openai_weekly_all_model'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:primary' THEN 'openai_codex_spark_5h'
            WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:secondary' THEN 'openai_codex_spark_weekly'
            ELSE o.provider || '_unknown'
        END AS quota_lane,
        o.quota_type AS raw_observation_quota_type,
        o.expected_reset_at,
        o.observed_at,
        MAX(GREATEST(0, LEAST(100, 100 - o.remaining_pct)))::double precision AS consumed_pct
    FROM public.rate_limit_observations o
    WHERE o.provider IN ('anthropic', 'openai')
      AND o.quota_key IN (
          'anthropic_unified_5h:5h',
          'anthropic_unified_7d:7d',
          'anthropic_unified_7d_sonnet:7d_sonnet',
          'codex:primary',
          'codex:secondary',
          'codex_bengalfox:primary',
          'codex_bengalfox:secondary'
      )
      AND o.remaining_pct IS NOT NULL
      AND o.remaining_pct >= 0
      AND o.observed_at IS NOT NULL
      AND o.observed_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
      AND o.observed_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')
    GROUP BY
        o.provider,
        o.quota_key,
        o.quota_type,
        o.expected_reset_at,
        o.observed_at
)
SELECT
    o.provider,
    o.raw_provider,
    o.quota_key,
    o.quota_type,
    o.quota_lane,
    o.raw_observation_quota_type,
    rw.raw_interval_quota_type,
    o.expected_reset_at,
    rw.reset_start_at,
    COALESCE(rw.reset_end_at, o.expected_reset_at) AS reset_end_at,
    o.observed_at,
    o.consumed_pct
FROM observations o
LEFT JOIN reset_windows rw
       ON rw.provider = o.provider
      AND rw.quota_key = o.quota_key
      AND rw.expected_reset_at IS NOT DISTINCT FROM o.expected_reset_at
WHERE o.quota_type IS NOT NULL
ORDER BY o.provider ASC, o.quota_key ASC, o.expected_reset_at ASC NULLS LAST, o.observed_at ASC;
`

  return { sql, values: [from, to], metadata: { from, to } }
}

export function buildQuotaEstimatorUsageBucketQuery(searchParams) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)

  const sql = `
WITH usage_events AS (
    SELECT
        ${providerDimension} AS provider,
        CASE
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%haiku%' THEN 'haiku'
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%sonnet%' THEN 'sonnet'
            WHEN ${providerDimension} = 'anthropic' AND COALESCE(sh.model, '') ILIKE '%opus%' THEN 'opus'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE '%spark%' THEN 'spark'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE '%codex%' THEN 'codex'
            WHEN ${providerDimension} = 'openai' AND COALESCE(sh.model, '') ILIKE 'gpt%' THEN 'gpt'
            ELSE 'other'
        END AS model_family,
        to_timestamp(
            floor(extract(epoch from COALESCE(sh.end_time, sh.start_time, sh.created_at)) / 300) * 300
        ) AS bucket_start_at,
        COALESCE(sh.input_tokens, 0)::double precision AS uncached_input_tokens,
        COALESCE(sh.output_tokens, 0)::double precision AS output_tokens,
        COALESCE(sh.cache_read_input_tokens, 0)::double precision AS cache_read_tokens,
        COALESCE(sh.cache_creation_input_tokens, 0)::double precision AS cache_create_tokens,
        (COALESCE(sh.reasoning_tokens_reported, 0)
          + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS reasoning_tokens,
        COALESCE(sh.response_cost_usd, 0)::double precision AS usd_cost,
        COALESCE(sh.tool_call_count, 0)::double precision AS tool_calls
    FROM public.session_history sh
    WHERE COALESCE(sh.end_time, sh.start_time, sh.created_at) >= ($1::date::timestamp AT TIME ZONE 'America/New_York') - INTERVAL '1 hour'
      AND COALESCE(sh.end_time, sh.start_time, sh.created_at) < ($2::date::timestamp AT TIME ZONE 'America/New_York') + INTERVAL '2 hours'
      AND ${providerDimension} IN ('anthropic', 'openai')
)
SELECT
    provider,
    model_family,
    bucket_start_at,
    COUNT(*)::double precision AS traces,
    SUM(uncached_input_tokens)::double precision AS uncached_input_tokens,
    SUM(output_tokens)::double precision AS output_tokens,
    SUM(cache_read_tokens)::double precision AS cache_read_tokens,
    SUM(cache_create_tokens)::double precision AS cache_create_tokens,
    SUM(reasoning_tokens)::double precision AS reasoning_tokens,
    SUM(usd_cost)::double precision AS usd_cost,
    SUM(tool_calls)::double precision AS tool_calls
FROM usage_events
GROUP BY provider, model_family, bucket_start_at
ORDER BY provider ASC, bucket_start_at ASC, model_family ASC;
`

  return { sql, values: [from, to], metadata: { from, to } }
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
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
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
    WHERE ${startTimeDateRangeWhere.join('\n      AND ')}
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
    WHERE ${startTimeDateRangeWhere.join('\n      AND ')}
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
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
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
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
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
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
  }
}

function normalizeTokenTrendModelFirstSeenRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    first_seen_at: row.first_seen_at ?? null,
    first_seen_day: row.first_seen_day ?? null,
    first_seen_hour: normalizeNumber(row.first_seen_hour),
    observations: normalizeNumber(row.observations) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
  }
}

const tokenTrendScoreNumericKeys = [
  'agent_score_rows',
  'agent_quality_score',
  'agent_quality_evaluated',
  'agent_quality_possible',
  'agent_quality_failures',
  'agent_instruction_score',
  'agent_instruction_evaluated',
  'agent_instruction_possible',
  'agent_instruction_failures',
  'agent_tool_score',
  'agent_tool_evaluated',
  'agent_tool_possible',
  'agent_tool_failures',
  'agent_contract_score',
  'agent_contract_evaluated',
  'agent_contract_possible',
  'agent_contract_failures',
  'agent_progress_score',
  'agent_progress_evaluated',
  'agent_progress_possible',
  'agent_progress_failures',
  'agent_risk_score',
  'agent_risk_evaluated',
  'agent_risk_possible',
  'agent_risk_events',
]

function normalizeTokenTrendScoreRow(row) {
  const normalized = {
    bucket: row.bucket,
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
  }
  for (const key of tokenTrendScoreNumericKeys) {
    normalized[key] = normalizeNumber(row[key])
  }
  return normalized
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
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
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
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
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

function normalizeDockerLogErrorRow(row) {
  return {
    observed_at: row.observed_at ?? null,
    container: row.container ?? 'unknown',
    stream: row.stream ?? 'unknown',
    provider: row.provider ?? 'unknown',
    status_code: normalizeNumber(row.status_code),
    level: row.level ?? 'error',
    message: row.message ?? '',
  }
}

function normalizeLocalHealthRow(row) {
  const status = String(row.status ?? 'red')
  return {
    checked_at: row.checked_at ?? null,
    category: row.category === 'model' ? 'model' : 'container',
    key: row.key ?? 'unknown',
    label: row.label ?? row.key ?? 'unknown',
    status:
      status === 'green' || status === 'yellow' || status === 'red'
        ? status
        : 'red',
    detail: row.detail ?? '',
    target: row.target ?? null,
    latency_ms: normalizeNumber(row.latency_ms),
  }
}

function normalizeProviderStatusUsageRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    ...normalizeLatencyAggregateFields(row),
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
    recent_traces_90m: normalizeNumber(item?.recent_traces_90m) ?? 0,
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
          recent_traces_90m: normalizeNumber(b.recent_traces_90m) ?? 0,
        }))
      : [],
  }
}

function normalizeQuotaEstimatorDatasetRow(row) {
  return {
    lag_minutes: normalizeNumber(row.lag_minutes) ?? 0,
    provider: row.provider ?? 'unknown',
    quota_key: row.quota_key ?? 'unknown',
    quota_type: row.quota_type ?? 'unknown',
    quota_lane: row.quota_lane ?? 'unknown',
    raw_observation_quota_type: row.raw_observation_quota_type ?? null,
    raw_interval_quota_type: row.raw_interval_quota_type ?? null,
    expected_reset_at: row.expected_reset_at ?? null,
    reset_start_at: row.reset_start_at ?? null,
    reset_end_at: row.reset_end_at ?? null,
    interval_start_at: row.interval_start_at ?? null,
    interval_end_at: row.interval_end_at ?? null,
    previous_consumed_pct: normalizeNumber(row.previous_consumed_pct),
    current_consumed_pct: normalizeNumber(row.current_consumed_pct),
    delta_pct: normalizeNumber(row.delta_pct),
    is_reset_boundary: Boolean(row.is_reset_boundary),
    is_capped_at_100: Boolean(row.is_capped_at_100),
    trainable: Boolean(row.trainable),
    exclude_reason: row.exclude_reason ?? null,
    model_family: row.model_family ?? 'no_usage',
    traces: normalizeNumber(row.traces) ?? 0,
    uncached_input_tokens: normalizeNumber(row.uncached_input_tokens) ?? 0,
    output_tokens: normalizeNumber(row.output_tokens) ?? 0,
    cache_read_tokens: normalizeNumber(row.cache_read_tokens) ?? 0,
    cache_create_tokens: normalizeNumber(row.cache_create_tokens) ?? 0,
    reasoning_tokens: normalizeNumber(row.reasoning_tokens) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
  }
}

function normalizeQuotaEstimatorObservationRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    raw_provider: row.raw_provider ?? null,
    quota_key: row.quota_key ?? 'unknown',
    quota_type: row.quota_type ?? 'unknown',
    quota_lane: row.quota_lane ?? 'unknown',
    raw_observation_quota_type: row.raw_observation_quota_type ?? null,
    raw_interval_quota_type: row.raw_interval_quota_type ?? null,
    expected_reset_at: row.expected_reset_at ?? null,
    reset_start_at: row.reset_start_at ?? null,
    reset_end_at: row.reset_end_at ?? null,
    observed_at: row.observed_at ?? null,
    consumed_pct: normalizeNumber(row.consumed_pct),
  }
}

function normalizeQuotaEstimatorUsageBucketRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model_family: row.model_family ?? 'other',
    bucket_start_at: row.bucket_start_at ?? null,
    traces: normalizeNumber(row.traces) ?? 0,
    uncached_input_tokens: normalizeNumber(row.uncached_input_tokens) ?? 0,
    output_tokens: normalizeNumber(row.output_tokens) ?? 0,
    cache_read_tokens: normalizeNumber(row.cache_read_tokens) ?? 0,
    cache_create_tokens: normalizeNumber(row.cache_create_tokens) ?? 0,
    reasoning_tokens: normalizeNumber(row.reasoning_tokens) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
  }
}

function buildQuotaEstimatorPhase0Audit() {
  return {
    source_database: 'aawm_tristore',
    usage_event_shape: {
      source_table: 'public.session_history',
      timestamp_policy: 'COALESCE(end_time, start_time, created_at)',
      token_categories: [
        'uncached_input_tokens',
        'output_tokens',
        'cache_read_tokens',
        'cache_create_tokens',
        'reasoning_tokens',
      ],
      cache_read_policy:
        'cache_read_input_tokens is kept as a separate feature and is not summed into uncached input.',
      cache_write_policy:
        'cache_creation_input_tokens is preserved as one generic cache create/write bucket; duration-specific 5m/1h cache write fields were not verified in session_history.',
    },
    quota_pct_interval_shape: {
      source_table: 'public.rate_limit_observations',
      reset_context_table: 'public.rate_limit_intervals',
      value_policy: 'consumed_pct = 100 - remaining_pct',
      interval_policy:
        'consecutive observations per provider/quota_key/expected_reset_at form plateau intervals.',
      excluded_training_rows: [
        'first_observation_in_reset_period',
        'reset_or_measurement_boundary',
        'plateau_no_positive_delta',
        'capped_at_100',
      ],
    },
    provider_lane_policy: {
      anthropic: [
        'short -> 5-hour all-model',
        'weekly -> weekly all-model',
        'special -> weekly Sonnet-only; Haiku/Opus coefficients are diagnostics',
      ],
      openai: [
        'short/weekly -> Codex all-model lanes',
        'short_special/special -> Codex Spark lanes',
        'single-observation unknown-window keys are excluded from training',
      ],
    },
    known_missing_fields: [
      'cache_write_5m_tokens',
      'cache_write_1h_tokens',
      'shared account_id across session_history and rate_limit_observations',
    ],
  }
}

function quotaEstimatorIntervalKey(row) {
  return [
    row.lag_minutes,
    row.provider,
    row.quota_key,
    row.quota_type,
    row.expected_reset_at ?? '',
    row.interval_start_at ?? '',
    row.interval_end_at ?? '',
  ].join('|')
}

function quotaEstimatorLaneKey(row) {
  return [row.provider, row.quota_key, row.quota_type, row.quota_lane].join('|')
}

function buildQuotaEstimatorIntervals(rows) {
  const intervalsByKey = new Map()
  for (const row of rows) {
    const key = quotaEstimatorIntervalKey(row)
    let interval = intervalsByKey.get(key)
    if (!interval) {
      interval = {
        lagMinutes: row.lag_minutes,
        provider: row.provider,
        quotaKey: row.quota_key,
        quotaType: row.quota_type,
        quotaLane: row.quota_lane,
        expectedResetAt: row.expected_reset_at,
        resetStartAt: row.reset_start_at,
        resetEndAt: row.reset_end_at,
        intervalStartAt: row.interval_start_at,
        intervalEndAt: row.interval_end_at,
        previousConsumedPct: row.previous_consumed_pct,
        currentConsumedPct: row.current_consumed_pct,
        deltaPct: row.delta_pct,
        isResetBoundary: row.is_reset_boundary,
        isCappedAt100: row.is_capped_at_100,
        trainable: row.trainable,
        excludeReason: row.exclude_reason,
        featureTotals: {},
        traces: 0,
        usdCost: 0,
        toolCalls: 0,
      }
      intervalsByKey.set(key, interval)
    }
    if (row.model_family !== 'no_usage') {
      const family = row.model_family
      interval.featureTotals[family] ??= {
        uncachedInputMtok: 0,
        outputMtok: 0,
        cacheReadMtok: 0,
        cacheCreateMtok: 0,
        reasoningMtok: 0,
      }
      interval.featureTotals[family].uncachedInputMtok +=
        row.uncached_input_tokens / 1_000_000
      interval.featureTotals[family].outputMtok += row.output_tokens / 1_000_000
      interval.featureTotals[family].cacheReadMtok +=
        row.cache_read_tokens / 1_000_000
      interval.featureTotals[family].cacheCreateMtok +=
        row.cache_create_tokens / 1_000_000
      interval.featureTotals[family].reasoningMtok +=
        row.reasoning_tokens / 1_000_000
    }
    interval.traces += row.traces
    interval.usdCost += row.usd_cost
    interval.toolCalls += row.tool_calls
  }
  return [...intervalsByKey.values()].sort((a, b) =>
    String(a.intervalEndAt ?? '').localeCompare(String(b.intervalEndAt ?? ''))
  )
}

function quotaEstimatorFeatureNames(intervals) {
  const families = new Set()
  for (const interval of intervals) {
    for (const family of Object.keys(interval.featureTotals)) {
      families.add(family)
    }
  }
  const orderedFamilies = [...families].sort()
  const names = []
  for (const family of orderedFamilies) {
    names.push(`${family}:workload`)
    names.push(`${family}:cache_read`)
  }
  return names
}

function quotaEstimatorFeatureVector(interval, featureNames) {
  return featureNames.map((name) => {
    const [family, category] = name.split(':')
    const totals = interval.featureTotals[family]
    if (!totals) return 0
    if (category === 'cache_read') return totals.cacheReadMtok
    return (
      totals.uncachedInputMtok +
      totals.outputMtok +
      totals.cacheCreateMtok +
      totals.reasoningMtok
    )
  })
}

function fitNonNegativeRidge(samples, featureNames, options = {}) {
  const ridge = options.ridge ?? 1e-6
  const weights = options.weights ?? samples.map(() => 1)
  const xs = samples.map((sample) =>
    quotaEstimatorFeatureVector(sample, featureNames)
  )
  const ys = samples.map((sample) => sample.deltaPct ?? 0)
  const featureCount = featureNames.length
  const beta = Array(featureCount).fill(0)
  const predictions = Array(samples.length).fill(0)

  for (let iteration = 0; iteration < 500; iteration += 1) {
    let maxChange = 0
    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      let numerator = 0
      let denominator = ridge
      for (let rowIndex = 0; rowIndex < samples.length; rowIndex += 1) {
        const x = xs[rowIndex][featureIndex]
        if (x === 0) continue
        const weight = weights[rowIndex] ?? 1
        const predictionWithoutFeature =
          predictions[rowIndex] - beta[featureIndex] * x
        numerator += weight * x * (ys[rowIndex] - predictionWithoutFeature)
        denominator += weight * x * x
      }
      if (denominator <= 0) continue
      const next = Math.max(0, numerator / denominator)
      const change = next - beta[featureIndex]
      if (change !== 0) {
        beta[featureIndex] = next
        maxChange = Math.max(maxChange, Math.abs(change))
        for (let rowIndex = 0; rowIndex < samples.length; rowIndex += 1) {
          predictions[rowIndex] += change * xs[rowIndex][featureIndex]
        }
      }
    }
    if (maxChange < 1e-9) break
  }

  return {
    coefficients: Object.fromEntries(
      featureNames.map((name, index) => [name, beta[index]])
    ),
    predictions,
  }
}

function quotaEstimatorResidualMetrics(samples, predictions, weights = []) {
  if (!samples.length) {
    return { rmse_pct: null, mae_pct: null, max_abs_error_pct: null }
  }
  let weightedSquared = 0
  let weightedAbsolute = 0
  let totalWeight = 0
  let maxAbs = 0
  for (let index = 0; index < samples.length; index += 1) {
    const weight = weights[index] ?? 1
    const error = (samples[index].deltaPct ?? 0) - (predictions[index] ?? 0)
    const abs = Math.abs(error)
    weightedSquared += weight * error * error
    weightedAbsolute += weight * abs
    totalWeight += weight
    maxAbs = Math.max(maxAbs, abs)
  }
  return {
    rmse_pct: Math.sqrt(weightedSquared / Math.max(totalWeight, 1)),
    mae_pct: weightedAbsolute / Math.max(totalWeight, 1),
    max_abs_error_pct: maxAbs,
  }
}

function quotaEstimatorWeights(samples, halfLifeHours) {
  if (!samples.length) return []
  const latest = Math.max(
    ...samples.map((sample) => new Date(sample.intervalEndAt).getTime())
  )
  return samples.map((sample) => {
    const ageHours = Math.max(
      0,
      (latest - new Date(sample.intervalEndAt).getTime()) / 3_600_000
    )
    return Math.exp((-Math.LN2 * ageHours) / Math.max(halfLifeHours, 1))
  })
}

function effectiveSampleSize(weights) {
  const sum = weights.reduce((total, weight) => total + weight, 0)
  const sumSquares = weights.reduce((total, weight) => total + weight * weight, 0)
  if (sumSquares <= 0) return 0
  return (sum * sum) / sumSquares
}

function maxFeatureCorrelation(samples, featureNames) {
  if (samples.length < 3 || featureNames.length < 2) return 0
  const xs = samples.map((sample) =>
    quotaEstimatorFeatureVector(sample, featureNames)
  )
  let maxCorrelation = 0
  for (let a = 0; a < featureNames.length; a += 1) {
    for (let b = a + 1; b < featureNames.length; b += 1) {
      const valuesA = xs.map((row) => row[a])
      const valuesB = xs.map((row) => row[b])
      const meanA =
        valuesA.reduce((total, value) => total + value, 0) / valuesA.length
      const meanB =
        valuesB.reduce((total, value) => total + value, 0) / valuesB.length
      let covariance = 0
      let varianceA = 0
      let varianceB = 0
      for (let index = 0; index < valuesA.length; index += 1) {
        const deltaA = valuesA[index] - meanA
        const deltaB = valuesB[index] - meanB
        covariance += deltaA * deltaB
        varianceA += deltaA * deltaA
        varianceB += deltaB * deltaB
      }
      if (varianceA <= 0 || varianceB <= 0) continue
      maxCorrelation = Math.max(
        maxCorrelation,
        Math.abs(covariance / Math.sqrt(varianceA * varianceB))
      )
    }
  }
  return maxCorrelation
}

function quotaEstimatorIdentifiability(samples, featureNames, weights = []) {
  const activeFeatures = featureNames.filter((featureName) =>
    samples.some(
      (sample) => quotaEstimatorFeatureVector(sample, [featureName])[0] > 0
    )
  )
  const familyMix = new Set(
    activeFeatures.map((featureName) => featureName.split(':')[0])
  )
  const maxCorrelation = maxFeatureCorrelation(samples, activeFeatures)
  const sampleSize = samples.length
  const effectiveN = weights.length ? effectiveSampleSize(weights) : sampleSize
  let status = 'high_confidence'
  const risks = []
  if (
    sampleSize < QUOTA_ESTIMATOR_MIN_TRAINING_ROWS ||
    activeFeatures.length === 0
  ) {
    status = 'not_identifiable'
    risks.push('too_few_trainable_intervals')
  }
  if (familyMix.size < 2) {
    status = status === 'not_identifiable' ? status : 'directional_only'
    risks.push('low_model_family_mix')
  }
  if (sampleSize < QUOTA_ESTIMATOR_HIGH_CONFIDENCE_ROWS) {
    status = status === 'not_identifiable' ? status : 'directional_only'
    risks.push('small_sample_window')
  }
  if (maxCorrelation >= 0.95) {
    status = status === 'not_identifiable' ? status : 'directional_only'
    risks.push('high_feature_correlation')
  }
  if (activeFeatures.length >= sampleSize) {
    status = status === 'not_identifiable' ? status : 'directional_only'
    risks.push('feature_count_near_sample_count')
  }

  return {
    status,
    trainable_interval_count: sampleSize,
    effective_sample_size: effectiveN,
    active_feature_count: activeFeatures.length,
    model_family_mix_count: familyMix.size,
    max_feature_correlation: maxCorrelation,
    risks,
  }
}

function quotaEstimatorCoefficientRows({
  coefficients,
  featureNames,
  identifiability,
  residuals,
  samples,
  estimateKind,
  halfLifeHours,
}) {
  const sonnetBase = coefficients['sonnet:workload'] ?? 0
  const rows = []
  for (const featureName of featureNames) {
    const [family, category] = featureName.split(':')
    const coefficient = coefficients[featureName] ?? 0
    const featureValues = samples.map(
      (sample) => quotaEstimatorFeatureVector(sample, [featureName])[0]
    )
    const featureScale = Math.sqrt(
      featureValues.reduce((total, value) => total + value * value, 0) /
        Math.max(featureValues.length, 1)
    )
    const widen =
      identifiability.status === 'high_confidence'
        ? 1
        : identifiability.status === 'directional_only'
          ? 2.5
          : 6
    const standardError =
      ((residuals.rmse_pct ?? 0) /
        Math.sqrt(Math.max(identifiability.effective_sample_size, 1)) /
        Math.max(featureScale, 1e-6)) *
      widen
    rows.push({
      estimate_kind: estimateKind,
      feature: featureName,
      model_family: family,
      token_category:
        category === 'cache_read'
          ? 'cache_read'
          : 'workload_excluding_cache_read',
      coefficient_pct_per_mtok: coefficient,
      relative_weight_vs_sonnet:
        category === 'workload' && sonnetBase > 0
          ? coefficient / sonnetBase
          : null,
      confidence_low_pct_per_mtok: Math.max(0, coefficient - 1.96 * standardError),
      confidence_high_pct_per_mtok: coefficient + 1.96 * standardError,
      half_life_hours: halfLifeHours,
      effective_sample_size: identifiability.effective_sample_size,
      estimate_status: identifiability.status,
    })
  }
  return rows
}

function quotaEstimatorCacheReadRatios(coefficients) {
  const ratios = []
  const families = new Set(
    Object.keys(coefficients).map((featureName) => featureName.split(':')[0])
  )
  for (const family of families) {
    const workload = coefficients[`${family}:workload`] ?? 0
    const cacheRead = coefficients[`${family}:cache_read`] ?? 0
    ratios.push({
      model_family: family,
      cache_read_vs_uncached_workload_ratio:
        workload > 0 ? cacheRead / workload : null,
      expected_lower_than_uncached: true,
      status:
        workload > 0 && cacheRead / workload <= 1
          ? 'consistent'
          : workload > 0
            ? 'anomalous'
            : 'not_identifiable',
    })
  }
  return ratios
}

function quotaEstimatorBacktest(samples, featureNames, halfLifeHours) {
  const trainable = samples.filter((sample) => sample.trainable)
  if (trainable.length < 8 || featureNames.length === 0) {
    return {
      status: 'not_enough_holdout_data',
      static_rmse_pct: null,
      rolling_rmse_pct: null,
      rolling_improved: false,
    }
  }
  const splitIndex = Math.max(4, Math.floor(trainable.length * 0.7))
  const training = trainable.slice(0, splitIndex)
  const holdout = trainable.slice(splitIndex)
  if (!holdout.length) {
    return {
      status: 'not_enough_holdout_data',
      static_rmse_pct: null,
      rolling_rmse_pct: null,
      rolling_improved: false,
    }
  }
  const staticFit = fitNonNegativeRidge(training, featureNames)
  const rollingWeights = quotaEstimatorWeights(training, halfLifeHours)
  const rollingFit = fitNonNegativeRidge(training, featureNames, {
    weights: rollingWeights,
  })
  const predict = (coefficients) =>
    holdout.map((sample) => {
      const vector = quotaEstimatorFeatureVector(sample, featureNames)
      return vector.reduce(
        (total, value, index) =>
          total + value * (coefficients[featureNames[index]] ?? 0),
        0
      )
    })
  const staticResiduals = quotaEstimatorResidualMetrics(
    holdout,
    predict(staticFit.coefficients)
  )
  const rollingResiduals = quotaEstimatorResidualMetrics(
    holdout,
    predict(rollingFit.coefficients)
  )
  const staticRmse = staticResiduals.rmse_pct
  const rollingRmse = rollingResiduals.rmse_pct
  return {
    status: 'evaluated',
    holdout_interval_count: holdout.length,
    static_rmse_pct: staticRmse,
    rolling_rmse_pct: rollingRmse,
    rolling_improved:
      staticRmse !== null && rollingRmse !== null && rollingRmse < staticRmse,
  }
}

function buildQuotaEstimatorLaneEstimate(laggedIntervals) {
  const intervalsByLag = new Map()
  for (const interval of laggedIntervals) {
    const key = interval.lagMinutes
    const rows = intervalsByLag.get(key) ?? []
    rows.push(interval)
    intervalsByLag.set(key, rows)
  }
  const lagSensitivity = []
  for (const [lagMinutes, intervals] of intervalsByLag.entries()) {
    const trainable = intervals.filter((interval) => interval.trainable)
    const featureNames = quotaEstimatorFeatureNames(trainable)
    if (
      trainable.length < QUOTA_ESTIMATOR_MIN_TRAINING_ROWS ||
      featureNames.length === 0
    ) {
      lagSensitivity.push({
        lag_minutes: lagMinutes,
        trainable_interval_count: trainable.length,
        rmse_pct: null,
        status: 'not_identifiable',
      })
      continue
    }
    const fit = fitNonNegativeRidge(trainable, featureNames)
    const residuals = quotaEstimatorResidualMetrics(trainable, fit.predictions)
    lagSensitivity.push({
      lag_minutes: lagMinutes,
      trainable_interval_count: trainable.length,
      rmse_pct: residuals.rmse_pct,
      status: 'evaluated',
    })
  }
  const selectedLag =
    lagSensitivity
      .filter((entry) => entry.rmse_pct !== null)
      .sort((a, b) => a.rmse_pct - b.rmse_pct)[0]?.lag_minutes ??
    lagSensitivity[0]?.lag_minutes ??
    0
  const intervals = intervalsByLag.get(selectedLag) ?? []
  const trainable = intervals.filter((interval) => interval.trainable)
  const featureNames = quotaEstimatorFeatureNames(trainable)
  const halfLifeHours =
    QUOTA_ESTIMATOR_ROLLING_HALF_LIFE_HOURS[intervals[0]?.quotaType] ?? 72
  const staticFit =
    trainable.length >= QUOTA_ESTIMATOR_MIN_TRAINING_ROWS
      ? fitNonNegativeRidge(trainable, featureNames)
      : { coefficients: {}, predictions: [] }
  const staticResiduals = quotaEstimatorResidualMetrics(
    trainable,
    staticFit.predictions
  )
  const rollingWeights = quotaEstimatorWeights(trainable, halfLifeHours)
  const rollingFit =
    trainable.length >= QUOTA_ESTIMATOR_MIN_TRAINING_ROWS
      ? fitNonNegativeRidge(trainable, featureNames, { weights: rollingWeights })
      : { coefficients: {}, predictions: [] }
  const rollingResiduals = quotaEstimatorResidualMetrics(
    trainable,
    rollingFit.predictions,
    rollingWeights
  )
  const identifiability = quotaEstimatorIdentifiability(
    trainable,
    featureNames,
    rollingWeights
  )
  const excludedReasons = {}
  for (const interval of intervals) {
    if (interval.trainable) continue
    const reason = interval.excludeReason ?? 'not_trainable'
    excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1
  }
  const coefficients = [
    ...quotaEstimatorCoefficientRows({
      coefficients: staticFit.coefficients,
      featureNames,
      identifiability,
      residuals: staticResiduals,
      samples: trainable,
      estimateKind: 'static_baseline',
      halfLifeHours: null,
    }),
    ...quotaEstimatorCoefficientRows({
      coefficients: rollingFit.coefficients,
      featureNames,
      identifiability,
      residuals: rollingResiduals,
      samples: trainable,
      estimateKind: 'rolling_exponential',
      halfLifeHours,
    }),
  ]
  const diagnostics = []
  if (identifiability.status !== 'high_confidence') {
    diagnostics.push({
      code: 'limited_identifiability',
      severity:
        identifiability.status === 'not_identifiable' ? 'warning' : 'info',
      detail: identifiability.risks.join(', '),
    })
  }
  if (intervals[0]?.provider === 'anthropic' && intervals[0]?.quotaType === 'special') {
    for (const family of ['haiku', 'opus']) {
      const coefficient = rollingFit.coefficients[`${family}:workload`] ?? 0
      const sonnet = rollingFit.coefficients['sonnet:workload'] ?? 0
      if (sonnet > 0 && coefficient / sonnet > 0.1) {
        diagnostics.push({
          code: 'sonnet_only_non_sonnet_signal',
          severity: 'warning',
          detail: `${family} coefficient is positive on Anthropic Sonnet-only quota; investigate lag, reset contamination, mapping, or external Claude usage.`,
        })
      }
    }
  }
  for (const ratio of quotaEstimatorCacheReadRatios(rollingFit.coefficients)) {
    if (ratio.status === 'anomalous') {
      diagnostics.push({
        code: 'cache_read_ratio_above_uncached',
        severity: 'warning',
        detail: `${ratio.model_family} cache-read coefficient is above uncached workload; treat as telemetry, lag, or provider-policy risk until confirmed.`,
      })
    }
  }
  diagnostics.push({
    code: 'cache_write_duration_unavailable',
    severity: 'info',
    detail:
      'Only cache_creation_input_tokens is available; 5-minute vs 1-hour cache-write buckets are not modeled separately.',
  })

  return {
    provider: intervals[0]?.provider ?? 'unknown',
    quota_key: intervals[0]?.quotaKey ?? 'unknown',
    quota_type: intervals[0]?.quotaType ?? 'unknown',
    quota_lane: intervals[0]?.quotaLane ?? 'unknown',
    selected_lag_minutes: selectedLag,
    lag_sensitivity: lagSensitivity.sort(
      (a, b) => a.lag_minutes - b.lag_minutes
    ),
    interval_count: intervals.length,
    trainable_interval_count: trainable.length,
    excluded_interval_count: intervals.length - trainable.length,
    excluded_reasons: excludedReasons,
    residuals: {
      static_baseline: staticResiduals,
      rolling_exponential: rollingResiduals,
    },
    identifiability,
    backtest: quotaEstimatorBacktest(trainable, featureNames, halfLifeHours),
    cache_read_ratios: quotaEstimatorCacheReadRatios(rollingFit.coefficients),
    coefficients,
    diagnostics,
  }
}

function quotaEstimatorUsageBucketMatchesLane(bucket, interval) {
  if (bucket.provider !== interval.provider) return false
  if (interval.provider !== 'openai') return true
  if (['short', 'weekly'].includes(interval.quota_type)) {
    return bucket.model_family !== 'spark'
  }
  if (['short_special', 'special'].includes(interval.quota_type)) {
    return bucket.model_family === 'spark'
  }
  return true
}

function buildQuotaEstimatorRowsFromReadModels(observations, usageBuckets) {
  const observationsByLane = new Map()
  for (const observation of observations) {
    if (observation.observed_at === null || observation.consumed_pct === null) {
      continue
    }
    const key = [
      observation.provider,
      observation.quota_key,
      observation.quota_type,
      observation.expected_reset_at ?? '',
    ].join('|')
    const laneObservations = observationsByLane.get(key) ?? []
    laneObservations.push(observation)
    observationsByLane.set(key, laneObservations)
  }

  const bucketsByProvider = new Map()
  for (const bucket of usageBuckets) {
    if (bucket.bucket_start_at === null) continue
    const providerBuckets = bucketsByProvider.get(bucket.provider) ?? []
    providerBuckets.push(bucket)
    bucketsByProvider.set(bucket.provider, providerBuckets)
  }

  const rows = []
  for (const laneObservations of observationsByLane.values()) {
    laneObservations.sort((a, b) =>
      String(a.observed_at).localeCompare(String(b.observed_at))
    )
    const capped = laneObservations.slice(
      Math.max(0, laneObservations.length - QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE - 1)
    )
    for (let index = 1; index < capped.length; index += 1) {
      const previous = capped[index - 1]
      const current = capped[index]
      const previousConsumed = previous.consumed_pct ?? 0
      const currentConsumed = current.consumed_pct ?? 0
      const deltaPct = currentConsumed - previousConsumed
      const isResetBoundary = currentConsumed < previousConsumed
      const isCappedAt100 = previousConsumed >= 99.5 || currentConsumed >= 99.5
      const trainable = deltaPct > 0 && !isResetBoundary && !isCappedAt100
      const excludeReason =
        trainable
          ? null
          : isResetBoundary
            ? 'reset_or_measurement_boundary'
            : deltaPct === 0
              ? 'plateau_no_positive_delta'
              : isCappedAt100
                ? 'capped_at_100'
                : 'non_positive_delta'
      const baseInterval = {
        provider: current.provider,
        quota_key: current.quota_key,
        quota_type: current.quota_type,
        quota_lane: current.quota_lane,
        raw_observation_quota_type: current.raw_observation_quota_type,
        raw_interval_quota_type: current.raw_interval_quota_type,
        expected_reset_at: current.expected_reset_at,
        reset_start_at: current.reset_start_at,
        reset_end_at: current.reset_end_at,
        interval_start_at: previous.observed_at,
        interval_end_at: current.observed_at,
        previous_consumed_pct: previousConsumed,
        current_consumed_pct: currentConsumed,
        delta_pct: deltaPct,
        is_reset_boundary: isResetBoundary,
        is_capped_at_100: isCappedAt100,
        trainable,
        exclude_reason: excludeReason,
      }
      const providerBuckets = bucketsByProvider.get(current.provider) ?? []
      for (const lagMinutes of QUOTA_ESTIMATOR_LAG_MINUTES) {
        const startMs = new Date(previous.observed_at).getTime()
        const endMs = new Date(current.observed_at).getTime()
        const familyTotals = new Map()
        for (const bucket of providerBuckets) {
          if (!quotaEstimatorUsageBucketMatchesLane(bucket, current)) continue
          const effectiveMs =
            new Date(bucket.bucket_start_at).getTime() + lagMinutes * 60_000
          if (effectiveMs < startMs || effectiveMs >= endMs) continue
          const totals = familyTotals.get(bucket.model_family) ?? {
            traces: 0,
            uncached_input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_create_tokens: 0,
            reasoning_tokens: 0,
            usd_cost: 0,
            tool_calls: 0,
          }
          totals.traces += bucket.traces
          totals.uncached_input_tokens += bucket.uncached_input_tokens
          totals.output_tokens += bucket.output_tokens
          totals.cache_read_tokens += bucket.cache_read_tokens
          totals.cache_create_tokens += bucket.cache_create_tokens
          totals.reasoning_tokens += bucket.reasoning_tokens
          totals.usd_cost += bucket.usd_cost
          totals.tool_calls += bucket.tool_calls
          familyTotals.set(bucket.model_family, totals)
        }
        if (familyTotals.size === 0) {
          rows.push({
            ...baseInterval,
            lag_minutes: lagMinutes,
            model_family: 'no_usage',
            traces: 0,
            uncached_input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_create_tokens: 0,
            reasoning_tokens: 0,
            usd_cost: 0,
            tool_calls: 0,
          })
          continue
        }
        for (const [modelFamily, totals] of familyTotals.entries()) {
          rows.push({
            ...baseInterval,
            lag_minutes: lagMinutes,
            model_family: modelFamily,
            ...totals,
          })
        }
      }
    }
  }
  return rows
}

export function buildQuotaEstimatorReport(rows, metadata = {}) {
  const intervals = buildQuotaEstimatorIntervals(rows)
  const lanes = new Map()
  for (const interval of intervals) {
    const key = quotaEstimatorLaneKey({
      provider: interval.provider,
      quota_key: interval.quotaKey,
      quota_type: interval.quotaType,
      quota_lane: interval.quotaLane,
    })
    const laneIntervals = lanes.get(key) ?? []
    laneIntervals.push(interval)
    lanes.set(key, laneIntervals)
  }

  return {
    metadata: {
      from: metadata.from ?? null,
      to: metadata.to ?? null,
      generatedAt: new Date().toISOString(),
      phase: '0-2',
      lagCandidatesMinutes: QUOTA_ESTIMATOR_LAG_MINUTES,
      estimatorVersion: 'quota-weight-phase0-2-v1',
    },
    phase0Audit: buildQuotaEstimatorPhase0Audit(),
    estimates: [...lanes.values()].map(buildQuotaEstimatorLaneEstimate),
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

export function proxyTargetUrl(req, proxyConfig) {
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

export function buildUsageQuery(searchParams) {
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
  const whereParts = [...startTimeDateRangeWhere]

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
  const outputColumns = ['bucket', ...groupBy]
  const reasonJoinParts = outputColumns.map(
    (column) =>
      `base.${column} IS NOT DISTINCT FROM reason_summary.${column}`
  )

  const sql = `
WITH filtered AS (
    SELECT sh.*
    FROM public.session_history sh
    WHERE ${whereParts.join('\n      AND ')}
),
base AS (
SELECT
    ${selectParts.join(',\n    ')},

    NULL::timestamp with time zone AS weekly_reset_first,
    NULL::timestamp with time zone AS weekly_reset_last,
    NULL::double precision AS min_weekly_pct,
    NULL::double precision AS max_weekly_pct,

    NULL::timestamp with time zone AS short_reset_first,
    NULL::timestamp with time zone AS short_reset_last,
    NULL::double precision AS min_short_pct,
    NULL::double precision AS max_short_pct,

    NULL::timestamp with time zone AS weekly_reset_special_first,
    NULL::timestamp with time zone AS weekly_reset_special_last,
    NULL::double precision AS min_weekly_pct_special,
    NULL::double precision AS max_weekly_pct_special,

    NULL::timestamp with time zone AS short_reset_special_first,
    NULL::timestamp with time zone AS short_reset_special_last,
    NULL::double precision AS min_short_pct_special,
    NULL::double precision AS max_short_pct_special,

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

    ${latencyMetricSelectParts.join(',\n    ')},

    ${agentScoreSelectParts.join(',\n    ')},

    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end
FROM filtered sh
GROUP BY
    ${groupParts.join(',\n    ')}
),
reason_counts AS (
SELECT
    ${selectParts.join(',\n    ')},
    reason_family.family,
    CASE
        WHEN jsonb_typeof(reason_value.value) = 'string'
        THEN reason_value.value #>> '{}'
        WHEN jsonb_typeof(reason_value.value) = 'object'
        THEN COALESCE(
            reason_value.value ->> 'reason',
            reason_value.value ->> 'code',
            reason_value.value ->> 'evidence_mode',
            reason_value.value ->> 'rule',
            reason_value.value ->> 'catalog_version'
        )
        ELSE NULL
    END AS reason,
    COUNT(*)::double precision AS reason_count
FROM filtered sh
CROSS JOIN LATERAL jsonb_each(
    CASE
        WHEN jsonb_typeof(sh.agent_score_reasons) = 'object'
        THEN sh.agent_score_reasons
        ELSE '{}'::jsonb
    END
) AS reason_family(family, reasons)
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(reason_family.reasons) = 'array'
        THEN reason_family.reasons
        WHEN jsonb_typeof(reason_family.reasons) = 'string'
        THEN jsonb_build_array(reason_family.reasons)
        WHEN jsonb_typeof(reason_family.reasons) = 'object'
        THEN jsonb_build_array(reason_family.reasons)
        ELSE '[]'::jsonb
    END
) AS reason_value(value)
WHERE sh.agent_score_reasons IS NOT NULL
  AND sh.agent_score_reasons <> '{}'::jsonb
  AND (
      jsonb_typeof(reason_value.value) = 'string'
      OR (
          jsonb_typeof(reason_value.value) = 'object'
          AND COALESCE(
              reason_value.value ->> 'reason',
              reason_value.value ->> 'code',
              reason_value.value ->> 'evidence_mode',
              reason_value.value ->> 'rule',
              reason_value.value ->> 'catalog_version'
          ) IS NOT NULL
      )
  )
GROUP BY
    ${groupParts.join(',\n    ')},
    reason_family.family,
    CASE
        WHEN jsonb_typeof(reason_value.value) = 'string'
        THEN reason_value.value #>> '{}'
        WHEN jsonb_typeof(reason_value.value) = 'object'
        THEN COALESCE(
            reason_value.value ->> 'reason',
            reason_value.value ->> 'code',
            reason_value.value ->> 'evidence_mode',
            reason_value.value ->> 'rule',
            reason_value.value ->> 'catalog_version'
        )
        ELSE NULL
    END
),
reason_ranked AS (
SELECT
    reason_counts.*,
    ROW_NUMBER() OVER (
        PARTITION BY ${outputColumns.join(', ')}
        ORDER BY reason_count DESC, family, reason
    ) AS reason_rank
FROM reason_counts
),
reason_summary AS (
SELECT
    ${outputColumns.join(',\n    ')},
    jsonb_agg(
        jsonb_build_object(
            'family', family,
            'reason', reason,
            'count', reason_count
        )
        ORDER BY reason_count DESC, family, reason
    ) AS agent_score_reasons_top
FROM reason_ranked
WHERE reason_rank <= 8
GROUP BY
    ${outputColumns.join(',\n    ')}
)
SELECT
    base.*,
    COALESCE(reason_summary.agent_score_reasons_top, '[]'::jsonb) AS agent_score_reasons_top
FROM base
LEFT JOIN reason_summary
  ON ${reasonJoinParts.join('\n  AND ')}
ORDER BY ${sort} ${sortDirection}
LIMIT $${values.length};
`

  return { sql, values, metadata: { from, to, grain, groupBy, limit } }
}

async function findDockerJsonLogSources() {
  if (!DOCKER_LOG_CONTAINER_NAMES.length || MAX_DOCKER_LOG_ERROR_ROWS <= 0) {
    return []
  }

  let entries
  try {
    entries = await readdir(DOCKER_LOG_ROOT, { withFileTypes: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      process.stderr.write(
        `[report-service] WARN: unable to scan Docker log root ${DOCKER_LOG_ROOT}: ${formatError(error)}\n`
      )
    }
    return []
  }

  const wanted = new Set(DOCKER_LOG_CONTAINER_NAMES)
  const sources = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const containerDir = path.join(DOCKER_LOG_ROOT, entry.name)
    let config
    try {
      config = JSON.parse(
        await readFile(path.join(containerDir, 'config.v2.json'), 'utf8')
      )
    } catch {
      continue
    }

    const containerName = String(config?.Name ?? '').replace(/^\//, '')
    if (!wanted.has(containerName)) continue

    sources.push({
      container: containerName,
      logPath: path.join(containerDir, `${entry.name}-json.log`),
    })
  }
  return sources
}

async function readFileTail(filePath, maxBytes) {
  const handle = await open(filePath, 'r')
  try {
    const stats = await handle.stat()
    const length = Math.min(stats.size, maxBytes)
    const offset = Math.max(0, stats.size - length)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    return { text: buffer.toString('utf8'), truncated: offset > 0 }
  } finally {
    await handle.close()
  }
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function compactLogMessage(value) {
  return stripAnsi(value).replace(/\s+/g, ' ').trim().slice(0, 280)
}

function inferLogProvider(message) {
  const lower = message.toLowerCase()
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic'
  if (lower.includes('openrouter')) return 'openrouter'
  if (lower.includes('openai') || lower.includes('gpt-')) return 'openai'
  if (lower.includes('google') || lower.includes('gemini')) return 'google'
  if (lower.includes('xai') || lower.includes('grok')) return 'xai'
  if (lower.includes('nvidia') || lower.includes('nim')) return 'nvidia_nim'
  if (lower.includes('local')) return 'local'
  return 'unknown'
}

function inferLogLevel(message) {
  const lower = message.toLowerCase()
  if (/\bcritical\b|\bfatal\b/.test(lower)) return 'critical'
  if (/\berror\b|\bexception\b|\btraceback\b|\bfailed\b/.test(lower)) {
    return 'error'
  }
  if (/\bwarn(?:ing)?\b/.test(lower)) return 'warning'
  return 'error'
}

function inferLogStatusCode(message) {
  const match = message.match(/(?<!\d)(4\d{2}|5\d{2})(?!\d)/)
  return match ? Number(match[1]) : null
}

function isActionableErrorLog(message) {
  const lower = message.toLowerCase()
  if (/health\/(?:liveliness|readiness)|"get \/health\b/.test(lower)) {
    return false
  }
  if (/\b(?:4\d{2}|5\d{2})\b/.test(lower)) return true
  return /\b(?:critical|fatal|error|exception|traceback|failed|timeout|rate limit|overloaded)\b/.test(
    lower
  )
}

async function loadDockerLogErrors() {
  const sources = await findDockerJsonLogSources()
  if (!sources.length) return []

  const cutoffMs = Date.now() - 90 * 60 * 1000
  const rows = []
  for (const source of sources) {
    let tail
    try {
      tail = await readFileTail(source.logPath, DOCKER_LOG_TAIL_BYTES)
    } catch (error) {
      process.stderr.write(
        `[report-service] WARN: unable to read Docker log ${source.container}: ${formatError(error)}\n`
      )
      continue
    }

    const lines = tail.text.split('\n')
    if (tail.truncated) lines.shift()
    for (const line of lines) {
      if (!line.trim()) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const observedAt = Date.parse(parsed?.time ?? '')
      if (!Number.isFinite(observedAt) || observedAt < cutoffMs) continue

      const message = compactLogMessage(String(parsed?.log ?? ''))
      if (!message || !isActionableErrorLog(message)) continue

      rows.push({
        observed_at: new Date(observedAt).toISOString(),
        container: source.container,
        stream: String(parsed?.stream ?? 'unknown'),
        provider: inferLogProvider(message),
        status_code: inferLogStatusCode(message),
        level: inferLogLevel(message),
        message,
      })
    }
  }

  return rows
    .sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)))
    .slice(0, MAX_DOCKER_LOG_ERROR_ROWS)
}

function compactProbeMessage(value) {
  return stripAnsi(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function localHealthStatusForHttp(response) {
  if (response.ok) return 'green'
  if (response.status >= 500) return 'red'
  return 'yellow'
}

async function probeHttpHealth(probe, checkedAt) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, LOCAL_HEALTH_TIMEOUT_MS)

  try {
    const response = await fetch(probe.url, {
      headers: probe.headers,
      signal: controller.signal,
    })
    const body = compactProbeMessage(await response.text().catch(() => ''))
    const latencyMs = Date.now() - startedAt
    return {
      checked_at: checkedAt,
      category: probe.category,
      key: probe.key,
      label: probe.label,
      status: localHealthStatusForHttp(response),
      detail: body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`,
      target: probe.url,
      latency_ms: latencyMs,
    }
  } catch (error) {
    return {
      checked_at: checkedAt,
      category: probe.category,
      key: probe.key,
      label: probe.label,
      status: 'red',
      detail: compactProbeMessage(error?.message ?? error),
      target: probe.url,
      latency_ms: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function probeRedisHealth(probe, checkedAt) {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let settled = false
    let timeout
    const socket = net.createConnection({
      host: probe.host,
      port: probe.port,
    })

    const finish = (status, detail) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      resolve({
        checked_at: checkedAt,
        category: probe.category,
        key: probe.key,
        label: probe.label,
        status,
        detail: compactProbeMessage(detail),
        target: `${probe.host}:${probe.port}`,
        latency_ms: Date.now() - startedAt,
      })
    }

    timeout = setTimeout(() => {
      finish('red', `timeout after ${LOCAL_HEALTH_TIMEOUT_MS}ms`)
    }, LOCAL_HEALTH_TIMEOUT_MS)

    socket.once('connect', () => {
      socket.write('PING\r\n')
    })
    socket.once('error', (error) => {
      finish('red', error.message)
    })
    socket.once('data', (buffer) => {
      const response = buffer.toString('utf8').trim()
      finish(response.startsWith('+PONG') ? 'green' : 'yellow', response)
    })
  })
}

async function loadLocalHealth() {
  const checkedAt = new Date().toISOString()
  const probes = [
    ...LOCAL_CONTAINER_HEALTH_PROBES.map((probe) => ({
      ...probe,
      category: 'container',
    })),
    ...LOCAL_MODEL_HEALTH_PROBES.map((probe) => ({
      ...probe,
      category: 'model',
    })),
  ]

  return Promise.all(
    probes.map((probe) =>
      probe.kind === 'redis'
        ? probeRedisHealth(probe, checkedAt)
        : probeHttpHealth(probe, checkedAt)
    )
  )
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

  const [
    result,
    summaryResult,
    trendResult,
    clientUsageResult,
    providerLatencyHealthResult,
    providerErrorObservationResult,
    providerStatusUsageResult,
    dockerLogErrors,
    localHealth,
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
      () => loadDockerLogErrors(),
      () => loadLocalHealth(),
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
    dockerLogErrors: dockerLogErrors.map(normalizeDockerLogErrorRow),
    localHealth: localHealth.map(normalizeLocalHealthRow),
    providerStatusUsage: providerStatusUsageResult.rows.map(
      normalizeProviderStatusUsageRow
    ),
    quotas: [],
    quotaHistory: [],
    toolActivity: [],
    rows,
  }
}

async function loadUsageQuotaHistory(searchParams) {
  const query = buildQuotaHistoryQuery(searchParams)
  const result = await pool.query(query.sql, query.values)
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
    },
    quotaHistory: result.rows.map(normalizeQuotaHistoryRow),
  }
}

async function loadUsageQuotaRangeHistory(searchParams) {
  const query = buildQuotaRangeHistoryQuery(searchParams)
  const result = await pool.query(query.sql, query.values)
  return {
    metadata: {
      from: parseSearchDateOnly(searchParams.get('from'), defaultFromDate),
      to: parseSearchDateOnly(searchParams.get('to'), defaultToDate),
      generatedAt: new Date().toISOString(),
    },
    quotaRangeHistory: result.rows.map(normalizeQuotaHistoryRow),
  }
}

async function loadUsageQuotaEstimator(searchParams) {
  const observationQuery = buildQuotaEstimatorObservationQuery(searchParams)
  const usageBucketQuery = buildQuotaEstimatorUsageBucketQuery(searchParams)
  const [observationResult, usageBucketResult] = await runTasksWithConcurrency(
    [
      () => pool.query(observationQuery.sql, observationQuery.values),
      () => pool.query(usageBucketQuery.sql, usageBucketQuery.values),
    ],
    REPORT_SQL_FANOUT_CONCURRENCY
  )
  const observations = observationResult.rows.map(
    normalizeQuotaEstimatorObservationRow
  )
  const usageBuckets = usageBucketResult.rows.map(
    normalizeQuotaEstimatorUsageBucketRow
  )
  const rows = buildQuotaEstimatorRowsFromReadModels(observations, usageBuckets)
  return buildQuotaEstimatorReport(rows, {
    from: observationQuery.metadata.from,
    to: observationQuery.metadata.to,
  })
}

async function loadUsageToolActivity(searchParams) {
  const query = buildToolActivityQuery(searchParams)
  const result = await pool.query(query.sql, query.values)
  return {
    metadata: {
      from: parseDateParam(searchParams.get('from'), defaultFromDate),
      to: parseDateParam(searchParams.get('to'), defaultToDate),
      generatedAt: new Date().toISOString(),
    },
    toolActivity: result.rows.map(normalizeToolActivityRow),
  }
}

async function loadUsageTokenTrendSummary(searchParams) {
  const hoursQuery = buildTokenTrendHoursQuery(searchParams)
  const healthQuery = buildTokenTrendHealthQuery(searchParams)
  const scoreQuery = buildTokenTrendScoreQuery(searchParams)
  const versionsQuery = buildTokenTrendVersionIntervalsQuery(searchParams)
  const modelFirstSeenQuery = buildTokenTrendModelFirstSeenQuery(searchParams)
  const [
    hoursResult,
    healthResult,
    scoreResult,
    versionsResult,
    modelFirstSeenResult,
  ] =
    await runTasksWithConcurrency(
    [
      () => pool.query(hoursQuery.sql, hoursQuery.values),
      () => pool.query(healthQuery.sql, healthQuery.values),
      () => pool.query(scoreQuery.sql, scoreQuery.values),
      () => pool.query(versionsQuery.sql, versionsQuery.values),
      () => pool.query(modelFirstSeenQuery.sql, modelFirstSeenQuery.values),
    ],
    REPORT_SQL_FANOUT_CONCURRENCY
  )

  return {
    metadata: {
      from: parseDateParam(searchParams.get('from'), defaultFromDate),
      to: parseDateParam(searchParams.get('to'), defaultToDate),
    },
    tokenTrendHours: hoursResult.rows.map(normalizeTokenTrendHourRow),
    tokenTrendHealth: healthResult.rows.map(normalizeProviderLatencyHealthRow),
    tokenTrendScores: scoreResult.rows.map(normalizeTokenTrendScoreRow),
    tokenTrendVersions: versionsResult.rows.map(
      normalizeTokenTrendVersionIntervalRow
    ),
    tokenTrendModelFirstSeen: modelFirstSeenResult.rows.map(
      normalizeTokenTrendModelFirstSeenRow
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

async function handleUsageQuotaRangeHistory(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-quota-range-history',
    () => loadUsageQuotaRangeHistory(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

  sendJson(res, 200, body)
}

async function handleUsageQuotaHistory(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-quota-history',
    () => loadUsageQuotaHistory(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

  sendJson(res, 200, body)
}

async function handleUsageQuotaEstimator(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-quota-estimator-v1',
    () => loadUsageQuotaEstimator(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

  sendJson(res, 200, body)
}

async function handleUsageToolActivity(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(
    'usage-tool-activity',
    () => loadUsageToolActivity(requestUrl.searchParams),
    {
      searchParams: requestUrl.searchParams,
    }
  )

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
    'usage-token-trend-summary-v3',
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
  const today = formatDashboardDate(new Date())
  const tomorrow = addDaysToDateString(today, 1)
  const yearStart = `${today.slice(0, 4)}-01-01`
  const twoYearStart = `${(Number(today.slice(0, 4)) - 2).toString()}${today.slice(4)}`

  return [
    {
      name: 'last-7-days',
      from: addDaysToDateString(today, -6),
      to: tomorrow,
    },
    {
      name: 'last-30-days',
      from: addDaysToDateString(today, -30),
      to: tomorrow,
    },
    {
      name: 'ytd',
      from: yearStart,
      to: tomorrow,
    },
    {
      name: 'trailing-2-years',
      from: twoYearStart,
      to: tomorrow,
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

export function findUpstreamApiProxy(pathname) {
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
    requestUrl.pathname === '/api/shell/reports/usage/quota-range-history'
  ) {
    await handleUsageQuotaRangeHistory(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage/quota-history'
  ) {
    await handleUsageQuotaHistory(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage/quota-estimator'
  ) {
    await handleUsageQuotaEstimator(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage/tool-activity'
  ) {
    await handleUsageToolActivity(req, res)
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

const shouldStartServer =
  process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true'

if (shouldStartServer) {
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
}

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

if (shouldStartServer) {
  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}
