const providerColorsByKey: Record<string, string> = {
  openai: '#2563eb',
  anthropic: '#7c3aed',
  google: '#0891b2',
  gemini: '#0891b2',
  openrouter: '#4f46e5',
  local_llm: '#c026d3',
  local_embed: '#0369a1',
  nvidia_nim: '#6d28d9',
  chatgpt: '#475569',
}

export const providerColors = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
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
  return normalized
}

export function modelColorFor(model: string) {
  return modelColors[colorHash(model.toLowerCase(), modelColors.length)]
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
