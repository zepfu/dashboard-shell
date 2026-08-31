export {}

declare module './report-cache-identity.mjs' {
  type SearchParamsLike = {
    keys(): IterableIterator<string>
    getAll(name: string): string[]
  }

  type ReportCacheIdentity = {
    scope: string
    canonicalParams: string
    hash: string
    cacheKey: string
    lockKey: string
  }

  type ReportCacheEntry<T = unknown> = {
    cacheVersion: string
    generatedAt: string
    freshUntil: number
    staleUntil: number
    payload: T
  }

  export const CACHE_IDENTITY_EXCLUDED_KEYS: ReadonlySet<string>
  export const REPORT_CACHE_PREFIX: string
  export const REPORT_CACHE_STALE_TTL_MS: number
  export const REPORT_CACHE_TTL_MS: number
  export const REPORT_CACHE_USAGE_TTL_MS: number
  export const REPORT_CACHE_VERSION: string

  export function canonicalizeSearchParams(
    searchParams: SearchParamsLike,
    config?: ReturnType<typeof resolveReportCacheConfig>
  ): string

  export function buildReportCacheIdentity(
    scope: string,
    searchParams?: SearchParamsLike | null,
    config?: ReturnType<typeof resolveReportCacheConfig>
  ): ReportCacheIdentity

  export function buildReportCachePrewarmLockKey(
    config?: ReturnType<typeof resolveReportCacheConfig>
  ): string

  export function buildReportCacheEntry(
    payload: unknown,
    options?: {
      scope?: string
      cacheTtlMs?: number
      config?: ReturnType<typeof resolveReportCacheConfig>
    }
  ): ReportCacheEntry

  export function applyCurrentReportCacheTtl(
    cacheEntry: ReportCacheEntry | null | undefined,
    options?: {
      scope?: string
      cacheTtlMs?: number
      config?: ReturnType<typeof resolveReportCacheConfig>
    }
  ): ReportCacheEntry | null | undefined

  export function isUsageReportCacheScope(scope: string): boolean

  export function resolveReportCacheConfig(env?: NodeJS.ProcessEnv): {
    defaultTtlMs: number
    usageTtlMs: number
    staleTtlMs: number
    prefix: string
    version: string
    cacheBustExcludedKeys: ReadonlySet<string>
  }

  export function resolveReportCacheTtlMs(
    scope: string,
    options?: {
      cacheTtlMs?: number
      config?: ReturnType<typeof resolveReportCacheConfig>
    }
  ): number
}
