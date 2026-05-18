/**
 * DonutChart — SVG stroke-based donut chart for client token distribution.
 *
 * Renders N coloured arc segments using stroke-dasharray/stroke-dashoffset
 * on stacked <circle> elements. Each segment carries a data-client attribute
 * for testability. A centre label shows the slice count.
 *
 * Accessibility: the SVG carries role="img" and a descriptive aria-label.
 */
import type { ReactElement } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for one donut slice. */
export interface SliceConfig {
  client: string
  tokens: number
  color: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CX = 70
const CY = 70
const R = 50
const STROKE_WIDTH = 16
const CIRCUMFERENCE = 2 * Math.PI * R // ≈ 314.159

// ---------------------------------------------------------------------------
// DonutChart
// ---------------------------------------------------------------------------

export interface DonutChartProps {
  slices: SliceConfig[]
}

/**
 * DonutChart renders a stroke-based SVG donut chart where each slice is a
 * separate <circle> element with stroke-dasharray and stroke-dashoffset
 * positioned cumulatively around the ring.
 */
export function DonutChart({ slices }: DonutChartProps): ReactElement {
  const total = slices.reduce((sum, s) => sum + s.tokens, 0)

  // Pre-compute arc lengths and cumulative offsets so no mutation occurs during render
  const arcLengths = slices.map((s) =>
    total > 0 ? (s.tokens / total) * CIRCUMFERENCE : 0
  )
  const cumulativeOffsets = arcLengths.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : (acc[i - 1] ?? 0) + (arcLengths[i - 1] ?? 0))
    return acc
  }, [])

  const sliceElements = slices.map((slice, i) => {
    const arcLen = arcLengths[i] ?? 0
    const dashOffset = -(cumulativeOffsets[i] ?? 0)

    return (
      <circle
        key={slice.client}
        cx={CX}
        cy={CY}
        r={R}
        stroke={slice.color}
        strokeWidth={STROKE_WIDTH}
        fill='none'
        strokeDasharray={`${arcLen.toFixed(4)} ${(CIRCUMFERENCE - arcLen).toFixed(4)}`}
        strokeDashoffset={dashOffset.toFixed(4)}
        data-client={slice.client}
        transform={`rotate(-90 ${CX} ${CY})`}
      />
    )
  })

  return (
    <div>
      <svg
        role='img'
        aria-label='Client token distribution donut chart'
        viewBox='0 0 140 140'
        width='140'
        height='140'
        style={{ display: 'block' }}
      >
        {/* Background track */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          stroke='var(--card-2)'
          strokeWidth={STROKE_WIDTH}
          fill='none'
        />

        {/* Slice arcs */}
        {sliceElements}

        {/* Centre label: count of slices */}
        <text
          x={CX}
          y={CY + 5}
          textAnchor='middle'
          fontSize='20'
          fill='var(--fg)'
          fontFamily='monospace'
        >
          {slices.length}
        </text>
      </svg>

      {/* Legend */}
      <div
        className='client-legend'
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '6px 4px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--fg-muted)',
          justifyContent: 'center',
        }}
      >
        {slices.map((slice) => (
          <div
            key={slice.client}
            className='client-legend-item'
            data-client={slice.client}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              minWidth: '50px',
            }}
          >
            <span
              className='client-legend-swatch'
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                background: slice.color,
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            />
            <span className='client-legend-name'>{slice.client}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
