/**
 * Provider name aliases — maps a canonical provider key to the set of strings
 * that may appear in the `providerLatencyHealth` materialized view.
 *
 * Wave 15-B (15-B.2): The DB materialised view `provider_latency_health_5m`
 * stores Google rows under the key `'gemini'`, while the dashboard's canonical
 * provider list and the `rows` collection both use `'google'` (because
 * report-service.mjs CASE-maps them on the rows/trend side but NOT on the
 * health side). This map lets callers expand a canonical key to all its DB
 * aliases before filtering health rows.
 */
export const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  google: ['google', 'gemini'],
}

/**
 * Returns all alias strings that should be matched for a given canonical
 * provider key (case-insensitive lower).
 *
 * Wave 15-B.2: Use when filtering `providerLatencyHealth` rows to avoid
 * dropping gemini rows for the google provider card.
 */
export function providerAliases(provider: string): readonly string[] {
  const key = provider.toLowerCase()
  return PROVIDER_ALIASES[key] ?? [key]
}

/**
 * Maps any DB/alias provider string to its canonical key.
 *
 * Wave 15-B.2: Use in buildModelRows to normalise health row provider keys
 * so that DB keys like 'gemini' map to the canonical 'google' key used in
 * providerStatusUsage, ensuring health latency lookups succeed.
 *
 * @example canonicalProvider('gemini') → 'google'
 * @example canonicalProvider('openai') → 'openai'
 */
export function canonicalProvider(provider: string): string {
  const key = provider.toLowerCase()
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(key)) return canonical
  }
  return key
}

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

/**
 * Infers a canonical provider key from a model name.
 *
 * Wave 27 (W26 follow-up): consumers like ProviderCard's quota-hover .t-model
 * row and RepoBreakdownTable's "Top Model" cell pass *model* names (e.g.
 * `claude-opus-4-7`, `gpt-5.5`) into {@link providerBrandHex}. That helper's
 * lookup table (PROVIDER_BRAND_HEX) is keyed by provider names only
 * (`anthropic`, `openai`, ...), so model-name inputs fell through to the
 * `var(--fg)` fallback and rendered un-branded. This helper bridges that gap
 * by pattern-matching the model prefix back to its provider key.
 *
 * Patterns covered:
 *   claude-*, claude_*, anthropic*               -> 'anthropic'
 *   gpt-*, o1-*, o3-*, o4-*, chatgpt*, codex*,
 *     text-embedding*, text-davinci*             -> 'openai'
 *   gemini*, embeddinggemma*                     -> 'google'
 *   grok*                                        -> 'xai'
 *   nvidia*, nemo*, nim-*                        -> 'nvidia_nim'
 *   strings containing '/' (vendor/model paths)  -> 'openrouter'
 *   llama*, mistral*, mixtral*, qwen*, phi*,
 *     deepseek*, nomic-embed*, gte-*, e5-*       -> 'local'
 *
 * Unrecognised inputs fall through to the raw lowercased string so that
 * {@link providerBrandHex} can attempt its own match (and otherwise return
 * the `var(--fg)` fallback).
 */
export function modelToProviderKey(model: string): string {
  const m = model.trim().toLowerCase()
  if (m === '') return ''

  // Anthropic - Claude family
  if (m.startsWith('claude') || m.startsWith('anthropic')) return 'anthropic'

  // OpenAI - GPT family + reasoning (o1/o3/o4) + ChatGPT + Codex +
  // text-embedding / text-davinci legacy models
  if (
    m.startsWith('gpt-') ||
    m.startsWith('gpt_') ||
    m.startsWith('gpt5') ||
    m.startsWith('gpt4') ||
    m.startsWith('gpt3') ||
    m === 'gpt' ||
    m.startsWith('o1-') ||
    m.startsWith('o3-') ||
    m.startsWith('o4-') ||
    m.startsWith('chatgpt') ||
    m.startsWith('codex') ||
    m.startsWith('text-embedding') ||
    m.startsWith('text-davinci') ||
    m.startsWith('davinci')
  ) {
    return 'openai'
  }

  // Google - Gemini family + EmbeddingGemma
  if (m.startsWith('gemini') || m.startsWith('embeddinggemma')) return 'google'

  // xAI - Grok family
  if (m.startsWith('grok')) return 'xai'

  // NVIDIA NIM - branded prefixes
  if (m.startsWith('nvidia') || m.startsWith('nemo') || m.startsWith('nim-')) {
    return 'nvidia_nim'
  }

  // OpenRouter - uses `<vendor>/<model>` paths
  if (m.includes('/')) return 'openrouter'

  // Local / open-weight families served via local_llm / local_embed
  if (
    m.startsWith('llama') ||
    m.startsWith('mistral') ||
    m.startsWith('mixtral') ||
    m.startsWith('qwen') ||
    m.startsWith('phi') ||
    m.startsWith('deepseek') ||
    m.startsWith('nomic-embed') ||
    m.startsWith('gte-') ||
    m.startsWith('e5-')
  ) {
    return 'local'
  }

  return m
}

/**
 * Convenience wrapper: returns the reference brand-identity hex for a model
 * name, inferring the provider via {@link modelToProviderKey}.
 *
 * Wave 27: use this at call sites where the input is a *model* name (e.g.
 * `claude-opus-4-7`, `gpt-5.5`) rather than a provider key. Falls back to
 * `var(--fg)` for unknown models.
 */
export function modelBrandHex(model: string): string {
  const key = modelToProviderKey(model)
  return providerBrandHex(key)
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
/**
 * Count of provider error observations within a dashboard date window.
 *
 * Each row in `providerErrorObservations` is one discrete event (one 429, one
 * 529, etc.) queried server-side with a fixed 14-day window. Passing `from` /
 * `to` (ISO-8601 date strings) filters to only observations whose
 * `observed_at` falls within `[from, to)`, aligning the Errors KPI tile with
 * the user-selected date range used by all other KPI tiles.
 *
 * When `from` / `to` are absent the full observation array length is returned
 * (backward-compatible behaviour for callers without a date window).
 *
 * Usage in index.tsx:
 *   errors: computeFleetErrors(summaryReport?.providerErrorObservations ?? [], from, to)
 */
export function computeFleetErrors(
  observations: { observed_at: string | null }[],
  from?: string,
  to?: string
): number {
  if (!from || !to) return observations.length
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  return observations.filter((o) => {
    if (!o.observed_at) return false
    const t = new Date(o.observed_at).getTime()
    return t >= fromMs && t < toMs
  }).length
}

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
