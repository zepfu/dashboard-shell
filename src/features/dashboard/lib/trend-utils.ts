/**
 * trend-utils — Pure helper functions for token trend data processing.
 *
 * These functions transform raw API data into chart-ready formats and can
 * be used both by components and in isolation (pure functions, no React).
 */
import type { UsageReportTrendRow } from '../api/usage-report'
import type { TrendBucket } from '../components/token-trend-chart'
import { canonicalProvider } from './usage-report-display'

// ---------------------------------------------------------------------------
// normalizeTrendData
// ---------------------------------------------------------------------------

/** Target bucket count for the trend chart — one bar per hour over 24 hours. */
const TREND_BUCKET_COUNT = 24

/**
 * normalizeTrendData groups UsageReportTrendRow records by bucket_start,
 * summing per-provider token counts into a totals map per bucket.
 *
 * Provider names are normalised through {@link canonicalProvider} before keying
 * into the totals map so that raw API variants such as `'x.ai'`, `'gemini'`, or
 * `'nvidia'` are collapsed to their canonical forms (`'xai'`, `'google'`,
 * `'nvidia_nim'`). This ensures that the chart series keys always find their
 * matching entries in `TrendBucket.totals` regardless of which variant the
 * upstream data source emits.
 *
 * The result is always padded (or truncated) to exactly {@link TREND_BUCKET_COUNT}
 * buckets so that the TokenTrendChart always renders ~24 narrow bars regardless
 * of whether the API returns daily, weekly, or monthly aggregates:
 *
 * - If the raw data produces ≥24 buckets: keep the most recent 24.
 * - If the raw data produces <24 buckets: prepend empty buckets labelled
 *   `Xh` (where X counts down from the left) so the chart fills the full
 *   width with appropriately narrow bars.
 *
 * @param rows - Raw trend rows from the usage report API.
 * @returns Array of exactly {@link TREND_BUCKET_COUNT} TrendBucket objects
 *   in ascending bucket order.
 */
export function normalizeTrendData(rows: UsageReportTrendRow[]): TrendBucket[] {
  // Use an ordered map (insertion order = chronological order after sorting)
  const bucketMap = new Map<string, Record<string, number>>()

  for (const row of rows) {
    const key = row.bucket
    // Normalise provider name so variant spellings ('x.ai', 'gemini', 'nvidia')
    // collapse to their canonical forms ('xai', 'google', 'nvidia_nim') and
    // match the keys used in PROVIDER_SERIES / TokenTrendChart.
    const provider = canonicalProvider(row.provider)
    const existing = bucketMap.get(key)
    if (existing === undefined) {
      bucketMap.set(key, { [provider]: row.token_total })
    } else {
      existing[provider] = (existing[provider] ?? 0) + row.token_total
    }
  }

  // Sort buckets chronologically
  const sortedKeys = [...bucketMap.keys()].sort()

  const dataBuckets: TrendBucket[] = sortedKeys.map((bucket) => ({
    label: bucket,
    totals: bucketMap.get(bucket) ?? {},
  }))

  // Truncate to the most recent TREND_BUCKET_COUNT if we have too many
  const trimmed =
    dataBuckets.length > TREND_BUCKET_COUNT
      ? dataBuckets.slice(dataBuckets.length - TREND_BUCKET_COUNT)
      : dataBuckets

  // Pad the beginning with empty buckets so the total is always exactly 24
  const padCount = TREND_BUCKET_COUNT - trimmed.length
  const padBuckets: TrendBucket[] = Array.from(
    { length: padCount },
    (_, i) => ({
      // Label counts back from the oldest real bucket so that the x-axis
      // reads as "Xh ago" for context (e.g. "23h", "22h", …).
      label: `${padCount - i + trimmed.length - 1}h`,
      totals: {},
    })
  )

  return [...padBuckets, ...trimmed]
}

// ---------------------------------------------------------------------------
// formatBucketLabel
// ---------------------------------------------------------------------------

/**
 * ISO-8601 date pattern (accepts both date-only and full datetime strings).
 *
 * Matches strings that start with `YYYY-MM-DD` so that daily-grain bucket
 * keys produced by the API (e.g. `2026-05-19T00:00:00.000Z`) are detected
 * and formatted as `MM/DD`. Relative labels such as `"23h"` do not match and
 * are returned unchanged.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

/**
 * Formats a raw {@link TrendBucket} label for display in the x-axis label row.
 *
 * - ISO-8601 strings → `MM/DD` (e.g. `"2026-05-19T00:00:00.000Z"` → `"05/19"`).
 * - Relative strings (e.g. `"23h"`, `"0h"`) → returned as-is.
 *
 * Exported so that the component and tests can share the same formatting logic
 * without duplicating the regex and slice arithmetic.
 *
 * @param rawLabel - The `label` field from a {@link TrendBucket}.
 * @returns A short display string suitable for an 8–9 px monospaced label.
 */
export function formatBucketLabel(rawLabel: string): string {
  if (!ISO_DATE_RE.test(rawLabel)) return rawLabel

  // Parse the date portion only to avoid timezone edge cases.
  // YYYY-MM-DD → MM/DD
  const datePart = rawLabel.slice(0, 10) // "YYYY-MM-DD"
  const month = datePart.slice(5, 7) // "MM"
  const day = datePart.slice(8, 10) // "DD"
  return `${month}/${day}`
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
