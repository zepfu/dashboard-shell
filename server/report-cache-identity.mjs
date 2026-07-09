import crypto from 'node:crypto'

/** Params excluded from canonical cache identity (#39 / S6-T7). */
const CACHE_IDENTITY_EXCLUDED_KEYS = new Set(['cache_bust'])

const USAGE_REPORT_CACHE_SCOPES = new Set([
  'usage-v2',
  'usage-token-trend-summary-v6',
  'usage-tool-activity',
  'usage-token-trend-day',
])

function resolveReportCacheConfig(env = process.env) {
  const defaultTtlMs = Math.max(
    0,
    Number(env.SHELL_REPORT_CACHE_TTL_MS ?? 60 * 1000)
  )
  const usageTtlMs = Math.max(
    0,
    Number(env.SHELL_REPORT_USAGE_CACHE_TTL_MS ?? 10 * 60 * 1000)
  )
  const staleTtlMs = Math.max(
    0,
    Number(env.SHELL_REPORT_CACHE_STALE_TTL_MS ?? 24 * 60 * 60 * 1000)
  )
  const prefix = env.SHELL_REPORT_CACHE_PREFIX ?? 'dashboard-shell:reports'
  const version = env.SHELL_REPORT_CACHE_VERSION ?? 'v14'

  return {
    defaultTtlMs,
    usageTtlMs,
    staleTtlMs,
    prefix,
    version,
    cacheBustExcludedKeys: CACHE_IDENTITY_EXCLUDED_KEYS,
  }
}

const defaultReportCacheConfig = resolveReportCacheConfig()

const REPORT_CACHE_TTL_MS = defaultReportCacheConfig.defaultTtlMs
const REPORT_CACHE_USAGE_TTL_MS = defaultReportCacheConfig.usageTtlMs
const REPORT_CACHE_STALE_TTL_MS = defaultReportCacheConfig.staleTtlMs
const REPORT_CACHE_PREFIX = defaultReportCacheConfig.prefix
const REPORT_CACHE_VERSION = defaultReportCacheConfig.version

function isUsageReportCacheScope(scope) {
  if (scope === 'quotas' || scope.startsWith('usage-quota')) {
    return false
  }
  if (USAGE_REPORT_CACHE_SCOPES.has(scope)) {
    return true
  }
  if (/^usage-v\d+$/.test(scope)) {
    return true
  }
  if (/^usage-token-trend-summary-v\d+$/.test(scope)) {
    return true
  }
  return false
}

function resolveReportCacheTtlMs(scope, options = {}) {
  const config = options.config ?? defaultReportCacheConfig
  if (Number.isFinite(options.cacheTtlMs)) {
    return Math.max(0, Number(options.cacheTtlMs))
  }
  return isUsageReportCacheScope(scope)
    ? config.usageTtlMs
    : config.defaultTtlMs
}

function canonicalizeSearchParams(
  searchParams,
  config = defaultReportCacheConfig
) {
  const excluded = config.cacheBustExcludedKeys ?? CACHE_IDENTITY_EXCLUDED_KEYS
  const entries = []
  const keys = [...new Set([...searchParams.keys()])]
    .filter((key) => !excluded.has(key))
    .sort()

  for (const key of keys) {
    for (const value of searchParams.getAll(key)) {
      entries.push([key, value.trim()])
    }
  }

  return new URLSearchParams(entries).toString()
}

/** Scopes whose SQL deliberately ignores request params (or only uses a fixed set). */
const PARAM_INDEPENDENT_CACHE_SCOPES = new Set([
  'usage-quota-history',
  'usage-quota-history-v2',
])

function buildReportCacheIdentity(
  scope,
  searchParams,
  config = defaultReportCacheConfig
) {
  // usage-quota-history lookback is per-lane / interval-driven and ignores
  // from/to (and other request params). Key the cache on an empty param set so
  // distinct date ranges do not thrash identical results.
  const canonicalParams =
    searchParams && !PARAM_INDEPENDENT_CACHE_SCOPES.has(scope)
      ? canonicalizeSearchParams(searchParams, config)
      : ''
  const hash = crypto
    .createHash('sha256')
    .update(`${scope}\n${canonicalParams}`)
    .digest('hex')

  return {
    scope,
    canonicalParams,
    hash,
    cacheKey: `${config.prefix}:${config.version}:${scope}:${hash}`,
    lockKey: `${config.prefix}:${config.version}:${scope}:${hash}:lock`,
  }
}

function buildReportCachePrewarmLockKey(config = defaultReportCacheConfig) {
  return `${config.prefix}:${config.version}:prewarm:lock`
}

function buildReportCacheEntry(payload, options = {}) {
  const config = options.config ?? defaultReportCacheConfig
  const now = Date.now()
  const freshUntil = now + resolveReportCacheTtlMs(options.scope, options)
  const staleUntil = freshUntil + config.staleTtlMs

  return {
    cacheVersion: config.version,
    generatedAt: new Date(now).toISOString(),
    freshUntil,
    staleUntil,
    payload,
  }
}

export {
  CACHE_IDENTITY_EXCLUDED_KEYS,
  REPORT_CACHE_PREFIX,
  REPORT_CACHE_STALE_TTL_MS,
  REPORT_CACHE_TTL_MS,
  REPORT_CACHE_USAGE_TTL_MS,
  REPORT_CACHE_VERSION,
  buildReportCacheEntry,
  buildReportCacheIdentity,
  buildReportCachePrewarmLockKey,
  canonicalizeSearchParams,
  isUsageReportCacheScope,
  resolveReportCacheConfig,
  resolveReportCacheTtlMs,
}
