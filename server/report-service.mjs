import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  buildReportCachePrewarmLockKey,
  canonicalizeSearchParams,
  REPORT_CACHE_VERSION,
  resolveReportCacheTtlMs,
} from './report-cache-identity.mjs'
import crypto from 'node:crypto'
import { open, readdir, readFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'
import { promisify } from 'node:util'
import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib'
import {
  appendDockerLogErrorsToIntake,
  extractDockerLogErrorsFromTail,
  selectNewDockerLogErrors,
  resolveDockerLogContainerNames,
  discoverDockerJsonLogSourcesFromConfigs,
  shouldDiscoverDockerJsonLogSources,
  splitDockerLogErrorsForDashboardAndIntake,
  filterDockerLogErrorsForCentralizedIntake,
  stripAnsi,
} from './docker-log-error-intake.mjs'

import pg from 'pg'

// Dynamic import for redis so that the module can be imported in environments
// where the 'redis' package is not installed (for example, environments that
// only exercise SQL query-builder and report cache logic). All call sites already
// guard on the presence of a usable redisClient; when the package is absent we
// get a null client and cache paths degrade to local/SQL as designed. This keeps
// query-builder and cache helpers importable without requiring a live Redis at
// test time.
let createClient = null
let RESP_TYPES = null
try {
  const redisMod = await import('redis')
  createClient = redisMod.createClient
  RESP_TYPES = redisMod.RESP_TYPES ?? null
} catch {
  // redis not resolvable; redisClient remains null below.
}

const { Pool } = pg
const gzip = promisify(gzipCallback)
const gunzip = promisify(gunzipCallback)

function parseFiniteNumberEnv(name, fallback) {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(parsed)) {
    const fallbackNumber = Number(fallback)
    return Number.isFinite(fallbackNumber) ? fallbackNumber : 0
  }
  return parsed
}

function boundedIntegerEnv(
  name,
  fallback,
  { minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY, floor = true } = {}
) {
  const finiteMinimum = Number.isFinite(minimum) ? minimum : Number.NEGATIVE_INFINITY
  const finiteMaximum = Number.isFinite(maximum) ? maximum : Number.POSITIVE_INFINITY
  const clamp = (value) => Math.max(finiteMinimum, Math.min(finiteMaximum, value))
  const parsed = Number(process.env[name] ?? fallback)
  const resolveFallback = () => {
    const fallbackNumber = Number(fallback)
    if (!Number.isFinite(fallbackNumber)) {
      return Number.isFinite(finiteMinimum) ? finiteMinimum : 0
    }
    const normalizedFallback = floor ? Math.floor(fallbackNumber) : fallbackNumber
    return clamp(normalizedFallback)
  }
  if (!Number.isFinite(parsed)) {
    return resolveFallback()
  }
  const normalized = floor ? Math.floor(parsed) : parsed
  return clamp(normalized)
}

function positiveIntegerEnv(name, fallback, minimum = 1) {
  return boundedIntegerEnv(name, fallback, {
    minimum,
    maximum: Number.POSITIVE_INFINITY,
    floor: true,
  })
}

const BOOLEAN_ENV_TRUE = new Set(['1', 'true', 'yes', 'on'])
const BOOLEAN_ENV_FALSE = new Set(['0', 'false', 'no', 'off'])

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') {
    return fallback
  }
  const normalized = String(raw).trim().toLowerCase()
  if (BOOLEAN_ENV_TRUE.has(normalized)) return true
  if (BOOLEAN_ENV_FALSE.has(normalized)) return false
  return fallback
}

function normalizeDatabaseUrl(value) {
  if (!value) return value

  const hostRewrite = process.env.SHELL_REPORT_DATABASE_HOST_REWRITE
  if (!hostRewrite) return value

  try {
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
  } catch {
    return value
  }
}

const PORT = boundedIntegerEnv('SHELL_REPORT_PORT', 3010, {
  minimum: 1,
  maximum: 65_535,
})
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
const MAX_SESSION_DIAGNOSTICS_ROWS = 500
const MAX_SESSION_DIAGNOSTICS_CANDIDATE_ROWS = 50000
const MIN_SESSION_DIAGNOSTICS_CANDIDATE_ROWS = 5000
const SESSION_DIAGNOSTICS_CANDIDATE_MULTIPLIER = 5000
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
const MAX_HEALTH_ROWS = boundedIntegerEnv('SHELL_REPORT_HEALTH_MAX_ROWS', 20_000, {
  minimum: 100,
  maximum: 20_000,
})
const MAX_PROVIDER_ERROR_ROWS = 2_000
const MAX_DOCKER_LOG_ERROR_ROWS = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_ERROR_ROWS',
  200,
  { minimum: 0, maximum: 1_000 }
)
const DOCKER_LOG_TAIL_BYTES = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_TAIL_BYTES',
  4 * 1024 * 1024,
  { minimum: 64 * 1024, maximum: 32 * 1024 * 1024 }
)
const DOCKER_LOG_ROOT =
  process.env.SHELL_REPORT_DOCKER_LOG_ROOT ?? '/host/docker/containers'
const DOCKER_LOG_CONTAINER_NAMES = resolveDockerLogContainerNames(process.env)
const DOCKER_LOG_ERROR_INTAKE_DIR = path.resolve(
  process.env.SHELL_REPORT_ERROR_INTAKE_DIR ??
    path.join(process.cwd(), '.analysis')
)
const DOCKER_LOG_SCAN_MAX_SOURCES = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_SCAN_MAX_SOURCES',
  24,
  { minimum: 1, maximum: 128 }
)
const DOCKER_LOG_SCAN_MAX_TOTAL_BYTES = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_SCAN_MAX_TOTAL_BYTES',
  16 * 1024 * 1024,
  { minimum: 256 * 1024, maximum: 128 * 1024 * 1024 }
)
const DOCKER_LOG_SCAN_CACHE_TTL_MS = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS',
  45_000,
  { minimum: 0, maximum: 10 * 60 * 1000 }
)
const DOCKER_LOG_INTAKE_FINGERPRINT_MAX = boundedIntegerEnv(
  'SHELL_REPORT_DOCKER_LOG_INTAKE_FINGERPRINT_MAX',
  8_192,
  { minimum: 256, maximum: 65_536 }
)

class BoundedDockerLogFingerprintSet {
  constructor(maxEntries) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 1)
    this.keys = new Map()
  }

  has(key) {
    return this.keys.has(key)
  }

  add(key) {
    const normalized = String(key)
    if (!normalized) return this
    if (this.keys.has(normalized)) {
      this.keys.delete(normalized)
    }
    this.keys.set(normalized, true)
    while (this.keys.size > this.maxEntries) {
      const oldest = this.keys.keys().next().value
      this.keys.delete(oldest)
    }
    return this
  }

  get size() {
    return this.keys.size
  }

  clear() {
    this.keys.clear()
  }
}

const dockerLogErrorIntakeSeenFingerprints = new BoundedDockerLogFingerprintSet(
  DOCKER_LOG_INTAKE_FINGERPRINT_MAX
)

/** @type {{ sources: Array<{ container: string, logPath: string, matchKind?: string }>, cachedAt: number } | null} */
let dockerLogJsonSourcesCache = null

/** @type {{ sortedRows: unknown[], forDashboard: unknown[], cachedAt: number } | null} */
let dockerLogErrorsScanCache = null
/** @type {Map<string, { size: number, mtimeMs: number, tailBytes: number, rows: unknown[] }>} */
let dockerLogScanSourceCache = new Map()
let dockerLogTailReadCountForTests = 0
const LOCAL_HEALTH_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_LOCAL_HEALTH_TIMEOUT_MS',
  900,
  { minimum: 250, maximum: 5_000 }
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
const REPORT_DB_DISABLE_PARALLELISM = parseBooleanEnv(
  'SHELL_REPORT_DB_DISABLE_PARALLELISM',
  true
)
const REPORT_SQL_FANOUT_CONCURRENCY = boundedIntegerEnv(
  'SHELL_REPORT_SQL_FANOUT_CONCURRENCY',
  1,
  { minimum: 1, maximum: 4 }
)
const REPORT_DB_STATEMENT_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_DB_STATEMENT_TIMEOUT_MS',
  120_000,
  { minimum: 0, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_DB_POOL_MAX = boundedIntegerEnv('SHELL_REPORT_DB_POOL_MAX', 4, {
  minimum: 1,
  maximum: 8,
})
const REPORT_DB_CONNECTION_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_DB_CONNECTION_TIMEOUT_MS',
  5_000,
  { minimum: 500, maximum: Number.POSITIVE_INFINITY }
)
const HEALTH_DB_STATEMENT_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_HEALTH_DB_STATEMENT_TIMEOUT_MS',
  2_000,
  { minimum: 500, maximum: Number.POSITIVE_INFINITY }
)
const HEALTH_DB_CONNECTION_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_HEALTH_DB_CONNECTION_TIMEOUT_MS',
  1_000,
  { minimum: 500, maximum: Number.POSITIVE_INFINITY }
)
const PGBOUNCER_HEALTH_CACHE_TTL_MS = boundedIntegerEnv(
  'SHELL_REPORT_PGBOUNCER_HEALTH_CACHE_TTL_MS',
  15_000,
  { minimum: 1_000, maximum: Number.POSITIVE_INFINITY }
)
const PGBOUNCER_ADMIN_QUERY_TIMEOUT_MS = boundedIntegerEnv(
  'SHELL_REPORT_PGBOUNCER_ADMIN_QUERY_TIMEOUT_MS',
  2_000,
  { minimum: 500, maximum: Number.POSITIVE_INFINITY }
)
const MATERIALIZED_VIEW_HEALTH_CACHE_TTL_MS = boundedIntegerEnv(
  'SHELL_REPORT_MV_HEALTH_CACHE_TTL_MS',
  30_000,
  { minimum: 1_000, maximum: Number.POSITIVE_INFINITY }
)
const QUOTA_MV_STALE_AFTER_MS = boundedIntegerEnv(
  'SHELL_REPORT_QUOTA_MV_STALE_AFTER_MS',
  30 * 60 * 1000,
  { minimum: 60_000, maximum: Number.POSITIVE_INFINITY }
)
const PROVIDER_HEALTH_MV_STALE_AFTER_MS = boundedIntegerEnv(
  'SHELL_REPORT_PROVIDER_HEALTH_MV_STALE_AFTER_MS',
  60 * 60 * 1000,
  { minimum: 60_000, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_REDIS_URL = process.env.SHELL_REPORT_REDIS_URL
const REPORT_CACHE_LOCK_TTL_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_LOCK_TTL_MS',
  30 * 60 * 1000,
  { minimum: 1_000, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_LOCK_WAIT_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_LOCK_WAIT_MS',
  60 * 1000,
  { minimum: 0, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS',
  2 * 1000,
  { minimum: 0, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_LOCK_POLL_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_LOCK_POLL_MS',
  500,
  { minimum: 100, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_PREWARM = parseBooleanEnv('SHELL_REPORT_CACHE_PREWARM', false)
const REPORT_CACHE_PREWARM_INTERVAL_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_PREWARM_INTERVAL_MS',
  15 * 60 * 1000,
  { minimum: 0, maximum: Number.POSITIVE_INFINITY }
)
const REPORT_CACHE_PREWARM_LOCK_TTL_MS = boundedIntegerEnv(
  'SHELL_REPORT_CACHE_PREWARM_LOCK_TTL_MS',
  2 * 60 * 60 * 1000,
  { minimum: 60_000, maximum: Number.POSITIVE_INFINITY }
)
const MAX_REPORT_CACHE_ENTRIES = 20
let reportCacheMaxEntries = MAX_REPORT_CACHE_ENTRIES
let readRedisCacheEntryTestImpl = null
let writeRedisCacheEntryTestImpl = null
let queryReportDatabaseTestImpl = null
let loadDockerLogErrorsTestImpl = null
let loadLocalHealthTestImpl = null
const TOOL_ACTIVITY_RECENT_ROW_LIMIT = positiveIntegerEnv(
  'SHELL_REPORT_TOOL_ACTIVITY_RECENT_ROW_LIMIT',
  5_000,
  250
)
const TOOL_ACTIVITY_STATEMENT_TIMEOUT_MS = positiveIntegerEnv(
  'SHELL_REPORT_TOOL_ACTIVITY_STATEMENT_TIMEOUT_MS',
  Math.min(REPORT_DB_STATEMENT_TIMEOUT_MS, 30_000),
  1_000
)
const TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS = positiveIntegerEnv(
  'SHELL_REPORT_TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS',
  Math.min(REPORT_DB_STATEMENT_TIMEOUT_MS, 15_000),
  1_000
)
const TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS = positiveIntegerEnv(
  'SHELL_REPORT_TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS',
  7,
  1
)
const QUOTA_HISTORY_STATEMENT_TIMEOUT_MS = positiveIntegerEnv(
  'SHELL_REPORT_QUOTA_HISTORY_STATEMENT_TIMEOUT_MS',
  Math.min(REPORT_DB_STATEMENT_TIMEOUT_MS, 15_000),
  1_000
)
const QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS = positiveIntegerEnv(
  'SHELL_REPORT_QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS',
  QUOTA_HISTORY_STATEMENT_TIMEOUT_MS,
  1_000
)
// Wave 41-QuotaHistory-1:
// Explicitly bound the quota-history query window to avoid unbounded scans in
// `rate_limit_intervals` and `session_history` while still keeping enough bars for
// the active UI path (provider cards + quota detail). These defaults are hard
// caps when callers do not provide tighter from/to ranges.
const QUOTA_HISTORY_MAX_LOOKBACK_DAYS = positiveIntegerEnv(
  'SHELL_REPORT_QUOTA_HISTORY_MAX_LOOKBACK_DAYS',
  45,
  1
)
const QUOTA_HISTORY_MAX_UPPER_HOURS = positiveIntegerEnv(
  'SHELL_REPORT_QUOTA_HISTORY_MAX_UPPER_HOURS',
  72,
  0
)
const QUOTA_HISTORY_MAX_INTERVALS_PER_LANE = boundedIntegerEnv(
  'SHELL_REPORT_QUOTA_HISTORY_MAX_INTERVALS_PER_LANE',
  180,
  { minimum: 24, maximum: 999 }
)
const AGENT_SCORE_REASON_RECENT_ROW_LIMIT = positiveIntegerEnv(
  'SHELL_REPORT_AGENT_SCORE_REASON_RECENT_ROW_LIMIT',
  10_000,
  1_000
)
export const USAGE_TOKEN_TREND_SUMMARY_SUBQUERY_KEYS = [
  'hours',
  'health',
  'scores',
  'versions',
  'modelFirstSeen',
]
const TOKEN_TREND_SUMMARY_RAW_SUBQUERY_KEYS = [
  'hours',
  'scores',
  'versions',
  'modelFirstSeen',
]
const USAGE_TOKEN_TREND_SUMMARY_CACHE_SCOPE = 'usage-token-trend-summary-v6'
const USAGE_QUOTA_HISTORY_CACHE_SCOPE = 'usage-quota-history-v2'
export const USAGE_REPORT_CACHE_SCOPE = 'usage-v2'

const QUOTA_VELOCITY_SEGMENT_COUNT = 100
const QUOTA_ESTIMATOR_LAG_MINUTES = [0, 1, 5, 10, 30, 60]
const QUOTA_ESTIMATOR_MIN_TRAINING_ROWS = 4
const QUOTA_ESTIMATOR_HIGH_CONFIDENCE_ROWS = 20
const QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE = boundedIntegerEnv(
  'SHELL_REPORT_QUOTA_ESTIMATOR_MAX_INTERVALS_PER_LANE',
  40,
  { minimum: 10, maximum: 500 }
)
const QUOTA_ESTIMATOR_ROLLING_HALF_LIFE_HOURS = {
  short: 5,
  short_special: 5,
  weekly: 72,
  special: 72,
  monthly: 168,
}
const UPSTREAM_FETCH_TIMEOUT_MS = parseFiniteNumberEnv(
  'SHELL_REPORT_UPSTREAM_TIMEOUT_MS',
  30_000
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
const REPORT_PROXY_SECRET_HEADER = 'X-Dashboard-Shell-Proxy-Secret'
const DEFAULT_REPORT_PROXY_SHARED_SECRET = 'dashboard-shell-local-proxy-secret'
const INTERNAL_PROXY_HEADERS = new Set([REPORT_PROXY_SECRET_HEADER.toLowerCase()])

function resolveReportProxySharedSecret() {
  const raw = process.env.SHELL_REPORT_PROXY_SHARED_SECRET
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).trim()
  }
  return DEFAULT_REPORT_PROXY_SHARED_SECRET
}

function readHeaderValue(headers, headerName) {
  const lower = headerName.toLowerCase()
  const direct = headers[headerName] ?? headers[lower]
  if (direct == null) return undefined
  return Array.isArray(direct) ? direct[0] : direct
}

export function evaluateUpstreamProxySecret(headers) {
  const expected = resolveReportProxySharedSecret()
  const provided = readHeaderValue(headers, REPORT_PROXY_SECRET_HEADER)
  if (provided == null || String(provided).trim() === '') {
    return {
      ok: false,
      status: 401,
      error: 'Missing dashboard shell proxy secret.',
    }
  }
  if (String(provided) !== expected) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid dashboard shell proxy secret.',
    }
  }
  return { ok: true }
}

const PGBOUNCER_SIDECARS = [
  {
    key: 'aawm-pgbouncer',
    label: 'AAWM PgBouncer',
    containerName: 'aawm-pgbouncer',
    hostEndpoint: '127.0.0.1:6432',
    runtimeAliases: ['aawm_tristore', 'aawm_tap_dev'],
    upstreamPostgres: 'aawm-postgres18:5432',
    adminDatabaseUrl:
      optionalEnvValue(process.env.SHELL_REPORT_AAWM_PGBOUNCER_DATABASE_URL) ??
      buildPgBouncerAdminDatabaseUrl(DATABASE_URL),
  },
  {
    key: 'aegis-pgbouncer',
    label: 'Aegis PgBouncer',
    containerName: 'aegis-pgbouncer',
    hostEndpoint: '127.0.0.1:6433',
    runtimeAliases: ['aegis'],
    upstreamPostgres: 'aegis-db:5432',
    adminDatabaseUrl: buildAegisPgBouncerAdminDatabaseUrl(),
  },
]

function optionalEnvValue(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function buildPostgresPoolOptions(
  applicationName,
  {
    max,
    connectionTimeoutMillis = REPORT_DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs = REPORT_DB_STATEMENT_TIMEOUT_MS,
    queryTimeoutMs = statementTimeoutMs > 0 ? statementTimeoutMs + 5_000 : 0,
  }
) {
  return {
    connectionString: DATABASE_URL,
    application_name: applicationName,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMs > 0 ? queryTimeoutMs : undefined,
  }
}

function buildPostgresLocalSettings(
  statementTimeoutMs = REPORT_DB_STATEMENT_TIMEOUT_MS
) {
  const settings = []
  if (REPORT_DB_DISABLE_PARALLELISM) {
    settings.push(['max_parallel_workers_per_gather', '0'])
  }
  if (statementTimeoutMs > 0) {
    settings.push([
      'statement_timeout',
      `${Math.round(statementTimeoutMs).toString()}ms`,
    ])
  }
  return settings
}

async function applyPostgresLocalSettings(
  client,
  statementTimeoutMs = REPORT_DB_STATEMENT_TIMEOUT_MS
) {
  const settings = buildPostgresLocalSettings(statementTimeoutMs)
  if (settings.length === 0) return

  const expressions = []
  const values = []
  for (const [name, value] of settings) {
    values.push(name, value)
    expressions.push(
      `set_config($${(values.length - 1).toString()}, $${values.length.toString()}, true)`
    )
  }

  await client.query(`SELECT ${expressions.join(', ')};`, values)
}

async function queryPostgresWithLocalSettings(
  targetPool,
  sql,
  values,
  statementTimeoutMs = REPORT_DB_STATEMENT_TIMEOUT_MS
) {
  const client = await targetPool.connect()
  let transactionOpen = false
  let discardClient = false

  try {
    await client.query('BEGIN')
    transactionOpen = true
    await applyPostgresLocalSettings(client, statementTimeoutMs)
    const result = await client.query(sql, values ?? [])
    await client.query('COMMIT')
    transactionOpen = false
    return result
  } catch (error) {
    const clientSideTimeout = isClientSideDatabaseTimeoutError(error)
    if (clientSideTimeout) {
      discardClient = true
    }
    if (transactionOpen && !clientSideTimeout) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        discardClient = true
        process.stderr.write(
          `[report-service] WARN: database rollback failed after query error: ${formatError(rollbackError)}\n`
        )
      }
    }
    throw error
  } finally {
    client.release(discardClient)
  }
}

function isDatabaseTimeoutError(error) {
  if (!(error instanceof Error)) return false
  const code = typeof error.code === 'string' ? error.code : ''
  const message = error.message.toLowerCase()
  return (
    code === '57014' ||
    message.includes('statement timeout') ||
    message.includes('query timeout') ||
    message.includes('query read timeout') ||
    message.includes('timeout exceeded')
  )
}

function isClientSideDatabaseTimeoutError(error) {
  if (!(error instanceof Error)) return false
  const code = typeof error.code === 'string' ? error.code : ''
  const message = error.message.toLowerCase()
  return (
    code !== '57014' &&
    (message.includes('query timeout') ||
      message.includes('query read timeout') ||
      message.includes('timeout exceeded'))
  )
}

const pool = DATABASE_URL
  ? new Pool(
      buildPostgresPoolOptions('dashboard-shell-report-service', {
        max: REPORT_DB_POOL_MAX,
      })
    )
  : null
const healthPool = DATABASE_URL
  ? new Pool(
      buildPostgresPoolOptions('dashboard-shell-health', {
        max: 1,
        connectionTimeoutMillis: HEALTH_DB_CONNECTION_TIMEOUT_MS,
        statementTimeoutMs: HEALTH_DB_STATEMENT_TIMEOUT_MS,
        queryTimeoutMs: HEALTH_DB_STATEMENT_TIMEOUT_MS + 500,
      })
    )
  : null

if (pool) {
  pool.on('error', (error) => {
    process.stderr.write(
      `[report-service] WARN: idle database client error: ${formatError(error)}\n`
    )
  })
}
if (healthPool) {
  healthPool.on('error', (error) => {
    process.stderr.write(
      `[report-service] WARN: idle health database client error: ${formatError(error)}\n`
    )
  })
}

const activeReportQueries = new Map()
const reportQueryMetrics = {
  nextQueryId: 1,
  started: 0,
  completed: 0,
  errors: 0,
  timeouts: 0,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastTimeoutAt: null,
  lastDurationMs: null,
  maxDurationMs: 0,
}

function summarizeReportSql(sql) {
  return String(sql ?? '')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

async function queryReportDatabase(sql, values, options = {}) {
  if (queryReportDatabaseTestImpl) {
    return queryReportDatabaseTestImpl(sql, values, options)
  }
  if (!pool) {
    throw new Error('DATABASE_URL is not configured for the shell report service.')
  }
  const statementTimeoutMs =
    options.statementTimeoutMs ?? REPORT_DB_STATEMENT_TIMEOUT_MS
  const queryId = reportQueryMetrics.nextQueryId
  reportQueryMetrics.nextQueryId += 1
  const startedAtMs = Date.now()
  reportQueryMetrics.started += 1
  reportQueryMetrics.lastStartedAt = new Date(startedAtMs).toISOString()
  activeReportQueries.set(queryId, {
    id: queryId,
    startedAtMs,
    label: summarizeReportSql(sql),
  })

  try {
    const result = await queryPostgresWithLocalSettings(
      pool,
      sql,
      values,
      statementTimeoutMs
    )
    const durationMs = Date.now() - startedAtMs
    reportQueryMetrics.completed += 1
    reportQueryMetrics.lastCompletedAt = new Date().toISOString()
    reportQueryMetrics.lastDurationMs = durationMs
    reportQueryMetrics.maxDurationMs = Math.max(
      reportQueryMetrics.maxDurationMs,
      durationMs
    )
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAtMs
    reportQueryMetrics.errors += 1
    reportQueryMetrics.lastErrorAt = new Date().toISOString()
    reportQueryMetrics.lastErrorMessage = formatError(error)
    reportQueryMetrics.lastDurationMs = durationMs
    reportQueryMetrics.maxDurationMs = Math.max(
      reportQueryMetrics.maxDurationMs,
      durationMs
    )
    if (isDatabaseTimeoutError(error)) {
      reportQueryMetrics.timeouts += 1
      reportQueryMetrics.lastTimeoutAt = reportQueryMetrics.lastErrorAt
    }
    throw error
  } finally {
    activeReportQueries.delete(queryId)
  }
}

async function queryHealthDatabase(sql, values) {
  if (!healthPool) {
    throw new Error('DATABASE_URL is not configured for the shell report service.')
  }
  return queryPostgresWithLocalSettings(
    healthPool,
    sql,
    values,
    HEALTH_DB_STATEMENT_TIMEOUT_MS
  )
}
const reportCache = new Map()
const releaseCacheLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

function createRedisCacheClient(redisUrl, clientFactory = createClient, respTypes = RESP_TYPES) {
  if (!redisUrl || !clientFactory) return null

  const client = clientFactory({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 5_000),
    },
  })
  const blobStringType = respTypes?.BLOB_STRING
  if (
    blobStringType == null ||
    typeof client?.withTypeMapping !== 'function'
  ) {
    return client
  }

  return client.withTypeMapping({
    [blobStringType]: Buffer,
  })
}

const redisClient = createRedisCacheClient(REPORT_CACHE_REDIS_URL)
let prewarmTimer = null
let prewarmPromise = null
function createTtlMemoizer(ttlMs, onError) {
  /** @type {{ expiresAt: number, value: unknown } | null} */
  let cache = null
  /** @type {Promise<unknown> | null} */
  let inFlight = null

  async function load(loader) {
    const now = Date.now()
    if (cache && cache.expiresAt > now) {
      return cache.value
    }
    if (inFlight) {
      return inFlight
    }

    inFlight = Promise.resolve()
      .then(() => loader())
      .then((value) => {
        cache = {
          expiresAt: Date.now() + ttlMs,
          value,
        }
        return value
      })
      .catch((error) => {
        const value = onError(error)
        cache = {
          expiresAt: Date.now() + ttlMs,
          value,
        }
        return value
      })
      .finally(() => {
        inFlight = null
      })

    return inFlight
  }

  function resetForTests() {
    cache = null
    inFlight = null
  }

  return { load, resetForTests }
}

const materializedViewHealthMemo = createTtlMemoizer(
  MATERIALIZED_VIEW_HEALTH_CACHE_TTL_MS,
  (error) => ({
    status: 'unknown',
    error: formatError(error),
    views: [],
    cronJobs: [],
  })
)
const pgBouncerHealthMemo = createTtlMemoizer(
  PGBOUNCER_HEALTH_CACHE_TTL_MS,
  (error) => ({
    status: 'unknown',
    error: formatError(error),
    sidecars: PGBOUNCER_SIDECARS.map((sidecar) =>
      buildPgBouncerSidecarUnavailable(sidecar, formatError(error))
    ),
  })
)
const sourceTableHealthMemo = createTtlMemoizer(
  MATERIALIZED_VIEW_HEALTH_CACHE_TTL_MS,
  (error) => ({
    status: 'unknown',
    error: formatError(error),
    tables: [],
  })
)

let reportServiceShuttingDown = false
let shutdownForceExitTimer = null

const SHUTDOWN_GRACE_MS = boundedIntegerEnv('SHELL_REPORT_SHUTDOWN_GRACE_MS', 30_000, {
  minimum: 1_000,
  maximum: 300_000,
})

