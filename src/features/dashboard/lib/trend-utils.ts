/**
 * trend-utils — Pure helper functions for token trend data processing.
 *
 * These functions transform raw API data into chart-ready formats and can
 * be used both by components and in isolation (pure functions, no React).
 */
import type { UsageReportTrendRow } from '../api/usage-report'
import type { TrendBucket } from '../components/token-trend-chart'

// ---------------------------------------------------------------------------
// normalizeTrendData
// ---------------------------------------------------------------------------

/**
 * normalizeTrendData groups UsageReportTrendRow records by bucket_start,
 * summing per-provider token counts into a totals map per bucket.
 *
 * @param rows - Raw trend rows from the usage report API.
 * @returns Array of TrendBucket objects in ascending bucket order.
 */
export function normalizeTrendData(rows: UsageReportTrendRow[]): TrendBucket[] {
  // Use an ordered map (insertion order = chronological order after sorting)
  const bucketMap = new Map<string, Record<string, number>>()

  for (const row of rows) {
    const key = row.bucket
    const existing = bucketMap.get(key)
    if (existing === undefined) {
      bucketMap.set(key, { [row.provider]: row.token_total })
    } else {
      existing[row.provider] = (existing[row.provider] ?? 0) + row.token_total
    }
  }

  // Sort buckets chronologically
  const sortedKeys = [...bucketMap.keys()].sort()

  return sortedKeys.map((bucket) => ({
    label: bucket,
    totals: bucketMap.get(bucket) ?? {},
  }))
}

// ---------------------------------------------------------------------------
// computeSparklinePoints
// ---------------------------------------------------------------------------

/**
 * computeSparklinePoints converts a numeric series into an SVG polyline
 * points string, normalised to the given viewBox dimensions with 2px padding.
 *
 * Mirrors the logic inside the Sparkline component for reuse outside React.
 *
 * @param data   - Input numeric series (must be non-empty).
 * @param width  - SVG viewport width (default 60).
 * @param height - SVG viewport height (default 20).
 * @returns SVG `points` attribute string, e.g. `"0,18 30,10 60,2"`.
 *          Returns an empty string for empty input.
 */
export function computeSparklinePoints(
  data: number[],
  width = 60,
  height = 20
): string {
  if (data.length === 0) return ''

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  return data
    .map((value, i) => {
      const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width
      const y = height - 2 - ((value - min) / range) * (height - 4)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
