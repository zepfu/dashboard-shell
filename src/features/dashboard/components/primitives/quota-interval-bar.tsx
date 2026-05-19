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
 */
import type { ReactElement, ReactNode } from 'react'
import { HoverTooltip } from './hover-tooltip'
import './quota-interval-bar.module.css'

interface Interval {
  widthPct: number
  /** v9.7 threshold class: iv-0-5 | iv-5-10 | iv-10-25 | iv-25-50 | iv-50-p */
  severityClass: string
  highVelocity: boolean
}

/** Velocity tier for the optional sub-label row. */
export type VelocityTier = 'amber' | 'red' | 'steady'

interface QuotaIntervalBarProps {
  intervals: Interval[]
  projectionPct?: number
  tooltipContent?: ReactNode
  /**
   * Optional velocity annotation rendered as a `.quota-row-velocity` row
   * immediately below the bar. Includes text content and tier class
   * (`amber` | `red` | `steady`) per v9.7 mockup lines 1690–1742.
   */
  velocityLabel?: string
  velocityTier?: VelocityTier
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
  tooltipContent,
  velocityLabel,
  velocityTier = 'steady',
}: QuotaIntervalBarProps): ReactElement {
  const bar = (
    <>
      <div
        className='quota-row-bar'
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: '6px',
          background: 'var(--card-2)',
          border: '1px solid var(--border)',
          boxSizing: 'border-box',
          overflow: 'visible',
        }}
      >
        {intervals.map((interval, i) => (
          <div
            key={i}
            className={[
              'quota-interval',
              'qbar-fill',
              interval.severityClass,
              interval.highVelocity ? 'high-velocity' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ width: `${interval.widthPct}%`, height: '100%' }}
          />
        ))}
        {projectionPct !== undefined && (
          <div
            className='qbar-projection sustainable'
            style={{
              position: 'absolute',
              left: `${projectionPct}%`,
              top: 0,
              bottom: 0,
              width: '2px',
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
