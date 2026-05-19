/**
 * AlertsRail — real-time alert feed for Phosphor Atlas.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - Added "⚠ Alerts" panel title with border-bottom.
 * - early-reset: lime green border (#a3e635), teal→amber gradient background.
 * - cache-stale: amber border, diagonal stripe repeating-linear-gradient.
 * - Alert gap reduced to 4px (was 0.5rem/8px).
 * - max-height: calc(100vh - 60px) with overflow-y: auto scroll.
 * - Panel background: var(--card), border: 1px solid var(--border).
 *
 * The container is marked aria-live="polite" so screen readers announce
 * new alerts automatically.
 *
 * Wave 16-V N1: wrap each alert's leading glyph in span.alert-glyph so the
 * CSS rule added in Wave 15-A (12px fixed-width, text-align:center) applies.
 */
import type { ReactElement } from 'react'

/** Discriminated union of supported alert categories. */
export type AlertItem = {
  type:
    | 'rate-limit'
    | 'budget'
    | 'early-reset'
    | 'cache-stale'
    | 'info'
    | 'warn'
  head: string
  sub?: string
}

interface AlertsRailProps {
  alerts: AlertItem[]
}

/** Returns inline styles for an alert item based on its type. */
function alertItemStyle(type: AlertItem['type']): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: '1px',
    borderLeft: '2px solid',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  switch (type) {
    case 'rate-limit':
    case 'budget':
      return {
        ...base,
        borderLeftColor: 'var(--accent-hot)',
        color: 'var(--accent-hot)',
        background: 'var(--card-2)',
      }
    case 'early-reset':
      return {
        ...base,
        borderLeftColor: '#a3e635',
        color: '#d9f99d',
        background:
          'linear-gradient(90deg, rgba(20,184,166,0.22) 0%, rgba(245,158,11,0.18) 100%)',
        whiteSpace: 'normal',
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }
    case 'cache-stale':
      return {
        ...base,
        borderLeftColor: 'var(--accent-warm)',
        color: 'var(--accent-warm)',
        background:
          'repeating-linear-gradient(135deg, rgba(245,158,11,0.12) 0 4px, rgba(245,158,11,0.04) 4px 8px), var(--card-2)',
        whiteSpace: 'normal',
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }
    case 'info':
      return {
        ...base,
        borderLeftColor: 'var(--accent-cool)',
        color: 'var(--accent-cool)',
        background: 'var(--card-2)',
      }
    case 'warn':
      return {
        ...base,
        borderLeftColor: 'var(--accent-warm)',
        color: 'var(--accent-warm)',
        background: 'var(--card-2)',
      }
  }
}

/**
 * Derives the CSS class names for an alert item.
 *
 * rate-limit gets both `alert-rate-limit` and `alert-critical` so that
 * tests querying either class succeed.
 */
function alertClassNames(type: AlertItem['type']): string {
  const base = `alert-item alert-${type}`
  if (type === 'rate-limit') {
    return `${base} alert-critical`
  }
  return base
}

/**
 * Returns the leading glyph character for each alert type.
 *
 * N1 (Wave 16-V): glyphs are wrapped in span.alert-glyph so the fixed-width
 * CSS rule from Wave 15-A applies correctly.
 */
function alertGlyph(type: AlertItem['type']): string {
  switch (type) {
    case 'rate-limit':
      return '🚫'
    case 'budget':
      return '💰'
    case 'early-reset':
      return '⟲'
    case 'cache-stale':
      return '⚠'
    case 'info':
      return 'ℹ'
    case 'warn':
      return '⚠'
  }
}

/**
 * AlertsRail renders a stack of alert items with live-region semantics and
 * the v9.7 reference panel styling.
 */
export function AlertsRail({ alerts }: AlertsRailProps): ReactElement {
  return (
    <div
      aria-live='polite'
      className='alerts-panel'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '10px',
        maxHeight: 'calc(100vh - 60px)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {/* Panel title */}
      <div
        className='alerts-title'
        style={{
          fontSize: '9px',
          color: 'var(--fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '4px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '4px',
        }}
      >
        ⚠ Alerts
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {alerts.length === 0 ? (
          <div
            style={{
              fontSize: '9px',
              color: 'var(--fg-muted)',
              padding: '4px 0',
              fontStyle: 'italic',
            }}
          >
            No active alerts
          </div>
        ) : (
          alerts.map((alert, index) => (
            <div
              key={index}
              className={alertClassNames(alert.type)}
              style={alertItemStyle(alert.type)}
            >
              <div
                className='alert-head'
                style={{
                  fontWeight: 600,
                  fontSize: '10px',
                  letterSpacing: '0.02em',
                }}
              >
                {/* N1: leading glyph wrapped in span.alert-glyph for 12px fixed-width column */}
                <span className='alert-glyph'>{alertGlyph(alert.type)}</span>
                {alert.head}
              </div>
              {alert.sub !== undefined && (
                <div
                  className='alert-sub'
                  style={{
                    fontSize: '9px',
                    color: 'var(--fg-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 400,
                    letterSpacing: '0.01em',
                  }}
                >
                  {alert.sub}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
