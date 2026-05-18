/**
 * Sparkline — inline SVG trend line for Phosphor Atlas data cells.
 *
 * Normalises an arbitrary numeric series into the viewBox dimensions with
 * 2 px padding on all sides. Returns null for empty data arrays so call
 * sites need not guard against rendering an invisible SVG.
 */
import type { ReactElement } from 'react'

interface SparklineProps {
  data: number[]
  color: string
  width?: number
  height?: number
}

/**
 * Sparkline renders a single polyline SVG from a numeric data series.
 *
 * @returns null when `data` is empty; an `<svg>` with a `<polyline>` otherwise.
 */
export function Sparkline({
  data,
  color,
  width = 60,
  height = 20,
}: SparklineProps): ReactElement | null {
  if (data.length === 0) {
    return null
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data
    .map((value, i) => {
      const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width
      const y = height - 2 - ((value - min) / range) * (height - 4)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className='sparkline'
    >
      <polyline fill='none' stroke={color} strokeWidth={1.5} points={points} />
    </svg>
  )
}
