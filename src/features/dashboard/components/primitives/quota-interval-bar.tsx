/**
 * QuotaIntervalBar — segmented quota visualisation with projection tick.
 *
 * Renders N interval segments in a flex bar, each coloured according to its
 * iv-* threshold class (matching v9.7 CSS rules). A projection tick
 * (absolutely positioned) can be overlaid at any horizontal percentage.
 * Optionally wraps the bar in a HoverTooltip.
 *
 * Wave 9: changed height from 12px to 6px to match reference; changed
 * class names from severity-* to iv-0-5 / iv-5-10 / iv-10-25 / iv-25-50 /
 * iv-50-p per v9.7 CSS rules. High-velocity intervals get a shimmer
 * animation that respects `prefers-reduced-motion: reduce`.
 *
 * Wave 14-G: added `.qbar-fill`, `.quota-row-velocity`, `.quota-anomaly-icon`
 * structural class names per v9.7 mockup lines 1690–1742 and 412–436.
 *
 * Wave 41 spectral-animation scoping fix:
 * - Added `isPrior` prop. When true, the `.is-prior` class is added to the
 *   `.quota-row-bar` wrapper for prior/history bar styling hooks.
 * - `overflow: hidden` added to `.quota-row-bar` so the masked velocity overlay
 *   is clipped to the bar boundary and cannot bleed into adjacent provider card
 *   rows.
 *
 * D1-019: adjacent buckets with the same visual state are merged into wider
 * display runs. Fast/hot/peak tiers keep static segment intensity while a
 * single masked bar-level overlay provides motion for all hot spans.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { HoverTooltip } from './hover-tooltip'

export interface QuotaInterval {
  widthPct: number
  /** v9.7 threshold class: iv-0-5 | iv-5-10 | iv-10-25 | iv-25-50 | iv-50-p */
  severityClass: string
  highVelocity: boolean
  velocityClass?: string
}

/** Velocity tier for the optional sub-label row. */
export type VelocityTier = 'amber' | 'red' | 'steady'

const ANIMATED_VELOCITY_CLASSES = new Set([
  'velocity-fast',
  'velocity-hot',
  'velocity-peak',
])

function shouldAnimateInterval(interval: QuotaInterval): boolean {
  return (
    interval.highVelocity &&
    interval.velocityClass !== undefined &&
    ANIMATED_VELOCITY_CLASSES.has(interval.velocityClass)
  )
}

function intervalMergeKey(interval: QuotaInterval): string {
  return [
    interval.severityClass,
    shouldAnimateInterval(interval) ? 'animated' : 'static',
    interval.velocityClass ?? '',
  ].join('|')
}

function mergeQuotaIntervalsForDisplay(
  intervals: readonly QuotaInterval[]
): QuotaInterval[] {
  const runs: QuotaInterval[] = []

  for (const interval of intervals) {
    const normalized: QuotaInterval = {
      ...interval,
      highVelocity: shouldAnimateInterval(interval),
    }
    const previous = runs[runs.length - 1]

    if (
      previous !== undefined &&
      intervalMergeKey(previous) === intervalMergeKey(normalized)
    ) {
      previous.widthPct += normalized.widthPct
      continue
    }

    runs.push({ ...normalized })
  }

  return runs
}

function formatPercent(value: number): string {
  const clamped = Math.min(100, Math.max(0, value))
  return Number.isInteger(clamped)
    ? `${clamped}%`
    : `${Number(clamped.toFixed(4))}%`
}

function buildVelocityOverlayMask(
  intervals: readonly QuotaInterval[]
): string | undefined {
  const stops: string[] = ['transparent 0%']
  let cursor = 0
  let hasVisibleRun = false
  let lastVisibleEnd = 0

  for (const interval of intervals) {
    const start = cursor
    const end = cursor + interval.widthPct
    cursor = end

    if (!interval.highVelocity || end <= start) {
      continue
    }

    const startPct = formatPercent(start)
    const endPct = formatPercent(end)

    if (start > lastVisibleEnd || !hasVisibleRun) {
      stops.push(`transparent ${startPct}`)
    }

    stops.push(`black ${startPct}`, `black ${endPct}`, `transparent ${endPct}`)
    hasVisibleRun = true
    lastVisibleEnd = end
  }

  if (!hasVisibleRun) {
    return undefined
  }

  if (lastVisibleEnd < 100) {
    stops.push('transparent 100%')
  }

  return `linear-gradient(to right, ${stops.join(', ')})`
}

