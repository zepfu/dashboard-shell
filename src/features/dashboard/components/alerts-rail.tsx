/**
 * AlertsRail — real-time alert feed for Phosphor Atlas.
 *
 * Renders a list of alert items with semantic colour coding derived from
 * Phosphor accent tokens. The container is marked aria-live="polite" so
 * screen readers announce new alerts automatically.
 */
import type { ReactElement } from 'react'

/** Discriminated union of supported alert categories. */
export type AlertItem = {
  type: 'rate-limit' | 'budget' | 'early-reset' | 'cache-stale' | 'info'
  head: string
  sub?: string
}

interface AlertsRailProps {
  alerts: AlertItem[]
}

/** Maps alert type to the primary accent colour token. */
const ALERT_COLOR: Record<AlertItem['type'], string> = {
  'rate-limit': 'var(--accent-hot)',
  budget: 'var(--accent-hot)',
  'early-reset': 'var(--accent-warm)',
  'cache-stale': 'var(--accent-cool)',
  info: 'var(--fg-muted)',
}

/**
 * Derives the CSS class names for an alert item.
 *
 * rate-limit gets both `alert-rate-limit` and `alert-critical` so that
 * tests querying either class succeed.
 */
function alertClassNames(type: AlertItem['type']): string {
  const base = `alert-${type}`
  if (type === 'rate-limit') {
    return `${base} alert-critical`
  }
  return base
}

/**
 * AlertsRail renders a stack of alert items with live-region semantics.
 */
export function AlertsRail({ alerts }: AlertsRailProps): ReactElement {
  return (
    <div
      aria-live='polite'
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      {alerts.map((alert, index) => (
        <div
          key={index}
          className={alertClassNames(alert.type)}
          style={{
            borderLeft: `3px solid ${ALERT_COLOR[alert.type]}`,
            padding: '0.5rem 0.75rem',
            background: 'var(--card)',
            color: 'var(--fg)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{alert.head}</div>
          {alert.sub !== undefined && (
            <div style={{ color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
              {alert.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
