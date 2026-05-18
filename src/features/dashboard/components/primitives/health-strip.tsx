/**
 * HealthStrip — 288-cell grid visualising per-interval health status.
 *
 * Each cell represents a 5-minute bucket within a 24-hour window
 * (24 × 12 = 288). Sparse input is padded to 288 cells using
 * `var(--card-2)` as the neutral background. Input longer than 288 cells
 * is truncated to the first 288.
 *
 * Accessibility: the strip is decorative and is hidden from the a11y tree
 * via `aria-hidden="true"`. A sibling text element should convey the same
 * information for screen reader users.
 */
import { memo, type ReactElement } from 'react'

interface CellDef {
  color: string
}

interface HealthStripProps {
  cells: CellDef[]
}

const TOTAL_CELLS = 288
const PADDING_COLOR = 'var(--card-2)'

interface HealthCellProps {
  color: string
}

/**
 * HealthCell is a memoised single strip cell to avoid unnecessary re-renders
 * when only a subset of cells changes (plan Risk: 288-element rerender cost).
 */
const HealthCell = memo(function HealthCell({
  color,
}: HealthCellProps): ReactElement {
  return <div className='health-strip-cell' style={{ background: color }} />
})

/**
 * HealthStrip renders a 288-cell horizontal grid of coloured health buckets.
 */
export function HealthStrip({ cells }: HealthStripProps): ReactElement {
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

  return (
    <div
      aria-hidden='true'
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${TOTAL_CELLS}, 1fr)`,
        height: '8px',
        gap: '1px',
      }}
    >
      {padded.map((cell, i) => (
        <HealthCell key={i} color={cell.color} />
      ))}
    </div>
  )
}