export type QuotaProjectionTier = 'sustainable' | 'approaching' | 'over'

function projectionTickClasses(
  projectionPct: number,
  projectionTier?: QuotaProjectionTier
): string {
  if (projectionTier !== undefined) {
    return `qbar-projection ${projectionTier}`
  }
  if (projectionPct > 100) {
    return 'qbar-projection over'
  }
  if (projectionPct >= 80) {
    return 'qbar-projection approaching'
  }
  return 'qbar-projection sustainable'
}

interface QuotaIntervalBarProps {
  intervals: QuotaInterval[]
  projectionPct?: number
  projectionTier?: QuotaProjectionTier
  tooltipContent?: ReactNode
  /**
   * Optional velocity annotation rendered as a `.quota-row-velocity` row
   * immediately below the bar. Includes text content and tier class
   * (`amber` | `red` | `steady`) per v9.7 mockup lines 1690–1742.
   */
  velocityLabel?: string
  velocityTier?: VelocityTier
  /**
   * Wave 41: when true, marks this bar as a prior (history) bar.
   * Adds `.is-prior` to the `.quota-row-bar` wrapper for prior/history
   * styling hooks while preserving velocity-tier classes.
   */
  isPrior?: boolean
}

/**
 * QuotaIntervalBar renders a multi-segment quota bar with optional projection
 * tick and tooltip wrapping.
 *
 * The bar height is 6px (v9.7 reference). Intervals use iv-* CSS class names
 * which must match the `.quota-interval.iv-*` rules in the global stylesheet.
 */
export function QuotaIntervalBar({
  intervals,
  projectionPct,
  projectionTier,
  tooltipContent,
  velocityLabel,
  velocityTier = 'steady',
  isPrior = false,
}: QuotaIntervalBarProps): ReactElement {
  const barClassName = ['quota-row-bar', isPrior ? 'is-prior' : '']
    .filter(Boolean)
    .join(' ')

  const displayIntervals = mergeQuotaIntervalsForDisplay(intervals)
  const segmentCount = displayIntervals.length
  const barGap = segmentCount > 50 ? 0 : '2px'
  const clampedProjectionPct =
    projectionPct === undefined
      ? undefined
      : Math.min(100, Math.max(0, projectionPct))
  const velocityMask = buildVelocityOverlayMask(displayIntervals)
  const velocityOverlayStyle: CSSProperties | undefined =
    velocityMask === undefined
      ? undefined
      : {
          WebkitMaskImage: velocityMask,
          maskImage: velocityMask,
        }

  const bar = (
    <>
      <div
        className={barClassName}
        style={{
          position: 'relative',
          display: 'flex',
          gap: barGap,
          width: '100%',
          height: '6px',
          background: 'var(--card-2)',
          border: '1px solid var(--border)',
          boxSizing: 'border-box',
          /* overflow:hidden clips the masked velocity overlay strictly to the
             bar boundary, preventing visual bleed into adjacent rows/cards. */
          overflow: 'hidden',
        }}
      >
        {displayIntervals.map((interval, i) => (
          <div
            key={i}
            className={[
              'quota-interval',
              'qbar-fill',
              interval.severityClass,
              interval.highVelocity ? 'high-velocity' : '',
              interval.velocityClass ?? '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              width: `${interval.widthPct}%`,
              flex: `0 0 ${interval.widthPct}%`,
              height: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          />
        ))}
        {velocityOverlayStyle !== undefined && (
          <div
            aria-hidden='true'
            className='quota-row-velocity-overlay'
            style={velocityOverlayStyle}
          >
            <span className='quota-row-velocity-sweep' />
          </div>
        )}
        {clampedProjectionPct !== undefined && (
          <div
            className={projectionTickClasses(
              projectionPct ?? clampedProjectionPct,
              projectionTier
            )}
            style={{
              position: 'absolute',
              left: `${clampedProjectionPct}%`,
              top: 0,
              bottom: 0,
              width: '2px',
              zIndex: 5,
            }}
          />
        )}
      </div>
      {velocityLabel !== undefined && (
        <div className={`quota-row-velocity ${velocityTier}`}>
          {velocityLabel}
        </div>
      )}
    </>
  )

  if (tooltipContent !== undefined) {
    return (
      <HoverTooltip content={tooltipContent} variant='quota-bar'>
        {bar}
      </HoverTooltip>
    )
  }

  return <>{bar}</>
}
