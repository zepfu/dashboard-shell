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

// ---------------------------------------------------------------------------
// S5-32: rate-limit alert sub-text must not be clipped by overflow:hidden
// ---------------------------------------------------------------------------

/**
 * S5-32 — a rate-limit alert with a long `sub` string must not be visually
 * clipped. The `alertItemStyle` for 'rate-limit' sets:
 *   overflow: 'hidden'
 *   textOverflow: 'ellipsis'
 *   whiteSpace: 'nowrap'
 * …at the item level, but the sub-text element (.alert-sub) must be able
 * to wrap or scroll, not be silently truncated without any visible indicator.
 *
 * Specifically: when `sub` is present on a rate-limit alert, the `.alert-sub`
 * element must be in the DOM and have non-zero content. The outer overflow:hidden
 * must NOT prevent the sub element from rendering.
 *
 * EXPECTED FAIL: current implementation renders rate-limit with
 * `whiteSpace: 'nowrap'` + `overflow: 'hidden'` on the container, which clips
 * the .alert-sub text in many viewport sizes. The component does NOT wrap
 * the sub text or set `display: flex; flexDirection: column` for rate-limit
 * (unlike early-reset and cache-stale). Long sub text gets clipped invisibly.
 *
 * The test verifies .alert-sub is rendered AND that the rate-limit item
 * does not have `whiteSpace: nowrap` when sub is present (or uses flex column).
 */
test('test_alerts_rail_rate_limit_sub_not_clipped', () => {
  const alerts = [
    {
      type: 'rate-limit' as const,
      head: 'Anthropic 95% of quota',
      sub: 'resets in 12m · last triggered 2025-06-12T14:32:00Z · model: claude-3-5-sonnet-20241022',
    },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)

  // The rate-limit alert item must exist
  const rateLimitEl = container.querySelector(
    '.alert-rate-limit'
  ) as HTMLElement | null
  expect(rateLimitEl).not.toBeNull()

  // The sub-text element must be in the DOM with the expected content
  const subEl = rateLimitEl?.querySelector('.alert-sub') as HTMLElement | null
  expect(subEl).not.toBeNull()
  expect(subEl?.textContent).toContain('resets in 12m')

  // The rate-limit item must NOT clip sub text silently:
  // Either it uses display:flex + flexDirection:column (like early-reset),
  // OR it does not set whiteSpace:nowrap at the container level.
  const itemWhiteSpace = rateLimitEl?.style.whiteSpace ?? ''
  const itemDisplay = rateLimitEl?.style.display ?? ''
  const itemFlexDir = rateLimitEl?.style.flexDirection ?? ''

  // Valid configurations that don't clip sub:
  //  - display:flex + flexDirection:column (wraps content)
  //  - whiteSpace NOT 'nowrap' at container level
  const usesFlexColumn = itemDisplay === 'flex' && itemFlexDir === 'column'
  const doesNotForceNowrap = itemWhiteSpace !== 'nowrap'

  expect(usesFlexColumn || doesNotForceNowrap).toBe(true)
})
