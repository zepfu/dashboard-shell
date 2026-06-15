import type { CSSProperties, ReactElement } from 'react'

export interface StackedBarSeries {
  key: string
  label: string
  color: string
  cssClass: string
  tokens: number
}

export interface StackedBarProps {
  series: readonly StackedBarSeries[]
  total: number
  heightPct: number
  opacity?: number
  flex?: string
  resolveColor?: (key: string, color: string) => string
  className?: string
  extraBarStyle?: CSSProperties
}

export function StackedBar({
  series,
  total,
  heightPct,
  opacity,
  flex = '0 0 auto',
  resolveColor,
  className,
  extraBarStyle,
}: StackedBarProps): ReactElement {
  const barStyle: CSSProperties = {
    flex,
    width: '100%',
    height: `${heightPct.toFixed(1)}%`,
    display: 'flex',
    flexDirection: 'column-reverse',
    overflow: 'hidden',
    minWidth: 0,
    ...(opacity !== undefined ? { opacity } : {}),
    ...extraBarStyle,
  }

  return (
    <div
      className={['trend-bar', className].filter(Boolean).join(' ')}
      style={barStyle}
    >
      {series.map((s) => {
        if (s.tokens <= 0) return null
        const pct = total > 0 ? (s.tokens / total) * 100 : 0
        const background =
          resolveColor !== undefined ? resolveColor(s.key, s.color) : s.color
        const sliceStyle: CSSProperties = {
          flexBasis: `${pct.toFixed(4)}%`,
          flexShrink: 0,
          minHeight: '1px',
          width: '100%',
          background,
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
}
