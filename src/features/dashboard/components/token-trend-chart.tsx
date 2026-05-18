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
 * Accessibility: the outer container carries a descriptive aria-label.
 */
import type { ReactElement } from 'react'

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

                return (
                  <div
                    key={s.key}
                    // 14-F.5: color applied via CSS class only (audit §12 deviation 3)
                    // Inline background removed — .tt-anthropic etc. define the color
                    className={`tt-slice ${s.cssClass}`}
                    style={{
                      flexBasis: `${pct.toFixed(4)}%`,
                      flexShrink: 0,
                      minHeight: '1px',
                      width: '100%',
                    }}
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
              // 14-F.5: swatch color applied via CSS class only
              className={`tt-swatch ${s.cssClass}`}
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                border: '1px solid var(--border)',
                flexShrink: 0,
              }}
            />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
