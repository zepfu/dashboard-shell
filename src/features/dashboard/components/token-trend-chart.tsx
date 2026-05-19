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
 * Wave 28-TrendVisual:
 * - Track B: hover tooltip per bar — shows bucket label + per-provider token
 *   breakdown sorted by token count descending. Uses the existing HoverTooltip
 *   primitive (variant='quota': above-bar positioning) and .v9-tip-* CSS
 *   class structure consistent with other dashboard tooltips.
 * - Track C: bucket label row below the bar strip. Each bar shows its
 *   TrendBucket.label; ISO-8601 timestamps are formatted as MM/DD for daily
 *   grain, relative labels (e.g. "23h") are displayed as-is. To avoid
 *   crowding at 24 bars only even-indexed labels are shown (every other bar).
 *
 * Wave 31 — Q1 bar-height fix:
 * - Replaced `height: '100%'` on `.trend-bar` (which collapsed every bar to
 *   4-7px under `align-items: flex-end`) with a volume-proportional inline
 *   `height` computed as `(bucketTotal / maxBucketTotal) * 100%`. Non-zero
 *   buckets are floored at 6% so the smallest visible bucket still renders a
 *   ribbon. Empty buckets (total === 0) get 0% and are fully invisible.
 *   Root-cause diagnosis: Wave 31 principal investigation, Q1 verdict.
 *
 * Accessibility: the outer container carries a descriptive aria-label.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { formatBucketLabel } from '../lib/trend-utils'
import { PROVIDER_BRAND_HEX } from '../lib/usage-report-display'
import { HoverTooltip } from './primitives/hover-tooltip'

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
// Tooltip content builder
// ---------------------------------------------------------------------------

/**
 * Builds the tooltip {@link ReactNode} for a single hovered bucket.
 *
 * Shows the bucket label as a heading and then one row per provider
 * (from `series`) that has a non-zero token count, sorted descending by
 * token count. Uses the standard `.v9-tip-head` / `.v9-tip-row` CSS
 * structure shared by all dashboard tooltips.
 *
 * @param bucket - The {@link TrendBucket} being hovered.
 * @param series - Ordered series config (used only for provider label lookup).
 * @returns A {@link ReactNode} ready to pass to {@link HoverTooltip}.
 */
function buildBarTooltip(
  bucket: TrendBucket,
  series: readonly ProviderSeries[]
): ReactNode {
  // Build a label map for fast lookup (key → human label)
  const labelMap = new Map<string, string>(series.map((s) => [s.key, s.label]))

  // Collect all providers with non-zero tokens and sort descending
  const rows = Object.entries(bucket.totals)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)

  const total = rows.reduce((sum, [, v]) => sum + v, 0)

  const displayLabel = formatBucketLabel(bucket.label)

  return (
    <>
      <div className='v9-tip-head'>{displayLabel}</div>
      {rows.map(([key, count]) => {
        const providerLabel = labelMap.get(key) ?? key
        const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0'
        const formatted = new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(count)
        return (
          <div
            key={key}
            className='v9-tip-row'
            style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
          >
            <span className='t-model'>{providerLabel}</span>
            <span className='t-count'>
              {formatted} ({pct}%)
            </span>
          </div>
        )
      })}
      {rows.length === 0 && (
        <div className='v9-tip-row' style={{ gridTemplateColumns: '1fr' }}>
          <span className='t-model' style={{ color: 'var(--fg-muted)' }}>
            no data
          </span>
        </div>
      )}
    </>
  )
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
 * grouped by provider, with a legend strip and bucket label row below.
 *
 * Each bar has a hover tooltip (via {@link HoverTooltip}) showing the
 * bucket label and per-provider token breakdown sorted descending.
 * A label row underneath each bar displays `MM/DD` (ISO dates) or the
 * relative label (e.g. `"23h"`) as-is, with every-other-bar skipping
 * at 24 buckets to prevent text crowding.
 */
