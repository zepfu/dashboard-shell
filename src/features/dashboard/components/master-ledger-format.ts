/**
 * Master ledger display formatters and severity colors (W11 split).
 */
import {
  canonicalProvider,
  formatModelDisplayName,
} from '../lib/usage-report-display'
import type { ModelRow } from './master-ledger-aggregation'

export function providerDisplayName(provider: string): string {
  const key = canonicalProvider(provider)
  switch (key) {
    case 'anthropic':
      return 'Anthropic'
    case 'openai':
      return 'OpenAI'
    case 'google':
      return 'Google'
    case 'xai':
      return 'xAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'nvidia_nim':
      return 'NVIDIA'
    case 'local':
      return 'Local'
    case 'alibaba_token_plan':
      return 'Alibaba Token Plan'
    default:
      return formatModelDisplayName(provider)
  }
}
/**
 * Returns the CSS color variable for sparkline tinting (still needed for
 * Sparkline color prop which accepts a color string, not a class name).
 *
 * Wave 26 (F#13): quota_pct removed from severity computation.
 */
export function rowSeverityColor(row: ModelRow): string {
  const err = row.error_pct
  if (err === undefined) return 'var(--accent-cool)'
  if (err >= 2) return 'var(--accent-hot)'
  if (err >= 0.5) return 'var(--accent-warm)'
  if (row.cost_usd >= 1) return 'var(--accent-teal)'
  return 'var(--accent-cool)'
}

/** Returns cost cell color based on cost_usd severity thresholds (C6). */
export function costColor(cost: number): string {
  if (cost >= 5) return 'var(--accent-hot)'
  if (cost >= 1) return 'var(--accent-warm)'
  return 'var(--accent-cool)'
}

/** Returns error-pct cell color based on error_pct severity thresholds (C7). */
export function errorPctColor(pct: number): string {
  if (pct >= 2) return 'var(--accent-hot)'
  if (pct >= 0.5) return 'var(--accent-warm)'
  return 'var(--accent-teal)'
}

/** Maximum number of recent error events shown in the Err% hover tooltip. */
export const MAX_ERROR_HOVER_ROWS = 10

export function fmtOrDash<T>(
  value: T | null | undefined,
  formatter?: (v: T) => string
): string {
  if (value == null) return '—'
  return formatter ? formatter(value) : String(value)
}

export function formatPercent(pct: number): string {
  return `${pct.toFixed(1)}%`
}

/**
 * Formats an ISO timestamp as a compact "N ago" string for the error hover
 * tooltip.  Returns `'—'` for null/invalid inputs.
 *
 * Q8 (Wave 31): used to show how long ago each error observation occurred in
 * the Model Ledger Err% hover panel.
 */
export function formatObservedAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    const diffMs = Date.now() - date.getTime()
    if (diffMs < 0) return 'just now'
    const totalMins = Math.floor(diffMs / 60_000)
    const days = Math.floor(totalMins / 1440)
    const hours = Math.floor((totalMins % 1440) / 60)
    const mins = totalMins % 60
    if (days > 0) return `${days.toString()}d ${hours.toString()}h ago`
    if (hours > 0) return `${hours.toString()}h ${mins.toString()}m ago`
    if (mins > 0) return `${mins.toString()}m ago`
    return 'just now'
  } catch {
    return '—'
  }
}
