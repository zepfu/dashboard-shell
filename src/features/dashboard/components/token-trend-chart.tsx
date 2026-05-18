/**
 * TokenTrendChart — 24-bar stacked provider token visualisation.
 *
 * Renders a strip of vertical stacked bars where each bar represents one
 * time bucket and each coloured slice represents a provider's proportion
 * of total tokens. Bars grow from the bottom up using column-reverse flex.
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
      {/* Bar strip */}
      <div
        style={{
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
              }}
            >
              {series.map((s) => {
                const tokens = bucket.totals[s.key] ?? 0
                if (tokens <= 0) return null

                const pct = total > 0 ? (tokens / total) * 100 : 0

                return (
                  <div
                    key={s.key}
                    className={s.cssClass}
                    style={{
                      flexBasis: `${pct.toFixed(4)}%`,
                      flexShrink: 0,
                      background: s.color,
                      minHeight: '1px',
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
          flexWrap: 'wrap',
          gap: '8px',
          marginTop: '6px',
        }}
      >
        {series.map((s) => (
          <div
            key={s.key}
            className='tt-leg-item'
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: 'var(--fg-muted)',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                background: s.color,
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
