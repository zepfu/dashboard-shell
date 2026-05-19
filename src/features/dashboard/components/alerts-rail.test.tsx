/**
 * Wave 2 — AlertsRail red-phase tests.
 *
 * Component path: src/features/dashboard/components/alerts-rail.tsx
 * Expected export: AlertsRail (named)
 * Types: AlertItem = { type: 'rate-limit' | 'early-reset' | 'cache-stale' | 'info' | 'warn'; head: string; sub?: string }
 * Props: { alerts: AlertItem[] }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { AlertsRail } from './alerts-rail'

test('test_alerts_rail_renders_rate_limit_item', () => {
  const alerts = [
    {
      type: 'rate-limit' as const,
      head: 'Anthropic 95% of quota',
      sub: 'resets in 12m',
    },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)

  // Assert a critical/rate-limit styled element is present
  const criticalEl =
    container.querySelector('.alert-critical') ??
    container.querySelector('.alert-rate-limit')
  expect(criticalEl).not.toBeNull()

  // Assert head text is rendered
  expect(screen.getByText('Anthropic 95% of quota')).toBeInTheDocument()
})

test('test_alerts_rail_renders_early_reset_item', () => {
  const alerts = [
    {
      type: 'early-reset' as const,
      head: 'Early reset detected',
      sub: 'reset shifted -47m',
    },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)

  const earlyResetEl = container.querySelector('.alert-early-reset')
  expect(earlyResetEl).not.toBeNull()

  // Sub-line text should be visible
  expect(screen.getByText('reset shifted -47m')).toBeInTheDocument()
})

test('test_alerts_rail_renders_cache_stale_item', () => {
  const alerts = [{ type: 'cache-stale' as const, head: 'Stale cache' }]
  const { container } = render(<AlertsRail alerts={alerts} />)

  const cacheStaleEl = container.querySelector('.alert-cache-stale')
  expect(cacheStaleEl).not.toBeNull()
})