const GENERIC_INTERNAL_SERVER_ERROR_BODY = Object.freeze({
  error: 'Internal server error',
})


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
  const cacheTtlMs = resolveReportCacheTtlMs(scope, options)

  if (cacheTtlMs <= 0) {
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
    if (options.refreshStaleInForeground) {
      try {
        const refreshResult = await refreshReportCache(identity, load, {
          cacheTtlMs,
          lockWaitMs: options.lockWaitMs ?? REPORT_CACHE_FOREGROUND_LOCK_WAIT_MS,
          requireFreshOnLockWait: true,
        })
        if (refreshResult.entry) {
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
      } catch (error) {
        process.stderr.write(
          `[report-service] WARN: foreground cache refresh failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
        )
      }
    }

    setLocalReportCache(identity.cacheKey, redisEntry.entry)
    scheduleBackgroundCacheRefresh(identity, load, { cacheTtlMs }, 'background')
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

  if (redisEntry.status === 'error' || redisEntry.status === 'unavailable') {
    const localEntry = readLocalReportCache(identity.cacheKey)
    if (localEntry?.status === 'fresh' || localEntry?.status === 'stale') {
      if (localEntry.status === 'stale') {
        scheduleBackgroundCacheRefresh(
          identity,
          load,
          {
            cacheTtlMs,
            useRedis: false,
          },
          'local'
        )
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

  const localEntry = readLocalReportCache(identity.cacheKey)
  if (localEntry?.status === 'fresh' || localEntry?.status === 'stale') {
    if (localEntry.status === 'stale') {
      scheduleBackgroundCacheRefresh(identity, load, { cacheTtlMs }, 'background')
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

  const refreshResult = await refreshReportCache(identity, load, {
    cacheTtlMs,
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

export function shouldSuppressCacheRefreshFailureDuringShutdown(
  error,
  shuttingDown = reportServiceShuttingDown
) {
  if (!shuttingDown) return false
  const message = formatError(error)
  return message.includes('Cannot use a pool after calling end on the pool')
}

function logCacheRefreshFailure(kind, identity, error) {
  if (shouldSuppressCacheRefreshFailureDuringShutdown(error)) return
  process.stderr.write(
    `[report-service] WARN: ${kind} cache refresh failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
  )
}

function scheduleBackgroundCacheRefresh(identity, load, options, kind) {
  if (reportServiceShuttingDown) return
  refreshReportCache(identity, load, options).catch((error) => {
    logCacheRefreshFailure(kind, identity, error)
  })
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


function coerceRedisCacheStoredValue(encoded) {
  if (encoded == null) return null
  if (Buffer.isBuffer(encoded)) {
    if (encoded[0] === 0x1f && encoded[1] === 0x8b) return encoded
    return Buffer.from(encoded.toString('utf8'), 'base64')
  }
  if (encoded instanceof Uint8Array) {
    const buffer = Buffer.from(encoded)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return buffer
    return Buffer.from(buffer.toString('utf8'), 'base64')
  }
  if (typeof encoded === 'string') {
    return Buffer.from(encoded, 'base64')
  }
  throw new Error('Unsupported Redis report cache payload type')
}

async function encodeRedisReportCachePayload(entry) {
  return gzip(Buffer.from(JSON.stringify(entry)))
}

async function decodeRedisReportCachePayload(encoded) {
  const compressed = coerceRedisCacheStoredValue(encoded)
  if (!compressed?.length) {
    throw new Error('Redis report cache payload is empty')
  }
  const json = (await gunzip(compressed)).toString('utf8')
  return JSON.parse(json)
}

async function readRedisCacheEntry(identity) {
  if (readRedisCacheEntryTestImpl) {
    return readRedisCacheEntryTestImpl(identity)
  }
  return readRedisCacheEntryFromClient(identity, redisClient)
}

async function readRedisCacheEntryFromClient(identity, client) {
  if (!client) return { status: 'unavailable' }
  if (!client.isReady) return { status: 'unavailable' }

  try {
    const encoded = await client.get(identity.cacheKey)
    if (!encoded) return { status: 'miss' }

    const entry = await decodeRedisReportCachePayload(encoded)
    const status = classifyCacheEntry(entry)
    if (status === 'fresh' || status === 'stale') return { status, entry }

    client.del(identity.cacheKey).catch(() => {})
    return { status }
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: Redis cache read failed for ${identity.scope}:${identity.hash}: ${formatError(error)}\n`
    )
    return { status: 'error', error }
  }
}

async function writeRedisCacheEntry(identity, entry) {
  if (writeRedisCacheEntryTestImpl) {
    return writeRedisCacheEntryTestImpl(identity, entry)
  }
  if (!redisClient?.isReady) return false

  const ttlMs = Math.max(1_000, entry.staleUntil - Date.now())
  const encoded = await encodeRedisReportCachePayload(entry)

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
          options.lockWaitMs,
          { requireFresh: options.requireFreshOnLockWait }
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
    const entry = buildReportCacheEntry(payload, {
      cacheTtlMs: options.cacheTtlMs,
      scope: identity.scope,
    })
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
  waitMs = REPORT_CACHE_LOCK_WAIT_MS,
  options = {}
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
    if (redisEntry.status === 'fresh') {
      return redisEntry
    }
    if (redisEntry.status === 'stale' && !options.requireFresh) return redisEntry
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

async function loadMaterializedViewHealth() {
  if (!healthPool) {
    return {
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      views: [],
      cronJobs: [],
    }
  }

  return materializedViewHealthMemo.load(() =>
    loadMaterializedViewHealthFromDatabase()
  )
}

export function buildReportQueryPressureQuery() {
  return {
    sql: `
WITH activity AS (
  SELECT
    application_name,
    COALESCE(state, 'unknown') AS state,
    wait_event_type,
    wait_event,
    query_start,
    GREATEST(
      EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000,
      0
    )::double precision AS active_age_ms,
    left(regexp_replace(COALESCE(query, ''), '\\s+', ' ', 'g'), 180) AS query_prefix
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND application_name IN (
      'dashboard-shell-report-service',
      'dashboard-shell-health'
    )
)
SELECT
  application_name,
  state,
  wait_event_type,
  wait_event,
  COUNT(*)::double precision AS connection_count,
  COUNT(*) FILTER (WHERE state = 'active')::double precision AS active_count,
  COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::double precision AS waiting_count,
  MAX(active_age_ms) FILTER (
    WHERE state = 'active' AND query_start IS NOT NULL
  )::double precision AS max_active_age_ms,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'ageMs', ROUND(active_age_ms::numeric, 0)::double precision,
        'queryPrefix', query_prefix
      )
      ORDER BY query_start ASC
    ) FILTER (WHERE state = 'active' AND query_start IS NOT NULL),
    '[]'::jsonb
  ) AS active_queries
FROM activity
GROUP BY application_name, state, wait_event_type, wait_event
ORDER BY application_name ASC, state ASC, wait_event_type ASC NULLS LAST, wait_event ASC NULLS LAST;
`,
    values: [],
  }
}

function reportQueryMetricsSnapshot() {
  const activeQueries = [...activeReportQueries.values()]
    .map((query) => ({
      id: query.id,
      activeAgeMs: Date.now() - query.startedAtMs,
      startedAt: new Date(query.startedAtMs).toISOString(),
      label: query.label,
    }))
    .sort((a, b) => b.activeAgeMs - a.activeAgeMs)

  const oldestActiveAgeMs = activeQueries.length
    ? Math.max(...activeQueries.map((query) => query.activeAgeMs))
    : null

  return {
    started: reportQueryMetrics.started,
    completed: reportQueryMetrics.completed,
    errors: reportQueryMetrics.errors,
    timeouts: reportQueryMetrics.timeouts,
    active: activeQueries.length,
    oldestActiveAgeMs,
    lastStartedAt: reportQueryMetrics.lastStartedAt,
    lastCompletedAt: reportQueryMetrics.lastCompletedAt,
    lastErrorAt: reportQueryMetrics.lastErrorAt,
    lastErrorMessage: reportQueryMetrics.lastErrorMessage,
    lastTimeoutAt: reportQueryMetrics.lastTimeoutAt,
    lastDurationMs: reportQueryMetrics.lastDurationMs,
    maxDurationMs: reportQueryMetrics.maxDurationMs,
    activeQueries: activeQueries.slice(0, 5),
  }
}

function normalizeReportQueryPressureRow(row) {
  const activeQueries = Array.isArray(row.active_queries)
    ? row.active_queries
    : []

  return {
    applicationName: row.application_name,
    state: row.state,
    waitEventType: row.wait_event_type ?? null,
    waitEvent: row.wait_event ?? null,
    connectionCount: normalizeNumber(row.connection_count) ?? 0,
    activeCount: normalizeNumber(row.active_count) ?? 0,
    waitingCount: normalizeNumber(row.waiting_count) ?? 0,
    maxActiveAgeMs: normalizeNumber(row.max_active_age_ms),
    activeQueries: activeQueries.slice(0, 5).map((query) => ({
      ageMs: normalizeNumber(query.ageMs),
      queryPrefix: String(query.queryPrefix ?? '').slice(0, 180),
    })),
  }
}

async function loadReportQueryPressure() {
  const inProcess = reportQueryMetricsSnapshot()
  if (!healthPool) {
    return {
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      inProcess,
      pgStatActivity: {
        connectionCount: 0,
        activeCount: 0,
        waitingCount: 0,
        maxActiveAgeMs: null,
        rows: [],
      },
    }
  }

  try {
    const query = buildReportQueryPressureQuery()
    const result = await queryHealthDatabase(query.sql, query.values)
    const rows = result.rows.map(normalizeReportQueryPressureRow)
    return {
      status: 'ok',
      inProcess,
      pgStatActivity: {
        connectionCount: rows.reduce((sum, row) => sum + row.connectionCount, 0),
        activeCount: rows.reduce((sum, row) => sum + row.activeCount, 0),
        waitingCount: rows.reduce((sum, row) => sum + row.waitingCount, 0),
        maxActiveAgeMs:
          rows
            .map((row) => row.maxActiveAgeMs)
            .filter((value) => value !== null)
            .sort((a, b) => b - a)[0] ?? null,
        rows,
      },
    }
  } catch (error) {
    return {
      status: 'unknown',
      error: formatError(error),
      inProcess,
      pgStatActivity: {
        connectionCount: 0,
        activeCount: 0,
        waitingCount: 0,
        maxActiveAgeMs: null,
        rows: [],
      },
    }
  }
}

async function loadPgBouncerHealth() {
  return pgBouncerHealthMemo.load(() => loadPgBouncerHealthUncached())
}

async function loadPgBouncerHealthUncached() {
  const sidecars = await Promise.all(
    PGBOUNCER_SIDECARS.map((sidecar) => loadPgBouncerSidecarHealth(sidecar))
  )
  const status = sidecars.some((sidecar) => sidecar.status === 'red')
    ? 'red'
    : sidecars.some((sidecar) => sidecar.status === 'yellow')
      ? 'yellow'
      : 'green'

  return { status, sidecars }
}

async function loadPgBouncerSidecarHealth(sidecar) {
  const [container, admin] = await Promise.all([
    loadDockerContainerStatus(sidecar.containerName),
    loadPgBouncerAdminSummary(sidecar),
  ])
  const status = classifyPgBouncerSidecarStatus(container, admin)

  return {
    key: sidecar.key,
    label: sidecar.label,
    containerName: sidecar.containerName,
    hostEndpoint: sidecar.hostEndpoint,
    runtimeAliases: sidecar.runtimeAliases,
    upstreamPostgres: sidecar.upstreamPostgres,
    status,
    container,
    admin,
  }
}

function buildPgBouncerSidecarUnavailable(sidecar, error) {
  return {
    key: sidecar.key,
    label: sidecar.label,
    containerName: sidecar.containerName,
    hostEndpoint: sidecar.hostEndpoint,
    runtimeAliases: sidecar.runtimeAliases,
    upstreamPostgres: sidecar.upstreamPostgres,
    status: 'red',
    container: {
      present: false,
      status: 'unknown',
      health: null,
      running: false,
      logConfig: null,
      error,
    },
    admin: {
      configured: Boolean(sidecar.adminDatabaseUrl),
      status: 'unknown',
      endpoint: describeDatabaseUrl(sidecar.adminDatabaseUrl),
      error,
      poolSummary: emptyPgBouncerPoolSummary(),
      statsSummary: emptyPgBouncerStatsSummary(),
      serverSummary: emptyPgBouncerServerSummary(),
      pools: [],
      stats: [],
    },
  }
}

function classifyPgBouncerSidecarStatus(container, admin) {
  if (container.status === 'missing' || container.status === 'unhealthy') {
    return 'red'
  }
  if (admin.status === 'unreachable') return 'red'
  if (admin.poolSummary.clWaiting > 0 || admin.poolSummary.maxWaitSeconds > 0) {
    return 'yellow'
  }
  if (
    container.status === 'unknown' ||
    container.status === 'stopped' ||
    admin.status === 'unconfigured' ||
    admin.status === 'unknown'
  ) {
    return 'yellow'
  }
  return 'green'
}

async function loadDockerContainerStatus(containerName) {
  let entries
  try {
    entries = await readdir(DOCKER_LOG_ROOT, { withFileTypes: true })
  } catch (error) {
    return {
      present: false,
      status: 'unknown',
      health: null,
      running: false,
      logConfig: null,
      error: formatError(error),
    }
  }

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

    const name = String(config?.Name ?? '').replace(/^\//, '')
    if (name !== containerName) continue

    let hostConfig = null
    try {
      hostConfig = JSON.parse(
        await readFile(path.join(containerDir, 'hostconfig.json'), 'utf8')
      )
    } catch {
      hostConfig = null
    }

    const state = config?.State ?? {}
    const health = state?.Health?.Status ?? null
    const running = Boolean(state?.Running)
    const logConfig = normalizeDockerLogConfig(hostConfig?.LogConfig)
    const status = health === 'unhealthy'
      ? 'unhealthy'
      : health === 'healthy'
        ? 'healthy'
        : running
          ? 'running'
          : state?.Status
            ? String(state.Status)
            : 'unknown'

    return {
      present: true,
      status,
      health,
      running,
      startedAt: state?.StartedAt ?? null,
      finishedAt: state?.FinishedAt ?? null,
      logConfig,
      error: null,
    }
  }

  return {
    present: false,
    status: 'missing',
    health: null,
    running: false,
    logConfig: null,
    error: null,
  }
}

function normalizeDockerLogConfig(logConfig) {
  if (!logConfig || typeof logConfig !== 'object') return null
  const config = logConfig.Config ?? {}
  return {
    type: logConfig.Type ?? null,
    maxSize: config['max-size'] ?? null,
    maxFile: config['max-file'] ?? null,
  }
}

const pgBouncerAdminPoolsByKey = new Map()

function pgBouncerAdminPoolCacheKey(sidecar) {
  return JSON.stringify([sidecar.key, sidecar.adminDatabaseUrl])
}

function getOrCreatePgBouncerAdminPool(sidecar) {
  const cacheKey = pgBouncerAdminPoolCacheKey(sidecar)
  let adminPool = pgBouncerAdminPoolsByKey.get(cacheKey)
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: sidecar.adminDatabaseUrl,
      application_name: 'dashboard-shell-pgbouncer-health',
      max: 1,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: PGBOUNCER_ADMIN_QUERY_TIMEOUT_MS,
      query_timeout: PGBOUNCER_ADMIN_QUERY_TIMEOUT_MS,
    })
    adminPool.on('error', (error) => {
      process.stderr.write(
        `[report-service] WARN: idle PgBouncer admin client error for ${sidecar.key}: ${formatError(error)}
`
      )
    })
    pgBouncerAdminPoolsByKey.set(cacheKey, adminPool)
  }
  return adminPool
}

async function cleanupPgBouncerAdminPools() {
  const pools = [...pgBouncerAdminPoolsByKey.values()]
  pgBouncerAdminPoolsByKey.clear()
  await Promise.all(pools.map((pool) => pool.end().catch(() => {})))
}

async function loadPgBouncerAdminSummary(sidecar) {
  if (!sidecar.adminDatabaseUrl) {
    return {
      configured: false,
      status: 'unconfigured',
      endpoint: null,
      error: 'PgBouncer admin database URL is not configured.',
      poolSummary: emptyPgBouncerPoolSummary(),
      statsSummary: emptyPgBouncerStatsSummary(),
      serverSummary: emptyPgBouncerServerSummary(),
      pools: [],
      stats: [],
    }
  }

  const adminPool = getOrCreatePgBouncerAdminPool(sidecar)

  try {
    const client = await adminPool.connect()
    try {
      const poolsResult = await client.query('SHOW POOLS;')
      const statsResult = await client.query('SHOW STATS;')
      const serversResult = await client.query('SHOW SERVERS;')
      const pools = poolsResult.rows.map(normalizePgBouncerPoolRow)
      const stats = statsResult.rows.map(normalizePgBouncerStatsRow)
      const serverSummary = summarizePgBouncerServers(serversResult.rows)

      return {
        configured: true,
        status: 'ok',
        endpoint: describeDatabaseUrl(sidecar.adminDatabaseUrl),
        error: null,
        poolSummary: summarizePgBouncerPools(pools),
        statsSummary: summarizePgBouncerStats(stats),
        serverSummary,
        pools,
        stats,
      }
    } finally {
      client.release()
    }
  } catch (error) {
    return {
      configured: true,
      status: 'unreachable',
      endpoint: describeDatabaseUrl(sidecar.adminDatabaseUrl),
      error: formatError(error),
      poolSummary: emptyPgBouncerPoolSummary(),
      statsSummary: emptyPgBouncerStatsSummary(),
      serverSummary: emptyPgBouncerServerSummary(),
      pools: [],
      stats: [],
    }
  }
}

export function normalizePgBouncerPoolRow(row) {
  return {
    database: row.database ?? null,
    user: row.user ?? null,
    clActive: normalizeNumber(row.cl_active) ?? 0,
    clWaiting: normalizeNumber(row.cl_waiting) ?? 0,
    svActive: normalizeNumber(row.sv_active) ?? 0,
    svIdle: normalizeNumber(row.sv_idle) ?? 0,
    svUsed: normalizeNumber(row.sv_used) ?? 0,
    svTested: normalizeNumber(row.sv_tested) ?? 0,
    svLogin: normalizeNumber(row.sv_login) ?? 0,
    maxWaitSeconds: normalizeNumber(row.maxwait) ?? 0,
    maxWaitMicroseconds: normalizeNumber(row.maxwait_us) ?? 0,
    poolMode: row.pool_mode ?? null,
  }
}

export function normalizePgBouncerStatsRow(row) {
  return {
    database: row.database ?? null,
    totalXactCount: normalizeNumber(row.total_xact_count) ?? 0,
    totalQueryCount: normalizeNumber(row.total_query_count) ?? 0,
    totalReceived: normalizeNumber(row.total_received) ?? 0,
    totalSent: normalizeNumber(row.total_sent) ?? 0,
    avgXactCount: normalizeNumber(row.avg_xact_count) ?? 0,
    avgQueryCount: normalizeNumber(row.avg_query_count) ?? 0,
    avgWaitTime: normalizeNumber(row.avg_wait_time) ?? 0,
  }
}

function emptyPgBouncerPoolSummary() {
  return {
    clActive: 0,
    clWaiting: 0,
    svActive: 0,
    svIdle: 0,
    svUsed: 0,
    svTested: 0,
    svLogin: 0,
    maxWaitSeconds: 0,
    maxWaitMicroseconds: 0,
  }
}

function summarizePgBouncerPools(pools) {
  return pools.reduce(
    (summary, row) => ({
      clActive: summary.clActive + row.clActive,
      clWaiting: summary.clWaiting + row.clWaiting,
      svActive: summary.svActive + row.svActive,
      svIdle: summary.svIdle + row.svIdle,
      svUsed: summary.svUsed + row.svUsed,
      svTested: summary.svTested + row.svTested,
      svLogin: summary.svLogin + row.svLogin,
      maxWaitSeconds: Math.max(summary.maxWaitSeconds, row.maxWaitSeconds),
      maxWaitMicroseconds: Math.max(
        summary.maxWaitMicroseconds,
        row.maxWaitMicroseconds
      ),
    }),
    emptyPgBouncerPoolSummary()
  )
}

function emptyPgBouncerStatsSummary() {
  return {
    totalXactCount: 0,
    totalQueryCount: 0,
    totalReceived: 0,
    totalSent: 0,
    avgXactCount: 0,
    avgQueryCount: 0,
    avgWaitTime: 0,
  }
}

function summarizePgBouncerStats(stats) {
  if (!stats.length) return emptyPgBouncerStatsSummary()
  const totals = stats.reduce(
    (summary, row) => ({
      totalXactCount: summary.totalXactCount + row.totalXactCount,
      totalQueryCount: summary.totalQueryCount + row.totalQueryCount,
      totalReceived: summary.totalReceived + row.totalReceived,
      totalSent: summary.totalSent + row.totalSent,
      avgXactCount: summary.avgXactCount + row.avgXactCount,
      avgQueryCount: summary.avgQueryCount + row.avgQueryCount,
      avgWaitTime: summary.avgWaitTime + row.avgWaitTime,
    }),
    emptyPgBouncerStatsSummary()
  )
  return {
    ...totals,
    avgXactCount: Math.round(totals.avgXactCount / stats.length),
    avgQueryCount: Math.round(totals.avgQueryCount / stats.length),
    avgWaitTime: Math.round(totals.avgWaitTime / stats.length),
  }
}

function emptyPgBouncerServerSummary() {
  return {
    total: 0,
    active: 0,
    idle: 0,
    used: 0,
    tested: 0,
    login: 0,
    byState: [],
  }
}

function summarizePgBouncerServers(rows) {
  const counts = new Map()
  for (const row of rows) {
    const state = String(row.state ?? 'unknown')
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  const countFor = (state) => counts.get(state) ?? 0
  return {
    total: rows.length,
    active: countFor('active'),
    idle: countFor('idle'),
    used: countFor('used'),
    tested: countFor('tested'),
    login: countFor('login'),
    byState: [...counts.entries()]
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => a.state.localeCompare(b.state)),
  }
}

async function loadMaterializedViewHealthFromDatabase() {
  const viewResult = await queryHealthDatabase(`
WITH rel AS (
  SELECT relname, GREATEST(reltuples, 0)::bigint AS estimated_row_count
  FROM pg_class
  WHERE oid IN (
    'public.rate_limit_intervals'::regclass,
    'public.provider_latency_health_5m'::regclass
  )
)
SELECT
  'rate_limit_intervals' AS view_name,
  'quota' AS category,
  (SELECT MAX(fromdate) FROM public.rate_limit_intervals) AS latest_data_at,
  (SELECT estimated_row_count FROM rel WHERE relname = 'rate_limit_intervals') AS row_count
UNION ALL
SELECT
  'provider_latency_health_5m' AS view_name,
  'provider_health' AS category,
  (SELECT MAX(bucket_start) FROM public.provider_latency_health_5m) AS latest_data_at,
  (SELECT estimated_row_count FROM rel WHERE relname = 'provider_latency_health_5m') AS row_count
ORDER BY view_name ASC;
`)
  const jobResult = await queryHealthDatabase(`
WITH dashboard_jobs AS (
  SELECT jobid, schedule, command, active, jobname
  FROM cron.job
  WHERE jobname IN (
    'aawm_rate_limit_intervals_refresh',
    'aawm_rate_limit_intervals_analyze',
    'aawm_provider_latency_health_5m_refresh',
    'aawm_provider_latency_health_5m_analyze'
  )
), latest_runs AS (
  SELECT DISTINCT ON (jobid)
    jobid,
    runid,
    status,
    return_message,
    start_time,
    end_time
  FROM cron.job_run_details
  WHERE jobid IN (SELECT jobid FROM dashboard_jobs)
  ORDER BY jobid, start_time DESC NULLS LAST, runid DESC
), last_success AS (
  SELECT DISTINCT ON (jobid)
    jobid,
    start_time AS last_success_start_time,
    end_time AS last_success_end_time,
    return_message AS last_success_message
  FROM cron.job_run_details
  WHERE jobid IN (SELECT jobid FROM dashboard_jobs)
    AND status = 'succeeded'
  ORDER BY jobid, start_time DESC NULLS LAST, runid DESC
), last_failure AS (
  SELECT DISTINCT ON (jobid)
    jobid,
    start_time AS last_failure_start_time,
    end_time AS last_failure_end_time,
    return_message AS last_failure_message
  FROM cron.job_run_details
  WHERE jobid IN (SELECT jobid FROM dashboard_jobs)
    AND status = 'failed'
  ORDER BY jobid, start_time DESC NULLS LAST, runid DESC
)
SELECT
  j.jobid,
  j.jobname,
  j.schedule,
  j.command,
  j.active,
  lr.status AS last_status,
  lr.return_message AS last_message,
  lr.start_time AS last_start_time,
  lr.end_time AS last_end_time,
  ls.last_success_start_time,
  ls.last_success_end_time,
  ls.last_success_message,
  lf.last_failure_start_time,
  lf.last_failure_end_time,
  lf.last_failure_message
FROM dashboard_jobs j
LEFT JOIN latest_runs lr USING (jobid)
LEFT JOIN last_success ls USING (jobid)
LEFT JOIN last_failure lf USING (jobid)
ORDER BY j.jobid ASC;
`)
  const activeResult = await queryHealthDatabase(`
SELECT
  pid,
  now() - query_start AS age,
  query
FROM pg_stat_activity
WHERE datname = current_database()
  AND application_name = 'pg_cron'
  AND (
    query ILIKE '%rate_limit_intervals%'
    OR query ILIKE '%provider_latency_health_5m%'
    OR query ILIKE '%dashboard_shell_maintain_materialized_view%'
)
ORDER BY query_start ASC NULLS LAST;
`)

  const activeRows = activeResult.rows.map((row) => ({
    pid: normalizeNumber(row.pid),
    age: row.age ? String(row.age) : null,
    query: String(row.query ?? '').slice(0, 160),
  }))
  const cronJobs = jobResult.rows.map((row) =>
    normalizeMaterializedViewCronJob(row, activeRows)
  )
  const jobsByView = cronJobs.reduce((acc, job) => {
    const viewName = job.viewName
    if (!viewName) return acc
    acc[viewName] = [...(acc[viewName] ?? []), job]
    return acc
  }, {})

  const views = viewResult.rows.map((row) =>
    normalizeMaterializedViewHealthRow(row, jobsByView[row.view_name] ?? [])
  )
  const status = views.some((view) => view.status === 'stale')
    ? 'stale'
    : views.some((view) => view.status === 'unknown')
      ? 'unknown'
      : 'ok'

  return {
    status,
    checkedAt: new Date().toISOString(),
    cacheTtlMs: MATERIALIZED_VIEW_HEALTH_CACHE_TTL_MS,
    views,
    cronJobs,
  }
}

async function loadSourceTableHealth() {
  if (!healthPool) {
    return {
      status: 'unconfigured',
      error: 'DATABASE_URL is not configured.',
      tables: [],
    }
  }

  return sourceTableHealthMemo.load(() => loadSourceTableHealthFromDatabase())
}

export function buildSourceTableHealthQuery() {
  const sql = `
WITH rel AS (
  SELECT relname, GREATEST(reltuples, 0)::bigint AS estimated_row_count
  FROM pg_class
  WHERE oid IN (
    'public.session_history'::regclass,
    'public.rate_limit_observations'::regclass
  )
)
SELECT
  'session_history' AS table_name,
  'usage_source' AS category,
  (SELECT id FROM public.session_history ORDER BY id DESC LIMIT 1) AS latest_row_id,
  (SELECT created_at FROM public.session_history ORDER BY id DESC LIMIT 1) AS latest_data_at,
  (SELECT created_at FROM public.session_history ORDER BY id DESC LIMIT 1) AS latest_persisted_at,
  (SELECT start_time FROM public.session_history ORDER BY id DESC LIMIT 1) AS latest_event_at,
  (SELECT estimated_row_count FROM rel WHERE relname = 'session_history') AS row_count
UNION ALL
SELECT
  'rate_limit_observations' AS table_name,
  'quota_source' AS category,
  (SELECT id FROM public.rate_limit_observations ORDER BY id DESC LIMIT 1) AS latest_row_id,
  (SELECT observed_at FROM public.rate_limit_observations ORDER BY id DESC LIMIT 1) AS latest_data_at,
  NULL::timestamp with time zone AS latest_persisted_at,
  (SELECT observed_at FROM public.rate_limit_observations ORDER BY id DESC LIMIT 1) AS latest_event_at,
  (SELECT estimated_row_count FROM rel WHERE relname = 'rate_limit_observations') AS row_count
ORDER BY table_name ASC;
`
  return { sql, values: [] }
}

async function loadSourceTableHealthFromDatabase() {
  const query = buildSourceTableHealthQuery()
  const result = await queryHealthDatabase(query.sql, query.values)
  const tables = result.rows.map(normalizeSourceTableHealthRow)
  const status = tables.some((table) => table.status === 'stale')
    ? 'stale'
    : tables.some((table) => table.status === 'unknown')
      ? 'unknown'
      : 'ok'

  return {
    status,
    checkedAt: new Date().toISOString(),
    cacheTtlMs: MATERIALIZED_VIEW_HEALTH_CACHE_TTL_MS,
    tables,
  }
}

function normalizeSourceTableHealthRow(row) {
  const latestDataAt = row.latest_data_at
    ? new Date(row.latest_data_at).toISOString()
    : null
  const latestDataAgeMs = latestDataAt
    ? Math.max(0, Date.now() - new Date(latestDataAt).getTime())
    : null
  const staleAfterMs = STALE_RECORD_THRESHOLD_MINUTES * 60 * 1000
  const status =
    latestDataAgeMs === null
      ? 'unknown'
      : latestDataAgeMs > staleAfterMs
        ? 'stale'
        : 'ok'

  return {
    tableName: row.table_name,
    category: row.category,
    status,
    latestRowId: normalizeNumber(row.latest_row_id),
    latestDataAt,
    latestPersistedAt: row.latest_persisted_at
      ? new Date(row.latest_persisted_at).toISOString()
      : null,
    latestEventAt: row.latest_event_at
      ? new Date(row.latest_event_at).toISOString()
      : null,
    latestDataAgeMinutes:
      latestDataAgeMs === null ? null : Math.round(latestDataAgeMs / 60_000),
    rowCount: normalizeNumber(row.row_count) ?? 0,
    staleAfterMinutes: STALE_RECORD_THRESHOLD_MINUTES,
    refreshOwner: 'application_writer',
  }
}

function normalizeMaterializedViewHealthRow(row, jobs) {
  const latestDataAt = row.latest_data_at
    ? new Date(row.latest_data_at).toISOString()
    : null
  const latestDataAgeMs = latestDataAt
    ? Math.max(0, Date.now() - new Date(latestDataAt).getTime())
    : null
  const staleAfterMs =
    row.view_name === 'provider_latency_health_5m'
      ? PROVIDER_HEALTH_MV_STALE_AFTER_MS
      : QUOTA_MV_STALE_AFTER_MS
  const status =
    latestDataAgeMs === null
      ? 'unknown'
      : latestDataAgeMs > staleAfterMs
        ? 'stale'
        : 'ok'

  return {
    viewName: row.view_name,
    category: row.category,
    status,
    latestDataAt,
    latestDataAgeMinutes:
      latestDataAgeMs === null ? null : Math.round(latestDataAgeMs / 60_000),
    rowCount: normalizeNumber(row.row_count) ?? 0,
    staleAfterMinutes: Math.round(staleAfterMs / 60_000),
    refreshOwner: 'pg_cron',
    jobs,
  }
}

function normalizeMaterializedViewCronJob(row, activeRows) {
  const command = String(row.command ?? '')
  const viewName = command.includes('provider_latency_health_5m')
    ? 'provider_latency_health_5m'
    : command.includes('rate_limit_intervals')
      ? 'rate_limit_intervals'
      : null
  const jobName = String(row.jobname ?? '')
  const kind =
    jobName.endsWith('_analyze') ||
    command.includes("'analyze'") ||
    command.includes('ANALYZE')
      ? 'analyze'
      : 'refresh'
  const activeRun = activeRows.find((activeRow) => {
    if (!viewName) return false
    return (
      activeRow.query.includes(`public.${viewName}`) ||
      activeRow.query.includes(viewName)
    )
  })

  return {
    jobId: normalizeNumber(row.jobid),
    jobName: row.jobname,
    viewName,
    kind,
    schedule: row.schedule,
    active: Boolean(row.active),
    inFlight: Boolean(activeRun),
    activePid: activeRun?.pid ?? null,
    activeAge: activeRun?.age ?? null,
    lastStatus: row.last_status ?? null,
    lastMessage: row.last_message ?? null,
    lastStartTime: row.last_start_time
      ? new Date(row.last_start_time).toISOString()
      : null,
    lastEndTime: row.last_end_time ? new Date(row.last_end_time).toISOString() : null,
    lastSuccessStartTime: row.last_success_start_time
      ? new Date(row.last_success_start_time).toISOString()
      : null,
    lastSuccessEndTime: row.last_success_end_time
      ? new Date(row.last_success_end_time).toISOString()
      : null,
    lastSuccessMessage: row.last_success_message ?? null,
    lastFailureStartTime: row.last_failure_start_time
      ? new Date(row.last_failure_start_time).toISOString()
      : null,
    lastFailureEndTime: row.last_failure_end_time
      ? new Date(row.last_failure_end_time).toISOString()
      : null,
    lastFailureMessage: row.last_failure_message ?? null,
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

function annotateTokenTrendSummarySubqueryTimeout(error, subqueryKey) {
  if (!error || typeof error !== 'object') {
    const wrapped = new Error(formatError(error))
    wrapped.tokenTrendSummaryTimedOutSubquery = subqueryKey
    return wrapped
  }

  error.tokenTrendSummaryTimedOutSubquery = subqueryKey
  return error
}

async function runTokenTrendSummarySubqueries(labeledTasks) {
  const results = new Array(labeledTasks.length)
  await runTasksWithConcurrency(
    labeledTasks.map(({ subqueryKey, task }, index) => async () => {
      try {
        const value = await task()
        results[index] = {
          status: 'fulfilled',
          subqueryKey,
          value,
        }
      } catch (error) {
        results[index] = {
          status: 'rejected',
          subqueryKey,
          error: annotateTokenTrendSummarySubqueryTimeout(error, subqueryKey),
        }
      }
    }),
    REPORT_SQL_FANOUT_CONCURRENCY
  )
  return results
}

function formatError(error) {
  return error instanceof Error && error.message ? error.message : String(error)
}

function pruneReportCache() {
  while (reportCache.size > reportCacheMaxEntries) {
    let oldestEvictableKey
    for (const key of reportCache.keys()) {
      const cached = reportCache.get(key)
      if (!cached?.promise) {
        oldestEvictableKey = key
        break
      }
    }
    if (oldestEvictableKey === undefined) return
    reportCache.delete(oldestEvictableKey)
  }
}

export function buildPgBouncerAdminDatabaseUrl(value) {
  if (!value) return undefined

  try {
    const databaseUrl = new URL(value)
    databaseUrl.pathname = '/pgbouncer'
    return databaseUrl.toString()
  } catch {
    return undefined
  }
}

export function buildAegisPgBouncerAdminDatabaseUrl(env = process.env) {
  const explicitUrl = optionalEnvValue(
    env.SHELL_REPORT_AEGIS_PGBOUNCER_DATABASE_URL
  )
  if (explicitUrl) return explicitUrl

  const databaseUrl = new URL('postgresql://aegis-pgbouncer')
  databaseUrl.username =
    optionalEnvValue(env.SHELL_REPORT_AEGIS_PGBOUNCER_USER) ??
    optionalEnvValue(env.AEGIS_PGBOUNCER_AUTH_USER) ??
    'aegis_app'
  const password =
    optionalEnvValue(env.SHELL_REPORT_AEGIS_PGBOUNCER_PASSWORD) ??
    optionalEnvValue(env.AEGIS_PGBOUNCER_AUTH_PASSWORD) ??
    optionalEnvValue(env.AEGIS_DB_PASSWORD)
  if (!password) return undefined
  databaseUrl.password = password
  databaseUrl.hostname =
    optionalEnvValue(env.SHELL_REPORT_AEGIS_PGBOUNCER_HOST) ??
    'aegis-pgbouncer'
  databaseUrl.port =
    optionalEnvValue(env.SHELL_REPORT_AEGIS_PGBOUNCER_PORT) ?? '6432'
  databaseUrl.pathname = `/${
    optionalEnvValue(env.SHELL_REPORT_AEGIS_PGBOUNCER_DATABASE) ?? 'pgbouncer'
  }`
  return databaseUrl.toString()
}

function describeDatabaseUrl(value) {
  if (!value) return null

  try {
    const databaseUrl = new URL(value)
    return {
      database: databaseUrl.pathname.replace(/^\//, '') || null,
      host: databaseUrl.hostname,
      port: databaseUrl.port || null,
    }
  } catch {
    return null
  }
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
function providerDimensionExpression(
  columnExpression = 'sh.provider',
  { includeAntigravity = false } = {}
) {
  const antigravityBranch = includeAntigravity
    ? `
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) = 'antigravity' THEN 'antigravity'`
    : ''
  return `
CASE
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('google', 'gemini') THEN 'google'${antigravityBranch}
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('claude', 'anthropic') THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'claude/%' THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'anthropic/%' THEN 'anthropic'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'deepseek/%' THEN 'deepseek'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(${columnExpression}, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(${columnExpression}, 'unknown')
END`
}

const providerDimension = providerDimensionExpression('sh.provider')

function providerDimensionForAlias(alias = 'sh', options = {}) {
  return providerDimensionExpression(`${alias}.provider`, options)
}

const providerDimensionRecent = providerDimensionForAlias('sh_recent')
const healthProviderDimension = providerDimensionForAlias('h')
const inboundModelAliasDimension =
  "COALESCE(NULLIF(sh.inbound_model_alias, ''), 'unknown_inbound_model')"
const agentNameDimension =
  "COALESCE(NULLIF(sh.agent_name, ''), 'unknown_agent_name')"
const agentIdDimension =
  "COALESCE(NULLIF(sh.agent_id, ''), 'uncaptured_agent_id')"

function sessionHistoryTokenSignalExpression(alias = 'sh') {
  return `(COALESCE(${alias}.input_tokens, 0)
    + COALESCE(${alias}.output_tokens, 0)
    + COALESCE(${alias}.cache_read_input_tokens, 0)
    + COALESCE(${alias}.cache_creation_input_tokens, 0)
    + COALESCE(${alias}.reasoning_tokens_reported, 0)
    + COALESCE(${alias}.reasoning_tokens_estimated, 0))`
}

function sessionHistoryCostSignalExpression(alias = 'sh') {
  return `(COALESCE(${alias}.response_cost_usd, 0)
    + COALESCE(${alias}.provider_cache_miss_cost_usd, 0))`
}

function sessionHistoryMetadataText(alias, key, fallback) {
  return `lower(btrim(COALESCE(${alias}.metadata->>${sqlTextLiteral(key)}, ${sqlTextLiteral(fallback)})))`
}

function legacyGrokSideChannelPredicate(alias = 'sh') {
  return `(
    ${providerDimensionForAlias(alias)} = 'xai'
    AND lower(COALESCE(${alias}.client_name, '')) = 'grok-build'
    AND COALESCE(NULLIF(${alias}.model, ''), 'unknown') = 'unknown'
    AND ${sessionHistoryTokenSignalExpression(alias)} = 0
    AND ${sessionHistoryCostSignalExpression(alias)} = 0
    AND COALESCE(${alias}.tool_call_count, 0) = 0
    AND lower(COALESCE(
      NULLIF(${alias}.metadata->>'passthrough_route_family', ''),
      NULLIF(${alias}.metadata->>'route_family', ''),
      ''
    )) = 'grok_cli_chat_proxy'
)`
}

function sessionHistoryReportablePredicate(alias = 'sh') {
  return `(
    ${sessionHistoryMetadataText(alias, 'session_history_usage_record', 'true')} <> 'false'
    AND ${sessionHistoryMetadataText(alias, 'session_history_reporting_excluded', 'false')} <> 'true'
    AND ${sessionHistoryMetadataText(alias, 'session_history_model_reporting_excluded', 'false')} <> 'true'
    AND (
      ${sessionHistoryTokenSignalExpression(alias)} > 0
      OR ${sessionHistoryCostSignalExpression(alias)} > 0
      OR COALESCE(${alias}.tool_call_count, 0) > 0
    )
    AND NOT ${legacyGrokSideChannelPredicate(alias)}
)`
}

function appendReportableSessionHistoryWhere(whereParts, alias = 'sh') {
  whereParts.push(sessionHistoryReportablePredicate(alias))
}

function sessionHistoryFastUsageSignalPredicate(alias = 'sh') {
  return `(
    ${sessionHistoryTokenSignalExpression(alias)} > 0
    OR ${sessionHistoryCostSignalExpression(alias)} > 0
    OR COALESCE(${alias}.tool_call_count, 0) > 0
)`
}

function appendFastUsageSignalWhere(whereParts, alias = 'sh') {
  whereParts.push(sessionHistoryFastUsageSignalPredicate(alias))
}

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
  inbound_model_alias: inboundModelAliasDimension,
  agent_name: agentNameDimension,
  agent_id: agentIdDimension,
  provider_model:
    `${providerDimension} || '/' || COALESCE(sh.model, 'unknown')`,
}

const filterColumns = {
  environment: dimensions.environment,
  client: dimensions.client,
  repository: "COALESCE(sh.tenant_id, 'unknown')",
  provider: providerDimension,
  model: "COALESCE(sh.model, 'unknown')",
  inbound_model_alias: inboundModelAliasDimension,
  agent_name: agentNameDimension,
  agent_id: agentIdDimension,
  provider_model: dimensions.provider_model,
}

const configChangeFlagColumns = [
  'changed_pre_commit_config',
  'changed_env_file',
  'changed_pyproject_toml',
  'changed_gitignore',
]

const configChangeFilterColumns = Object.fromEntries(
  configChangeFlagColumns.map((column) => [column, `sh.${column}`])
)

const sortColumns = {
  period_end: 'period_end',
  period_start: 'period_start',
  traces: 'traces',
  usd_cost: 'usd_cost',
  token_total: 'token_total',
}

function parseTruthySearchParam(value) {
  if (value == null) {
    return false
  }
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}


function isEmptyUsageRowFieldValue(value) {
  return value === null || value === undefined || value === ''
}

export function compactUsageRow(row) {
  if (!row || typeof row !== 'object') {
    return row
  }

  const compacted = {}
  for (const [key, value] of Object.entries(row)) {
    if (!isEmptyUsageRowFieldValue(value)) {
      compacted[key] = value
    }
  }
  return compacted
}

export function shouldIncludeEmptyUsageRowFields(searchParams) {
  return parseTruthySearchParam(searchParams.get('include_empty_row_fields'))
}

export function buildUsageReportRowSerializationMetadata(searchParams) {
  const includeEmptyRowFields = shouldIncludeEmptyUsageRowFields(searchParams)
  return {
    compactRows: !includeEmptyRowFields,
    rowNullFieldsOmitted: !includeEmptyRowFields,
    includeEmptyRowFields,
  }
}

function serializeUsageReportRows(rows, searchParams) {
  if (shouldIncludeEmptyUsageRowFields(searchParams)) {
    return rows
  }
  return rows.map(compactUsageRow)
}

export function shouldIncludeTokenTrendHealth(searchParams) {
  return parseTruthySearchParam(searchParams.get('include_health'))
}

export function applyTokenTrendSummaryHealthInclusion(searchParams, report) {
  if (shouldIncludeTokenTrendHealth(searchParams)) {
    return {
      ...report,
      metadata: {
        ...report.metadata,
        includeTokenTrendHealth: true,
      },
    }
  }

  return {
    ...report,
    metadata: {
      ...report.metadata,
      includeTokenTrendHealth: false,
      tokenTrendHealthOmitted: true,
    },
    tokenTrendHealth: [],
  }
}

export function parseUsageReportSort(searchParams) {
  const rawSort = searchParams.get('sort') ?? 'period_end'
  let sortKey = rawSort
  let directionParam = searchParams.get('direction')
  const dotIndex = rawSort.lastIndexOf('.')

  if (dotIndex > 0) {
    const maybeColumn = rawSort.slice(0, dotIndex)
    const maybeDirection = rawSort.slice(dotIndex + 1).toLowerCase()
    if (
      sortColumns[maybeColumn] &&
      (maybeDirection === 'asc' || maybeDirection === 'desc')
    ) {
      sortKey = maybeColumn
      directionParam = maybeDirection
    }
  }

  const sort = sortColumns[sortKey]
  if (!sort) {
    throw new Error(`Unsupported sort: ${rawSort}`)
  }

  const sortDirection =
    directionParam?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  return { sort, sortDirection, sortKey: rawSort }
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

function buildFastLatencyMetricSelects(column, alias) {
  return [
    `NULL::double precision AS ${alias}_p50_ms`,
    `NULL::double precision AS ${alias}_p95_ms`,
    `NULL::double precision AS ${alias}_p99_ms`,
    `COUNT(sh.${column})::double precision AS ${alias}_count`,
  ]
}

const fastUsageLatencyMetricSelectParts = [
  'COUNT(*)::double precision AS latency_sample_rows',
  ...buildFastLatencyMetricSelects('litellm_pre_send_ms', 'litellm_pre_send'),
  ...buildFastLatencyMetricSelects(
    'litellm_post_response_ms',
    'litellm_post_response'
  ),
  ...buildFastLatencyMetricSelects('litellm_processing_ms', 'litellm_processing'),
  ...buildFastLatencyMetricSelects(
    'llm_upstream_time_to_first_byte_ms',
    'llm_upstream_time_to_first_byte'
  ),
  ...buildFastLatencyMetricSelects(
    'llm_upstream_elapsed_ms',
    'llm_upstream_elapsed'
  ),
  ...buildFastLatencyMetricSelects('llm_upstream_stream_ms', 'llm_upstream_stream'),
  ...buildFastLatencyMetricSelects('ttft_ms', 'ttft'),
  ...buildFastLatencyMetricSelects(
    'total_server_elapsed_ms',
    'total_server_elapsed'
  ),
  ...buildFastLatencyMetricSelects(
    'latency_unclassified_ms',
    'latency_unclassified'
  ),
  ...buildFastLatencyMetricSelects(
    'previous_response_to_current_request_ms',
    'previous_response_to_current_request'
  ),
  `NULL::double precision AS llm_upstream_output_tokens_per_second_p50`,
  `NULL::double precision AS llm_upstream_output_tokens_per_second_p95`,
  `COUNT(*) FILTER (WHERE sh.llm_upstream_elapsed_ms > 0)::double precision AS llm_upstream_output_tokens_per_second_count`,
  `NULL::double precision AS llm_stream_output_tokens_per_second_p50`,
  `NULL::double precision AS llm_stream_output_tokens_per_second_p95`,
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

function fastUsageAgentScoreSelect(part) {
  const alias = part.match(/\sAS\s+([a-z0-9_]+)\s*$/i)?.[1]
  if (!alias) return part
  if (alias === 'agent_score_rows') {
    return 'COUNT(*)::double precision AS agent_score_rows'
  }
  if (alias === 'agent_compact_summary_source_counts') {
    return `jsonb_build_object(
      'claude-code', NULL,
      'codex', NULL,
      'gemini-cli', NULL
  ) AS agent_compact_summary_source_counts`
  }
  return `NULL::double precision AS ${alias}`
}

const fastUsageAgentScoreSelectParts = agentScoreSelectParts.map(
  fastUsageAgentScoreSelect
)

const configChangeAnyEvaluated = configChangeFlagColumns
  .map((column) => `sh.${column} IS NOT NULL`)
  .join(' OR ')
const configChangeAnyTrue = configChangeFlagColumns
  .map((column) => `sh.${column} IS TRUE`)
  .join(' OR ')
const configChangeAllUnknown = configChangeFlagColumns
  .map((column) => `sh.${column} IS NULL`)
  .join(' AND ')

const configChangeAggregateSelectParts = [
  `COUNT(*) FILTER (WHERE ${configChangeAnyEvaluated})::double precision AS config_change_evaluated_rows`,
  `COUNT(*) FILTER (WHERE ${configChangeAllUnknown})::double precision AS config_change_unevaluated_rows`,
  `COUNT(*) FILTER (WHERE ${configChangeAnyTrue})::double precision AS config_change_any_true_rows`,
  ...configChangeFlagColumns.flatMap((column) => [
    `COUNT(*) FILTER (WHERE sh.${column} IS TRUE)::double precision AS ${column}_true_rows`,
    `COUNT(*) FILTER (WHERE sh.${column} IS FALSE)::double precision AS ${column}_false_rows`,
    `COUNT(*) FILTER (WHERE sh.${column} IS NULL)::double precision AS ${column}_unknown_rows`,
  ]),
]

const configChangeAggregateNumericKeys = [
  'config_change_evaluated_rows',
  'config_change_unevaluated_rows',
  'config_change_any_true_rows',
  ...configChangeFlagColumns.flatMap((column) => [
    `${column}_true_rows`,
    `${column}_false_rows`,
    `${column}_unknown_rows`,
  ]),
]

const usageFilteredColumns = [
  'created_at',
  'start_time',
  'end_time',
  'provider',
  'model',
  'tenant_id',
  'litellm_environment',
  'litellm_version',
  'client_name',
  'client_version',
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'reasoning_tokens_reported',
  'reasoning_tokens_estimated',
  'reasoning_tokens_source',
  'provider_cache_attempted',
  'provider_cache_miss',
  'provider_cache_miss_reason',
  'provider_cache_miss_token_count',
  'provider_cache_miss_cost_usd',
  'response_cost_usd',
  'tool_call_count',
  'git_commit_count',
  'git_push_count',
  'litellm_pre_send_ms',
  'litellm_post_response_ms',
  'litellm_processing_ms',
  'llm_upstream_time_to_first_byte_ms',
  'llm_upstream_elapsed_ms',
  'llm_upstream_stream_ms',
  'ttft_ms',
  'total_server_elapsed_ms',
  'latency_unclassified_ms',
  'previous_response_to_current_request_ms',
  'trace_quality_score',
  'response_meaningfulness_score',
  'answer_completeness_score',
  'evidence_fidelity_score',
  'context_retention_score',
  'instruction_adherence_score',
  'read_only_policy_compliance_score',
  'scope_control_score',
  'destructive_action_policy_score',
  'tool_use_validity_score',
  'tool_result_fidelity_score',
  'tool_error_recovery_score',
  'error_attribution_quality_score',
  'output_contract_compliance_score',
  'task_progress_score',
  'repetition_loop_risk_score',
  'stall_risk_score',
  'discovery_inventory_coverage_score',
  'discovery_inventory_missing_count',
  'terminal_completion_score',
  'empty_completion_failure',
  'invalid_tool_call_error',
  'destructive_checkout_after_work',
  'large_tool_result_payload_risk',
  'read_only_policy_violation_count',
  'ignored_path_tracking_policy_score',
  'ignored_path_tracking_violation_count',
  'baseline_deflection_attempted_score',
  'baseline_deflection_incident_score',
  'baseline_deflection_attempt_count',
  'baseline_deflection_tool_call_count',
  'baseline_deflection_input_tokens',
  'baseline_deflection_elapsed_ms',
  'quality_gate_trigger_count',
  'quality_gate_fix_attempt_count',
  'quality_gate_rerun_count',
  'sleep_wellness_interruption_attempted_score',
  'sleep_wellness_interruption_incident_score',
  'sleep_wellness_interruption_count',
  'sleep_wellness_interruption_output_tokens',
  'sleep_wellness_interruption_input_tokens',
  'sleep_wellness_interruption_elapsed_ms',
  'sleep_wellness_interruption_after_user_pushback_count',
  'sleep_wellness_interruption_repeated_count',
  'is_compact_summary',
  'session_id',
  'compact_summary_id',
  'compact_summary_role',
  'compact_summary_source',
  'agent_score_reasons',
  ...configChangeFlagColumns,
]
const usageFilteredColumnSelects = [
  ...usageFilteredColumns.map((column) => `        sh.${column}`),
  "        NULLIF(sh.inbound_model_alias, '') AS inbound_model_alias",
  "        NULLIF(sh.agent_name, '') AS agent_name",
  "        NULLIF(sh.agent_id, '') AS agent_id",
]

function acceptsGzipEncoding(req) {
  const raw = req?.headers?.['accept-encoding']
  if (!raw || typeof raw !== 'string') {
    return false
  }
  return raw.split(',').some((part) => {
    const segments = part.trim().split(';').map((segment) => segment.trim())
    const token = segments[0]?.toLowerCase()
    if (token !== 'gzip') {
      return false
    }
    let quality = 1
    for (let index = 1; index < segments.length; index += 1) {
      const match = segments[index].match(/^q=(.+)$/i)
      if (!match) {
        continue
      }
      const parsed = Number.parseFloat(match[1].trim())
      if (Number.isFinite(parsed)) {
        quality = parsed
      }
      break
    }
    return quality > 0
  })
}

function isHttpResponseCommitted(res) {
  if (!res) return true
  return Boolean(res.headersSent || res.writableEnded || res.destroyed)
}

function logUnhandledRequestError(error) {
  process.stderr.write(
    `[report-service] WARN: unhandled request error: ${formatError(error)}\n`
  )
}

async function respondWithGenericServerError(req, res, error) {
  logUnhandledRequestError(error)
  if (isHttpResponseCommitted(res)) {
    return
  }
  await sendJson(req, res, 500, GENERIC_INTERNAL_SERVER_ERROR_BODY)
}

function resolveBoundedShutdownGraceMs(graceMs = SHUTDOWN_GRACE_MS) {
  const parsed = Number(graceMs)
  if (!Number.isFinite(parsed)) {
    return SHUTDOWN_GRACE_MS
  }
  return Math.max(1_000, Math.min(300_000, Math.floor(parsed)))
}

function scheduleShutdownForceExit(
  server,
  graceMs,
  {
    setTimeoutFn = setTimeout,
    exitFn = (code) => process.exit(code),
  } = {}
) {
  const boundedGraceMs = resolveBoundedShutdownGraceMs(graceMs)
  const timer = setTimeoutFn(() => {
    server?.closeAllConnections?.()
    exitFn(1)
  }, boundedGraceMs)
  if (timer && typeof timer.unref === 'function') {
    timer.unref()
  }
  return { timer, boundedGraceMs }
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeIdleConnections?.()
  })
}

function beginHttpServerShutdown(server, onClosed) {
  server.close(onClosed)
  server.closeIdleConnections?.()
}

async function runBoundedShutdownSequence(
  server,
  {
    graceMs = SHUTDOWN_GRACE_MS,
    runCleanup = async () => {},
    exitFn = (code) => process.exit(code),
    setForceExitTimer = (timer) => {
      shutdownForceExitTimer = timer
    },
    clearForceExitTimer = () => {
      if (shutdownForceExitTimer) {
        clearTimeout(shutdownForceExitTimer)
        shutdownForceExitTimer = null
      }
    },
  } = {}
) {
  const { timer } = scheduleShutdownForceExit(server, graceMs, { exitFn })
  setForceExitTimer(timer)

  try {
    await closeHttpServer(server)
    await runCleanup()
    clearForceExitTimer()
    exitFn(0)
  } catch (error) {
    clearForceExitTimer()
    throw error
  }
}

async function sendJson(req, res, status, body) {
  const payload = JSON.stringify(body)
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }
  if (acceptsGzipEncoding(req)) {
    const compressed = await gzip(Buffer.from(payload, 'utf8'))
    res.writeHead(status, {
      ...headers,
      'content-encoding': 'gzip',
      vary: 'Accept-Encoding',
    })
    res.end(compressed)
    return
  }
  res.writeHead(status, headers)
  res.end(payload)
}

function parseDateParam(value, fallback) {
  if (!value) return fallback()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateOnlyParam(value)
  }
  throw new Error('A valid date=YYYY-MM-DD parameter is required.')
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
function calculateTokenTrendRangeDays(searchParams) {
  const fromDate = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const toDate = parseSearchDateOnly(searchParams.get('to'), defaultToDate)
  const fromMs = new Date(`${fromDate}T00:00:00.000Z`).getTime()
  const toMs = new Date(`${toDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return 0
  }
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)))
}

