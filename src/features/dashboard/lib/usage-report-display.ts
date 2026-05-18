const providerColorsByKey: Record<string, string> = {
  openai: '#2563eb',
  anthropic: '#7c3aed',
  google: '#0891b2',
  gemini: '#0891b2',
  xai: '#334155',
  openrouter: '#4f46e5',
  local: '#c026d3',
  local_llm: '#c026d3',
  local_embed: '#c026d3',
  nvidia_nim: '#6d28d9',
  chatgpt: '#475569',
}

/**
 * Reference brand-identity hex palette for provider name/label coloring.
 *
 * Wave 12 Fix 1: introduced to replace the legacy `providerColorsByKey` palette
 * at call sites that need to match the v9.7 reference (Model Ledger Provider
 * column, ProviderCard header). The legacy palette is intentionally kept for
 * severity/gutter coloring (MasterLedger gutter) that has different semantics.
 */
export const PROVIDER_BRAND_HEX: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  google: '#4285f4',
  xai: '#475569',
  nvidia_nim: '#76b900',
  openrouter: '#7e57c2',
  local: '#64748b',
}

/**
 * Returns the reference brand-identity hex for a provider, falling back to
 * `'var(--fg)'` for unknown providers.
 *
 * Wave 12 Fix 1: use this at any call site where the v9.7 reference shows
 * provider-branded text colors (card headers, ledger Provider cells).
 */
export function providerBrandHex(provider: string): string {
  const key = providerColorKey(provider)
  return (
    PROVIDER_BRAND_HEX[key] ??
    PROVIDER_BRAND_HEX[provider.toLowerCase()] ??
    'var(--fg)'
  )
}

export const providerColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#334155',
  '#4f46e5',
  '#c026d3',
  '#0369a1',
  '#6d28d9',
  '#475569',
]

export const repositoryColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#4338ca',
  '#c026d3',
  '#0369a1',
  '#6d28d9',
  '#64748b',
  '#0e7490',
]

export const modelColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#4f46e5',
  '#c026d3',
  '#0369a1',
  '#6d28d9',
  '#475569',
  '#0e7490',
]

const modelKindColors = {
  embedding: '#0369a1',
  reranker: '#c026d3',
} as const

export const clientColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#4f46e5',
  '#c026d3',
  '#0369a1',
  '#6d28d9',
  '#475569',
  '#0e7490',
]

export type GoogleQuotaClass = 'flash' | 'flash-lite' | 'pro'

export const googleQuotaClasses: Array<{
  key: GoogleQuotaClass
  label: string
  sidebarLabel: string
}> = [
  { key: 'flash', label: 'Flash', sidebarLabel: 'Gemini Flash' },
  { key: 'flash-lite', label: 'Flash Lite', sidebarLabel: 'Gemini Lite' },
  { key: 'pro', label: 'Pro', sidebarLabel: 'Gemini Pro' },
]

export function googleQuotaClass(
  model: string | null
): GoogleQuotaClass | null {
  const normalized = model?.toLowerCase() ?? ''
  if (
    normalized.includes('flash-lite') ||
    normalized.includes('flash_lite') ||
    normalized.includes('flash lite')
  ) {
    return 'flash-lite'
  }
  if (normalized.includes('flash')) return 'flash'
  if (normalized.includes('pro')) return 'pro'
  return null
}

export function providerColorFor(provider: string) {
  const colorKey = providerColorKey(provider)
  return (
    providerColorsByKey[colorKey] ??
    providerColors[colorHash(colorKey, providerColors.length)]
  )
}

export function providerColorKey(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'google' || normalized === 'gemini') return 'google'
  if (normalized === 'x.ai' || normalized === 'xai') return 'xai'
  if (normalized === 'nvidia') return 'nvidia_nim'
  if (normalized === 'open-router') return 'openrouter'
  if (normalized === 'local' || normalized.startsWith('local_')) return 'local'
  return normalized
}

export function modelColorFor(model: string) {
  const kind = modelCalloutKind(model)
  if (kind === 'embedding' || kind === 'reranker') {
    return modelKindColors[kind]
  }
  return modelColors[colorHash(model.toLowerCase(), modelColors.length)]
}

export function modelCalloutKind(model: string | null | undefined) {
  const normalized = model?.trim().toLowerCase() ?? ''
  if (!normalized) return 'standard'

  if (
    normalized.includes('rerank') ||
    normalized.includes('re-rank') ||
    normalized.includes('ranker')
  ) {
    return 'reranker'
  }

  if (
    normalized.includes('embedding') ||
    normalized.includes('embeddings') ||
    normalized.includes('embed') ||
    normalized.includes('text-embedding') ||
    normalized.includes('embeddinggemma') ||
    normalized.includes('e5-') ||
    normalized.includes('gte-') ||
    normalized.includes('nomic-embed')
  ) {
    return 'embedding'
  }

  return 'standard'
}

export function clientColorFor(client: string) {
  return clientColors[colorHash(client.toLowerCase(), clientColors.length)]
}

export function colorHash(value: string, modulo: number) {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash % modulo
}

export function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.trim()
  const hex = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!hex) return normalized

  const [, red, green, blue] = hex
  return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${alpha})`
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  }).format(value)
  return `${formatted}%`
}

export function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

/**
 * Formats a millisecond latency value for display.
 *
 * Wave 12 Fix 4: resolves the regression where real P95 values (e.g. 13201ms)
 * rendered as `13201.163149995ms` with full-precision floats.
 *   ≥1000ms → `13.2s`
 *   <1000ms → `247ms` (rounded to integer)
 *   null/undefined → `—`
 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/**
 * Formats a USD cost value with comma-separated thousands and exactly 2
 * decimal places.
 *
 * Wave 12 Fix 4: resolves the regression where real cost values (e.g. 1560.10)
 * rendered as `$1560.1038` with 4 decimals and no comma separator.
 *   null/undefined → `—`
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return '—'
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Formats an ISO reset-at timestamp as a short relative distance string.
 *
 * Wave 12 Fix 4: resolves the regression where the full ISO string
 * `2026-05-21T15:00:00.000Z` was rendered verbatim in the quota reset cell.
 * Output example: `in 3d 1h` (via date-fns formatDistanceToNow).
 *   null/undefined/empty → `—`
 */
export function formatResetDistance(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    // date-fns formatDistanceToNow is not available; use native fallback
    const diffMs = date.getTime() - Date.now()
    if (diffMs <= 0) return 'now'
    const totalMins = Math.floor(diffMs / 60_000)
    const days = Math.floor(totalMins / 1440)
    const hours = Math.floor((totalMins % 1440) / 60)
    const mins = totalMins % 60
    if (days > 0) return `in ${days.toString()}d ${hours.toString()}h`
    if (hours > 0) return `in ${hours.toString()}h ${mins.toString()}m`
    return `in ${mins.toString()}m`
  } catch {
    return '—'
  }
}
