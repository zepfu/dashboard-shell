/**
 * Sparkline — inline SVG trend line for Phosphor Atlas data cells.
 *
 * Normalises an arbitrary numeric series into the viewBox dimensions with
 * 2 px padding on all sides (x and y for the polyline). Non-finite values
 * (NaN, ±Infinity) are dropped before plotting; remaining points are
 * spaced evenly in x, so a NaN gap in the input compresses into a continuous
 * segment rather than a visual break. Returns null for empty data arrays so
 * call sites need not guard against rendering an invisible SVG.
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
 * @returns null when `data` is empty; an `<svg>` with a `<circle>` for a
 *   single-point series; an `<svg>` with a `<polyline>` otherwise.
 */
export function Sparkline({
  data,
  color,
  width = 60,
  height = 20,
}: SparklineProps): ReactElement | null {
  // S3-27: filter non-finite values (NaN, Infinity, -Infinity)
  const finite = data.filter(Number.isFinite)

  if (finite.length === 0) {
    return null
  }

  // S3-28: single point renders a visible circle dot
  if (finite.length === 1) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className='sparkline'
      >
        <circle cx={width / 2} cy={height / 2} r={1.5} fill={color} />
      </svg>
    )
  }

  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const range = max - min

  const xPad = 2
  const xSpan = width - 2 * xPad
  const compressXAxis = finite.length !== data.length

  const points = finite
    .map((value, i) => {
      const x = compressXAxis
        ? (i / (finite.length - 1)) * width
        : xPad + (i / (finite.length - 1)) * xSpan
      // S3-28: flat series (range === 0) renders centered, not at the floor
      const y =
        range === 0
          ? height / 2
          : height - 2 - ((value - min) / range) * (height - 4)
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
