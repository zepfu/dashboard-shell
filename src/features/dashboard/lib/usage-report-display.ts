/**
 * Shared dashboard display helpers. Canonical provider identity helpers remain in
 * provider-identity.ts and are re-exported here for compatibility.
 *
 * Timezone contract: these helpers mirror the dashboard date logic in
 * `server/report-service.mjs` (`formatDashboardDate`, `addDaysToDateString`,
 * and `dashboardDateToUtcIso`) for `DASHBOARD_TIME_ZONE`. They run in separate
 * runtimes, so update both copies together rather than moving this browser
 * contract into a server import.
 */
const DASHBOARD_TIME_ZONE = 'America/New_York'

const DATE_PARTS_FORMATTER_OPTIONS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
} as const

const DASHBOARD_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: DASHBOARD_TIME_ZONE,
  ...DATE_PARTS_FORMATTER_OPTIONS,
})

const DATE_PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>([
  [DASHBOARD_TIME_ZONE, DASHBOARD_DATE_PARTS_FORMATTER],
])

const DASHBOARD_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: DASHBOARD_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
})

const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
})

function datePartsInTimeZone(
  date: Date,
  timeZone: string
): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const formatter =
    DATE_PARTS_FORMATTER_CACHE.get(timeZone) ??
    (() => {
      const created = new Intl.DateTimeFormat('en-US', {
        ...DATE_PARTS_FORMATTER_OPTIONS,
        timeZone,
      })
      DATE_PARTS_FORMATTER_CACHE.set(timeZone, created)
      return created
    })()
  const parts = formatter.formatToParts(date)
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

export function formatDashboardDate(date: Date): string {
  const parts = datePartsInTimeZone(date, DASHBOARD_TIME_ZONE)
  return [
    parts.year.toString().padStart(4, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.day.toString().padStart(2, '0'),
  ].join('-')
}

export function addDaysToDateString(value: string, days: number): string {
  const parts = value.split('-')
  if (parts.length !== 3) return value
  const [year, month, day] = parts.map(Number)
  if (![year, month, day].every(Number.isFinite)) return value
  const date = new Date(Date.UTC(year, month - 1, day + days))
  const time = date.getTime()
  if (!Number.isFinite(time)) return value
  return date.toISOString().slice(0, 10)
}

export function dashboardDateToUtcMs(value: string): number {
  const dateParts = value.split('-')
  if (dateParts.length !== 3) return NaN
  const [yearText, monthText, dayText] = dateParts
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined
  )
    return NaN
  if (
    !/^\d+$/.test(yearText) ||
    !/^\d+$/.test(monthText) ||
    !/^\d+$/.test(dayText)
  ) {
    return NaN
  }

  const [year, month, day] = [yearText, monthText, dayText].map(Number)
  if (![year, month, day].every(Number.isFinite)) return NaN
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0)
  if (!Number.isFinite(targetAsUtc)) return NaN
  let candidate = targetAsUtc
  for (let i = 0; i < 4; i += 1) {
    const parts = datePartsInTimeZone(new Date(candidate), DASHBOARD_TIME_ZONE)
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
  return candidate
}

export function formatDashboardTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return DASHBOARD_TIME_FORMATTER.format(date)
}

export function formatDashboardIntervalCompact(start: Date, end: Date): string {
  const format = (date: Date): string => {
    const parts = datePartsInTimeZone(date, DASHBOARD_TIME_ZONE)
    return `${parts.month.toString()}/${parts.day.toString()} ${parts.hour
      .toString()
      .padStart(2, '0')}:${parts.minute.toString().padStart(2, '0')}`
  }
  return `${format(start)} → ${format(end)}`
}

// Canonical provider identity is owned by provider-identity.ts.
// Re-export here so existing import sites can continue using usage-report-display.
export {
  canonicalProvider,
  providerDisplayLabel,
  providerAliases,
  QUOTA_ONLY_PROVIDERS,
} from './provider-identity'

const providerColorsByKey: Record<string, string> = {
  openai: '#2563eb',
  anthropic: '#7c3aed',
  antigravity: '#0f766e',
  google: '#0891b2',
  gemini: '#0891b2',
  xai: '#334155',
  openrouter: '#4f46e5',
  local: '#c026d3',
  local_llm: '#c026d3',
  local_embed: '#c026d3',
  nvidia_nim: '#6d28d9',
  chatgpt: '#475569',
  alibaba_token_plan: '#d97706',
  kimi_code: '#0284c7',
  cohere: '#dc2626',
  cursor_agent: '#9333ea',
  opencode_go: '#16a34a',
  opencode_zen: '#0d9488',
  zai_coding_plan: '#7c2d12',
}

/** Reference brand-identity colors for provider labels and headers. */
export const PROVIDER_BRAND_HEX: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  antigravity: '#0f766e',
  google: '#4285f4',
  xai: '#475569',
  nvidia_nim: '#76b900',
  openrouter: '#7e57c2',
  local: '#64748b',
  alibaba_token_plan: '#ff6a00',
  kimi_code: '#0ea5e9',
  cohere: '#d97706',
  cursor_agent: '#a855f7',
  opencode_go: '#16a34a',
  opencode_zen: '#14b8a6',
  zai_coding_plan: '#ea580c',
}

/** Returns brand color for a provider, falling back to `'var(--fg)'`. */
export function providerBrandHex(provider: string): string {
  const key = providerColorKey(provider)
  return (
    PROVIDER_BRAND_HEX[key] ??
    PROVIDER_BRAND_HEX[provider.toLowerCase()] ??
    'var(--fg)'
  )
}