function defaultFromDate() {
  return addDaysToDateString(formatDashboardDate(new Date()), -6)
}

function defaultToDate() {
  return resolveDefaultToDateString()
}

// The report API treats `to` as an exclusive dashboard-date upper bound.
// Omitting it means "through today" by using tomorrow in America/New_York.
export function resolveDefaultToDateString(referenceDate = new Date()) {
  return addDaysToDateString(formatDashboardDate(referenceDate), 1)
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
    .map((item) => {
      const trimmed = item.trim()
      if (!trimmed) return ''
      try {
        return decodeURIComponent(trimmed)
      } catch {
        return trimmed
      }
    })
    .filter(Boolean)
}

function parseLimit(value) {
  const parsed = Number(value ?? 200)
  if (!Number.isFinite(parsed) || parsed < 1) return 200
  return Math.min(Math.floor(parsed), MAX_LIMIT)
}

function parseSessionDiagnosticsLimit(value) {
  const parsed = Number(value ?? 100)
  if (!Number.isFinite(parsed) || parsed < 1) return 100
  return Math.min(Math.floor(parsed), MAX_SESSION_DIAGNOSTICS_ROWS)
}

function sessionDiagnosticsCandidateLimit(limit) {
  return Math.min(
    Math.max(
      limit * SESSION_DIAGNOSTICS_CANDIDATE_MULTIPLIER,
      MIN_SESSION_DIAGNOSTICS_CANDIDATE_ROWS
    ),
    MAX_SESSION_DIAGNOSTICS_CANDIDATE_ROWS
  )
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

function configChangeFilterClause(column, value) {
  switch (value.toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
      return `${column} IS TRUE`
    case 'false':
    case '0':
    case 'no':
      return `${column} IS FALSE`
    case 'null':
    case 'unknown':
    case 'unevaluated':
      return `${column} IS NULL`
    case 'evaluated':
      return `${column} IS NOT NULL`
    default:
      throw new Error(
        `Unsupported config-change filter value: ${value}. ` +
          'Use true, false, null, evaluated, or unevaluated.'
      )
  }
}

function appendConfigChangeFilters(searchParams, whereParts) {
  for (const [key, column] of Object.entries(configChangeFilterColumns)) {
    const selected = parseCsv(searchParams.get(key))
    if (!selected.length) continue

    const clauses = [
      ...new Set(selected.map((value) => configChangeFilterClause(column, value))),
    ]
    whereParts.push(`(${clauses.join(' OR ')})`)
  }
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

const normalizeRowNumericKeys = [
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
    ...configChangeAggregateNumericKeys,
]

function normalizeRow(row) {
  const normalized = { ...row }
  for (const key of normalizeRowNumericKeys) {
    normalized[key] = normalizeNumber(normalized[key])
  }
  normalized.agent_score_reasons_bounded_min_id = normalizeNumber(
    normalized.agent_score_reasons_bounded_min_id
  )
  normalized.agent_score_reasons_bounded_max_id = normalizeNumber(
    normalized.agent_score_reasons_bounded_max_id
  )
  normalized.agent_score_reasons_recent_row_limit =
    normalizeNumber(normalized.agent_score_reasons_recent_row_limit) ??
    AGENT_SCORE_REASON_RECENT_ROW_LIMIT
  if (normalized.agent_score_reasons_recent_id_cap_active == null) {
    normalized.agent_score_reasons_recent_id_cap_active = true
  }
  if (normalized.agent_score_reasons_recent_id_cap_truncates_requested_window == null) {
    normalized.agent_score_reasons_recent_id_cap_truncates_requested_window = false
  }
  return normalized
}

function buildFilteredWhere(searchParams, options = {}) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = options.values ?? []
  const whereParts = []
  const excludedFilterKeys = new Set(options.excludeFilterKeys ?? [])

  if (options.includeDateRange !== false) {
    appendStartTimeDateRangeWhere(whereParts, values, from, to)
  }
  if (options.fastUsageSignal) {
    appendFastUsageSignalWhere(whereParts)
  } else {
    appendReportableSessionHistoryWhere(whereParts)
  }

  for (const key of Object.keys(filterColumns)) {
    if (excludedFilterKeys.has(key)) continue
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }
  appendConfigChangeFilters(searchParams, whereParts)

  return { from, to, values, whereParts }
}

function appendSessionDiagnosticsFilter(searchParams, key, whereParts, values) {
  const selected = parseCsv(searchParams.get(key))
  if (!selected.length) return

  const column =
    key === 'client'
      ? "COALESCE(sh.client_name, 'unknown')"
      : key === 'environment'
        ? "COALESCE(sh.litellm_environment, 'unknown')"
        : filterColumns[key]
  values.push(selected)
  whereParts.push(`${column} = ANY($${values.length}::text[])`)
}


function grokSideChannelMetadataPresentClause(columnPrefix = 'sh.') {
  const p = columnPrefix
  return `(
    lower(COALESCE(${p}metadata->>'grok_side_channel', '')) = 'true'
    OR ${p}metadata->>'grok_side_channel_endpoint_type' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_endpoint_path_template' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_request_content_type' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_request_body_byte_length' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_request_body_sha256' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_request_body_digest_source' IS NOT NULL
    OR ${p}metadata->>'grok_side_channel_request_json_container_type' IS NOT NULL
    OR ${p}metadata ? 'grok_side_channel_request_top_level_key_types'
    OR ${p}metadata->>'grok_side_channel_request_array_length' IS NOT NULL
  )`
}

function appendGrokSideChannelDiagnosticsFilters(searchParams, whereParts, values) {
  const grokSideChannel = parseCsv(searchParams.get('grok_side_channel'))
  if (
    grokSideChannel.some((value) =>
      ['true', '1', 'yes'].includes(value.toLowerCase())
    )
  ) {
    whereParts.push(grokSideChannelMetadataPresentClause('sh.'))
  }

  const endpointTypes = parseCsv(
    searchParams.get('grok_side_channel_endpoint_type')
  )
  if (endpointTypes.length) {
    values.push(endpointTypes)
    whereParts.push(
      `sh.metadata->>'grok_side_channel_endpoint_type' = ANY($${values.length}::text[])`
    )
  }
}

function sessionDiagnosticsMetadataPresentClause(columnPrefix = '') {
  const p = columnPrefix
  return `(
    ${p}metadata->>'credential_family' IS NOT NULL
    OR ${p}metadata->>'grok_native_oauth_managed' IS NOT NULL
    OR ${p}metadata->>'grok_native_entrypoint' IS NOT NULL
    OR ${p}metadata->>'usage_output_contract_required_final_phrase' IS NOT NULL
    OR ${p}metadata->>'usage_output_contract_required_final_phrase_present' IS NOT NULL
    OR ${p}metadata->>'usage_output_contract_failure_class' IS NOT NULL
    OR ${p}metadata->>'usage_output_contract_setup_only_detected' IS NOT NULL
    OR ${p}metadata->>'aawm_tool_definition_capture_version' IS NOT NULL
    OR ${p}metadata->>'aawm_tool_definition_snapshot_hash' IS NOT NULL
    OR ${p}metadata->>'aawm_tool_definition_snapshot' IS NOT NULL
    OR ${p}metadata->>'xai_responses_request_sanitized' IS NOT NULL
    OR ${p}metadata->>'xai_responses_sanitized_removed_params' IS NOT NULL
    OR ${p}metadata->>'xai_responses_sanitized_tool_count' IS NOT NULL
    OR ${p}metadata->>'xai_responses_sanitized_tool_types' IS NOT NULL
    OR ${p}metadata->>'xai_tool_choice_without_tools_removed' IS NOT NULL
    OR ${p}metadata->>'xai_tool_choice_without_tools_removed_reason' IS NOT NULL
    OR ${p}metadata->>'session_history_transcript_attribution_status' IS NOT NULL
    OR ${p}metadata->>'session_history_transcript_attribution_source' IS NOT NULL
    OR ${p}metadata->>'session_history_transcript_attribution' IS NOT NULL
    OR ${p}metadata->>'aawm_alias_routing_audit_events' IS NOT NULL
    OR ${p}metadata->>'codex_auto_agent_audit_events' IS NOT NULL
    OR ${p}metadata->>'anthropic_auto_agent_audit_events' IS NOT NULL
    OR ${p}metadata->>'anthropic_context_window_mode' IS NOT NULL
    OR ${p}metadata->>'anthropic_context_window_requested_tokens' IS NOT NULL
    OR ${p}metadata->>'anthropic_context_window_source' IS NOT NULL
    OR ${p}metadata->>'anthropic_context_window_beta' IS NOT NULL
    OR ${p}metadata->>'anthropic_context_window_classification' IS NOT NULL
    OR ${grokSideChannelMetadataPresentClause(p)}
  )`
}

function buildSessionDiagnosticsWhere(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = []
  const whereParts = []

  appendCreatedAtDateRangeWhere(whereParts, values, from, to)
  for (const key of ['provider', 'model', 'repository', 'client', 'environment']) {
    appendSessionDiagnosticsFilter(searchParams, key, whereParts, values)
  }

  for (const key of ['session_id', 'trace_id', 'litellm_call_id']) {
    const selected = parseCsv(searchParams.get(key))
    if (!selected.length) continue
    values.push(selected)
    if (key === 'session_id') {
      whereParts.push(`sh.session_id::text = ANY($${values.length}::text[])`)
    } else if (key === 'litellm_call_id') {
      whereParts.push(`sh.litellm_call_id::text = ANY($${values.length}::text[])`)
    } else {
      whereParts.push(`NULLIF(sh.trace_id, '') = ANY($${values.length}::text[])`)
    }
  }

  appendGrokSideChannelDiagnosticsFilters(searchParams, whereParts, values)

  return { from, to, values, whereParts }
}

function buildTokenTrendFilteredWhere(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = []
  const whereParts = []

  appendCreatedAtDateRangeWhere(whereParts, values, from, to)
  appendReportableSessionHistoryWhere(whereParts)

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }
  appendConfigChangeFilters(searchParams, whereParts)

  return { from, to, values, whereParts }
}

function buildSummaryQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams, {
    fastUsageSignal: true,
  })

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
    ${configChangeAggregateSelectParts.join(',\n    ')},
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

  const { values, whereParts } = buildFilteredWhere(searchParams, {
    fastUsageSignal: true,
  })
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
  ...buildAgentPassScoreSelects('discovery_inventory_coverage', [
    'discovery_inventory_coverage_score',
  ]),
  ...buildAgentPassScoreSelects('terminal_completion', [
    'terminal_completion_score',
  ]),
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
  'AVG(sh.sleep_wellness_interruption_attempted_score)::double precision AS agent_sleep_wellness_interruption_attempted_score',
  'COUNT(sh.sleep_wellness_interruption_attempted_score)::double precision AS agent_sleep_wellness_interruption_attempted_evaluated',
  'COUNT(*) FILTER (WHERE sh.sleep_wellness_interruption_attempted_score = 1)::double precision AS agent_sleep_wellness_interruption_attempted_incidents',
  'AVG(sh.sleep_wellness_interruption_incident_score)::double precision AS agent_sleep_wellness_interruption_incident_score',
  'COUNT(sh.sleep_wellness_interruption_incident_score)::double precision AS agent_sleep_wellness_interruption_incident_evaluated',
  'COUNT(*) FILTER (WHERE sh.sleep_wellness_interruption_incident_score = 1)::double precision AS agent_sleep_wellness_interruption_incidents',
]

const tokenTrendScoreSourceColumns = [
  ...Object.values(agentPassScoreFamilies).flat(),
  ...agentRiskScoreColumns,
  'discovery_inventory_coverage_score',
  'terminal_completion_score',
  'ignored_path_tracking_policy_score',
  'baseline_deflection_attempted_score',
  'baseline_deflection_incident_score',
  'sleep_wellness_interruption_attempted_score',
  'sleep_wellness_interruption_incident_score',
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
  const { values, whereParts } = buildTokenTrendFilteredWhere(searchParams)
  const modelExpression = "COALESCE(NULLIF(sh.model, ''), 'unknown')"
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
ORDER BY
    first_seen_at ASC,
    provider ASC,
    model ASC;
`

  return { sql, values }
}

export function buildTokenTrendDayDetailQuery(searchParams) {
  const date = parseDateOnlyParam(searchParams.get('date'))
  const { from, to, values, whereParts } = buildTokenTrendFilteredWhere(searchParams)
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
  const { values, whereParts } = buildFilteredWhere(searchParams, {
    fastUsageSignal: true,
  })
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
      AND ${sessionHistoryReportablePredicate()}
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
  const { values, whereParts } = buildFilteredWhere(searchParams, {
    fastUsageSignal: true,
  })
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
    ${fastUsageLatencyMetricSelectParts.join(',\n    ')},
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

const rateLimitProviderDimension = providerDimensionExpression('ri.provider', {
  includeAntigravity: true,
})
const rateLimitRangeProviderDimension = providerDimensionExpression('ri.provider')

const XAI_GROK_BUILD_WEEKLY_CREDITS_KEY = 'xai_grok_build_weekly_credits:credits'
const XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY = 'xai_grok_build_monthly_requests:requests'

const RATE_LIMIT_NORMALIZED_MODEL_CASE = `
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'antigravity'
              AND ri.quota_key IN (
                  'antigravity_code_assist:gemini_pool',
                  'antigravity_code_assist:vertex_pool'
              )
            THEN ri.quota_key
            WHEN ri.quota_key IN (
                  '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}',
                  '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}'
              )
            THEN ri.quota_key
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END`

const RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE = `
        CASE
            WHEN ri.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'weekly'
            WHEN ri.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'monthly'
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
        END`

const QUOTA_KEY_INTERVAL_QUOTA_TYPES_SQL =
  "('weekly', 'weekly_overage_included', 'weekly_special', 'short', 'short_special', 'requests', 'monthly', 'wtus')"
const QUOTA_LANE_TYPES = [
  'weekly',
  'weekly_overage_included',
  'short',
  'special',
  'short_special',
  'monthly',
  'wtus',
]

function buildQuotaLaneAggregateSelectSql() {
  return QUOTA_LANE_TYPES.map((quotaType) => {
    const predicate = `s.quota_type = '${quotaType}'`
    return [
      `    MAX(s.remaining_pct) FILTER (WHERE ${predicate})::double precision AS ${quotaType}_remaining_pct`,
      `    MAX(s.expected_reset_at) FILTER (WHERE ${predicate}) AS ${quotaType}_reset_at`,
      `    MAX(s.interval_start) FILTER (WHERE ${predicate}) AS ${quotaType}_interval_start`,
      `    MAX(s.interval_end) FILTER (WHERE ${predicate}) AS ${quotaType}_interval_end`,
      `    MAX(s.active::int) FILTER (WHERE ${predicate})::double precision AS ${quotaType}_active`,
      `    0::double precision AS ${quotaType}_usage_tokens`,
      `    '[]'::jsonb AS ${quotaType}_usage_breakdown`,
      `    MAX(billing.quota_limit) FILTER (WHERE ${predicate})::double precision AS ${quotaType}_quota_limit`,
      `    MAX(billing.quota_used) FILTER (WHERE ${predicate})::double precision AS ${quotaType}_quota_used`,
      `    MAX(billing.quota_remaining) FILTER (WHERE ${predicate})::double precision AS ${quotaType}_quota_remaining`,
      `    MAX(billing.billing_observed_at) FILTER (WHERE ${predicate}) AS ${quotaType}_billing_observed_at`,
      `    MAX(billing.billing_period_start_at) FILTER (WHERE ${predicate}) AS ${quotaType}_billing_period_start_at`,
      `    MAX(billing.billing_period_end_at) FILTER (WHERE ${predicate}) AS ${quotaType}_billing_period_end_at`,
      `    MAX(billing.quota_key) FILTER (WHERE ${predicate}) AS ${quotaType}_quota_key`,
      `    MAX(billing.source) FILTER (WHERE ${predicate}) AS ${quotaType}_source`,
      `    MAX(billing.client) FILTER (WHERE ${predicate}) AS ${quotaType}_client`,
      `    MAX(billing.quota_unit) FILTER (WHERE ${predicate}) AS ${quotaType}_quota_unit`,
      `    (ARRAY_AGG(billing.raw_provider_fields) FILTER (WHERE ${predicate}))[1] AS ${quotaType}_raw_provider_fields`,
      `    (ARRAY_AGG(billing.evidence) FILTER (WHERE ${predicate}))[1] AS ${quotaType}_evidence`,
    ].join(',\n')
  }).join(',\n\n')
}

function buildQuotaKeyIntervalHoursCteSql({ requireQuotaKey = false } = {}) {
  const quotaKeyFilter = requireQuotaKey
    ? `
          AND quota_key IS NOT NULL`
    : ''
  return `
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
        WHERE quota_type IN ${QUOTA_KEY_INTERVAL_QUOTA_TYPES_SQL}
          AND expected_reset_at IS NOT NULL${quotaKeyFilter}
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
),`
}

function quotaObservationIntervalBoundsSql(intervalStartExpr, expectedResetExpr) {
  return `
     AND o.observed_at >= ${intervalStartExpr} - INTERVAL '5 minutes'
     AND o.observed_at <= ${expectedResetExpr} + INTERVAL '5 minutes'`
}

export function buildQuotaQuery() {
  const sql = `
