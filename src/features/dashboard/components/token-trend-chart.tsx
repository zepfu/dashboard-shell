/**
 * TokenTrendChart — 24-bar stacked provider token visualisation.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - Chart container: background var(--card), border 1px solid var(--border), padding 8px.
 * - Individual bars: border 1px solid var(--border), opacity 0.85, hover 1.0.
 * - Legend: gap 12px (was 8px), swatch 10×10px + border (was 8×8px no border).
 * - Section title: .section-title class with amber color (rendered by parent section).
 *
 * Wave 14-F compliance (audit §12):
 * - Hover via CSS .trend-bar:hover (opacity 1) instead of JS event handlers,
 *   restoring the mockup-spec `transition: opacity 50ms` (audit §12 deviation 2).
 *   CSS rule added to index.css Wave 14-F block.
 * - .tt-slice: removed inline `background` override — color applied exclusively
 *   via CSS class (audit §12 deviation 3).
 *
 * Wave 24 — operator F8 fixes:
 * - F8a: PROVIDER_COLOR_MAP added as the canonical fallback palette so bars
 *   never render white when a CSS class carries no/wrong background. The map
 *   covers every provider the API can emit and uses PROVIDER_BRAND_HEX values.
 *   Inline `background` is applied via `resolveSliceColor` as a secondary
 *   source of truth alongside the CSS class — the CSS class retains priority
 *   through specificity, but the inline value catches any class with no rule.
 * - F8b: normalizeTrendData (trend-utils.ts) now canonicalises provider names
 *   before keying into TrendBucket.totals, ensuring xai rows are never lost.
 *
 * Accessibility: the outer container carries a descriptive aria-label.
 */
import type { CSSProperties, ReactElement } from 'react'
import { PROVIDER_BRAND_HEX } from '../lib/usage-report-display'

// ---------------------------------------------------------------------------
// Provider colour map
// ---------------------------------------------------------------------------

/**
 * Canonical provider→hex map used as a fallback when the CSS class for a
 * series key carries no (or an incorrect) background rule.
 *
 * Values are sourced from {@link PROVIDER_BRAND_HEX} — the single source of
 * truth for provider brand colours across the dashboard — supplemented with
 * aliases that the trend API may emit (`gemini`, `local_llm`, `local_embed`).
 *
 * Every provider name that `providerDimension` in report-service.mjs can
 * produce must have an entry here so that bars are never rendered white:
 *   anthropic, openai, google (+ gemini alias), xai, nvidia_nim, openrouter,
 *   local (+ local_llm / local_embed aliases).
 *
 * Not exported: this is an implementation detail of {@link resolveSliceColor}.
 * Consumer code that needs provider colours should import {@link PROVIDER_BRAND_HEX}
 * directly from `../lib/usage-report-display`.
 */
const PROVIDER_COLOR_MAP: Readonly<Record<string, string>> = {
  ...PROVIDER_BRAND_HEX,
  // Alias: Google/Gemini — same brand colour
  gemini: PROVIDER_BRAND_HEX.google ?? '#4285f4',
  // Aliases: local sub-variants
  local_llm: PROVIDER_BRAND_HEX.local ?? '#64748b',
  local_embed: PROVIDER_BRAND_HEX.local ?? '#64748b',
}

/**
 * Returns the resolved hex color for a series key, preferring the explicit
 * `color` prop then falling back to {@link PROVIDER_COLOR_MAP} then to a
 * mid-grey so bars are never invisible.
 */
function resolveSliceColor(key: string, color: string): string {
  if (color && color !== '') return color
  return PROVIDER_COLOR_MAP[key] ?? '#94a3b8'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One time bucket with per-provider token totals. */
export interface TrendBucket {
  label: string
  totals: Record<string, number>
}

/** Series configuration for one provider in the chart. */
export interface ProviderSeries {
  key: string
  label: string
  color: string
  cssClass: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TokenTrendChartProps {
  data: TrendBucket[]
  series: ProviderSeries[]
}

// ---------------------------------------------------------------------------
// TokenTrendChart
// ---------------------------------------------------------------------------

/**
 * TokenTrendChart renders a stacked bar chart of token usage over time,
 * grouped by provider, with a legend strip below.
 */
export function TokenTrendChart({
  data,
  series,
}: TokenTrendChartProps): ReactElement {
  return (
    <div
      aria-label='Token usage over time, stacked by provider'
      style={{ width: '100%' }}
    >
      {/* Bar strip with reference card styling */}
      <div
        className='token-trend-chart'
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          padding: '8px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          height: '80px',
          width: '100%',
        }}
      >
        {data.map((bucket) => {
          // Compute total tokens for this bucket across all series
          const total = series.reduce(
            (sum, s) => sum + (bucket.totals[s.key] ?? 0),
            0
          )

          return (
            <div
              key={bucket.label}
              className='trend-bar'
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                flexDirection: 'column-reverse',
                overflow: 'hidden',
                minWidth: 0,
                border: '1px solid var(--border)',
                // 14-F.5: opacity set via inline style; CSS .trend-bar:hover
                // overrides to 1 with transition: opacity 50ms from index.css
                opacity: 0.85,
              }}
            >
              {series.map((s) => {
                const tokens = bucket.totals[s.key] ?? 0
                if (tokens <= 0) return null

                const pct = total > 0 ? (tokens / total) * 100 : 0

                // F8a: resolve bar color — prefer the explicit prop value then
                // fall back to PROVIDER_COLOR_MAP so bars are never white.
                const sliceStyle: CSSProperties = {
                  flexBasis: `${pct.toFixed(4)}%`,
                  flexShrink: 0,
                  minHeight: '1px',
                  width: '100%',
                  // Inline background is the second source of truth after the
                  // CSS class. It catches providers whose .tt-* rule is absent
                  // or carries an incorrect near-white value (e.g. old tt-xai).
                  background: resolveSliceColor(s.key, s.color),
                }

                return (
                  <div
                    key={s.key}
                    className={`tt-slice ${s.cssClass}`}
                    style={sliceStyle}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div
        className='tt-legend'
        style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--fg-muted)',
          padding: '6px 8px',
          letterSpacing: '0.02em',
        }}
      >
        {series.map((s) => (
          <div
            key={s.key}
            className='tt-leg-item'
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span
              className={`tt-swatch ${s.cssClass}`}
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                border: '1px solid var(--border)',
                flexShrink: 0,
                // F8a: same fallback approach as .tt-slice — inline background
                // ensures legend swatches always show the correct brand color.
                background: resolveSliceColor(s.key, s.color),
              }}
            />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
