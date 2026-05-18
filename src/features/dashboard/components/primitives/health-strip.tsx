/**
 * HealthStrip — 288-cell health status visualisation.
 *
 * Supports two orientations:
 * - horizontal (default): 288-cell grid across a full-width band, 6px tall.
 *   Used in AggregateCard and as the fleet-pulse strip.
 * - vertical: absolutely positioned at the right edge of a provider card,
 *   12px wide × full card height. v9w1 change — ProviderCard uses this.
 *
 * Each cell represents a 5-minute bucket within a 24-hour window
 * (24 × 12 = 288). Sparse input is padded to 288 cells using
 * `var(--card-2)` as the neutral background.
 *
 * Accessibility: the strip is decorative and is hidden from the a11y tree
 * via `aria-hidden="true"`. A sibling text element should convey the same
 * information for screen reader users.
 */
import { memo, type ReactElement } from 'react'

interface CellDef {
  color: string
}

export interface HealthStripProps {
  cells: CellDef[]
  /**
   * Orientation of the strip.
   * - 'horizontal' (default): row strip, 6px tall.
   * - 'vertical': column strip, 12px wide, absolutely positioned right edge.
   */
  orientation?: 'horizontal' | 'vertical'
}

const TOTAL_CELLS = 288
const PADDING_COLOR = 'var(--card-2)'

interface HealthCellProps {
  color: string
  vertical: boolean
}

/**
 * HealthCell is a memoised single strip cell to avoid unnecessary re-renders
 * when only a subset of cells changes (plan Risk: 288-element rerender cost).
 */
const HealthCell = memo(function HealthCell({
  color,
  vertical,
}: HealthCellProps): ReactElement {
  return (
    <div
      className='health-strip-cell'
      style={{
        background: color,
        width: vertical ? '12px' : '100%',
        height: vertical ? undefined : '6px',
        flex: vertical ? '1 1 0' : undefined,
        minHeight: vertical ? 0 : undefined,
      }}
    />
  )
})

/**
 * HealthStrip renders a 288-cell health visualisation in horizontal or
 * vertical orientation.
 *
 * Vertical mode positions the strip absolutely at the right edge of a
 * relatively-positioned parent (the provider card). The card must reserve
 * padding-right: 22px to avoid content overlap.
 */
export function HealthStrip({
  cells,
  orientation = 'horizontal',
}: HealthStripProps): ReactElement {
  const isVertical = orientation === 'vertical'

  const clipped = cells.slice(0, TOTAL_CELLS)
  const padded: CellDef[] =
    clipped.length < TOTAL_CELLS
      ? [
          ...clipped,
          ...Array.from<CellDef>({ length: TOTAL_CELLS - clipped.length }).fill(
            {
              color: PADDING_COLOR,
            }
          ),
        ]
      : clipped

  if (isVertical) {
    return (
      <div
        aria-hidden='true'
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          bottom: '6px',
          width: '12px',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid rgba(245,158,11,0.25)',
          overflow: 'hidden',
        }}
      >
        {/* "24H" label at top */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            color: 'var(--accent-chrome)',
            letterSpacing: '0.04em',
            lineHeight: 1,
            marginBottom: '2px',
            textAlign: 'center',
          }}
        >
          24H
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            gap: 0,
          }}
        >
          {padded.map((cell, i) => (
            <HealthCell key={i} color={cell.color} vertical />
          ))}
        </div>
        {/* "NOW" label at bottom */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '8px',
            color: 'var(--fg-muted)',
            letterSpacing: '0.04em',
            lineHeight: 1,
            marginTop: '2px',
            textAlign: 'center',
          }}
        >
          NOW
        </div>
      </div>
    )
  }

  // Horizontal (default) — 288-cell grid row
  return (
    <div
      aria-hidden='true'
      className='health-strip'
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${TOTAL_CELLS}, 1fr)`,
        height: '6px',
        gap: 0,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {padded.map((cell, i) => (
        <HealthCell key={i} color={cell.color} vertical={false} />
      ))}
    </div>
  )
}