WITH normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ri.quota_type AS raw_quota_type,
        ri.quota_key,
        ${rateLimitProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        CASE
            WHEN ri.fromDate <= now() AND ri.toDate > now() THEN true
            ELSE false
        END AS active
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'short', 'weekly_special', 'short_special', 'requests', 'monthly', 'wtus')
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
        'weekly_special' AS raw_quota_type,
        NULL::text AS quota_key,
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
        short.raw_provider,
        'short_special' AS raw_quota_type,
        NULL::text AS quota_key,
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
billing_by_type AS (
    SELECT DISTINCT ON (s.provider, COALESCE(s.model, ''), s.quota_type)
        s.provider,
        s.model,
        s.quota_type,
        s.quota_key,
        NULLIF(TRIM(BOTH FROM COALESCE(o.source, '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(o.client, '')), '') AS client,
        CASE
            WHEN s.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'credits'
            WHEN s.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'requests'
            WHEN s.quota_key LIKE '%:credits' THEN 'credits'
            WHEN s.quota_key LIKE '%:requests' THEN 'requests'
            ELSE NULL
        END AS quota_unit,
        o.observed_at AS billing_observed_at,
        o.quota_limit AS quota_limit,
        o.quota_used AS quota_used,
        o.quota_remaining AS quota_remaining,
        o.billing_period_start_at AS billing_period_start_at,
        o.billing_period_end_at AS billing_period_end_at,
        COALESCE(o.raw_provider_fields, '{}'::jsonb) AS raw_provider_fields,
        COALESCE(o.evidence, '{}'::jsonb) AS evidence
    FROM selected_with_fallbacks s
    JOIN public.rate_limit_observations o
      ON o.provider = s.raw_provider
     AND o.quota_key IS NOT DISTINCT FROM s.quota_key
     AND (
          s.expected_reset_at IS NULL
          OR o.expected_reset_at IS NOT DISTINCT FROM s.expected_reset_at
     )
    WHERE s.quota_key IS NOT NULL
      AND o.observed_at IS NOT NULL
      AND (
          s.expected_reset_at IS NULL
          OR s.interval_start IS NULL
          OR (
              o.observed_at >= s.interval_start - INTERVAL '5 minutes'
              AND o.observed_at <= s.expected_reset_at + INTERVAL '5 minutes'
          )
      )
    ORDER BY
        s.provider,
        COALESCE(s.model, ''),
        s.quota_type,
        o.observed_at DESC
)
SELECT
    s.provider,
    s.model,
${buildQuotaLaneAggregateSelectSql()}
FROM selected_with_fallbacks s
LEFT JOIN billing_by_type billing
  ON billing.provider = s.provider
 AND billing.model IS NOT DISTINCT FROM s.model
 AND billing.quota_type = s.quota_type
GROUP BY s.provider, s.model
ORDER BY s.provider ASC, s.model ASC NULLS FIRST;
`

  return { sql, values: [] }
}


export function buildQuotaVelocityQuery() {
  const sql = `
WITH
${buildQuotaKeyIntervalHoursCteSql({ requireQuotaKey: true })}
normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ${rateLimitProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
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
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'short', 'weekly_special', 'short_special', 'requests', 'monthly', 'wtus')
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
                WHEN s.provider = 'antigravity' AND s.raw_quota_type = 'wtus' THEN 5.0
                WHEN s.quota_type = 'monthly' THEN 720.0
                WHEN s.quota_type IN ('short', 'short_special') THEN 5.0
                WHEN s.quota_type IN ('weekly', 'weekly_overage_included', 'special') THEN 168.0
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
     AND o.observed_at >= s.interval_start - INTERVAL '5 minutes'
     AND o.observed_at <= s.expected_reset_at + INTERVAL '5 minutes'
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

export function buildQuotaHistoryQuery(_searchParams) {
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
${buildQuotaKeyIntervalHoursCteSql()}
normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ri.quota_type AS raw_quota_type,
        ri.quota_key,
        ${rateLimitProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
        ri.quota_key AS normalized_quota_key,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'source', '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'client', '')), '') AS client,
        CASE
            WHEN ri.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'credits'
            WHEN ri.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'requests'
            WHEN ri.quota_key LIKE '%:credits' THEN 'credits'
            WHEN ri.quota_key LIKE '%:requests' THEN 'requests'
            ELSE NULL
        END AS quota_unit,
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
        LEAST(
            GREATEST(
                COALESCE(
                    CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                    CASE
                        WHEN ri.quota_type = 'requests'
                          AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                          AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                        THEN 24.0
                        WHEN ri.quota_type = 'wtus' THEN 5.0
                        WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                        WHEN ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special') THEN 168.0
                        WHEN ri.quota_type = 'requests'
                          AND (
                              lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                              OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                          )
                        THEN 720.0
                        WHEN ri.quota_type = 'monthly'                    THEN 720.0
                        ELSE                                                   168.0
                    END
                ),
                1.0
            ),
            ${QUOTA_HISTORY_MAX_LOOKBACK_DAYS} * 24.0
        ) AS interval_hours
    FROM public.rate_limit_intervals ri
    LEFT JOIN quota_key_interval_hours kh
           ON kh.provider  = ri.provider
          AND kh.quota_key = ri.quota_key
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special', 'short', 'short_special', 'requests', 'monthly', 'wtus')
      AND ri.expected_reset_at IS NOT NULL
),
scoped_normalized AS (
    SELECT
        n.*
    FROM normalized n
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
    WHERE n.expected_reset_at >= now() - (n.interval_hours * 1.5 * INTERVAL '1 hour')
      AND n.expected_reset_at < now() + (
              LEAST(n.interval_hours * 2.0, ${QUOTA_HISTORY_MAX_UPPER_HOURS}::double precision)
              * INTERVAL '1 hour'
          )
),
bounded_normalized AS (
    SELECT
        n.*,
        ROW_NUMBER() OVER (
            PARTITION BY n.provider, COALESCE(n.model, ''), n.quota_type, COALESCE(n.normalized_quota_key, '')
            ORDER BY n.expected_reset_at DESC
        ) AS interval_rank
    FROM scoped_normalized n
),
observation_identity AS (
    SELECT DISTINCT ON (n.raw_provider, n.quota_key, n.expected_reset_at)
        n.raw_provider,
        n.quota_key,
        n.expected_reset_at,
        NULLIF(TRIM(BOTH FROM COALESCE(o.source, '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(o.client, '')), '') AS client
    FROM bounded_normalized n
    JOIN public.rate_limit_observations o
      ON n.quota_key IS NOT NULL
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.observed_at IS NOT NULL${quotaObservationIntervalBoundsSql('n.interval_start', 'n.expected_reset_at')}
    WHERE n.interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
    ORDER BY n.raw_provider, n.quota_key, n.expected_reset_at, o.observed_at DESC
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
    FROM bounded_normalized n
    JOIN public.rate_limit_observations o
      ON n.quota_key IS NOT NULL
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.remaining_pct IS NOT NULL
     AND o.remaining_pct >= 0
     AND o.observed_at IS NOT NULL${quotaObservationIntervalBoundsSql('n.interval_start', 'n.expected_reset_at')}
     AND n.interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
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
        FROM bounded_normalized
       WHERE interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
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
        n.provider,
        n.model,
        n.quota_type,
        MAX(n.normalized_quota_key) AS quota_key,
        COALESCE(MAX(n.source), MAX(oi.source)) AS source,
        COALESCE(MAX(n.client), MAX(oi.client)) AS client,
        MAX(n.quota_unit) AS quota_unit,
        n.expected_reset_at,
        MIN(n.interval_start) AS interval_start,
        MIN(n.remaining_pct)::double precision AS min_remaining_pct,
        MAX(n.remaining_pct)::double precision AS max_remaining_pct
    FROM bounded_normalized n
    LEFT JOIN observation_identity oi
           ON oi.raw_provider = n.raw_provider
          AND oi.quota_key = n.quota_key
          AND oi.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
   WHERE n.interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
    GROUP BY n.provider, n.model, n.quota_type, n.expected_reset_at
),
recent_traces_90m AS (
    SELECT
        ${providerDimensionRecent} AS provider,
        COALESCE(sh_recent.model, 'unknown') AS sh_model,
        COUNT(*)::double precision AS recent_traces_90m
    FROM public.session_history sh_recent
    WHERE COALESCE(sh_recent.start_time, sh_recent.created_at) >= now() - INTERVAL '90 minutes'
      AND COALESCE(sh_recent.start_time, sh_recent.created_at) < now()
      AND ${sessionHistoryReportablePredicate('sh_recent')}
    GROUP BY ${providerDimensionRecent}, COALESCE(sh_recent.model, 'unknown')
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
        COALESCE(recent.recent_traces_90m, 0)::double precision AS recent_traces_90m
    FROM window_bounds wb
    JOIN public.session_history sh
      ON wb.provider <> 'antigravity'
     AND ${providerDimensionForAlias('sh', { includeAntigravity: true })} = wb.provider
      -- Wave 35-C2 (⚠-7): use start_time (with created_at fallback) to match
      -- the live quota query (buildQuotaQuery), which also anchors on
      -- sh.start_time. Using created_at here caused sessions near quota-reset
      -- boundaries to appear in the wrong historical interval because
      -- created_at (record persistence time) can lag start_time by minutes.
      AND COALESCE(sh.start_time, sh.created_at) >= wb.interval_start
      AND COALESCE(sh.start_time, sh.created_at) < wb.expected_reset_at
      AND ${sessionHistoryReportablePredicate()}
      AND (wb.model IS NULL OR sh.model = wb.model)
    LEFT JOIN recent_traces_90m recent
      ON recent.provider = wb.provider
     AND recent.sh_model = COALESCE(sh.model, 'unknown')
     AND (wb.model IS NULL OR recent.sh_model = wb.model)
    GROUP BY wb.provider, wb.model, wb.quota_type, wb.expected_reset_at, COALESCE(sh.model, 'unknown'), recent.recent_traces_90m
)
SELECT
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.quota_key,
    wb.source,
    wb.client,
    wb.quota_unit,
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
    wb.quota_key,
    wb.source,
    wb.client,
    wb.quota_unit,
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

export function buildQuotaHistoryFallbackQuery(_searchParams) {
  const sql = `
WITH
${buildQuotaKeyIntervalHoursCteSql()}
normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ri.quota_type AS raw_quota_type,
        ri.quota_key,
        ${rateLimitProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
        ri.quota_key AS normalized_quota_key,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'source', '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'client', '')), '') AS client,
        CASE
            WHEN ri.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'credits'
            WHEN ri.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'requests'
            WHEN ri.quota_key LIKE '%:credits' THEN 'credits'
            WHEN ri.quota_key LIKE '%:requests' THEN 'requests'
            ELSE NULL
        END AS quota_unit,
        ri.expected_reset_at,
        ri.fromDate AS interval_start,
        LEAST(
            GREATEST(
                COALESCE(
                    CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                    CASE
                        WHEN ri.quota_type = 'requests'
                          AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                          AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                        THEN 24.0
                        WHEN ri.quota_type = 'wtus' THEN 5.0
                        WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                        WHEN ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special') THEN 168.0
                        WHEN ri.quota_type = 'requests'
                          AND (
                              lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                              OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                          )
                        THEN 720.0
                        WHEN ri.quota_type = 'monthly'                    THEN 720.0
                        ELSE                                                   168.0
                    END
                ),
                1.0
            ),
            ${QUOTA_HISTORY_MAX_LOOKBACK_DAYS} * 24.0
        ) AS interval_hours,
        LEAST(
            COALESCE(
                ri.remaining_pct,
                100
            ),
            100
        ) AS remaining_pct
    FROM public.rate_limit_intervals ri
    LEFT JOIN quota_key_interval_hours kh
           ON kh.provider  = ri.provider
          AND kh.quota_key = ri.quota_key
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special', 'short', 'short_special', 'requests', 'monthly', 'wtus')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.expected_reset_at >= now() - (
            LEAST(
                GREATEST(
                    COALESCE(
                        CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                        CASE
                            WHEN ri.quota_type = 'requests'
                              AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                              AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                            THEN 24.0
                            WHEN ri.quota_type = 'wtus' THEN 5.0
                            WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                            WHEN ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special') THEN 168.0
                            WHEN ri.quota_type = 'requests'
                              AND (
                                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                              )
                            THEN 720.0
                            WHEN ri.quota_type = 'monthly'                    THEN 720.0
                            ELSE                                                   168.0
                        END
                    ),
                    1.0
                ),
                ${QUOTA_HISTORY_MAX_LOOKBACK_DAYS} * 24.0
            ) * 1.5 * INTERVAL '1 hour'
        )
      AND ri.expected_reset_at < now() + (
            LEAST(
                LEAST(
                    GREATEST(
                        COALESCE(
                            CASE WHEN kh.gap_count >= 2 THEN kh.interval_hours END,
                            CASE
                                WHEN ri.quota_type = 'requests'
                                  AND lower(COALESCE(ri.provider, 'unknown')) NOT LIKE 'xai/%'
                                  AND lower(COALESCE(ri.provider, 'unknown')) NOT IN ('xai', 'x.ai')
                                THEN 24.0
                                WHEN ri.quota_type = 'wtus' THEN 5.0
                                WHEN ri.quota_type IN ('short', 'short_special') THEN 5.0
                                WHEN ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special') THEN 168.0
                                WHEN ri.quota_type = 'requests'
                                  AND (
                                      lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                                      OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
                                  )
                                THEN 720.0
                                WHEN ri.quota_type = 'monthly'                    THEN 720.0
                                ELSE                                                   168.0
                            END
                        ),
                        1.0
                    ),
                    ${QUOTA_HISTORY_MAX_LOOKBACK_DAYS} * 24.0
                ),
                ${QUOTA_HISTORY_MAX_UPPER_HOURS}::double precision
            ) * 2.0 * INTERVAL '1 hour'
        )
),
scoped_intervals AS (
    SELECT
        raw_provider,
        provider,
        model,
        quota_type,
        normalized_quota_key,
        source,
        client,
        quota_unit,
        expected_reset_at,
        interval_start,
        remaining_pct,
        interval_hours,
        ROW_NUMBER() OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type, COALESCE(normalized_quota_key, '')
            ORDER BY expected_reset_at DESC
    ) AS interval_rank
    FROM normalized
),
observation_identity AS (
    SELECT DISTINCT ON (n.raw_provider, n.normalized_quota_key, n.expected_reset_at)
        n.raw_provider,
        n.normalized_quota_key,
        n.expected_reset_at,
        NULLIF(TRIM(BOTH FROM COALESCE(o.source, '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(o.client, '')), '') AS client
    FROM scoped_intervals n
    JOIN public.rate_limit_observations o
      ON n.normalized_quota_key IN (
          '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}',
          '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}'
      )
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.normalized_quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.observed_at IS NOT NULL${quotaObservationIntervalBoundsSql('n.interval_start', 'n.expected_reset_at')}
    WHERE n.interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
    ORDER BY n.raw_provider, n.normalized_quota_key, n.expected_reset_at, o.observed_at DESC
),
bounded_intervals AS (
    SELECT
        n.provider,
        n.model,
        n.quota_type,
        MAX(n.normalized_quota_key) AS quota_key,
        COALESCE(MAX(n.source), MAX(oi.source)) AS source,
        COALESCE(MAX(n.client), MAX(oi.client)) AS client,
        MAX(n.quota_unit) AS quota_unit,
        n.expected_reset_at,
        MIN(n.interval_start) AS interval_start,
        MIN(n.remaining_pct)::double precision AS min_remaining_pct,
        MAX(n.remaining_pct)::double precision AS max_remaining_pct
    FROM scoped_intervals n
    LEFT JOIN observation_identity oi
           ON oi.raw_provider = n.raw_provider
          AND oi.normalized_quota_key = n.normalized_quota_key
          AND oi.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
    WHERE n.interval_rank <= ${QUOTA_HISTORY_MAX_INTERVALS_PER_LANE}
    GROUP BY n.provider, n.model, n.quota_type, n.expected_reset_at
)
SELECT
    provider,
    model,
    quota_type,
    quota_key,
    source,
    client,
    quota_unit,
    expected_reset_at,
    interval_start,
    expected_reset_at AS interval_end,
    min_remaining_pct,
    max_remaining_pct,
    0::double precision AS velocity_sample_count,
    '[]'::jsonb AS velocity_segments,
    '[]'::jsonb AS velocity_scores,
    0::double precision AS usage_tokens,
    '[]'::json AS usage_breakdown
FROM bounded_intervals
ORDER BY provider ASC, expected_reset_at DESC, quota_type ASC;
`

  return { sql, values: [] }
}

export function buildQuotaRangeHistoryFallbackQuery(searchParams) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)

  const sql = `
WITH normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ${rateLimitProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
        ri.quota_key AS normalized_quota_key,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'source', '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'client', '')), '') AS client,
        CASE
            WHEN ri.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'credits'
            WHEN ri.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'requests'
            WHEN ri.quota_key LIKE '%:credits' THEN 'credits'
            WHEN ri.quota_key LIKE '%:requests' THEN 'requests'
            ELSE NULL
        END AS quota_unit,
        ri.expected_reset_at,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special', 'short', 'short_special', 'requests', 'monthly', 'wtus')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.fromDate < ($2::date::timestamp AT TIME ZONE 'America/New_York')
      AND ri.expected_reset_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
      AND NOT (
          ri.quota_type IN ('short', 'short_special')
          AND (
              lower(COALESCE(ri.provider, 'unknown')) IN ('openai', 'anthropic', 'claude')
              OR lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%'
              OR lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%'
          )
      )
),
observation_identity AS (
    SELECT DISTINCT ON (n.raw_provider, n.normalized_quota_key, n.expected_reset_at)
        n.raw_provider,
        n.normalized_quota_key,
        n.expected_reset_at,
        NULLIF(TRIM(BOTH FROM COALESCE(o.source, '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(o.client, '')), '') AS client
    FROM normalized n
    JOIN public.rate_limit_observations o
      ON n.normalized_quota_key IN (
          '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}',
          '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}'
      )
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.normalized_quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.observed_at IS NOT NULL${quotaObservationIntervalBoundsSql('n.interval_start', 'n.expected_reset_at')}
    ORDER BY n.raw_provider, n.normalized_quota_key, n.expected_reset_at, o.observed_at DESC
),
window_bounds AS (
    SELECT
        n.provider,
        n.model,
        n.quota_type,
        MAX(n.normalized_quota_key) AS quota_key,
        COALESCE(MAX(n.source), MAX(oi.source)) AS source,
        COALESCE(MAX(n.client), MAX(oi.client)) AS client,
        MAX(n.quota_unit) AS quota_unit,
        n.expected_reset_at,
        MIN(n.interval_start) AS interval_start,
        MAX(n.interval_end) AS interval_end,
        MIN(n.remaining_pct)::double precision AS min_remaining_pct,
        MAX(n.remaining_pct)::double precision AS max_remaining_pct
    FROM normalized n
    LEFT JOIN observation_identity oi
           ON oi.raw_provider = n.raw_provider
          AND oi.normalized_quota_key = n.normalized_quota_key
          AND oi.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
    GROUP BY n.provider, n.model, n.quota_type, n.expected_reset_at
)
SELECT
    provider,
    model,
    quota_type,
    quota_key,
    source,
    client,
    quota_unit,
    expected_reset_at,
    interval_start,
    interval_end,
    min_remaining_pct,
    max_remaining_pct,
    0::double precision AS velocity_sample_count,
    '[]'::jsonb AS velocity_segments,
    '[]'::jsonb AS velocity_scores,
    0::double precision AS usage_tokens,
    '[]'::json AS usage_breakdown
FROM window_bounds
ORDER BY provider ASC, expected_reset_at DESC, quota_type ASC;
`

  return { sql, values: [from, to] }
}

export function buildQuotaRangeHistoryQuery(searchParams) {
  const from = parseSearchDateOnly(searchParams.get('from'), defaultFromDate)
  const to = parseSearchDateOnly(searchParams.get('to'), defaultToDate)

  const sql = `
WITH normalized AS (
    SELECT
        ri.provider AS raw_provider,
        ${rateLimitRangeProviderDimension} AS provider,
        ${RATE_LIMIT_NORMALIZED_MODEL_CASE} AS model,
        ${RATE_LIMIT_NORMALIZED_QUOTA_TYPE_CASE} AS quota_type,
        ri.quota_key AS normalized_quota_key,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'source', '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'client', '')), '') AS client,
        CASE
            WHEN ri.quota_key = '${XAI_GROK_BUILD_WEEKLY_CREDITS_KEY}' THEN 'credits'
            WHEN ri.quota_key = '${XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY}' THEN 'requests'
            WHEN ri.quota_key LIKE '%:credits' THEN 'credits'
            WHEN ri.quota_key LIKE '%:requests' THEN 'requests'
            ELSE NULL
        END AS quota_unit,
        ri.expected_reset_at,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'weekly_overage_included', 'weekly_special', 'short', 'short_special', 'requests', 'monthly', 'wtus')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.fromDate < ($2::date::timestamp AT TIME ZONE 'America/New_York')
      AND ri.expected_reset_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
      -- The Quota tab intentionally hides OpenAI/Anthropic 5-hour history
      -- lanes. Exclude them before the session_history usage join so the
      -- range read model does not spend statement-timeout budget building rows
      -- the UI will never show.
      AND NOT (
          ri.quota_type IN ('short', 'short_special')
          AND (
              lower(COALESCE(ri.provider, 'unknown')) IN ('openai', 'anthropic', 'claude')
              OR lower(COALESCE(ri.provider, 'unknown')) LIKE 'claude/%'
              OR lower(COALESCE(ri.provider, 'unknown')) LIKE 'anthropic/%'
          )
      )
),
observation_identity AS (
    SELECT DISTINCT ON (n.raw_provider, n.normalized_quota_key, n.expected_reset_at)
        n.raw_provider,
        n.normalized_quota_key,
        n.expected_reset_at,
        NULLIF(TRIM(BOTH FROM COALESCE(o.source, '')), '') AS source,
        NULLIF(TRIM(BOTH FROM COALESCE(o.client, '')), '') AS client
    FROM normalized n
    JOIN public.rate_limit_observations o
      ON n.normalized_quota_key IS NOT NULL
     AND n.expected_reset_at IS NOT NULL
     AND o.provider = n.raw_provider
     AND o.quota_key = n.normalized_quota_key
     AND o.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
     AND o.observed_at IS NOT NULL${quotaObservationIntervalBoundsSql('n.interval_start', 'n.expected_reset_at')}
    ORDER BY n.raw_provider, n.normalized_quota_key, n.expected_reset_at, o.observed_at DESC
),
window_bounds AS (
    SELECT
        n.provider,
        n.model,
        n.quota_type,
        MAX(n.normalized_quota_key) AS quota_key,
        COALESCE(MAX(n.source), MAX(oi.source)) AS source,
        COALESCE(MAX(n.client), MAX(oi.client)) AS client,
        MAX(n.quota_unit) AS quota_unit,
        n.expected_reset_at,
        MIN(n.interval_start) AS interval_start,
        MAX(n.interval_end) AS interval_end,
        MIN(n.remaining_pct)::double precision AS min_remaining_pct,
        MAX(n.remaining_pct)::double precision AS max_remaining_pct
    FROM normalized n
    LEFT JOIN observation_identity oi
           ON oi.raw_provider = n.raw_provider
          AND oi.normalized_quota_key = n.normalized_quota_key
          AND oi.expected_reset_at IS NOT DISTINCT FROM n.expected_reset_at
    GROUP BY n.provider, n.model, n.quota_type, n.expected_reset_at
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
      ON wb.provider <> 'antigravity'
     AND ${providerDimension} = wb.provider
     AND COALESCE(sh.start_time, sh.created_at) >= wb.interval_start
     AND COALESCE(sh.start_time, sh.created_at) < wb.expected_reset_at
     AND ${sessionHistoryReportablePredicate()}
     AND (wb.model IS NULL OR sh.model = wb.model)
    GROUP BY wb.provider, wb.model, wb.quota_type, wb.expected_reset_at, COALESCE(sh.model, 'unknown')
)
SELECT
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.quota_key,
    wb.source,
    wb.client,
    wb.quota_unit,
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
    wb.quota_key,
    wb.source,
    wb.client,
    wb.quota_unit,
    wb.expected_reset_at,
    wb.interval_start,
    wb.interval_end,
    wb.min_remaining_pct,
    wb.max_remaining_pct
ORDER BY wb.provider ASC, wb.expected_reset_at DESC, wb.quota_type ASC;
`

  return { sql, values: [from, to] }
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
        MAX(GREATEST(0, LEAST(100, 100 - o.remaining_pct)))::double precision AS consumed_pct,
        MAX(o.quota_limit) AS quota_limit,
        MAX(o.quota_used) AS quota_used,
        MAX(o.quota_remaining) AS quota_remaining,
        MAX(o.billing_period_start_at) AS billing_period_start_at,
        MAX(o.billing_period_end_at) AS billing_period_end_at,
        (ARRAY_AGG(COALESCE(o.raw_provider_fields, '{}'::jsonb) ORDER BY o.observed_at DESC))[1] AS raw_provider_fields,
        (ARRAY_AGG(COALESCE(o.evidence, '{}'::jsonb) ORDER BY o.observed_at DESC))[1] AS evidence
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
    o.consumed_pct,
    o.quota_limit,
    o.quota_used,
    o.quota_remaining,
    o.billing_period_start_at,
    o.billing_period_end_at,
    o.raw_provider_fields,
    o.evidence
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
      AND ${sessionHistoryReportablePredicate()}
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
export function buildToolActivityQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams, {
    excludeFilterKeys: ['agent_id'],
  })
  values.push(TOOL_ACTIVITY_RECENT_ROW_LIMIT)
  const recentRowLimitIndex = values.length
  const agentIdFilterValues = parseCsv(searchParams.get('agent_id'))
  let agentIdFilterClause = ''
  if (agentIdFilterValues.length > 0) {
    values.push(agentIdFilterValues)
    agentIdFilterClause = `
      AND COALESCE(ra.activity_agent_id, NULLIF(sh.agent_id, ''), 'uncaptured_agent_id') = ANY($${values.length}::text[])`
  }

  const providerExpr = providerDimensionExpression('sh.provider')

  const sql = `
WITH bounds AS (
    SELECT
        GREATEST(COALESCE(MAX(id), 0) - $${recentRowLimitIndex}::bigint, 0) AS min_id,
        COALESCE(MAX(id), 0) AS max_id,
        $${recentRowLimitIndex}::bigint AS recent_row_limit
    FROM public.session_history_tool_activity
),
window_cap_state AS (
    SELECT
        b.min_id AS tool_activity_bounded_min_id,
        b.max_id AS tool_activity_bounded_max_id,
        b.recent_row_limit AS tool_activity_recent_row_limit,
        true AS tool_activity_recent_id_cap_active,
        EXISTS (
            SELECT 1
            FROM public.session_history_tool_activity a
            WHERE a.created_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
              AND a.created_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')
              AND a.id <= b.min_id
        ) AS tool_activity_recent_id_cap_truncates_requested_window
    FROM bounds b
),
recent_activity AS MATERIALIZED (
    SELECT
        a.litellm_call_id,
        COALESCE(a.tool_kind, 'other') AS tool_kind,
        a.tool_name,
        a.command_text,
        NULLIF(a.agent_id, '') AS activity_agent_id
    FROM public.session_history_tool_activity a
    CROSS JOIN bounds b
    WHERE a.id > b.min_id
      AND a.created_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
      AND a.created_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')
),
tool_rows AS MATERIALIZED (
    SELECT
        ${providerExpr} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        NULLIF(sh.agent_name, '') AS agent_name,
        COALESCE(ra.activity_agent_id, NULLIF(sh.agent_id, '')) AS agent_id,
        ra.tool_kind,
        ra.tool_name,
        ra.command_text
    FROM recent_activity ra
    JOIN public.session_history sh
      ON sh.litellm_call_id = ra.litellm_call_id
    WHERE ${whereParts.join('\n      AND ')}
${agentIdFilterClause}
),
outer_counts AS (
    SELECT
        provider,
        model,
        tool_kind,
        tool_name,
        jsonb_agg(DISTINCT agent_name) FILTER (WHERE agent_name IS NOT NULL) AS agent_names,
        jsonb_agg(DISTINCT agent_id) FILTER (WHERE agent_id IS NOT NULL) AS agent_ids,
        COUNT(*)::bigint AS calls
    FROM tool_rows
    GROUP BY
        provider,
        model,
        tool_kind,
        tool_name
),
shell_labels AS (
    SELECT
        provider,
        model,
        trim(
            CASE
                WHEN lower(split_part(trim(command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(command_text), ' ', 1))
            END
        ) AS cmd_label,
        jsonb_agg(DISTINCT agent_name) FILTER (WHERE agent_name IS NOT NULL) AS agent_names,
        jsonb_agg(DISTINCT agent_id) FILTER (WHERE agent_id IS NOT NULL) AS agent_ids,
        COUNT(*)::bigint AS calls
    FROM tool_rows
    WHERE tool_kind = 'command'
      AND command_text IS NOT NULL
      AND command_text <> ''
      AND lower(split_part(trim(command_text), ' ', 1)) NOT IN (
          'cd','pwd','echo',':','true','false','exit'
      )
    GROUP BY
        provider,
        model,
        trim(
            CASE
                WHEN lower(split_part(trim(command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(command_text), ' ', 1))
            END
        )
)
SELECT
    activity_rows.provider,
    activity_rows.model,
    activity_rows.kind,
    activity_rows.label,
    activity_rows.agent_names,
    activity_rows.agent_ids,
    activity_rows.calls,
    cap.tool_activity_bounded_min_id,
    cap.tool_activity_bounded_max_id,
    cap.tool_activity_recent_row_limit,
    cap.tool_activity_recent_id_cap_active,
    cap.tool_activity_recent_id_cap_truncates_requested_window
FROM window_cap_state cap
LEFT JOIN (
    SELECT
        provider,
        model,
        'outer' AS kind,
        tool_name AS label,
        COALESCE(agent_names, '[]'::jsonb) AS agent_names,
        COALESCE(agent_ids, '[]'::jsonb) AS agent_ids,
        calls
    FROM outer_counts
    UNION ALL
    SELECT
        provider,
        model,
        'shell' AS kind,
        cmd_label AS label,
        COALESCE(agent_names, '[]'::jsonb) AS agent_names,
        COALESCE(agent_ids, '[]'::jsonb) AS agent_ids,
        calls
    FROM shell_labels
) activity_rows ON true
ORDER BY activity_rows.provider ASC NULLS LAST, activity_rows.model ASC NULLS LAST, activity_rows.kind ASC NULLS LAST, activity_rows.calls DESC NULLS LAST;
`

  return {
    sql,
    values,
    metadata: {
      from: parseDateParam(searchParams.get('from'), defaultFromDate),
      to: parseDateParam(searchParams.get('to'), defaultToDate),
      toolActivityRecentRowLimit: TOOL_ACTIVITY_RECENT_ROW_LIMIT,
      toolActivityRecentIdCapActive: true,
    },
  }
}

function normalizeToolActivityRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    kind: row.kind,
    label: row.label,
    agent_names: normalizeStringArray(row.agent_names),
    agent_ids: normalizeStringArray(row.agent_ids),
    calls: normalizeNumber(row.calls) ?? 0,
    tool_activity_bounded_min_id: normalizeNumber(row.tool_activity_bounded_min_id),
    tool_activity_bounded_max_id: normalizeNumber(row.tool_activity_bounded_max_id),
    tool_activity_recent_row_limit:
      normalizeNumber(row.tool_activity_recent_row_limit) ??
      TOOL_ACTIVITY_RECENT_ROW_LIMIT,
    tool_activity_recent_id_cap_active: row.tool_activity_recent_id_cap_active ?? true,
    tool_activity_recent_id_cap_truncates_requested_window:
      row.tool_activity_recent_id_cap_truncates_requested_window ?? false,
  }
}

function buildUsageToolActivityMetadata(searchParams, extra = {}) {
  return {
    from: parseDateParam(searchParams.get('from'), defaultFromDate),
    to: parseDateParam(searchParams.get('to'), defaultToDate),
    generatedAt: new Date().toISOString(),
    toolActivityRecentRowLimit: TOOL_ACTIVITY_RECENT_ROW_LIMIT,
    toolActivityRecentIdCapActive: true,
    ...extra,
  }
}

export function buildDegradedUsageToolActivityReport(searchParams) {
  return {
    metadata: buildUsageToolActivityMetadata(searchParams, {
      degraded: true,
      degradedReason: 'database_timeout',
      degradedMessage:
        'Tool activity exceeded the bounded database timeout; showing an empty degraded report.',
    }),
    toolActivity: [],
  }
}

function buildUsageQuotaHistoryMetadata(extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

function buildUsageQuotaRangeHistoryMetadata(searchParams, extra = {}) {
  return {
    from: parseDateParam(searchParams.get('from'), defaultFromDate),
    to: parseDateParam(searchParams.get('to'), defaultToDate),
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

export function buildDegradedUsageQuotaRangeHistoryReport({
  searchParams = new URLSearchParams(),
  timedOutSubqueries = [],
  quotaRangeHistory = [],
  degradedMessage,
} = {}) {
  const normalizedTimedOutSubqueries = Array.from(
    new Set(
      (timedOutSubqueries ?? []).filter(
        (subqueryKey) => typeof subqueryKey === 'string' && subqueryKey !== ''
      )
    )
  )
  const timedOutSubquery = normalizedTimedOutSubqueries[0]
  const timedOutSubqueryMessage = timedOutSubquery
    ? `subquery "${timedOutSubquery}"`
    : null

  return {
    metadata: buildUsageQuotaRangeHistoryMetadata(searchParams, {
      degraded: true,
      degradedReason: 'database_timeout',
      degradedMessage:
        degradedMessage ??
        (timedOutSubquery
          ? `Quota range history ${timedOutSubqueryMessage} exceeded the bounded database timeout; returning partial payload from base rows.`
          : 'Quota range history exceeded the bounded database timeout; returning partial payload from base rows.'),
      timeout: true,
      timedOutSubquery,
      timedOutSubqueries: normalizedTimedOutSubqueries,
      quotaRangeHistoryStatementTimeoutMs:
        QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS,
    }),
    quotaRangeHistory,
  }
}


export function buildDegradedQuotaReport() {
  return {
    metadata: {
      ...buildFreshnessMetadata(null),
      degraded: true,
      degradedReason: 'database_timeout',
      degradedMessage:
        'Quota report exceeded the bounded database timeout; showing an empty degraded report.',
      staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
      quotaReportStatementTimeoutMs: REPORT_DB_STATEMENT_TIMEOUT_MS,
    },
    quotas: [],
  }
}

export function buildDegradedUsageQuotaHistoryReport({
  timedOutSubqueries = [],
  quotaHistory = [],
  degradedMessage,
} = {}) {
  const normalizedTimedOutSubqueries = Array.from(
    new Set(
      (timedOutSubqueries ?? []).filter(
        (subqueryKey) => typeof subqueryKey === 'string' && subqueryKey !== ''
      )
    )
  )
  const timedOutSubquery = normalizedTimedOutSubqueries[0]
  const timedOutSubqueryMessage = timedOutSubquery
    ? `subquery "${timedOutSubquery}"`
    : null

  return {
    metadata: buildUsageQuotaHistoryMetadata({
      degraded: true,
      degradedReason: 'database_timeout',
      degradedMessage:
        degradedMessage ??
        (timedOutSubquery
          ? `Quota history ${timedOutSubqueryMessage} exceeded the bounded database timeout; returning partial payload from base rows.`
          : 'Quota history exceeded the bounded database timeout; returning partial payload from base rows.'),
      timeout: true,
      timedOutSubquery,
      timedOutSubqueries: normalizedTimedOutSubqueries,
      quotaHistoryStatementTimeoutMs: QUOTA_HISTORY_STATEMENT_TIMEOUT_MS,
    }),
    quotaHistory,
  }
}

function buildUsageTokenTrendSummaryMetadata(searchParams, extra = {}) {
  return {
    from: parseDateParam(searchParams.get('from'), defaultFromDate),
    to: parseDateParam(searchParams.get('to'), defaultToDate),
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

export function buildDegradedUsageTokenTrendSummaryReport(
  searchParams,
  {
    timedOutSubqueries = [],
    skippedSubqueries = [],
    unavailableSubqueries = [],
    tokenTrendHours = [],
    tokenTrendHealth = [],
    tokenTrendScores = [],
    tokenTrendVersions = [],
    tokenTrendModelFirstSeen = [],
    tokenTrendSummaryRangeDays,
    tokenTrendSummaryRawLaneMaxDays,
  } = {}
) {
  const normalizedTimedOutSubqueries = Array.from(
    new Set(
      (timedOutSubqueries ?? []).filter((subqueryKey) =>
        USAGE_TOKEN_TREND_SUMMARY_SUBQUERY_KEYS.includes(subqueryKey)
      )
    )
  )
  const normalizedSkippedSubqueries = Array.from(
    new Set(
      (skippedSubqueries ?? []).filter((subqueryKey) =>
        TOKEN_TREND_SUMMARY_RAW_SUBQUERY_KEYS.includes(subqueryKey)
      )
    )
  )
  const normalizedUnavailableSubqueries = Array.from(
    new Set([
      ...normalizedTimedOutSubqueries,
      ...normalizedSkippedSubqueries,
      ...unavailableSubqueries,
    ])
  )
  const timedOutSubquery = normalizedTimedOutSubqueries[0]
  const timedOutSubqueryMessage =
    normalizedTimedOutSubqueries.length === 1
      ? `subquery "${timedOutSubquery}"`
      : `subqueries ${normalizedTimedOutSubqueries.map((key) => `"${key}"`).join(', ')}`
  const hasTimedOutSubqueries = normalizedTimedOutSubqueries.length > 0
  const hasSkippedSubqueries = normalizedSkippedSubqueries.length > 0
  const hasUnavailableSubqueries = normalizedUnavailableSubqueries.length > 0
  const isLegacyTimeoutOnly =
    !hasTimedOutSubqueries && !hasSkippedSubqueries && !hasUnavailableSubqueries
  const skippedSubqueryMessage =
    normalizedSkippedSubqueries.length > 0
      ? `bounded raw-lane policy skipped ${normalizedSkippedSubqueries.map((key) => `"${key}"`).join(', ')} ${normalizedSkippedSubqueries.length > 1 ? 'lane queries' : 'lane query'} for a ${tokenTrendSummaryRangeDays ?? 'unknown'}-day range; max allowed is ${tokenTrendSummaryRawLaneMaxDays ?? 'unknown'} days`
      : null
  const degradedMessage =
    hasTimedOutSubqueries && skippedSubqueryMessage
      ? `Token trend summary ${timedOutSubqueryMessage} exceeded the bounded database timeout; ${skippedSubqueryMessage}; returning partial payload from successful subqueries.`
      : hasTimedOutSubqueries
        ? `Token trend summary ${timedOutSubqueryMessage} exceeded the bounded database timeout; returning partial payload from successful subqueries.`
        : skippedSubqueryMessage
          ? `Token trend summary ${skippedSubqueryMessage}; returning partial payload from successful subqueries.`
          : `Token trend summary exceeded the bounded database timeout; returning partial payload from successful subqueries.`

  return {
    metadata: buildUsageTokenTrendSummaryMetadata(searchParams, {
      degraded: true,
      degradedReason: hasTimedOutSubqueries
        ? 'database_timeout'
        : hasSkippedSubqueries
          ? 'bounded_raw_lane_policy'
          : 'database_timeout',
      degradedMessage,
      timeout: hasTimedOutSubqueries || isLegacyTimeoutOnly ? true : undefined,
      timedOutSubquery,
      timedOutSubqueries: normalizedTimedOutSubqueries,
      skippedSubqueries: normalizedSkippedSubqueries,
      unavailableSubqueries: normalizedUnavailableSubqueries,
      tokenTrendSummaryRangeDays,
      tokenTrendSummaryRawLaneMaxDays,
      tokenTrendSummaryStatementTimeoutMs:
        TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
    }),
    tokenTrendHours,
    tokenTrendHealth,
    tokenTrendScores,
    tokenTrendVersions,
    tokenTrendModelFirstSeen,
  }
}

const PROVIDER_ALIAS_ROUTING_RECENT_LIMIT = 400
const PROVIDER_ALIAS_ROUTING_LOOKBACK_HOURS = 24
const PROVIDER_ALIAS_ROUTING_FAMILY_PREFIXES = {
  codex: 'codex_auto_agent_',
  anthropic: 'anthropic_auto_agent_',
}

export function buildProviderAliasRoutingQuery(_searchParams) {
  const values = [
    PROVIDER_ALIAS_ROUTING_RECENT_LIMIT,
    PROVIDER_ALIAS_ROUTING_LOOKBACK_HOURS,
  ]
  const sql = `
WITH recent_alias_sessions AS MATERIALIZED (
    SELECT
        sh.created_at,
        sh.litellm_call_id::text AS litellm_call_id,
        ${providerDimension} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        NULLIF(sh.inbound_model_alias, '') AS inbound_model_alias,
        COALESCE(sh.metadata, '{}'::jsonb) AS metadata
    FROM public.session_history sh
    WHERE sh.created_at >= NOW() - ($2::integer * INTERVAL '1 hour')
      AND (
        sh.metadata ? 'codex_auto_agent_alias'
        OR sh.metadata ? 'anthropic_auto_agent_alias'
        OR sh.metadata ? 'aawm_alias_routing_audit_events'
        OR sh.metadata ? 'requested_model_alias'
        OR sh.metadata ? 'codex_auto_agent_affinity_state_source'
        OR sh.metadata ? 'anthropic_auto_agent_affinity_state_source'
        OR sh.metadata ? 'codex_auto_agent_cooldown_state_source'
        OR sh.metadata ? 'anthropic_auto_agent_cooldown_state_source'
        OR sh.metadata ? 'codex_auto_agent_selected_provider'
        OR sh.metadata ? 'anthropic_auto_agent_selected_provider'
        OR sh.metadata ? 'codex_auto_agent_skipped_candidates'
        OR sh.metadata ? 'anthropic_auto_agent_skipped_candidates'
        OR sh.metadata ? 'model_alias_label'
      )
    ORDER BY sh.created_at DESC
    LIMIT $1
),
audit_events AS (
    SELECT
        rs.litellm_call_id,
        jsonb_agg(
            jsonb_strip_nulls(
                jsonb_build_object(
                    'observed_at', aa.observed_at,
                    'alias_family', aa.alias_family,
                    'provider', aa.provider,
                    'model', aa.model,
                    'route_family', aa.route_family,
                    'event_type', aa.event_type,
                    'failure_class', aa.failure_class,
                    'cooldown_state', COALESCE(aa.candidate_status, aa.event_type),
                    'cooldown_until', aa.cooldown_until,
                    'cooldown_state_source', aa.metadata->>'cooldown_state_source'
                )
            )
            ORDER BY aa.observed_at
        ) AS alias_route_events
    FROM recent_alias_sessions rs
    JOIN public.aawm_alias_routing_audit aa
      ON rs.litellm_call_id IS NOT NULL
     AND aa.litellm_call_id = rs.litellm_call_id
    GROUP BY rs.litellm_call_id
),
projected_alias_sessions AS (
    SELECT
        rs.created_at,
        rs.provider,
        rs.model,
        rs.inbound_model_alias,
        jsonb_strip_nulls(jsonb_build_object(
            'requested_model_alias', NULLIF(rs.metadata->>'requested_model_alias', ''),
            'model_alias_label', NULLIF(rs.metadata->>'model_alias_label', ''),
            'codex_auto_agent_alias', NULLIF(rs.metadata->>'codex_auto_agent_alias', ''),
            'anthropic_auto_agent_alias', NULLIF(rs.metadata->>'anthropic_auto_agent_alias', ''),
            'codex_auto_agent_affinity_state_source', NULLIF(rs.metadata->>'codex_auto_agent_affinity_state_source', ''),
            'codex_auto_agent_cooldown_state_source', NULLIF(rs.metadata->>'codex_auto_agent_cooldown_state_source', ''),
            'codex_auto_agent_selected_provider', NULLIF(rs.metadata->>'codex_auto_agent_selected_provider', ''),
            'codex_auto_agent_selected_model', NULLIF(rs.metadata->>'codex_auto_agent_selected_model', ''),
            'codex_auto_agent_selected_route_family', NULLIF(rs.metadata->>'codex_auto_agent_selected_route_family', ''),
            'codex_auto_agent_selected_last_resort', NULLIF(rs.metadata->>'codex_auto_agent_selected_last_resort', ''),
            'codex_auto_agent_selection_reason', NULLIF(rs.metadata->>'codex_auto_agent_selection_reason', ''),
            'anthropic_auto_agent_affinity_state_source', NULLIF(rs.metadata->>'anthropic_auto_agent_affinity_state_source', ''),
            'anthropic_auto_agent_cooldown_state_source', NULLIF(rs.metadata->>'anthropic_auto_agent_cooldown_state_source', ''),
            'anthropic_auto_agent_selected_provider', NULLIF(rs.metadata->>'anthropic_auto_agent_selected_provider', ''),
            'anthropic_auto_agent_selected_model', NULLIF(rs.metadata->>'anthropic_auto_agent_selected_model', ''),
            'anthropic_auto_agent_selected_route_family', NULLIF(rs.metadata->>'anthropic_auto_agent_selected_route_family', ''),
            'anthropic_auto_agent_selected_last_resort', NULLIF(rs.metadata->>'anthropic_auto_agent_selected_last_resort', ''),
            'anthropic_auto_agent_selection_reason', NULLIF(rs.metadata->>'anthropic_auto_agent_selection_reason', ''),
            'codex_auto_agent_skipped_candidates', rs.metadata->'codex_auto_agent_skipped_candidates',
            'anthropic_auto_agent_skipped_candidates', rs.metadata->'anthropic_auto_agent_skipped_candidates'
        )) AS metadata,
        COALESCE(
            audit.alias_route_events,
            rs.metadata->'aawm_alias_routing_audit_events',
            rs.metadata->'codex_auto_agent_audit_events',
            rs.metadata->'anthropic_auto_agent_audit_events',
            '[]'::jsonb
        ) AS alias_route_events
    FROM recent_alias_sessions rs
    LEFT JOIN audit_events audit
      ON audit.litellm_call_id = rs.litellm_call_id
)
SELECT
    created_at,
    provider,
    model,
    inbound_model_alias,
    metadata,
    alias_route_events
FROM projected_alias_sessions
ORDER BY created_at DESC;
`

  return {
    sql,
    values,
    metadata: {
      lookbackHours: PROVIDER_ALIAS_ROUTING_LOOKBACK_HOURS,
      limit: PROVIDER_ALIAS_ROUTING_RECENT_LIMIT,
      dataSource: 'recent_observed_session_history',
    },
  }
}

function nullIfEmptyProviderAliasRouting(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

function parseProviderAliasRoutingTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const text = String(value).trim()
  if (!text) return null
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    if (!Number.isFinite(numeric)) return null
    const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000
    const date = new Date(millis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeProviderAliasRoutingStateSource(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (
    normalized === 'memory' ||
    normalized === 'durable_cache' ||
    normalized === 'local_fallback'
  ) {
    return normalized
  }
  return 'unknown'
}

function providerAliasRoutingRemainingSeconds(expiresAtIso) {
  if (!expiresAtIso) return null
  const expiresMs = Date.parse(expiresAtIso)
  if (!Number.isFinite(expiresMs)) return null
  return Math.max(0, Math.round((expiresMs - Date.now()) / 1000))
}

function providerAliasRoutingIsActive(expiresAtIso, cooldownUntilIso) {
  const target = cooldownUntilIso ?? expiresAtIso
  if (!target) return false
  const expiresMs = Date.parse(target)
  if (!Number.isFinite(expiresMs)) return false
  return expiresMs > Date.now()
}

function providerAliasRoutingMetadataValue(metadata, family, suffix) {
  const prefix = PROVIDER_ALIAS_ROUTING_FAMILY_PREFIXES[family]
  if (!prefix) return null
  return metadata[`${prefix}${suffix}`] ?? null
}

function providerAliasRoutingFamilyFromMetadata(metadata) {
  if (
    metadata.codex_auto_agent_alias != null ||
    metadata.codex_auto_agent_selected_provider != null ||
    metadata.codex_auto_agent_affinity_state_source != null ||
    metadata.codex_auto_agent_cooldown_state_source != null
  ) {
    return 'codex'
  }
  if (
    metadata.anthropic_auto_agent_alias != null ||
    metadata.anthropic_auto_agent_selected_provider != null ||
    metadata.anthropic_auto_agent_affinity_state_source != null ||
    metadata.anthropic_auto_agent_cooldown_state_source != null
  ) {
    return 'anthropic'
  }
  const aliasLabel = String(
    metadata.requested_model_alias ??
      metadata.model_alias_label ??
      ''
  ).toLowerCase()
  if (aliasLabel.includes('anthropic')) return 'anthropic'
  if (aliasLabel.startsWith('aawm')) return 'codex'
  return null
}

function sanitizeProviderAliasRoutingCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value
  const candidate = {
    provider: nullIfEmptyProviderAliasRouting(record.provider),
    model: nullIfEmptyProviderAliasRouting(record.model),
    route_family: nullIfEmptyProviderAliasRouting(
      record.route_family ?? record.routeFamily
    ),
    reason: nullIfEmptyProviderAliasRouting(
      record.reason ?? record.skip_reason ?? record.failure_class
    ),
  }
  if (
    candidate.provider == null &&
    candidate.model == null &&
    candidate.route_family == null &&
    candidate.reason == null
  ) {
    return null
  }
  return candidate
}

function sanitizeProviderAliasRoutingCandidateList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => sanitizeProviderAliasRoutingCandidate(entry))
    .filter((entry) => entry != null)
    .slice(0, 8)
}

function buildProviderAliasRoutingAffinityEntry(
  family,
  metadata,
  row,
  observedAt
) {
  const provider = nullIfEmptyProviderAliasRouting(
    providerAliasRoutingMetadataValue(metadata, family, 'selected_provider') ??
      row.provider
  )
  const model = nullIfEmptyProviderAliasRouting(
    providerAliasRoutingMetadataValue(metadata, family, 'selected_model') ??
      row.model
  )
  const routeFamily = nullIfEmptyProviderAliasRouting(
    providerAliasRoutingMetadataValue(metadata, family, 'selected_route_family')
  )
  const selectionReason = nullIfEmptyProviderAliasRouting(
    providerAliasRoutingMetadataValue(metadata, family, 'selection_reason')
  )
  const stateSource = normalizeProviderAliasRoutingStateSource(
    providerAliasRoutingMetadataValue(metadata, family, 'affinity_state_source')
  )
  const lastResortRaw = providerAliasRoutingMetadataValue(
    metadata,
    family,
    'selected_last_resort'
  )
  const lastResort =
    lastResortRaw == null
      ? null
      : ['true', '1', 'yes'].includes(String(lastResortRaw).toLowerCase())
  const expiresAt = parseProviderAliasRoutingTimestamp(
    metadata[`${family}_auto_agent_affinity_expires_at`] ??
      providerAliasRoutingMetadataValue(metadata, family, 'affinity_expires_at')
  )
  const remainingSeconds = providerAliasRoutingRemainingSeconds(expiresAt)
  const isActive =
    expiresAt != null
      ? providerAliasRoutingIsActive(expiresAt, null)
      : stateSource === 'memory' || stateSource === 'durable_cache'
  const skipped = sanitizeProviderAliasRoutingCandidateList(
    providerAliasRoutingMetadataValue(metadata, family, 'skipped_candidates')
  )
  if (provider == null && model == null && routeFamily == null) {
    return null
  }
  return {
    family,
    alias_label: nullIfEmptyProviderAliasRouting(
      providerAliasRoutingMetadataValue(metadata, family, 'alias') ??
        metadata.requested_model_alias ??
        metadata.model_alias_label ??
        row.inbound_model_alias
    ),
    provider,
    model,
    route_family: routeFamily,
    state_kind: 'affinity',
    state_source: stateSource,
    observed_at: observedAt,
    expires_at: expiresAt,
    cooldown_until: null,
    remaining_seconds: remainingSeconds,
    is_active: isActive,
    last_resort: lastResort,
    selection_reason: selectionReason,
    selected: sanitizeProviderAliasRoutingCandidate({
      provider,
      model,
      route_family: routeFamily,
      reason: selectionReason,
    }),
    skipped_candidates: skipped,
  }
}

function buildProviderAliasRoutingCooldownEntries(
  row,
  metadata,
  family,
  observedAt,
  auditEvents
) {
  const entries = []
  const cooldownSource = normalizeProviderAliasRoutingStateSource(
    providerAliasRoutingMetadataValue(metadata, family, 'cooldown_state_source')
  )
  const auditList = Array.isArray(auditEvents) ? auditEvents : []
  for (const event of auditList.slice(-12)) {
    if (!event || typeof event !== 'object') continue
    const eventFamily = nullIfEmptyProviderAliasRouting(event.alias_family)
    if (eventFamily && eventFamily !== family) continue
    const cooldownUntil = parseProviderAliasRoutingTimestamp(
      event.cooldown_until ?? event.expires_at
    )
    const cooldownState = nullIfEmptyProviderAliasRouting(
      event.cooldown_state ?? event.event_type
    )
    if (cooldownUntil == null && cooldownState == null) continue
    const provider = nullIfEmptyProviderAliasRouting(
      event.provider ?? row.provider
    )
    const model = nullIfEmptyProviderAliasRouting(event.model ?? row.model)
    const routeFamily = nullIfEmptyProviderAliasRouting(event.route_family)
    const remainingSeconds = providerAliasRoutingRemainingSeconds(cooldownUntil)
    const isActive = providerAliasRoutingIsActive(null, cooldownUntil)
    if (!isActive && cooldownUntil != null) continue
    entries.push({
      family,
      alias_label: nullIfEmptyProviderAliasRouting(
        providerAliasRoutingMetadataValue(metadata, family, 'alias') ??
          metadata.requested_model_alias ??
          metadata.model_alias_label ??
          row.inbound_model_alias
      ),
      provider,
      model,
      route_family: routeFamily,
      state_kind: 'cooldown',
      state_source: normalizeProviderAliasRoutingStateSource(
        event.cooldown_state_source ?? cooldownSource
      ),
      observed_at:
        parseProviderAliasRoutingTimestamp(event.observed_at) ?? observedAt,
      expires_at: cooldownUntil,
      cooldown_until: cooldownUntil,
      remaining_seconds: remainingSeconds,
      is_active: isActive,
      last_resort: null,
      selection_reason: nullIfEmptyProviderAliasRouting(
        event.failure_class ?? event.event_type
      ),
      selected: null,
      skipped_candidates: [
        sanitizeProviderAliasRoutingCandidate({
          provider,
          model,
          route_family: routeFamily,
          reason: event.failure_class ?? event.event_type,
        }),
      ].filter((entry) => entry != null),
    })
  }
  const skipped = sanitizeProviderAliasRoutingCandidateList(
    providerAliasRoutingMetadataValue(metadata, family, 'skipped_candidates')
  )
  for (const candidate of skipped) {
    entries.push({
      family,
      alias_label: nullIfEmptyProviderAliasRouting(
        providerAliasRoutingMetadataValue(metadata, family, 'alias') ??
          metadata.requested_model_alias ??
          metadata.model_alias_label ??
          row.inbound_model_alias
      ),
      provider: candidate.provider,
      model: candidate.model,
      route_family: candidate.route_family,
      state_kind: 'cooldown',
      state_source: cooldownSource,
      observed_at: observedAt,
      expires_at: null,
      cooldown_until: null,
      remaining_seconds: null,
      is_active: false,
      last_resort: null,
      selection_reason: candidate.reason,
      selected: null,
      skipped_candidates: [candidate],
    })
  }
  return entries
}

export function normalizeProviderAliasRoutingReport(rows, options = {}) {
  const generatedAt =
    options.generatedAt ?? new Date().toISOString()
  const affinityBest = new Map()
  const cooldownBest = new Map()
  const familiesSeen = new Set()

  for (const row of rows) {
    const metadata = normalizeJsonRecord(row.metadata) ?? {}
    const observedAt =
      parseProviderAliasRoutingTimestamp(row.created_at) ?? generatedAt
    const family = providerAliasRoutingFamilyFromMetadata(metadata)
    if (!family) continue
    familiesSeen.add(family)

    const affinity = buildProviderAliasRoutingAffinityEntry(
      family,
      metadata,
      row,
      observedAt
    )
    if (affinity) {
      const key = affinity.family
      const prior = affinityBest.get(key)
      if (
        !prior ||
        Date.parse(affinity.observed_at) > Date.parse(prior.observed_at)
      ) {
        affinityBest.set(key, affinity)
      }
    }

    const cooldowns = buildProviderAliasRoutingCooldownEntries(
      row,
      metadata,
      family,
      observedAt,
      row.alias_route_events
    )
    for (const entry of cooldowns) {
      if (entry.state_kind !== 'cooldown') continue
      const key = [
        entry.family,
        entry.provider ?? '',
        entry.model ?? '',
        entry.route_family ?? '',
      ].join('|')
      const prior = cooldownBest.get(key)
      if (
        !prior ||
        Date.parse(entry.observed_at) > Date.parse(prior.observed_at)
      ) {
        cooldownBest.set(key, entry)
      }
    }
  }

  const deduped = []
  for (const family of ['codex', 'anthropic']) {
    const affinity = affinityBest.get(family)
    if (affinity) deduped.push(affinity)
    deduped.push(
      ...[...cooldownBest.values()]
        .filter((entry) => entry.family === family)
        .sort(
          (left, right) =>
            Date.parse(right.observed_at) - Date.parse(left.observed_at)
        )
        .slice(0, 6)
    )
  }

  return {
    data_source: 'recent_observed_session_history',
    freshness_label:
      'Recent observed routing from session history (not live Redis/DualCache)',
    generated_at: generatedAt,
    lookback_hours: PROVIDER_ALIAS_ROUTING_LOOKBACK_HOURS,
    families: ['codex', 'anthropic'].map((family) => ({
      family,
      observed: familiesSeen.has(family),
    })),
    entries: deduped,
  }
}

const PROVIDER_AUTH_HEALTH_ROW_LIMIT = 200
const PROVIDER_AUTH_BLOCKED_METADATA_KEYS = new Set([
  'auth_file',
  'auth_file_path',
  'refresh_token',
  'access_token',
  'id_token',
  'api_key',
  'authorization',
  'client_secret',
  'raw_auth',
  'raw_auth_json',
  'token',
  'tokens',
])

export function buildProviderAuthHealthQuery(_searchParams) {
  const sql = `
SELECT
    observed_at,
    COALESCE(environment, 'unknown') AS environment,
    provider,
    auth_family,
    credential_scope,
    NULLIF(left(COALESCE(auth_file_hash, ''), 8), '') AS auth_file_hash_short,
    status,
    attempted,
    refreshed,
    skipped,
    expires_at,
    last_success_at,
    source_task,
    error_class,
    error_message,
    NULLIF(metadata->>'auth_file_source', '') AS auth_file_source
FROM public.provider_auth_current
ORDER BY
    provider ASC,
    auth_family ASC,
    environment ASC,
    observed_at DESC
LIMIT $1;
`
  return {
    sql,
    values: [PROVIDER_AUTH_HEALTH_ROW_LIMIT],
    metadata: {
      limit: PROVIDER_AUTH_HEALTH_ROW_LIMIT,
      dataSource: 'provider_auth_current',
    },
  }
}

function nullIfEmptyProviderAuth(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

function parseProviderAuthTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  const text = String(value).trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function providerAuthRemainingSeconds(expiresAtIso, nowMs = Date.now()) {
  if (!expiresAtIso) return null
  const expiresMs = Date.parse(expiresAtIso)
  if (!Number.isFinite(expiresMs)) return null
  return Math.round((expiresMs - nowMs) / 1000)
}

function shortProviderAuthFileHash(value) {
  const normalized = nullIfEmptyProviderAuth(value)
  if (!normalized) return null
  if (normalized.length <= 12) return normalized
  return normalized.slice(0, 8)
}

function sanitizeProviderAuthErrorMessage(value) {
  const normalized = nullIfEmptyProviderAuth(value)
  if (!normalized) return null
  let message = normalized
  message = message.replace(
    /(?:Bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[redacted-token]'
  )
  message = message.replace(
    /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
    '[redacted-credential]'
  )
  message = message.replace(/\/(?:home|Users|tmp|var)[^\s]*/g, '[redacted-path]')
  if (message.length > 240) {
    message = `${message.slice(0, 237)}...`
  }
  return message
}

function sanitizeProviderAuthSource(value) {
  const source = nullIfEmptyProviderAuth(value)
  if (!source) return null
  if (PROVIDER_AUTH_BLOCKED_METADATA_KEYS.has(source.toLowerCase())) {
    return null
  }
  if (/^\/(?:home|Users|tmp|var)\b/.test(source)) {
    return null
  }
  return source.length > 120 ? `${source.slice(0, 117)}...` : source
}

export function classifyProviderAuthHealthState(row, options = {}) {
  const nowMs = options.nowMs ?? Date.now()
  const status = String(row.status ?? '')
    .trim()
    .toLowerCase()
  const expiresAt = parseProviderAuthTimestamp(row.expires_at)
  const expiresInFuture =
    expiresAt != null && Number.isFinite(Date.parse(expiresAt))
      ? Date.parse(expiresAt) > nowMs
      : false

  if (status === 'failed' || row.error_class) {
    return 'failed'
  }
  if (status === 'refreshed' || row.refreshed) {
    if (expiresAt != null && !expiresInFuture) return 'expired'
    return 'refreshed'
  }
  if (status === 'skipped' || row.skipped) {
    if (!expiresAt || !expiresInFuture) return 'skipped_expired'
    return 'skipped_valid'
  }
  if (status === 'attempted' || row.attempted) {
    return 'attempted'
  }
  if (expiresAt != null && !expiresInFuture) {
    return 'expired'
  }
  return 'unknown'
}

export function normalizeProviderAuthHealthRow(row, options = {}) {
  const observedAt =
    parseProviderAuthTimestamp(row.observed_at) ??
    options.generatedAt ??
    new Date().toISOString()
  const expiresAt = parseProviderAuthTimestamp(row.expires_at)
  const lastSuccessAt = parseProviderAuthTimestamp(row.last_success_at)
  const remainingSeconds = providerAuthRemainingSeconds(
    expiresAt,
    options.nowMs
  )
  const authHealthState = classifyProviderAuthHealthState(row, options)
  return {
    observed_at: observedAt,
    environment: nullIfEmptyProviderAuth(row.environment) ?? 'unknown',
    provider: nullIfEmptyProviderAuth(row.provider) ?? 'unknown',
    auth_family: nullIfEmptyProviderAuth(row.auth_family) ?? 'unknown',
    credential_scope: nullIfEmptyProviderAuth(row.credential_scope),
    auth_file_hash_short:
      shortProviderAuthFileHash(row.auth_file_hash_short) ??
      shortProviderAuthFileHash(row.auth_file_hash),
    status: nullIfEmptyProviderAuth(row.status) ?? 'unknown',
    attempted: Boolean(row.attempted),
    refreshed: Boolean(row.refreshed),
    skipped: Boolean(row.skipped),
    expires_at: expiresAt,
    last_success_at: lastSuccessAt,
    remaining_seconds: remainingSeconds,
    auth_health_state: authHealthState,
    source_task: nullIfEmptyProviderAuth(row.source_task),
    error_class: nullIfEmptyProviderAuth(row.error_class),
    error_message: sanitizeProviderAuthErrorMessage(row.error_message),
    auth_file_source: sanitizeProviderAuthSource(
      row.auth_file_source ??
        (normalizeJsonRecord(row.metadata) ?? {}).auth_file_source
    ),
  }
}

export function normalizeProviderAuthHealthReport(rows, options = {}) {
  const generatedAt =
    options.generatedAt ?? new Date().toISOString()
  const nowMs = options.nowMs ?? Date.now()
  const entries = rows.map((row) =>
    normalizeProviderAuthHealthRow(row, { generatedAt, nowMs })
  )
  return {
    data_source: 'provider_auth_current',
    freshness_label:
      'Current provider credential refresh state from provider_auth_current',
    generated_at: generatedAt,
    entries,
  }
}


const PROVIDER_CREDIT_LIFECYCLE_ROW_LIMIT = 500

export function buildProviderCreditLifecycleQuery(_searchParams) {
  const sql = `
WITH filtered_credit_rows AS (
  SELECT
    cr.observed_at,
    COALESCE(cr.environment, 'unknown') AS environment,
    cr.provider,
    NULLIF(left(COALESCE(cr.account_hash, ''), 8), '') AS account_hash_short,
    cr.credit_family,
    cr.credit_type,
    cr.available_count,
    cr.expires_at,
    cr.source,
    cr.credit_identity,
    cr.granted_at,
    cr.status,
    cr.redeem_started_at,
    cr.redeemed_at,
    cr.operator_annotation,
    cr.source_url
  FROM public.provider_credit_current cr
  WHERE cr.provider = 'openai'
    AND cr.credit_family = 'codex_rate_limit_reset'
    AND (
      NULLIF(BTRIM(COALESCE(cr.credit_identity, '')), '') IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.provider_credit_current detail
        WHERE NULLIF(BTRIM(COALESCE(detail.credit_identity, '')), '') IS NOT NULL
          AND COALESCE(detail.environment, 'unknown') = COALESCE(cr.environment, 'unknown')
          AND detail.provider = cr.provider
          AND COALESCE(detail.account_hash, '') = COALESCE(cr.account_hash, '')
          AND COALESCE(detail.credit_family, '') = COALESCE(cr.credit_family, '')
          AND COALESCE(detail.source, '') = COALESCE(cr.source, '')
      )
    )
)
SELECT
    observed_at,
    environment,
    provider,
    account_hash_short,
    credit_family,
    credit_type,
    available_count,
    expires_at,
    source,
    credit_identity,
    granted_at,
    status,
    redeem_started_at,
    redeemed_at,
    operator_annotation,
    source_url
FROM filtered_credit_rows
ORDER BY
    observed_at DESC,
    granted_at DESC NULLS LAST,
    credit_identity ASC NULLS LAST
LIMIT $1;
`
  return {
    sql,
    values: [PROVIDER_CREDIT_LIFECYCLE_ROW_LIMIT],
    metadata: {
      limit: PROVIDER_CREDIT_LIFECYCLE_ROW_LIMIT,
      dataSource: 'provider_credit_current',
    },
  }
}

function nullIfEmptyProviderCredit(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

function parseProviderCreditTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  const text = String(value).trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function shortProviderCreditAccountHash(value) {
  const normalized = nullIfEmptyProviderCredit(value)
  if (!normalized) return null
  if (normalized.length <= 12) return normalized
  return normalized.slice(0, 8)
}

function resolveProviderCreditAccountHashShort(row) {
  return (
    nullIfEmptyProviderCredit(row.account_hash_short) ??
    shortProviderCreditAccountHash(row.account_hash)
  )
}

function sanitizeProviderCreditOperatorAnnotation(value) {
  const normalized = nullIfEmptyProviderCredit(value)
  if (!normalized) return null
  let message = normalized
  message = message.replace(
    /(?:Bearer\s+)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[redacted-token]'
  )
  message = message.replace(
    /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
    '[redacted-credential]'
  )
  message = message.replace(/\/(?:home|Users|tmp|var)[^\s]*/g, '[redacted-path]')
  if (message.length > 240) {
    message = `${message.slice(0, 237)}...`
  }
  return message
}

function sanitizeProviderCreditSource(value) {
  const source = nullIfEmptyProviderCredit(value)
  if (!source) return null
  if (source.length > 120) {
    return `${source.slice(0, 117)}...`
  }
  return source
}

function sanitizeProviderCreditSourceUrl(value) {
  const normalized = nullIfEmptyProviderCredit(value)
  if (!normalized) return null
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function normalizeProviderCreditStatus(value) {
  const status = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!status) return 'unknown'
  if (status === 'available' || status === 'used' || status === 'expired') {
    return status
  }
  return status
}

function providerCreditLegacyGroupKey(row) {
  return [
    nullIfEmptyProviderCredit(row.environment) ?? 'unknown',
    nullIfEmptyProviderCredit(row.provider) ?? 'unknown',
    resolveProviderCreditAccountHashShort(row) ?? '',
    nullIfEmptyProviderCredit(row.credit_family) ?? 'unknown',
    nullIfEmptyProviderCredit(row.source) ?? '',
  ].join('|')
}

export function filterLegacyProviderCreditAggregateRows(rows) {
  const detailGroups = new Set()
  for (const row of rows) {
    if (nullIfEmptyProviderCredit(row.credit_identity)) {
      detailGroups.add(providerCreditLegacyGroupKey(row))
    }
  }
  if (detailGroups.size === 0) {
    return rows
  }
  return rows.filter((row) => {
    if (nullIfEmptyProviderCredit(row.credit_identity)) {
      return true
    }
    return !detailGroups.has(providerCreditLegacyGroupKey(row))
  })
}

function providerCreditAvailableUnits(row) {
  const status = normalizeProviderCreditStatus(row.status)
  if (status !== 'available') return 0
  const count = Number(row.available_count)
  if (Number.isFinite(count) && count >= 0) {
    return count
  }
  return 1
}

export function buildProviderCreditLifecycleSummaries(entries) {
  const summariesByKey = new Map()
  for (const entry of entries) {
    const key = [
      entry.environment,
      entry.provider,
      entry.credit_family,
    ].join('|')
    const existing = summariesByKey.get(key) ?? {
      environment: entry.environment,
      provider: entry.provider,
      credit_family: entry.credit_family,
      label: `${entry.provider} ${entry.credit_family} credits`,
      available_count: 0,
      used_count: 0,
      expired_count: 0,
      total_count: 0,
    }
    existing.total_count += 1
    const status = normalizeProviderCreditStatus(entry.status)
    if (status === 'available') {
      existing.available_count += providerCreditAvailableUnits(entry)
    } else if (status === 'used') {
      existing.used_count += 1
    } else if (status === 'expired') {
      existing.expired_count += 1
    }
    summariesByKey.set(key, existing)
  }
  return [...summariesByKey.values()].sort((left, right) =>
    `${left.provider}:${left.credit_family}`.localeCompare(
      `${right.provider}:${right.credit_family}`
    )
  )
}

export function normalizeProviderCreditLifecycleRow(row, options = {}) {
  const observedAt =
    parseProviderCreditTimestamp(row.observed_at) ??
    options.generatedAt ??
    new Date().toISOString()
  const status = normalizeProviderCreditStatus(row.status)
  const availableCountRaw = Number(row.available_count)
  const availableCount =
    Number.isFinite(availableCountRaw) && availableCountRaw >= 0
      ? availableCountRaw
      : status === 'available'
        ? 1
        : 0
  return {
    observed_at: observedAt,
    environment: nullIfEmptyProviderCredit(row.environment) ?? 'unknown',
    provider: nullIfEmptyProviderCredit(row.provider) ?? 'unknown',
    account_hash_short: resolveProviderCreditAccountHashShort(row),
    credit_family: nullIfEmptyProviderCredit(row.credit_family) ?? 'unknown',
    credit_type: nullIfEmptyProviderCredit(row.credit_type),
    available_count: availableCount,
    expires_at: parseProviderCreditTimestamp(row.expires_at),
    source: sanitizeProviderCreditSource(row.source),
    credit_identity: nullIfEmptyProviderCredit(row.credit_identity),
    granted_at: parseProviderCreditTimestamp(row.granted_at),
    status,
    redeem_started_at: parseProviderCreditTimestamp(row.redeem_started_at),
    redeemed_at: parseProviderCreditTimestamp(row.redeemed_at),
    operator_annotation: sanitizeProviderCreditOperatorAnnotation(
      row.operator_annotation
    ),
    source_url: sanitizeProviderCreditSourceUrl(row.source_url),
  }
}

export function normalizeProviderCreditLifecycleReport(rows, options = {}) {
  const generatedAt =
    options.generatedAt ?? new Date().toISOString()
  const filteredRows = filterLegacyProviderCreditAggregateRows(rows)
  const entries = filteredRows.map((row) =>
    normalizeProviderCreditLifecycleRow(row, { generatedAt })
  )
  const summaries = buildProviderCreditLifecycleSummaries(entries)
  return {
    data_source: 'provider_credit_current',
    freshness_label:
      'Current provider credit lifecycle from provider_credit_current',
    generated_at: generatedAt,
    summaries,
    entries,
  }
}

export function buildSessionDiagnosticsQuery(searchParams) {
  const { from, to, values, whereParts } =
    buildSessionDiagnosticsWhere(searchParams)
  const limit = parseSessionDiagnosticsLimit(searchParams.get('limit'))
  const candidateLimit = sessionDiagnosticsCandidateLimit(limit)
  values.push(candidateLimit)
  const candidateLimitPlaceholder = `$${values.length.toString()}`
  values.push(limit)
  const limitPlaceholder = `$${values.length.toString()}`

  const sql = `
WITH candidate_sessions AS MATERIALIZED (
    SELECT
        sh.created_at,
        sh.start_time,
        sh.end_time,
        sh.session_id::text AS session_id,
        NULLIF(sh.trace_id, '') AS trace_id,
        sh.litellm_call_id::text AS litellm_call_id,
        ${providerDimension} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        NULLIF(sh.model_group, '') AS model_group,
        COALESCE(sh.tenant_id, 'unknown') AS repository,
        COALESCE(sh.client_name, 'unknown') AS client,
        COALESCE(sh.client_version, '0.0.0') AS client_version,
        COALESCE(sh.litellm_environment, 'unknown') AS environment,
        NULLIF(sh.inbound_model_alias, '') AS inbound_model_alias,
        NULLIF(sh.agent_name, '') AS agent_name,
        NULLIF(sh.agent_id, '') AS agent_id,
        COALESCE(sh.metadata, '{}'::jsonb) AS metadata,
        COALESCE(sh.agent_score_reasons, '{}'::jsonb) AS agent_score_reasons
    FROM public.session_history sh
    WHERE ${whereParts.join('\n      AND ')}
    ORDER BY sh.created_at DESC
    LIMIT ${candidateLimitPlaceholder}
),
recent_sessions AS MATERIALIZED (
    SELECT *
    FROM candidate_sessions
    WHERE ${sessionDiagnosticsMetadataPresentClause()}
    ORDER BY created_at DESC
    LIMIT ${limitPlaceholder}
),
diagnostic_rows AS (
    SELECT
        rs.*,
        alias_audit.alias_route_events,
        tool_snapshots.tool_definition_snapshot
    FROM recent_sessions rs
    LEFT JOIN LATERAL (
        SELECT
            jsonb_agg(
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'observed_at', to_jsonb(aa)->>'observed_at',
                        'session_id', to_jsonb(aa)->>'session_id',
                        'trace_id', to_jsonb(aa)->>'trace_id',
                        'litellm_call_id', to_jsonb(aa)->>'litellm_call_id',
                        'alias_model', to_jsonb(aa)->>'alias_model',
                        'alias_family', to_jsonb(aa)->>'alias_family',
                        'provider', to_jsonb(aa)->>'provider',
                        'model', to_jsonb(aa)->>'model',
                        'route_family', to_jsonb(aa)->>'route_family',
                        'attempt_number', to_jsonb(aa)->>'attempt_number',
                        'event_type', to_jsonb(aa)->>'event_type',
                        'failure_class', to_jsonb(aa)->>'failure_class',
                        'cooldown_state', to_jsonb(aa)->>'cooldown_state',
                        'cooldown_until', to_jsonb(aa)->>'cooldown_until',
                        'redispatch_required', to_jsonb(aa)->>'redispatch_required',
                        'last_resort', to_jsonb(aa)->>'last_resort',
                        'details', to_jsonb(aa)->'details'
                    )
                )
                ORDER BY observed_at
            ) AS alias_route_events
        FROM public.aawm_alias_routing_audit aa
        WHERE (
            rs.metadata->>'aawm_alias_routing_audit_events' IS NOT NULL
            OR rs.metadata->>'codex_auto_agent_audit_events' IS NOT NULL
            OR rs.metadata->>'anthropic_auto_agent_audit_events' IS NOT NULL
        )
          AND (
              (
                  NULLIF(aa.litellm_call_id, '') IS NOT NULL
                  AND rs.litellm_call_id IS NOT NULL
                  AND NULLIF(aa.litellm_call_id, '') = rs.litellm_call_id
              )
              OR (
                  NULLIF(aa.session_id, '') IS NOT NULL
                  AND rs.session_id IS NOT NULL
                  AND NULLIF(aa.session_id, '') = rs.session_id
              )
              OR (
                  NULLIF(aa.trace_id, '') IS NOT NULL
                  AND rs.trace_id IS NOT NULL
                  AND NULLIF(aa.trace_id, '') = rs.trace_id
              )
          )
    ) alias_audit ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            jsonb_agg(
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'snapshot_hash', to_jsonb(td)->>'snapshot_hash',
                        'session_id', to_jsonb(td)->>'session_id',
                        'first_litellm_call_id', to_jsonb(td)->>'first_litellm_call_id',
                        'first_trace_id', to_jsonb(td)->>'first_trace_id',
                        'snapshot_storage_key', to_jsonb(td)->>'snapshot_storage_key',
                        'metadata', to_jsonb(td)->'metadata',
                        'sanitized_snapshot', to_jsonb(td)->'sanitized_snapshot'
                    )
                )
                ORDER BY COALESCE(to_jsonb(td)->>'created_at', to_jsonb(td)->>'updated_at') DESC NULLS LAST
            ) AS tool_definition_snapshot
        FROM public.session_history_tool_definition_snapshots td
        WHERE (
            rs.metadata->>'aawm_tool_definition_capture_version' IS NOT NULL
            OR rs.metadata->>'aawm_tool_definition_snapshot_hash' IS NOT NULL
            OR rs.metadata->>'aawm_tool_definition_snapshot' IS NOT NULL
        )
          AND rs.session_id IS NOT NULL
          AND NULLIF(td.session_id, '') = rs.session_id
          AND (
              NULLIF(rs.metadata->>'aawm_tool_definition_snapshot_hash', '') IS NULL
              OR NULLIF(td.snapshot_hash, '') = rs.metadata->>'aawm_tool_definition_snapshot_hash'
          )
    ) tool_snapshots ON TRUE
)
SELECT
    created_at,
    start_time,
    end_time,
    session_id,
    trace_id,
    litellm_call_id,
    provider,
    model,
    model_group,
    repository,
    client,
    client_version,
    environment,
    inbound_model_alias,
    agent_name,
    agent_id,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN metadata->>'credential_family' IS NOT NULL
             OR metadata->>'grok_native_oauth_managed' IS NOT NULL
             OR metadata->>'grok_native_entrypoint' IS NOT NULL
             THEN 'grok_oauth'::text END,
        CASE WHEN alias_route_events IS NOT NULL
             OR metadata->>'aawm_alias_routing_audit_events' IS NOT NULL
             OR metadata->>'codex_auto_agent_audit_events' IS NOT NULL
             OR metadata->>'anthropic_auto_agent_audit_events' IS NOT NULL
             THEN 'alias_routing'::text END,
        CASE WHEN metadata->>'usage_output_contract_required_final_phrase' IS NOT NULL
             OR metadata->>'usage_output_contract_required_final_phrase_present' IS NOT NULL
             OR metadata->>'usage_output_contract_failure_class' IS NOT NULL
             OR metadata->>'usage_output_contract_setup_only_detected' IS NOT NULL
             THEN 'output_contract'::text END,
        CASE WHEN metadata->>'aawm_tool_definition_capture_version' IS NOT NULL
             OR metadata->>'aawm_tool_definition_snapshot_hash' IS NOT NULL
             OR metadata->>'aawm_tool_definition_snapshot' IS NOT NULL
             THEN 'tool_definitions'::text END,
        CASE WHEN metadata->>'xai_responses_request_sanitized' IS NOT NULL
             OR metadata->>'xai_responses_sanitized_removed_params' IS NOT NULL
             OR metadata->>'xai_tool_choice_without_tools_removed' IS NOT NULL
             OR metadata->>'xai_tool_choice_without_tools_removed_reason' IS NOT NULL
             THEN 'xai_sanitizer'::text END,
        CASE WHEN metadata->>'session_history_transcript_attribution_status' IS NOT NULL
             OR metadata->>'session_history_transcript_attribution_source' IS NOT NULL
             OR metadata->>'session_history_transcript_attribution' IS NOT NULL
             THEN 'transcript_attribution'::text END,
        CASE WHEN lower(COALESCE(metadata->>'grok_side_channel', '')) = 'true'
             OR metadata->>'grok_side_channel_endpoint_type' IS NOT NULL
             OR metadata->>'grok_side_channel_endpoint_path_template' IS NOT NULL
             OR metadata->>'grok_side_channel_request_body_sha256' IS NOT NULL
             THEN 'grok_side_channel'::text END,
        CASE WHEN metadata->>'anthropic_context_window_mode' IS NOT NULL
             OR metadata->>'anthropic_context_window_requested_tokens' IS NOT NULL
             OR metadata->>'anthropic_context_window_source' IS NOT NULL
             OR metadata->>'anthropic_context_window_beta' IS NOT NULL
             OR metadata->>'anthropic_context_window_classification' IS NOT NULL
             THEN 'anthropic_context_window'::text END
    ], NULL) AS diagnostic_flags,
    ARRAY_REMOVE(ARRAY[
        CASE WHEN metadata->>'credential_family' IS NOT NULL
             OR metadata->>'grok_native_oauth_managed' IS NOT NULL
             THEN 'route_identity'::text END,
        CASE WHEN alias_route_events IS NOT NULL
             OR metadata->>'aawm_alias_routing_audit_events' IS NOT NULL
             THEN 'route_timeline'::text END,
        CASE WHEN metadata->>'usage_output_contract_required_final_phrase_present' IS NOT NULL
             OR metadata->>'usage_output_contract_failure_class' IS NOT NULL
             THEN 'agent_quality'::text END,
        CASE WHEN metadata->>'aawm_tool_definition_snapshot_hash' IS NOT NULL
             OR metadata->>'aawm_tool_definition_snapshot' IS NOT NULL
             THEN 'tool_contract'::text END,
        CASE WHEN metadata->>'xai_responses_request_sanitized' IS NOT NULL
             OR metadata->>'xai_tool_choice_without_tools_removed' IS NOT NULL
             THEN 'request_shape'::text END,
        CASE WHEN lower(COALESCE(metadata->>'grok_side_channel', '')) = 'true'
             OR metadata->>'grok_side_channel_endpoint_type' IS NOT NULL
             OR metadata->>'grok_side_channel_endpoint_path_template' IS NOT NULL
             OR metadata->>'grok_side_channel_request_body_sha256' IS NOT NULL
             THEN 'request_shape'::text END,
        CASE WHEN metadata->>'session_history_transcript_attribution_status' IS NOT NULL
             THEN 'model_attribution'::text END,
        CASE WHEN metadata->>'anthropic_context_window_mode' IS NOT NULL
             OR metadata->>'anthropic_context_window_requested_tokens' IS NOT NULL
             OR metadata->>'anthropic_context_window_source' IS NOT NULL
             OR metadata->>'anthropic_context_window_beta' IS NOT NULL
             OR metadata->>'anthropic_context_window_classification' IS NOT NULL
             THEN 'context_window'::text END
    ], NULL) AS diagnostic_categories,
    jsonb_strip_nulls(jsonb_build_object(
        'credential_family', NULLIF(metadata->>'credential_family', ''),
        'grok_native_oauth_managed',
            CASE WHEN metadata ? 'grok_native_oauth_managed'
                 THEN lower(COALESCE(metadata->>'grok_native_oauth_managed', '')) = 'true'
            END,
        'grok_native_entrypoint', NULLIF(metadata->>'grok_native_entrypoint', ''),
        'passthrough_route_family', NULLIF(metadata->>'passthrough_route_family', ''),
        'route_family', NULLIF(metadata->>'route_family', ''),
        'auth_mode', NULLIF(metadata->>'auth_mode', ''),
        'grok_model_override', NULLIF(metadata->>'grok_model_override', '')
    )) AS grok_oauth,
    jsonb_strip_nulls(jsonb_build_object(
        'enabled',
            CASE WHEN metadata ? 'grok_side_channel'
                 THEN lower(COALESCE(metadata->>'grok_side_channel', '')) = 'true'
            END,
        'endpoint_type', NULLIF(metadata->>'grok_side_channel_endpoint_type', ''),
        'endpoint_template', NULLIF(metadata->>'grok_side_channel_endpoint_path_template', ''),
        'content_type', NULLIF(metadata->>'grok_side_channel_request_content_type', ''),
        'body_byte_length',
            CASE WHEN COALESCE(metadata->>'grok_side_channel_request_body_byte_length', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'grok_side_channel_request_body_byte_length')::integer
            END,
        'body_sha256', NULLIF(metadata->>'grok_side_channel_request_body_sha256', ''),
        'digest_source', NULLIF(metadata->>'grok_side_channel_request_body_digest_source', ''),
        'json_container_type', NULLIF(metadata->>'grok_side_channel_request_json_container_type', ''),
        'top_level_key_types', metadata->'grok_side_channel_request_top_level_key_types',
        'array_length',
            CASE WHEN COALESCE(metadata->>'grok_side_channel_request_array_length', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'grok_side_channel_request_array_length')::integer
            END
    )) AS grok_side_channel,
    jsonb_strip_nulls(jsonb_build_object(
        'usage_output_contract_required_final_phrase', NULLIF(metadata->>'usage_output_contract_required_final_phrase', ''),
        'usage_output_contract_required_final_phrase_present',
            CASE WHEN metadata ? 'usage_output_contract_required_final_phrase_present'
                 THEN lower(COALESCE(metadata->>'usage_output_contract_required_final_phrase_present', '')) = 'true'
            END,
        'usage_output_contract_required_final_phrase_source', NULLIF(metadata->>'usage_output_contract_required_final_phrase_source', ''),
        'usage_output_contract_failure_class', NULLIF(metadata->>'usage_output_contract_failure_class', ''),
        'usage_output_contract_failure_count',
            CASE WHEN COALESCE(metadata->>'usage_output_contract_failure_count', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'usage_output_contract_failure_count')::integer
            END,
        'usage_output_contract_setup_only_detected',
            CASE WHEN metadata ? 'usage_output_contract_setup_only_detected'
                 THEN lower(COALESCE(metadata->>'usage_output_contract_setup_only_detected', '')) = 'true'
            END,
        'usage_output_contract_setup_only_markers', metadata->'usage_output_contract_setup_only_markers',
        'usage_output_contract_final_text_chars',
            CASE WHEN COALESCE(metadata->>'usage_output_contract_final_text_chars', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'usage_output_contract_final_text_chars')::integer
            END,
        'usage_agent_score_reasons', COALESCE(metadata->'usage_agent_score_reasons', agent_score_reasons)
    )) AS output_contract,
    jsonb_strip_nulls(jsonb_build_object(
        'xai_responses_request_sanitized',
            CASE WHEN metadata ? 'xai_responses_request_sanitized'
                 THEN lower(COALESCE(metadata->>'xai_responses_request_sanitized', '')) = 'true'
            END,
        'xai_responses_sanitized_removed_params', metadata->'xai_responses_sanitized_removed_params',
        'xai_responses_sanitized_tool_count',
            CASE WHEN COALESCE(metadata->>'xai_responses_sanitized_tool_count', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'xai_responses_sanitized_tool_count')::integer
            END,
        'xai_responses_sanitized_tool_types', metadata->'xai_responses_sanitized_tool_types',
        'xai_responses_sanitized_tools', metadata->'xai_responses_sanitized_tools',
        'xai_tool_choice_without_tools_removed', COALESCE(metadata->'xai_tool_choice_without_tools_removed', to_jsonb(NULLIF(metadata->>'xai_tool_choice_without_tools_removed', ''))),
        'xai_tool_choice_without_tools_removed_reason', NULLIF(metadata->>'xai_tool_choice_without_tools_removed_reason', ''),
        'request_tags', metadata->'request_tags',
        'openai_passthrough_route_family', NULLIF(metadata->>'openai_passthrough_route_family', ''),
        'passthrough_route_family', NULLIF(metadata->>'passthrough_route_family', ''),
        'route_family', NULLIF(metadata->>'route_family', ''),
        'credential_family', NULLIF(metadata->>'credential_family', '')
    )) AS xai_sanitizer,
    jsonb_strip_nulls(jsonb_build_object(
        'session_history_transcript_attribution_status', NULLIF(metadata->>'session_history_transcript_attribution_status', ''),
        'session_history_transcript_attribution_source', NULLIF(metadata->>'session_history_transcript_attribution_source', ''),
        'reason', NULLIF(metadata->'session_history_transcript_attribution'->>'reason', ''),
        'match_rule', NULLIF(metadata->'session_history_transcript_attribution'->>'match_rule', ''),
        'updated_at', NULLIF(metadata->'session_history_transcript_attribution'->>'updated_at', ''),
        'session_history_transcript_attribution', COALESCE(metadata->'session_history_transcript_attribution', to_jsonb(NULLIF(metadata->>'session_history_transcript_attribution', '')))
    )) AS transcript_attribution,
    jsonb_strip_nulls(jsonb_build_object(
        'aawm_tool_definition_capture_version', NULLIF(metadata->>'aawm_tool_definition_capture_version', ''),
        'aawm_tool_definition_capture_source', NULLIF(metadata->>'aawm_tool_definition_capture_source', ''),
        'aawm_tool_definition_count',
            CASE WHEN COALESCE(metadata->>'aawm_tool_definition_count', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'aawm_tool_definition_count')::integer
            END,
        'aawm_tool_definition_captured_count',
            CASE WHEN COALESCE(metadata->>'aawm_tool_definition_captured_count', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'aawm_tool_definition_captured_count')::integer
            END,
        'aawm_tool_definition_sources', metadata->'aawm_tool_definition_sources',
        'aawm_tool_definition_names', metadata->'aawm_tool_definition_names',
        'aawm_tool_definition_types', metadata->'aawm_tool_definition_types',
        'snapshot_hash', NULLIF(metadata->>'aawm_tool_definition_snapshot_hash', ''),
        'aawm_tool_definition_snapshot_truncated',
            CASE WHEN metadata ? 'aawm_tool_definition_snapshot_truncated'
                 THEN lower(COALESCE(metadata->>'aawm_tool_definition_snapshot_truncated', '')) = 'true'
            END,
        'aawm_tool_definition_snapshot_storage', NULLIF(metadata->>'aawm_tool_definition_snapshot_storage', ''),
        'aawm_tool_definition_snapshot_storage_key', NULLIF(metadata->>'aawm_tool_definition_snapshot_storage_key', ''),
        'tool_definition_snapshot', COALESCE(tool_definition_snapshot, metadata->'aawm_tool_definition_snapshot')
    )) AS tool_definitions,
    jsonb_strip_nulls(jsonb_build_object(
        'mode', NULLIF(metadata->>'anthropic_context_window_mode', ''),
        'requested_tokens',
            CASE WHEN COALESCE(metadata->>'anthropic_context_window_requested_tokens', '') ~ '^-?[0-9]+$'
                 THEN (metadata->>'anthropic_context_window_requested_tokens')::bigint
            END,
        'source', NULLIF(metadata->>'anthropic_context_window_source', ''),
        'beta', NULLIF(metadata->>'anthropic_context_window_beta', ''),
        'classification', COALESCE(
            metadata->'anthropic_context_window_classification',
            to_jsonb(NULLIF(metadata->>'anthropic_context_window_classification', ''))
        )
    )) AS anthropic_context_window,
    COALESCE(
        alias_route_events,
        metadata->'aawm_alias_routing_audit_events',
        metadata->'codex_auto_agent_audit_events',
        metadata->'anthropic_auto_agent_audit_events',
        '[]'::jsonb
    ) AS alias_route_events
FROM diagnostic_rows
ORDER BY created_at DESC;
`

  return { sql, values, metadata: { from, to, limit, candidateLimit } }
}


function normalizeAnthropicContextWindow(value) {
  const record = normalizeJsonRecord(value)
  const mode =
    typeof record.mode === 'string' && record.mode.trim() !== ''
      ? record.mode.trim()
      : null
  const source =
    typeof record.source === 'string' && record.source.trim() !== ''
      ? record.source.trim()
      : null
  const beta =
    typeof record.beta === 'string' && record.beta.trim() !== ''
      ? record.beta.trim()
      : null
  const requestedTokens = normalizeNumber(record.requested_tokens)
  const classification =
    record.classification === undefined || record.classification === null
      ? null
      : record.classification
  if (
    mode == null &&
    source == null &&
    beta == null &&
    requestedTokens == null &&
    classification == null
  ) {
    return null
  }
  return {
    mode,
    requested_tokens: requestedTokens,
    source,
    beta,
    classification,
  }
}

function normalizeSessionDiagnosticsRow(row) {
  return {
    created_at: row.created_at ?? null,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    session_id: row.session_id ?? null,
    trace_id: row.trace_id ?? null,
    litellm_call_id: row.litellm_call_id ?? null,
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    model_group: row.model_group ?? null,
    repository: row.repository ?? 'unknown',
    client: row.client ?? 'unknown',
    client_version: row.client_version ?? '0.0.0',
    environment: row.environment ?? 'unknown',
    inbound_model_alias: row.inbound_model_alias ?? null,
    agent_name: row.agent_name ?? null,
    agent_id: row.agent_id ?? null,
    diagnostic_flags: normalizeStringArray(row.diagnostic_flags),
    diagnostic_categories: normalizeStringArray(row.diagnostic_categories),
    grok_oauth: normalizeJsonRecord(row.grok_oauth),
    grok_side_channel: normalizeJsonRecord(row.grok_side_channel),
    output_contract: normalizeJsonRecord(row.output_contract),
    xai_sanitizer: normalizeJsonRecord(row.xai_sanitizer),
    transcript_attribution: normalizeJsonRecord(row.transcript_attribution),
    tool_definitions: normalizeJsonRecord(row.tool_definitions),
    anthropic_context_window: normalizeAnthropicContextWindow(
      row.anthropic_context_window
    ),
    alias_route_events: Array.isArray(row.alias_route_events)
      ? row.alias_route_events
      : [],
  }
}

async function loadQuotaReport(options = {}) {
  return cachedReport('quotas', loadQuotaReportWithDatabaseTimeoutHandling, {
    decorateMetadata: options.decorateMetadata,
    lockWaitMs: 10_000,
    refreshStaleInForeground: true,
    searchParams: options.searchParams,
  })
}

async function loadQuotaReportWithDatabaseTimeoutHandling() {
  try {
    return await loadQuotaReportFromDatabase()
  } catch (error) {
    if (isDatabaseTimeoutError(error)) {
      return buildDegradedQuotaReport()
    }
    throw error
  }
}

async function loadQuotaReportFromDatabase() {
  const quotaQuery = buildQuotaQuery()
  const quotaVelocityQuery = buildQuotaVelocityQuery()
  const freshnessQuery = buildFreshnessQuery()
  const [quotaResult, quotaVelocityResult, freshnessResult] =
    await runTasksWithConcurrency(
      [
        () => queryReportDatabase(quotaQuery.sql, quotaQuery.values),
        () =>
          queryReportDatabase(quotaVelocityQuery.sql, quotaVelocityQuery.values),
        () => queryReportDatabase(freshnessQuery.sql, freshnessQuery.values),
      ],
      REPORT_SQL_FANOUT_CONCURRENCY
    )
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
    ...Object.fromEntries(
      configChangeAggregateNumericKeys.map((key) => [
        key,
        normalizeNumber(row[key]) ?? 0,
      ])
    ),
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
  'agent_discovery_inventory_coverage_score',
  'agent_discovery_inventory_coverage_evaluated',
  'agent_discovery_inventory_coverage_possible',
  'agent_discovery_inventory_coverage_failures',
  'agent_terminal_completion_score',
  'agent_terminal_completion_evaluated',
  'agent_terminal_completion_possible',
  'agent_terminal_completion_failures',
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
  'agent_sleep_wellness_interruption_attempted_score',
  'agent_sleep_wellness_interruption_attempted_evaluated',
  'agent_sleep_wellness_interruption_attempted_incidents',
  'agent_sleep_wellness_interruption_incident_score',
  'agent_sleep_wellness_interruption_incident_evaluated',
  'agent_sleep_wellness_interruption_incidents',
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

function normalizeStringArray(value) {
  const source = (() => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : [value]
      } catch {
        return [value]
      }
    }
    return []
  })()

  return source
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function normalizeJsonRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      return {}
    }
  }
  return {}
}

function hasRecordEntries(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0
}

function normalizeQuotaBillingDetail(row, prefix) {
  const rawProviderFields = normalizeJsonRecord(
    row[`${prefix}_raw_provider_fields`]
  )
  const evidence = normalizeJsonRecord(row[`${prefix}_evidence`])
  const detail = {
    quota_key: row[`${prefix}_quota_key`] ?? null,
    source: row[`${prefix}_source`] ?? null,
    client: row[`${prefix}_client`] ?? null,
    quota_unit: row[`${prefix}_quota_unit`] ?? null,
    quota_limit: normalizeNumber(row[`${prefix}_quota_limit`]),
    quota_used: normalizeNumber(row[`${prefix}_quota_used`]),
    quota_remaining: normalizeNumber(row[`${prefix}_quota_remaining`]),
    billing_observed_at: row[`${prefix}_billing_observed_at`] ?? null,
    billing_period_start_at: row[`${prefix}_billing_period_start_at`] ?? null,
    billing_period_end_at: row[`${prefix}_billing_period_end_at`] ?? null,
    raw_provider_fields: rawProviderFields,
    evidence,
  }
  const hasBillingValue =
    detail.quota_key !== null ||
    detail.source !== null ||
    detail.client !== null ||
    detail.quota_unit !== null ||
    detail.quota_limit !== null ||
    detail.quota_used !== null ||
    detail.quota_remaining !== null ||
    detail.billing_observed_at !== null ||
    detail.billing_period_start_at !== null ||
    detail.billing_period_end_at !== null ||
    hasRecordEntries(rawProviderFields) ||
    hasRecordEntries(evidence)

  return hasBillingValue ? detail : null
}

function normalizeQuotaBillingDetails(row) {
  const details = {}
  for (const quotaType of QUOTA_LANE_TYPES) {
    const detail = normalizeQuotaBillingDetail(row, quotaType)
    if (detail !== null) {
      details[quotaType] = detail
    }
  }
  return details
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
  for (const quotaType of QUOTA_LANE_TYPES) {
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

function normalizeQuotaLaneFields(row, quotaType) {
  return {
    [`${quotaType}_remaining_pct`]: normalizeNumber(
      row[`${quotaType}_remaining_pct`]
    ),
    [`${quotaType}_reset_at`]: row[`${quotaType}_reset_at`] ?? null,
    [`${quotaType}_interval_start`]:
      row[`${quotaType}_interval_start`] ?? null,
    [`${quotaType}_interval_end`]: row[`${quotaType}_interval_end`] ?? null,
    [`${quotaType}_active`]: Boolean(
      normalizeNumber(row[`${quotaType}_active`])
    ),
    [`${quotaType}_usage_tokens`]:
      normalizeNumber(row[`${quotaType}_usage_tokens`]) ?? 0,
    [`${quotaType}_usage_breakdown`]: normalizeUsageBreakdown(
      row[`${quotaType}_usage_breakdown`]
    ),
    [`${quotaType}_velocity_segments`]: normalizeQuotaVelocitySegments(
      row[`${quotaType}_velocity_segments`]
    ),
    [`${quotaType}_velocity_scores`]: normalizeQuotaVelocityScores(
      row[`${quotaType}_velocity_scores`]
    ),
    [`${quotaType}_velocity_sample_count`]:
      normalizeNumber(row[`${quotaType}_velocity_sample_count`]) ?? 0,
  }
}

export function normalizeQuotaRow(row) {
  return {
    provider: row.provider,
    model: row.model ?? null,
    billing_details: normalizeQuotaBillingDetails(row),
    ...Object.assign(
      {},
      ...QUOTA_LANE_TYPES.map((quotaType) =>
        normalizeQuotaLaneFields(row, quotaType)
      )
    ),
  }
}

function normalizeQuotaHistoryRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? null,
    quota_type: row.quota_type ?? 'unknown',
    quota_key: row.quota_key ?? null,
    source: row.source ?? null,
    client: row.client ?? null,
    quota_unit: row.quota_unit ?? null,
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
    quota_limit: normalizeNumber(row.quota_limit),
    quota_used: normalizeNumber(row.quota_used),
    quota_remaining: normalizeNumber(row.quota_remaining),
    billing_period_start_at: row.billing_period_start_at ?? null,
    billing_period_end_at: row.billing_period_end_at ?? null,
    raw_provider_fields: normalizeJsonRecord(row.raw_provider_fields),
    evidence: normalizeJsonRecord(row.evidence),
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

export function proxyHeaders(req, proxyConfig) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase()
    if (
      HOP_BY_HOP_HEADERS.has(lowerKey) ||
      CLIENT_AUTH_HEADERS.has(lowerKey) ||
      INTERNAL_PROXY_HEADERS.has(lowerKey)
    ) {
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
  const { sort, sortDirection } = parseUsageReportSort(searchParams)

  const values = [from, to]
  const whereParts = [...startTimeDateRangeWhere]
  appendFastUsageSignalWhere(whereParts)

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }
  appendConfigChangeFilters(searchParams, whereParts)

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
    SELECT
${usageFilteredColumnSelects.join(',\n')}
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
    ${configChangeAggregateSelectParts.join(',\n    ')},

    ROUND(CAST(SUM(COALESCE(sh.litellm_processing_ms, 0)) AS numeric), 2)::double precision AS litellm_processing_total_ms,
    ROUND(CAST(AVG(sh.litellm_processing_ms) AS numeric), 2)::double precision AS litellm_processing_average_ms,

    ROUND(CAST(SUM(COALESCE(sh.llm_upstream_elapsed_ms, 0)) AS numeric), 2)::double precision AS llm_upstream_elapsed_total_ms,
    ROUND(CAST(AVG(sh.llm_upstream_elapsed_ms) AS numeric), 2)::double precision AS llm_upstream_elapsed_average_ms,

    ${fastUsageLatencyMetricSelectParts.join(',\n    ')},

    ${fastUsageAgentScoreSelectParts.join(',\n    ')},

    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end
FROM filtered sh
GROUP BY
    ${groupParts.join(',\n    ')}
),
reason_bounds AS (
    SELECT
        GREATEST(COALESCE(MAX(id), 0) - ${AGENT_SCORE_REASON_RECENT_ROW_LIMIT}::bigint, 0) AS min_id,
        COALESCE(MAX(id), 0) AS max_id,
        ${AGENT_SCORE_REASON_RECENT_ROW_LIMIT}::bigint AS recent_row_limit
    FROM public.session_history
),
reason_cap_state AS (
    SELECT
        rb.min_id AS agent_score_reasons_bounded_min_id,
        rb.max_id AS agent_score_reasons_bounded_max_id,
        rb.recent_row_limit AS agent_score_reasons_recent_row_limit,
        true AS agent_score_reasons_recent_id_cap_active,
        EXISTS (
            SELECT 1
            FROM public.session_history sh_window
            WHERE sh_window.created_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')
              AND sh_window.created_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')
              AND sh_window.id <= rb.min_id
              AND sh_window.agent_score_reasons IS NOT NULL
              AND sh_window.agent_score_reasons <> '{}'::jsonb
        ) AS agent_score_reasons_recent_id_cap_truncates_requested_window
    FROM reason_bounds rb
),
reason_source AS MATERIALIZED (
    SELECT
${usageFilteredColumnSelects.join(',\n')}
    FROM public.session_history sh
    CROSS JOIN reason_bounds rb
    WHERE sh.id > rb.min_id
      AND ${whereParts.join('\n      AND ')}
      AND sh.agent_score_reasons IS NOT NULL
      AND sh.agent_score_reasons <> '{}'::jsonb
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
FROM reason_source sh
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
WHERE (
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
    COALESCE(reason_summary.agent_score_reasons_top, '[]'::jsonb) AS agent_score_reasons_top,
    cap.agent_score_reasons_bounded_min_id,
    cap.agent_score_reasons_bounded_max_id,
    cap.agent_score_reasons_recent_row_limit,
    cap.agent_score_reasons_recent_id_cap_active,
    cap.agent_score_reasons_recent_id_cap_truncates_requested_window
FROM base
CROSS JOIN reason_cap_state cap
LEFT JOIN reason_summary
  ON ${reasonJoinParts.join('\n  AND ')}
ORDER BY ${sort} ${sortDirection}
LIMIT $${values.length};
`

  return {
    sql,
    values,
    metadata: {
      from,
      to,
      grain,
      groupBy,
      limit,
      agentScoreReasonsRecentRowLimit: AGENT_SCORE_REASON_RECENT_ROW_LIMIT,
      agentScoreReasonsRecentIdCapActive: true,
    },
  }
}


function capDockerJsonLogSourcesForScan(sources, options = {}) {
  const list = Array.isArray(sources) ? sources : []
  const maxSources = Number(options.maxSources ?? DOCKER_LOG_SCAN_MAX_SOURCES)
  const maxTotalBytes = Number(
    options.maxTotalBytes ?? DOCKER_LOG_SCAN_MAX_TOTAL_BYTES
  )
  const perFileDefault = Number(options.perFileTailBytes ?? DOCKER_LOG_TAIL_BYTES)
  const cappedSources = list.slice(0, Math.max(0, maxSources))
  let remainingBytes = Math.max(0, maxTotalBytes)
  const selected = []
  for (const source of cappedSources) {
    if (remainingBytes <= 0) break
    const tailBytes = Math.min(perFileDefault, remainingBytes)
    if (tailBytes <= 0) break
    selected.push({ ...source, tailBytes })
    remainingBytes -= tailBytes
  }
  return selected
}

function isDockerLogScanCacheFresh(cachedAt, ttlMs = DOCKER_LOG_SCAN_CACHE_TTL_MS) {
  const ttl = Number(ttlMs)
  if (!Number.isFinite(ttl) || ttl <= 0) return false
  return Date.now() - Number(cachedAt) < ttl
}

function resetDockerLogScanCachesForTests() {
  dockerLogJsonSourcesCache = null
  dockerLogErrorsScanCache = null
  dockerLogScanSourceCache = new Map()
  dockerLogTailReadCountForTests = 0
}

function computeDockerLogSourceCacheKey(source = {}) {
  return `${source.container ?? ''}|${source.logPath ?? ''}`
}

function filterDockerLogRowsByCutoff(rows, cutoffMs) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const observedAt = Date.parse(row?.observed_at ?? '')
    return Number.isFinite(observedAt) && observedAt >= cutoffMs
  })
}

async function findDockerJsonLogSources() {
  if (
    dockerLogJsonSourcesCache &&
    isDockerLogScanCacheFresh(dockerLogJsonSourcesCache.cachedAt)
  ) {
    return dockerLogJsonSourcesCache.sources
  }

  if (!shouldDiscoverDockerJsonLogSources(DOCKER_LOG_CONTAINER_NAMES)) {
    dockerLogJsonSourcesCache = { sources: [], cachedAt: Date.now() }
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
    dockerLogJsonSourcesCache = { sources: [], cachedAt: Date.now() }
    return []
  }

  const configs = []
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
    configs.push({ containerDir, entryId: entry.name, config })
  }

  const sources = discoverDockerJsonLogSourcesFromConfigs(
    configs,
    DOCKER_LOG_CONTAINER_NAMES
  )
  dockerLogJsonSourcesCache = { sources, cachedAt: Date.now() }
  return sources
}

async function readFileTail(filePath, maxBytes, stats) {
  dockerLogTailReadCountForTests += 1
  const handle = await open(filePath, 'r')
  try {
    const fileStats = stats ?? (await handle.stat())
    const length = Math.min(fileStats.size, maxBytes)
    const offset = Math.max(0, fileStats.size - length)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    return { text: buffer.toString('utf8'), truncated: offset > 0 }
  } finally {
    await handle.close()
  }
}

async function readDockerLogFileStats(filePath) {
  const handle = await open(filePath, 'r')
  try {
    return await handle.stat()
  } finally {
    await handle.close()
  }
}


async function persistDockerLogErrorsToIntake(rows) {
  const fresh = selectNewDockerLogErrors(rows, dockerLogErrorIntakeSeenFingerprints)
  if (!fresh.length) return
  try {
    const result = await appendDockerLogErrorsToIntake({
      intakeDir: DOCKER_LOG_ERROR_INTAKE_DIR,
      rows: fresh,
      seenFingerprints: dockerLogErrorIntakeSeenFingerprints,
    })
    if (result.appended > 0) {
      process.stderr.write(
        `[report-service] INFO: appended ${result.appended} docker log error row(s) to ${DOCKER_LOG_ERROR_INTAKE_DIR}\n`
      )
    }
  } catch (error) {
    process.stderr.write(
      `[report-service] WARN: unable to append docker log errors to intake: ${formatError(error)}\n`
    )
  }
}

async function scanDockerLogErrorsFromSources(sources) {
  if (!sources?.length) return []

  const cutoffMs = Date.now() - 90 * 60 * 1000
  const rows = []
  const scanSources = capDockerJsonLogSourcesForScan(sources)
  const nextSourceCache = new Map()

  for (const source of scanSources) {
    const sourceCacheKey = computeDockerLogSourceCacheKey(source)
    const tailBytes = source.tailBytes ?? DOCKER_LOG_TAIL_BYTES

    let stats
    try {
      stats = await readDockerLogFileStats(source.logPath)
    } catch (error) {
      process.stderr.write(
        `[report-service] WARN: unable to read Docker log metadata ${source.container}: ${formatError(error)}\n`
      )
      continue
    }

    const cached = dockerLogScanSourceCache.get(sourceCacheKey)
    const unchanged =
      cached &&
      cached.tailBytes === tailBytes &&
      cached.size === stats.size &&
      cached.mtimeMs === stats.mtimeMs

    if (unchanged) {
      rows.push(...filterDockerLogRowsByCutoff(cached.rows, cutoffMs))
      nextSourceCache.set(sourceCacheKey, cached)
      continue
    }

    let tail
    try {
      tail = await readFileTail(
        source.logPath,
        tailBytes,
        stats
      )
    } catch (error) {
      process.stderr.write(
        `[report-service] WARN: unable to read Docker log ${source.container}: ${formatError(error)}\n`
      )
      continue
    }

    const extracted = extractDockerLogErrorsFromTail({
      tailText: tail.text,
      truncated: tail.truncated,
      container: source.container,
      cutoffMs,
      source: {
        sourceIdentity: 'docker-json-log',
        sourcePath: source.logPath,
      },
    })
    rows.push(...extracted)
    nextSourceCache.set(sourceCacheKey, {
      rows: extracted,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      tailBytes,
    })
  }

  dockerLogScanSourceCache = nextSourceCache

  return rows.sort((a, b) =>
    String(b.observed_at).localeCompare(String(a.observed_at))
  )
}

async function loadDockerLogErrors() {
  if (loadDockerLogErrorsTestImpl) {
    return loadDockerLogErrorsTestImpl()
  }

  if (
    dockerLogErrorsScanCache &&
    isDockerLogScanCacheFresh(dockerLogErrorsScanCache.cachedAt)
  ) {
    const forCentralizedIntake = filterDockerLogErrorsForCentralizedIntake(
      dockerLogErrorsScanCache.sortedRows,
      { env: process.env }
    )
    await persistDockerLogErrorsToIntake(forCentralizedIntake)
    return dockerLogErrorsScanCache.forDashboard
  }

  const sources = await findDockerJsonLogSources()
  if (!sources.length) {
    dockerLogErrorsScanCache = {
      sortedRows: [],
      forDashboard: [],
      cachedAt: Date.now(),
    }
    return []
  }

  const sorted = await scanDockerLogErrorsFromSources(sources)

  const { forDashboard } = splitDockerLogErrorsForDashboardAndIntake(
    sorted,
    MAX_DOCKER_LOG_ERROR_ROWS
  )
  dockerLogErrorsScanCache = {
    sortedRows: sorted,
    forDashboard,
    cachedAt: Date.now(),
  }

  const forCentralizedIntake = filterDockerLogErrorsForCentralizedIntake(sorted, {
    env: process.env,
  })
  await persistDockerLogErrorsToIntake(forCentralizedIntake)
  return forDashboard
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

export function classifyRedisPingProbeResponse(accumulated) {
  const text = String(accumulated ?? '')
  const newlineIdx = text.indexOf('\r\n')
  if (newlineIdx < 0) return null
  const line = text.slice(0, newlineIdx)
  return {
    status: line === '+PONG' ? 'green' : 'yellow',
    detail: line,
  }
}

function probeRedisHealth(probe, checkedAt) {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let settled = false
    let timeout
    let accumulated = ''
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
    socket.on('data', (buffer) => {
      accumulated += buffer.toString('utf8')
      const classified = classifyRedisPingProbeResponse(accumulated)
      if (!classified) return
      finish(classified.status, classified.detail)
    })
  })
}

async function loadLocalHealth() {
  if (loadLocalHealthTestImpl) {
    return loadLocalHealthTestImpl()
  }
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

const USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEYS = [
  'provider_alias_routing',
  'provider_auth_health',
  'provider_credit_lifecycle',
  'docker_log_errors',
  'local_health',
]

const USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEY_SET = new Set(
  USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEYS
)

function buildEmptyUsageReportProviderAliasRoutingReport(options = {}) {
  return normalizeProviderAliasRoutingReport([], options)
}

function buildEmptyUsageReportProviderAuthHealthReport(options = {}) {
  return normalizeProviderAuthHealthReport([], options)
}

function buildEmptyUsageReportProviderCreditLifecycleReport(options = {}) {
  return normalizeProviderCreditLifecycleReport([], options)
}

export function buildUsageReportAuxiliaryDegradedMetadata(
  unavailableAuxiliarySections = []
) {
  const normalizedSections = Array.from(
    new Set(
      (unavailableAuxiliarySections ?? []).filter(
        (sectionKey) =>
          typeof sectionKey === 'string' &&
          USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEY_SET.has(sectionKey)
      )
    )
  )
  if (!normalizedSections.length) {
    return {}
  }
  const sectionList = normalizedSections.map((key) => `"${key}"`).join(', ')
  return {
    degraded: true,
    degradedReason: 'auxiliary_fanout_failure',
    unavailableAuxiliarySections: normalizedSections,
    degradedMessage:
      normalizedSections.length === 1
        ? `Usage report auxiliary section ${sectionList} is unavailable; returning empty fallback payload.`
        : `Usage report auxiliary sections ${sectionList} are unavailable; returning empty fallback payloads.`,
  }
}

async function runUsageReportFanoutTasks(labeledTasks, concurrency) {
  const results = new Array(labeledTasks.length)
  await runTasksWithConcurrency(
    labeledTasks.map(({ taskKey, task }, index) => async () => {
      try {
        const value = await task()
        results[index] = {
          status: 'fulfilled',
          taskKey,
          value,
        }
      } catch (error) {
        results[index] = {
          status: 'rejected',
          taskKey,
          error,
        }
      }
    }),
    concurrency
  )

  const unavailableAuxiliarySections = []
  for (const result of results) {
    if (result.status === 'fulfilled') continue
    if (USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEY_SET.has(result.taskKey)) {
      unavailableAuxiliarySections.push(result.taskKey)
      continue
    }
    throw result.error
  }

  return {
    results,
    unavailableAuxiliarySections,
  }
}

function resolveUsageReportFanoutValue(results, taskKey, fallback) {
  const match = results.find(
    (result) => result.taskKey === taskKey && result.status === 'fulfilled'
  )
  return match?.value ?? fallback
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
  const providerAliasRoutingQuery = buildProviderAliasRoutingQuery(searchParams)
  const providerAuthHealthQuery = buildProviderAuthHealthQuery(searchParams)
  const providerCreditLifecycleQuery =
    buildProviderCreditLifecycleQuery(searchParams)

  const fanoutTasks = [
    {
      taskKey: 'usage_rows',
      task: () =>
        queryReportDatabase(sql, values, { usageReportTaskKey: 'usage_rows' }),
    },
    {
      taskKey: 'summary',
      task: () =>
        queryReportDatabase(summaryQuery.sql, summaryQuery.values, {
          usageReportTaskKey: 'summary',
        }),
    },
    {
      taskKey: 'trend',
      task: () =>
        queryReportDatabase(trendQuery.sql, trendQuery.values, {
          usageReportTaskKey: 'trend',
        }),
    },
    {
      taskKey: 'client_usage',
      task: () =>
        queryReportDatabase(clientUsageQuery.sql, clientUsageQuery.values, {
          usageReportTaskKey: 'client_usage',
        }),
    },
    {
      taskKey: 'provider_latency_health',
      task: () =>
        queryReportDatabase(
          providerLatencyHealthQuery.sql,
          providerLatencyHealthQuery.values,
          { usageReportTaskKey: 'provider_latency_health' }
        ),
    },
    {
      taskKey: 'provider_error_observations',
      task: () =>
        queryReportDatabase(
          providerErrorObservationQuery.sql,
          providerErrorObservationQuery.values,
          { usageReportTaskKey: 'provider_error_observations' }
        ),
    },
    {
      taskKey: 'provider_status_usage',
      task: () =>
        queryReportDatabase(
          providerStatusUsageQuery.sql,
          providerStatusUsageQuery.values,
          { usageReportTaskKey: 'provider_status_usage' }
        ),
    },
    {
      taskKey: 'provider_alias_routing',
      task: () =>
        queryReportDatabase(
          providerAliasRoutingQuery.sql,
          providerAliasRoutingQuery.values,
          { usageReportTaskKey: 'provider_alias_routing' }
        ),
    },
    {
      taskKey: 'provider_auth_health',
      task: () =>
        queryReportDatabase(
          providerAuthHealthQuery.sql,
          providerAuthHealthQuery.values,
          { usageReportTaskKey: 'provider_auth_health' }
        ),
    },
    {
      taskKey: 'provider_credit_lifecycle',
      task: () =>
        queryReportDatabase(
          providerCreditLifecycleQuery.sql,
          providerCreditLifecycleQuery.values,
          { usageReportTaskKey: 'provider_credit_lifecycle' }
        ),
    },
    {
      taskKey: 'docker_log_errors',
      task: () => loadDockerLogErrors(),
    },
    {
      taskKey: 'local_health',
      task: () => loadLocalHealth(),
    },
  ]

  const { results: fanoutResults, unavailableAuxiliarySections } =
    await runUsageReportFanoutTasks(fanoutTasks, REPORT_SQL_FANOUT_CONCURRENCY)

  const result = resolveUsageReportFanoutValue(fanoutResults, 'usage_rows', {
    rows: [],
  })
  const summaryResult = resolveUsageReportFanoutValue(fanoutResults, 'summary', {
    rows: [],
  })
  const trendResult = resolveUsageReportFanoutValue(fanoutResults, 'trend', {
    rows: [],
  })
  const clientUsageResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'client_usage',
    { rows: [] }
  )
  const providerLatencyHealthResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_latency_health',
    { rows: [] }
  )
  const providerErrorObservationResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_error_observations',
    { rows: [] }
  )
  const providerStatusUsageResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_status_usage',
    { rows: [] }
  )
  const providerAliasRoutingResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_alias_routing',
    { rows: [] }
  )
  const providerAuthHealthResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_auth_health',
    { rows: [] }
  )
  const providerCreditLifecycleResult = resolveUsageReportFanoutValue(
    fanoutResults,
    'provider_credit_lifecycle',
    { rows: [] }
  )
  const dockerLogErrors = resolveUsageReportFanoutValue(
    fanoutResults,
    'docker_log_errors',
    []
  )
  const localHealth = resolveUsageReportFanoutValue(
    fanoutResults,
    'local_health',
    []
  )

  const rows = serializeUsageReportRows(result.rows.map(normalizeRow), searchParams)
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

  const firstUsageRow = result.rows[0]
  const agentScoreReasonsCapTruncatesRequestedWindow =
    firstUsageRow?.agent_score_reasons_recent_id_cap_truncates_requested_window ??
    false

  const auxiliaryDegradedMetadata = buildUsageReportAuxiliaryDegradedMetadata(
    unavailableAuxiliarySections
  )

  return {
    metadata: {
      ...metadata,
      staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
      ...buildUsageReportRowSerializationMetadata(searchParams),
      agentScoreReasonsRecentIdCapTruncatesRequestedWindow:
        agentScoreReasonsCapTruncatesRequestedWindow,
      ...auxiliaryDegradedMetadata,
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
    providerAliasRouting: unavailableAuxiliarySections.includes(
      'provider_alias_routing'
    )
      ? buildEmptyUsageReportProviderAliasRoutingReport()
      : normalizeProviderAliasRoutingReport(providerAliasRoutingResult.rows),
    providerAuthHealth: unavailableAuxiliarySections.includes(
      'provider_auth_health'
    )
      ? buildEmptyUsageReportProviderAuthHealthReport()
      : normalizeProviderAuthHealthReport(providerAuthHealthResult.rows),
    providerCreditLifecycle: unavailableAuxiliarySections.includes(
      'provider_credit_lifecycle'
    )
      ? buildEmptyUsageReportProviderCreditLifecycleReport()
      : normalizeProviderCreditLifecycleReport(
          providerCreditLifecycleResult.rows
        ),
    quotas: [],
    quotaHistory: [],
    toolActivity: [],
    rows,
  }
}

async function loadUsageQuotaHistory(searchParams) {
  const query = buildQuotaHistoryQuery(searchParams)
  try {
    const result = await queryReportDatabase(query.sql, query.values, {
      statementTimeoutMs: QUOTA_HISTORY_STATEMENT_TIMEOUT_MS,
    })
    return {
      metadata: buildUsageQuotaHistoryMetadata({
        quotaHistoryStatementTimeoutMs: QUOTA_HISTORY_STATEMENT_TIMEOUT_MS,
      }),
      quotaHistory: result.rows.map(normalizeQuotaHistoryRow),
    }
  } catch (error) {
    if (isDatabaseTimeoutError(error)) {
      const fallbackQuery = buildQuotaHistoryFallbackQuery(searchParams)
      try {
        const fallbackResult = await queryReportDatabase(
          fallbackQuery.sql,
          fallbackQuery.values,
          {
            statementTimeoutMs: QUOTA_HISTORY_STATEMENT_TIMEOUT_MS,
          }
        )
        return buildDegradedUsageQuotaHistoryReport({
          timedOutSubqueries: ['history_enrichment'],
          quotaHistory: fallbackResult.rows.map(normalizeQuotaHistoryRow),
        })
      } catch (fallbackError) {
        if (isDatabaseTimeoutError(fallbackError)) {
          return buildDegradedUsageQuotaHistoryReport({
            timedOutSubqueries: ['history_base', 'history_enrichment'],
          })
        }
        throw fallbackError
      }
    }
    throw error
  }
}

async function loadUsageQuotaRangeHistory(searchParams) {
  const query = buildQuotaRangeHistoryQuery(searchParams)
  try {
    const result = await queryReportDatabase(query.sql, query.values, {
      statementTimeoutMs: QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS,
    })
    return {
      metadata: buildUsageQuotaRangeHistoryMetadata(searchParams, {
        quotaRangeHistoryStatementTimeoutMs:
          QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS,
      }),
      quotaRangeHistory: result.rows.map(normalizeQuotaHistoryRow),
    }
  } catch (error) {
    if (isDatabaseTimeoutError(error)) {
      const fallbackQuery = buildQuotaRangeHistoryFallbackQuery(searchParams)
      try {
        const fallbackResult = await queryReportDatabase(
          fallbackQuery.sql,
          fallbackQuery.values,
          {
            statementTimeoutMs: QUOTA_RANGE_HISTORY_STATEMENT_TIMEOUT_MS,
          }
        )
        return buildDegradedUsageQuotaRangeHistoryReport({
          searchParams,
          timedOutSubqueries: ['history_enrichment'],
          quotaRangeHistory: fallbackResult.rows.map(normalizeQuotaHistoryRow),
        })
      } catch (fallbackError) {
        if (isDatabaseTimeoutError(fallbackError)) {
          return buildDegradedUsageQuotaRangeHistoryReport({
            searchParams,
            timedOutSubqueries: ['history_base', 'history_enrichment'],
          })
        }
        throw fallbackError
      }
    }
    throw error
  }
}

async function loadUsageQuotaEstimator(searchParams) {
  const observationQuery = buildQuotaEstimatorObservationQuery(searchParams)
  const usageBucketQuery = buildQuotaEstimatorUsageBucketQuery(searchParams)
  const [observationResult, usageBucketResult] = await runTasksWithConcurrency(
    [
      () => queryReportDatabase(observationQuery.sql, observationQuery.values),
      () => queryReportDatabase(usageBucketQuery.sql, usageBucketQuery.values),
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
  try {
    const result = await queryReportDatabase(query.sql, query.values, {
      statementTimeoutMs: TOOL_ACTIVITY_STATEMENT_TIMEOUT_MS,
    })
    const firstRow = result.rows[0]
    const capTruncatesRequestedWindow =
      firstRow?.tool_activity_recent_id_cap_truncates_requested_window ?? false
    return {
      metadata: buildUsageToolActivityMetadata(searchParams, {
        ...query.metadata,
        toolActivityRecentIdCapTruncatesRequestedWindow: capTruncatesRequestedWindow,
      }),
      toolActivity: result.rows
        .filter((row) => row.kind != null)
        .map(normalizeToolActivityRow),
    }
  } catch (error) {
    if (isDatabaseTimeoutError(error)) {
      return buildDegradedUsageToolActivityReport(searchParams)
    }
    throw error
  }
}

async function loadUsageSessionDiagnostics(searchParams) {
  const query = buildSessionDiagnosticsQuery(searchParams)
  const result = await queryReportDatabase(query.sql, query.values)
  return {
    metadata: {
      ...query.metadata,
      generatedAt: new Date().toISOString(),
    },
    sessionDiagnostics: result.rows.map(normalizeSessionDiagnosticsRow),
  }
}

async function loadUsageTokenTrendSummary(searchParams) {
  const includeTokenTrendHealth = shouldIncludeTokenTrendHealth(searchParams)
  const hoursQuery = buildTokenTrendHoursQuery(searchParams)
  const healthQuery = buildTokenTrendHealthQuery(searchParams)
  const scoreQuery = buildTokenTrendScoreQuery(searchParams)
  const versionsQuery = buildTokenTrendVersionIntervalsQuery(searchParams)
  const modelFirstSeenQuery = buildTokenTrendModelFirstSeenQuery(searchParams)
  const tokenTrendSummaryRangeDays = calculateTokenTrendRangeDays(searchParams)
  const skipRawLanes =
    tokenTrendSummaryRangeDays > TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS
  const skippedSubqueries = skipRawLanes
    ? [...TOKEN_TREND_SUMMARY_RAW_SUBQUERY_KEYS]
    : []
  const querySpecs = [
    {
      subqueryKey: 'hours',
      task: () =>
        queryReportDatabase(hoursQuery.sql, hoursQuery.values, {
          statementTimeoutMs: TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
        }),
    },
    ...(includeTokenTrendHealth
      ? [
          {
            subqueryKey: 'health',
            task: () =>
              queryReportDatabase(healthQuery.sql, healthQuery.values, {
                statementTimeoutMs: TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
              }),
          },
        ]
      : []),
    {
      subqueryKey: 'scores',
      task: () =>
        queryReportDatabase(scoreQuery.sql, scoreQuery.values, {
          statementTimeoutMs: TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
        }),
    },
    {
      subqueryKey: 'versions',
      task: () =>
        queryReportDatabase(versionsQuery.sql, versionsQuery.values, {
          statementTimeoutMs: TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
        }),
    },
    {
      subqueryKey: 'modelFirstSeen',
      task: () =>
        queryReportDatabase(modelFirstSeenQuery.sql, modelFirstSeenQuery.values, {
          statementTimeoutMs: TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
        }),
    },
  ]
  const prioritizedQuerySpecs =
    REPORT_SQL_FANOUT_CONCURRENCY === 1
      ? [
          ...querySpecs.filter(({ subqueryKey }) => subqueryKey !== 'hours'),
          ...querySpecs.filter(({ subqueryKey }) => subqueryKey === 'hours'),
        ]
      : querySpecs

  const runnableQuerySpecs = skippedSubqueries.length
    ? prioritizedQuerySpecs.filter(
        ({ subqueryKey }) => !TOKEN_TREND_SUMMARY_RAW_SUBQUERY_KEYS.includes(subqueryKey)
      )
    : prioritizedQuerySpecs
  const queryResults = await runTokenTrendSummarySubqueries(runnableQuerySpecs)

  const tokenTrendHoursRows = []
  const tokenTrendHealthRows = []
  const tokenTrendScoresRows = []
  const tokenTrendVersionsRows = []
  const tokenTrendModelFirstSeenRows = []
  const timedOutSubqueries = []

  for (const result of queryResults) {
    if (result.status !== 'fulfilled') {
      if (!isDatabaseTimeoutError(result.error)) {
        throw result.error
      }
      timedOutSubqueries.push(result.subqueryKey)
      continue
    }

    if (result.subqueryKey === 'hours') {
      tokenTrendHoursRows.push(...result.value.rows.map(normalizeTokenTrendHourRow))
      continue
    }
    if (result.subqueryKey === 'health') {
      tokenTrendHealthRows.push(
        ...result.value.rows.map(normalizeProviderLatencyHealthRow)
      )
      continue
    }
    if (result.subqueryKey === 'scores') {
      tokenTrendScoresRows.push(
        ...result.value.rows.map(normalizeTokenTrendScoreRow)
      )
      continue
    }
    if (result.subqueryKey === 'versions') {
      tokenTrendVersionsRows.push(
        ...result.value.rows.map(normalizeTokenTrendVersionIntervalRow)
      )
      continue
    }
    if (result.subqueryKey === 'modelFirstSeen') {
      tokenTrendModelFirstSeenRows.push(
        ...result.value.rows.map(normalizeTokenTrendModelFirstSeenRow)
      )
    }
  }

  if (timedOutSubqueries.length > 0 || skippedSubqueries.length > 0) {
    return applyTokenTrendSummaryHealthInclusion(
      searchParams,
      buildDegradedUsageTokenTrendSummaryReport(searchParams, {
        skippedSubqueries,
        unavailableSubqueries: skippedSubqueries,
        tokenTrendSummaryRangeDays,
        tokenTrendSummaryRawLaneMaxDays: TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS,
        timedOutSubqueries,
        tokenTrendHours: tokenTrendHoursRows,
        tokenTrendHealth: tokenTrendHealthRows,
        tokenTrendScores: tokenTrendScoresRows,
        tokenTrendVersions: tokenTrendVersionsRows,
        tokenTrendModelFirstSeen: tokenTrendModelFirstSeenRows,
      })
    )
  }

  return applyTokenTrendSummaryHealthInclusion(searchParams, {
    metadata: buildUsageTokenTrendSummaryMetadata(searchParams, {
      tokenTrendSummaryRawLaneMaxDays:
        TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS,
      tokenTrendSummaryRangeDays,
      tokenTrendSummaryStatementTimeoutMs:
        TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS,
    }),
    tokenTrendHours: tokenTrendHoursRows,
    tokenTrendHealth: tokenTrendHealthRows,
    tokenTrendScores: tokenTrendScoresRows,
    tokenTrendVersions: tokenTrendVersionsRows,
    tokenTrendModelFirstSeen: tokenTrendModelFirstSeenRows,
  })
}

async function loadUsageTokenTrendDay(searchParams) {
  const { sql, values, metadata } = buildTokenTrendDayDetailQuery(searchParams)
  const result = await queryReportDatabase(sql, values)

  return {
    metadata,
    date: metadata.date,
    rows: result.rows.map(normalizeTokenTrendDayDetailRow),
  }
}

async function handleCachedUsageSubreport(req, res, scope, load, deps = {}) {
  const poolRef = deps.pool !== undefined ? deps.pool : pool
  const cachedReportFn = deps.cachedReport ?? cachedReport
  const sendJsonFn = deps.sendJson ?? sendJson

  if (!poolRef) {
    await sendJsonFn(req, res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const searchParams = requestUrl.searchParams
  const body = await cachedReportFn(scope, () => load(searchParams), {
    searchParams,
  })

  await sendJsonFn(req, res, 200, body)
}

async function handleUsageReport(req, res) {
  await handleCachedUsageSubreport(req, res, USAGE_REPORT_CACHE_SCOPE, loadUsageReport)
}

async function handleUsageQuotaRangeHistory(req, res) {
  await handleCachedUsageSubreport(
    req,
    res,
    'usage-quota-range-history',
    loadUsageQuotaRangeHistory
  )
}

async function handleUsageQuotaHistory(req, res) {
  await handleCachedUsageSubreport(
    req,
    res,
    USAGE_QUOTA_HISTORY_CACHE_SCOPE,
    loadUsageQuotaHistory
  )
}

async function handleUsageQuotaEstimator(req, res) {
  await handleCachedUsageSubreport(
    req,
    res,
    'usage-quota-estimator-v1',
    loadUsageQuotaEstimator
  )
}

async function handleUsageToolActivity(req, res) {
  await handleCachedUsageSubreport(req, res, 'usage-tool-activity', loadUsageToolActivity)
}

async function handleUsageSessionDiagnostics(req, res) {
  await handleCachedUsageSubreport(
    req,
    res,
    'usage-session-diagnostics-v1',
    loadUsageSessionDiagnostics
  )
}

async function handleUsageTokenTrendSummary(req, res) {
  await handleCachedUsageSubreport(
    req,
    res,
    USAGE_TOKEN_TREND_SUMMARY_CACHE_SCOPE,
    loadUsageTokenTrendSummary
  )
}

async function handleUsageTokenTrendDay(req, res) {
  await handleCachedUsageSubreport(req, res, 'usage-token-trend-day', loadUsageTokenTrendDay)
}

async function handleUsageQuotas(req, res) {
  if (!pool) {
    await sendJson(req, res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  await sendJson(
    req,
    res,
    200,
    await loadQuotaReport({ searchParams: requestUrl.searchParams })
  )
}

function startReportCachePrewarm() {
  if (
    reportServiceShuttingDown ||
    !pool ||
    !redisClient ||
    !REPORT_CACHE_PREWARM ||
    prewarmTimer
  )
    return

  const run = () => {
    if (prewarmPromise || reportServiceShuttingDown) return
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
  if (!redisClient?.isReady || reportServiceShuttingDown) return

  const lockKey = buildReportCachePrewarmLockKey()
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
      if (reportServiceShuttingDown) break
      try {
        const searchParams = buildPrewarmUsageSearchParams(window.from, window.to)
        const status = await prewarmCachedReport(USAGE_REPORT_CACHE_SCOPE, searchParams, () =>
          loadUsageReport(searchParams)
        )
        process.stdout.write(
          `[report-service] prewarm usage cache window=${window.name} status=${status} from=${window.from} to=${window.to}\n`
        )
      } catch (error) {
        if (!shouldSuppressCacheRefreshFailureDuringShutdown(error)) {
          process.stderr.write(
            `[report-service] WARN: prewarm usage cache failed window=${window.name} from=${window.from} to=${window.to}: ${formatError(error)}\n`
          )
        }
        break
      }
    }

    try {
      const quotaStatus = await prewarmCachedReport(
        'quotas',
        undefined,
        loadQuotaReportWithDatabaseTimeoutHandling
      )
      process.stdout.write(
        `[report-service] prewarm quota cache status=${quotaStatus}\n`
      )
    } catch (error) {
      if (!shouldSuppressCacheRefreshFailureDuringShutdown(error)) {
        process.stderr.write(
          `[report-service] WARN: prewarm quota cache failed: ${formatError(error)}\n`
        )
      }
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
  const upstreamSecretCheck = evaluateUpstreamProxySecret(req.headers)
  if (!upstreamSecretCheck.ok) {
    await sendJson(req, res, upstreamSecretCheck.status, {
      error: upstreamSecretCheck.error,
    })
    return
  }

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
      await sendJson(req, res, 504, {
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

async function buildShellHealthPayload({
  loaders = {},
} = {}) {
  const loadReportQueryPressureFn =
    loaders.loadReportQueryPressure ?? loadReportQueryPressure
  const loadPgBouncerHealthFn =
    loaders.loadPgBouncerHealth ?? loadPgBouncerHealth
  const loadSourceTableHealthFn =
    loaders.loadSourceTableHealth ?? loadSourceTableHealth
  const loadMaterializedViewHealthFn =
    loaders.loadMaterializedViewHealth ?? loadMaterializedViewHealth

  const [
    reportQueryPressure,
    pgBouncerSidecars,
    sourceTables,
    materializedViews,
  ] = await Promise.all([
    loadReportQueryPressureFn(),
    loadPgBouncerHealthFn(),
    loadSourceTableHealthFn(),
    loadMaterializedViewHealthFn(),
  ])

  return {
    ok: true,
    databaseConfigured: Boolean(pool),
    databaseEndpoint: describeDatabaseUrl(DATABASE_URL),
    databasePool: pool
      ? {
          max: REPORT_DB_POOL_MAX,
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
          sqlFanoutConcurrency: REPORT_SQL_FANOUT_CONCURRENCY,
        }
      : null,
    healthDatabasePool: healthPool
      ? {
          max: 1,
          total: healthPool.totalCount,
          idle: healthPool.idleCount,
          waiting: healthPool.waitingCount,
        }
      : null,
    redisConfigured: Boolean(redisClient),
    redisReady: Boolean(redisClient?.isReady),
    reportQueryPressure,
    pgBouncerSidecars,
    sourceTables,
    materializedViews,
  }
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && requestUrl.pathname === '/api/shell/health') {
    await sendJson(req, res, 200, await buildShellHealthPayload())
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
    requestUrl.pathname === '/api/shell/reports/usage/session-diagnostics'
  ) {
    await handleUsageSessionDiagnostics(req, res)
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

  await sendJson(req, res, 404, { error: 'Not found' })
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) =>
    respondWithGenericServerError(req, res, error)
  )
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
  if (reportServiceShuttingDown) {
    return
  }
  reportServiceShuttingDown = true

  if (prewarmTimer) {
    clearInterval(prewarmTimer)
    prewarmTimer = null
  }

  await runBoundedShutdownSequence(server, {
    graceMs: SHUTDOWN_GRACE_MS,
    async runCleanup() {
      try {
        if (redisClient?.isOpen) {
          await redisClient.quit()
        }
        await cleanupPgBouncerAdminPools()
        await healthPool?.end()
        await pool?.end()
      } catch (error) {
        process.stderr.write(
          `[report-service] WARN: shutdown cleanup failed: ${formatError(error)}\n`
        )
      }
    },
  })
}

if (shouldStartServer) {
  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

export const __ttlMemoizerTestHelpers = {
  createTtlMemoizer,
  resetHealthLoaderCachesForTests() {
    materializedViewHealthMemo.resetForTests()
    pgBouncerHealthMemo.resetForTests()
    sourceTableHealthMemo.resetForTests()
  },
}

export const __reportCacheInternals = {
  resetReportCache() {
    reportCache.clear()
  },
  getReportCacheEntry(cacheKey) {
    return reportCache.get(cacheKey)
  },
  setMaxReportCacheEntriesForTests(maxEntries) {
    reportCacheMaxEntries = Math.max(
      1,
      Number(maxEntries) || MAX_REPORT_CACHE_ENTRIES
    )
  },
  resetMaxReportCacheEntriesForTests() {
    reportCacheMaxEntries = MAX_REPORT_CACHE_ENTRIES
  },
  setReadRedisCacheEntryImpl(impl) {
    readRedisCacheEntryTestImpl = impl
  },
  setWriteRedisCacheEntryImpl(impl) {
    writeRedisCacheEntryTestImpl = impl
  },
  encodeRedisReportCachePayload,
  decodeRedisReportCachePayload,
  readRedisCacheEntry,
  readRedisCacheEntryFromClient,
  writeRedisCacheEntry,
  createRedisCacheClient,
  cachedReport,
  refreshReportCache,
  readLocalReportCache,
  setLocalReportCache,
  pruneReportCache,
}

export const __localHealthTestHelpers = {
  classifyRedisPingProbeResponse,
  probeRedisHealth,
}

export const __responseTestHelpers = {
  acceptsGzipEncoding,
  sendJson,
}


export const __proxySecurityTestHelpers = {
  evaluateUpstreamProxySecret,
  resolveReportProxySharedSecret,
  REPORT_PROXY_SECRET_HEADER,
  DEFAULT_REPORT_PROXY_SHARED_SECRET,
  proxyHeaders,
}

export const __envTestHelpers = {
  boundedIntegerEnv,
  positiveIntegerEnv,
  parseBooleanEnv,
  parseFiniteNumberEnv,
  normalizeDatabaseUrl,
  parseDateParam,
  resolveDefaultToDateString,
  addDaysToDateString,
  formatDashboardDate,
  providerDimensionExpression,
  providerDimensionForAlias,
  sessionHistoryMetadataText,
}

export {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  buildReportCachePrewarmLockKey,
  canonicalizeSearchParams,
  REPORT_CACHE_PREFIX,
  REPORT_CACHE_VERSION,
  resolveReportCacheConfig,
  resolveReportCacheTtlMs,
} from './report-cache-identity.mjs'
export {
  resolveDockerLogContainerNames,
  extractDockerLogErrorsFromTail,
  selectNewDockerLogErrors,
  capDockerLogErrorsForDashboard,
  inferLogLevel,
  isActionableErrorLog,
} from './docker-log-error-intake.mjs'
export { classifyCacheEntry }

export const __dockerLogScanTestHelpers = {
  capDockerJsonLogSourcesForScan,
  isDockerLogScanCacheFresh,
  scanDockerLogErrorsFromSources,
  loadDockerLogErrors,
  resetDockerLogScanCachesForTests,
  resetDockerLogErrorIntakeSeenFingerprintsForTests() {
    dockerLogErrorIntakeSeenFingerprints.clear()
  },
  dockerLogErrorIntakeSeenFingerprintsSizeForTests() {
    return dockerLogErrorIntakeSeenFingerprints.size
  },
  seedDockerLogErrorIntakeFingerprintsForTests(keys) {
    for (const key of keys ?? []) {
      dockerLogErrorIntakeSeenFingerprints.add(key)
    }
  },
  DOCKER_LOG_SCAN_MAX_SOURCES,
  DOCKER_LOG_SCAN_MAX_TOTAL_BYTES,
  DOCKER_LOG_INTAKE_FINGERPRINT_MAX,
  getDockerLogTailReadCountForTests() {
    return dockerLogTailReadCountForTests
  },
}

export const __cachedUsageSubreportTestHelpers = {
  handleCachedUsageSubreport,
}

export const __usageReportTestHelpers = {
  loadUsageReport,
  runUsageReportFanoutTasks,
  buildUsageReportAuxiliaryDegradedMetadata,
  USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEYS,
  normalizeRow,
  AGENT_SCORE_REASON_RECENT_ROW_LIMIT,
  setQueryReportDatabaseTestImpl(impl) {
    queryReportDatabaseTestImpl = impl
  },
  resetQueryReportDatabaseTestImpl() {
    queryReportDatabaseTestImpl = null
  },
  setLoadDockerLogErrorsTestImpl(impl) {
    loadDockerLogErrorsTestImpl = impl
  },
  resetLoadDockerLogErrorsTestImpl() {
    loadDockerLogErrorsTestImpl = null
  },
  setLoadLocalHealthTestImpl(impl) {
    loadLocalHealthTestImpl = impl
  },
  resetLoadLocalHealthTestImpl() {
    loadLocalHealthTestImpl = null
  },
}

export { buildShellHealthPayload }

export const __shellHealthTestHelpers = {
  buildShellHealthPayload,
}

export const __pgBouncerAdminTestHelpers = {
  cleanupPgBouncerAdminPools,
  getOrCreatePgBouncerAdminPool,
  getPgBouncerAdminPoolCacheSize() {
    return pgBouncerAdminPoolsByKey.size
  },
  loadPgBouncerAdminSummaryForTests: loadPgBouncerAdminSummary,
}

export const __serverRuntimeTestHelpers = {
  GENERIC_INTERNAL_SERVER_ERROR_BODY,
  isHttpResponseCommitted,
  logUnhandledRequestError,
  respondWithGenericServerError,
  resolveBoundedShutdownGraceMs,
  scheduleShutdownForceExit,
  beginHttpServerShutdown,
  closeHttpServer,
  runBoundedShutdownSequence,
}
