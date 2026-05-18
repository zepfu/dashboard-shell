/**
 * QuotaIntervalBar — segmented quota visualisation with projection tick.
 *
 * Renders N interval segments in a flex bar, each coloured according to its
 * severity class. A projection tick (absolutely positioned) can be overlaid
 * at any horizontal percentage. Optionally wraps the bar in a HoverTooltip.
 *
 * High-velocity intervals get a shimmer animation that respects the
 * `prefers-reduced-motion: reduce` media query (declared in the co-located
 * CSS module).
 */
import type { ReactElement, ReactNode } from 'react'
import { HoverTooltip } from './hover-tooltip'
import './quota-interval-bar.module.css'

interface Interval {
  widthPct: number
  severityClass: string
  highVelocity: boolean
}

interface QuotaIntervalBarProps {
  intervals: Interval[]
  projectionPct?: number
  tooltipContent?: ReactNode
}

/**
 * QuotaIntervalBar renders a multi-segment quota bar with optional projection
 * tick and tooltip wrapping.
 */
export function QuotaIntervalBar({
  intervals,
  projectionPct,
  tooltipContent,
}: QuotaIntervalBarProps): ReactElement {
  const bar = (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '12px',
      }}
    >
      {intervals.map((interval, i) => (
        <div
          key={i}
          className={[
            'quota-interval',
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
          className='qbar-projection'
          style={{
            position: 'absolute',
            left: `${projectionPct}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            background: 'var(--fg)',
          }}
        />
      )}
    </div>
  )

  if (tooltipContent !== undefined) {
    return (
      <HoverTooltip content={tooltipContent} variant='quota'>
        {bar}
      </HoverTooltip>
    )
  }

  return bar
}