/** Infer a provider key from a model name for brand-color lookup. */
function modelToProviderKey(model: string): string {
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
  if (m.startsWith('grok') || m.startsWith('xai/') || m.startsWith('oa_xai/')) {
    return 'xai'
  }

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

/** Returns brand color for a model name through provider-key inference. */
export function modelBrandHex(model: string): string {
  const key = modelToProviderKey(model)
  return providerBrandHex(key)
}

const MODEL_CONTEXT_SUFFIXES = new Set(['free', 'stealth'])
const MODEL_ACRONYMS = new Set([
  'ai',
  'api',
  'asr',
  'fs',
  'gpt',
  'llm',
  'mcp',
  'nim',
  'ocr',
  'sql',
  'stt',
  'tts',
])

function formatModelToken(token: string): string {
  const lower = token.toLowerCase()
  if (MODEL_ACRONYMS.has(lower)) return lower.toUpperCase()
  if (/^o[0-9]+$/i.test(token)) return token.toUpperCase()
  if (/^[0-9]+(?:\.[0-9]+)?[a-z]*$/i.test(token)) return token
  if (token === '') return token
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
}

function formatModelPathPart(part: string): string {
  return part
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(formatModelToken)
    .join(' ')
}

/**
 * Formats raw model identifiers for display without changing the row key.
 *
 * Raw provider/model labels often arrive as API identifiers
 * (`gpt-5.5`, `qwen3-coder:free`). The dashboard should render those as
 * readable names while preserving suffix context that affects operator
 * interpretation, especially OpenRouter `:free` and internal `:stealth`
 * models.
 */
export function formatModelDisplayName(model: string): string {
  const trimmed = model.trim()
  if (trimmed === '') return model

  let base = trimmed
  const contexts: string[] = []

  for (;;) {
    const match = base.match(/:([A-Za-z][A-Za-z0-9_-]*)$/)
    if (match == null) break

    const context = (match[1] ?? '').toLowerCase()
    if (!MODEL_CONTEXT_SUFFIXES.has(context)) break

    contexts.unshift(context)
    base = base.slice(0, -match[0].length)
  }

  const displayBase = base
    .split('/')
    .map(formatModelPathPart)
    .filter(Boolean)
    .join('/')

  if (contexts.length === 0) return displayBase || trimmed
  return `${displayBase || base} · ${contexts.join(' · ')}`
}

const providerColors = [
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

/**
 * Shared exported color helper for caller-owned provider visual styling.
 * Kept exported for dashboard and sidebar consumers that rely on this contract.
 */
export function providerColorFor(provider: string) {
  const colorKey = providerColorKey(provider)
  return (
    providerColorsByKey[colorKey] ??
    providerColors[colorHash(colorKey, providerColors.length)]
  )
}

function providerColorKey(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'google' || normalized === 'gemini') return 'google'
  if (
    normalized === 'x.ai' ||
    normalized === 'xai' ||
    normalized === 'oa_xai' ||
    normalized.startsWith('xai/') ||
    normalized.startsWith('oa_xai/')
  ) {
    return 'xai'
  }
  if (normalized === 'nvidia') return 'nvidia_nim'
  if (normalized === 'open-router') return 'openrouter'
  if (normalized === 'local' || normalized.startsWith('local_')) return 'local'
  return normalized
}

function colorHash(value: string, modulo: number) {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash % modulo
}

export function colorWithAlpha(color: string, alpha: number) {
  const normalized = color.trim()
  const hex6 = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  const hex3 = normalized.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i)
  let red: string
  let green: string
  let blue: string
  if (hex6) {
    red = hex6[1] ?? '00'
    green = hex6[2] ?? '00'
    blue = hex6[3] ?? '00'
  } else if (hex3) {
    red = (hex3[1] ?? '0') + (hex3[1] ?? '0')
    green = (hex3[2] ?? '0') + (hex3[2] ?? '0')
    blue = (hex3[3] ?? '0') + (hex3[3] ?? '0')
  } else {
    return normalized
  }
  return `rgb(${Number.parseInt(red, 16)} ${Number.parseInt(green, 16)} ${Number.parseInt(blue, 16)} / ${alpha})`
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  const formatted = PERCENT_FORMATTER.format(value)
  return `${formatted}%`
}

/** Formats latency in milliseconds as either rounded ms or fixed-second output. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/**
 * Formats a USD cost value with comma-separated thousands and exactly 2
 * decimal places.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return '—'
  return `$${usd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Count of provider error observations within a dashboard date window.
 *
 * Each row in `providerErrorObservations` is one discrete event (one 429, one
 * 529, etc.) queried server-side with a fixed 14-day window. Passing `from` /
 * `to` (ISO-8601 date strings) filters to only observations whose
 * `observed_at` falls within the Eastern-calendar `[from, to)` window,
 * aligning the Errors KPI tile with the user-selected date range used by all
 * other KPI tiles.
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
  const fromMs = dashboardDateToUtcMs(from)
  const toMs = dashboardDateToUtcMs(to)
  return observations.filter((o) => {
    if (!o.observed_at) return false
    const t = new Date(o.observed_at).getTime()
    return t >= fromMs && t < toMs
  }).length
}

/** Computes fleet-wide weighted P95 latency in milliseconds from provider health rows. */
export function computeFleetP95(
  healthRows: {
    upstream_p95_ms: number | null
    total_p95_ms?: number | null
    requests: number
  }[]
): number {
  let weightedSum = 0
  let totalRequests = 0
  for (const r of healthRows) {
    const p95 = r.upstream_p95_ms ?? r.total_p95_ms
    if (p95 == null) continue
    weightedSum += p95 * r.requests
    totalRequests += r.requests
  }
  return totalRequests > 0 ? weightedSum / totalRequests : 0
}

/** Formats an ISO timestamp as relative reset distance (for example, `in 3d 1h`). */
export function formatResetDistance(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    // Native fallback avoids importing date-fns for this lightweight component.
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
