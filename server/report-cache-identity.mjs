import crypto from 'node:crypto'

const REPORT_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_TTL_MS ?? 60 * 1000)
)
const REPORT_CACHE_USAGE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_USAGE_CACHE_TTL_MS ?? 10 * 60 * 1000)
)
const REPORT_CACHE_STALE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_STALE_TTL_MS ?? 24 * 60 * 60 * 1000)
)
const REPORT_CACHE_PREFIX =
  process.env.SHELL_REPORT_CACHE_PREFIX ?? 'dashboard-shell:reports'
const REPORT_CACHE_VERSION = process.env.SHELL_REPORT_CACHE_VERSION ?? 'v14'

const USAGE_REPORT_CACHE_SCOPES = new Set([
  'usage',
  'usage-token-trend-summary-v4',
  'usage-tool-activity',
  'usage-token-trend-day',
])

/** Params excluded from canonical cache identity (#39 / S6-T7). */
const CACHE_IDENTITY_EXCLUDED_KEYS = new Set(['cache_bust'])

function resolveReportCacheTtlMs(scope, options = {}) {
  if (Number.isFinite(options.cacheTtlMs)) {
    return Math.max(0, Number(options.cacheTtlMs))
  }
  return USAGE_REPORT_CACHE_SCOPES.has(scope)
    ? REPORT_CACHE_USAGE_TTL_MS
    : REPORT_CACHE_TTL_MS
}

function canonicalizeSearchParams(searchParams) {
  const entries = []
  const keys = [...new Set([...searchParams.keys()])]
    .filter((key) => !CACHE_IDENTITY_EXCLUDED_KEYS.has(key))
    .sort()

  for (const key of keys) {
    for (const value of searchParams.getAll(key)) {
      entries.push([key, value.trim()])
    }
  }

  return new URLSearchParams(entries).toString()
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

function buildReportCacheEntry(payload, options = {}) {
  const now = Date.now()
  const freshUntil = now + resolveReportCacheTtlMs(options.scope, options)
  const staleUntil = freshUntil + REPORT_CACHE_STALE_TTL_MS

  return {
    cacheVersion: REPORT_CACHE_VERSION,
    generatedAt: new Date(now).toISOString(),
    freshUntil,
    staleUntil,
    payload,
  }
}

export {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  canonicalizeSearchParams,
  resolveReportCacheTtlMs,
}
