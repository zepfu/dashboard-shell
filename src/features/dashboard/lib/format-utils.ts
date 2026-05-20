/**
 * Shared number-formatting utilities for Phosphor Atlas dashboard.
 *
 * These are the canonical implementations that supersede the local copies
 * that previously lived in kpi-strip.tsx, provider-card.tsx,
 * master-ledger-table.tsx, comparison-panel.tsx, repo-breakdown-table.tsx,
 * and client-breakdown-table.tsx.
 *
 * Canonical choices (see ⚠-1 / ⚠-2 in wave34-code-css-audit.md):
 *   - `fmtCompact`: uppercase suffixes (B/M/K), full four-tier coverage
 *     (≥1e9, ≥1e6, ≥1e3, else).  The operator-preferred display shows "1.2K"
 *     (uppercase), so lowercase-k variants in provider-card and
 *     comparison-panel have been unified to uppercase.
 *   - `numFmt`: identical across all three previous call-sites; centralised
 *     here to eliminate copy-paste maintenance burden.
 */

/**
 * Format a large integer with compact B/M/K suffixes (operator F#9 / F#12).
 *
 * Thresholds:
 *   ≥ 1 000 000 000 → `"X.XB"` (billions)
 *   ≥ 1 000 000     → `"X.XM"` (millions)
 *   ≥ 1 000         → `"X.XK"` (thousands — uppercase K, operator preference)
 *   else            → `String(n)` (raw integer string)
 *
 * @example fmtCompact(19_471_800_848) // "19.5B"
 * @example fmtCompact(1_200_000)      // "1.2M"
 * @example fmtCompact(587_234)        // "587.2K"
 * @example fmtCompact(999)            // "999"
 */
export function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Format a number with locale-aware thousand separators and a fixed number
 * of decimal places.
 *
 * @param n        - The number to format.
 * @param decimals - Decimal places for both min and max (default 0).
 *
 * @example numFmt(1_234_567)    // "1,234,567"
 * @example numFmt(3.14159, 2)   // "3.14"
 * @example numFmt(0.5, 1)       // "0.5"
 */
export function numFmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