export function TokenTrendChart({
  data,
  series,
}: TokenTrendChartProps): ReactElement {
  // Determine whether to show every other label (crowding threshold).
  // At 24 bars the text would overlap at any practical chart width, so we
  // skip odd-indexed labels. Below 12 bars all labels can be shown.
  const skipAlternate = data.length >= 12

  // Pre-compute per-bucket totals for volume-proportional height scaling.
  // A single pass here avoids a second reduce inside the render loop and
  // lets us derive maxBucketTotal before JSX construction begins.
  const bucketTotals = data.map((bucket) =>
    series.reduce((sum, s) => sum + (bucket.totals[s.key] ?? 0), 0)
  )
  const maxBucketTotal = Math.max(0, ...bucketTotals)

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
        {data.map((bucket, idx) => {
          // Use the pre-computed per-bucket total (avoids a second reduce pass).
          const total = bucketTotals[idx] ?? 0

          // Compute the volume-proportional outer bar height as a % of the 80px
          // container (height is set on the parent flex container above).
          //
          // Under `align-items: flex-end`, percentage heights on flex children
          // are resolved relative to the container's definite height (80px), so
          // `height: 50%` → 40px, `height: 100%` → 80px.
          //
          // The previous `height: '100%'` did NOT produce this: with no definite
          // height on the flex container itself (only a fixed px value on the
          // container), the percentage resolved against the *content* height of
          // each child, collapsing every bar to the sum of its slice min-heights
          // (4-7px). See Wave 31 principal investigation Q1 for DOM evidence.
          //
          // Rules (matching mockup lines 2780-2795):
          //   • total === 0  → 0%  (empty bucket, bar invisible)
          //   • raw < 6      → 6%  (floor so the smallest non-zero bucket still
          //                         renders a visible ~5px ribbon)
          //   • otherwise    → (total / maxBucketTotal) * 100%
          let pctHeight = 0
          if (total > 0 && maxBucketTotal > 0) {
            const raw = (total / maxBucketTotal) * 100
            pctHeight = raw < 6 ? 6 : raw
          }

          // Only show tooltip for non-empty bars (at least one provider has tokens)
          const isEmpty = total === 0
          const tooltipContent = isEmpty
            ? null
            : buildBarTooltip(bucket, series)

          const bar = (
            <div
              key={bucket.label}
              className='trend-bar'
              style={{
                // flex: '0 0 auto' — no grow, no shrink, height-driven sizing.
                // Inside the column-flex wrapper, flex: 1 (= flex: 1 1 0%) was
                // forcing this child to consume all main-axis (height) space,
                // making the inline height: N% inert. Width distribution across
                // the 24 bars is handled by the wrapper's own flex: 1 1 0%
                // (set in hover-tooltip.tsx), so we don't need flex growth here.
                flex: '0 0 auto',
                width: '100%',
                height: `${pctHeight.toFixed(1)}%`,
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

          // W28-TrendVisual Track B: wrap non-empty bars in HoverTooltip.
          // Empty (padding) bars are left unwrapped to avoid spurious tooltip
          // triggers and keep the DOM minimal.
          if (isEmpty || tooltipContent === null) {
            return (
              <div
                key={`${bucket.label}-${idx.toString()}`}
                style={{ flex: 1, minWidth: 0 }}
              >
                {bar}
              </div>
            )
          }

          return (
            <HoverTooltip
              key={`${bucket.label}-${idx.toString()}`}
              content={tooltipContent}
              variant='quota'
              className='tt-bar-tip-wrap'
            >
              {bar}
            </HoverTooltip>
          )
        })}
      </div>

      {/* W28-TrendVisual Track C: x-axis bucket label row.
          Labels mirror the bar strip's flex layout (gap: 1px, flex: 1 per
          bar) so each label is centred under its bar.
          ISO-8601 labels → MM/DD; relative labels ("Xh") → as-is.
          Every other label is hidden when data.length >= 12 to prevent
          crowding at 24-bar density. */}
      <div
        className='tt-label-row'
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1px',
          paddingTop: '3px',
          paddingLeft: '8px',
          paddingRight: '8px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {data.map((bucket, idx) => {
          const displayLabel =
            skipAlternate && idx % 2 !== 0
              ? ''
              : formatBucketLabel(bucket.label)

          return (
            <div
              key={`lbl-${bucket.label}-${idx.toString()}`}
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                color: 'var(--fg-muted)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'clip',
                lineHeight: 1.2,
                letterSpacing: '0.02em',
                userSelect: 'none',
                // Visually hidden placeholder for odd-indexed bars at 24-bar density
                visibility: displayLabel === '' ? 'hidden' : 'visible',
              }}
              aria-hidden={displayLabel === '' ? true : undefined}
            >
              {displayLabel === '' ? ' ' : displayLabel}
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
