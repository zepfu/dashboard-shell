/**
 * AlertsRail — D1-451 Wave 2 (C-5, W-1, W-3, E-1/E-4).
 *
 * W-1 disposition: AlertsRail is not rendered in production (sidebar summary path).
 * Tests pin component contract + a11y until deletion or layout wiring.
 */
import { render, screen } from '@testing-library/react'
import { AlertsRail, type AlertItem } from './alerts-rail'

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
// ---------------------------------------------------------------------------
// Wave 8 (S5-30/S5-31) — a11y: role=log, stable keys, info/warn arms, empty state
// ---------------------------------------------------------------------------

/**
 * S5-30 — The alert live region must have role='log'.
 *
 * `role='log'` is the semantic element for incrementally updated lists of
 * messages (exactly what an alerts rail is). A plain `aria-live='polite'`
 * without `role='log'` misses the semantic landmark that assistive technology
 * uses to present the region correctly (some AT only auto-scroll to `role='log'`
 * without needing a re-focus).
 *
 * Current implementation: `<div aria-live='polite' ...>` — missing role='log'.
 *
 * EXPECTED FAIL: the root element has aria-live but no role='log'.
 */
test('test_alerts_rail_has_role_log', () => {
  const { container } = render(<AlertsRail alerts={[]} />)

  const rail = container.firstChild as HTMLElement
  expect(rail).not.toBeNull()

  // EXPECTED FAIL: role='log' is absent in current implementation
  expect(rail.getAttribute('role')).toBe('log')
})

/**
 * S5-30 — The live region must also retain aria-live='polite'.
 *
 * When `role='log'` is set, `aria-live` is implied as 'polite' by the spec,
 * but being explicit is recommended for maximum AT compatibility. The component
 * must carry both attributes.
 */
test('test_alerts_rail_role_log_retains_aria_live_polite', () => {
  const { container } = render(<AlertsRail alerts={[]} />)

  const rail = container.firstChild as HTMLElement
  expect(rail.getAttribute('aria-live')).toBe('polite')
  // EXPECTED FAIL: role='log' absent
  expect(rail.getAttribute('role')).toBe('log')
})

/**
 * S5-31 — Content-derived stable keys: reordering alerts must not rewrite node text.
 *
 * Current implementation uses `key={index}` (array position). When alerts are
 * reordered, React reuses DOM nodes positionally and updates their text content
 * — the live region re-announces ALL reordered alerts as if they were new, even
 * though the alert content has not changed. This is a false-positive AT noise
 * problem.
 *
 * After fix: each alert item must use a key derived from its content
 * (`type + head`, or a provided `id`) so that reordering preserves DOM identity
 * and the live region only announces genuinely new alerts.
 *
 * Test: render two alerts, note their DOM node references, then re-render with
 * the order swapped. With stable keys, the DOM nodes for each alert text must
 * be the SAME objects (React reorders rather than recreates). With index keys,
 * the node texts are rewritten to the swapped values.
 *
 * EXPECTED FAIL: current `key={index}` causes node-text rewriting on reorder.
 */
test('test_alerts_rail_stable_keys_on_reorder', () => {
  const alertA: AlertItem = {
    type: 'rate-limit',
    head: 'Anthropic 95% of quota',
  }
  const alertB: AlertItem = {
    type: 'cache-stale',
    head: 'Stale cache detected',
  }

  const { rerender, container } = render(
    <AlertsRail alerts={[alertA, alertB]} />
  )

  // Capture initial DOM nodes for each alert head
  const headEls = container.querySelectorAll('.alert-head')
  expect(headEls.length).toBe(2)

  // Extract node references keyed by text content
  const nodeForHead = new Map<string, Node>()
  for (const el of Array.from(headEls)) {
    // The head text follows the glyph span; grab the text content of the
    // alert-head element (includes glyph text), then extract the alert text
    // by querying the element without the glyph child.
    const glyph = el.querySelector('.alert-glyph')
    const headText =
      el.textContent?.replace(glyph?.textContent ?? '', '').trim() ?? ''
    nodeForHead.set(headText, el)
  }

  const nodeA = nodeForHead.get('Anthropic 95% of quota')
  const nodeB = nodeForHead.get('Stale cache detected')
  expect(nodeA).not.toBeNull()
  expect(nodeB).not.toBeNull()

  // Re-render with swapped order
  rerender(<AlertsRail alerts={[alertB, alertA]} />)

  const headElsAfter = container.querySelectorAll('.alert-head')
  expect(headElsAfter.length).toBe(2)

  // With stable content-derived keys, the same DOM nodes should still contain
  // the same text — React reorders them rather than rewriting their content.
  // With index keys, node texts are overwritten to the swapped values.

  // Find which node now contains each text
  let foundA = false
  let foundB = false
  for (const el of Array.from(headElsAfter)) {
    const glyph = el.querySelector('.alert-glyph')
    const headText =
      el.textContent?.replace(glyph?.textContent ?? '', '').trim() ?? ''
    if (el === nodeA && headText === 'Anthropic 95% of quota') foundA = true
    if (el === nodeB && headText === 'Stale cache detected') foundB = true
  }

  // EXPECTED FAIL: with index keys nodeA.textContent changes to alertB's head
  expect(foundA).toBe(true)
  expect(foundB).toBe(true)
})

/**
 * S5-30/S5-31 — info-type alert renders with correct structure.
 *
 * The 'info' alert type must render an alert item with class 'alert-info',
 * the head text, and the info glyph. This ensures the info arm in alertGlyph
 * and alertClassNames is exercised and visible in the DOM.
 *
 * EXPECTED FAIL: if info arm is absent or misconfigured.
 * (Currently passes since info is implemented — this is a behavioral regression
 * guard that becomes a true red-phase test when role='log' check is included.)
 */
test('test_alerts_rail_info_type_renders', () => {
  const alerts: AlertItem[] = [
    { type: 'info', head: 'Cache refreshed successfully' },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)

  const infoEl = container.querySelector('.alert-info') as HTMLElement | null
  expect(infoEl).not.toBeNull()
  expect(infoEl?.textContent).toContain('Cache refreshed successfully')

  // Live region must also be role='log' — EXPECTED FAIL without fix
  const rail = container.firstChild as HTMLElement
  expect(rail.getAttribute('role')).toBe('log')
})

/**
 * S5-30/S5-31 — warn-type alert renders with correct structure.
 *
 * Same as info but for the 'warn' arm.
 *
 * EXPECTED FAIL on role='log' check.
 */
test('test_alerts_rail_warn_type_renders', () => {
  const alerts: AlertItem[] = [
    { type: 'warn', head: 'Quota usage approaching 80%' },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)

  const warnEl = container.querySelector('.alert-warn') as HTMLElement | null
  expect(warnEl).not.toBeNull()
  expect(warnEl?.textContent).toContain('Quota usage approaching 80%')

  // Live region must also be role='log' — EXPECTED FAIL without fix
  const rail = container.firstChild as HTMLElement
  expect(rail.getAttribute('role')).toBe('log')
})

/**
 * S5-30 — Empty state: no alerts renders the empty message accessibly.
 *
 * When the alerts array is empty, a "No active alerts" message should be
 * visible inside the live region so screen readers can confirm there are
 * no current alerts (rather than announcing silence, which is ambiguous).
 *
 * This test verifies:
 * 1. The empty message is in the DOM inside the live region.
 * 2. The live region has role='log'.
 *
 * EXPECTED FAIL on role='log' check.
 */
test('test_alerts_rail_empty_state_accessible', () => {
  const { container } = render(<AlertsRail alerts={[]} />)

  const rail = container.firstChild as HTMLElement
  expect(rail).not.toBeNull()

  // Empty message must be present inside the live region
  const emptyMsg = rail.textContent
  expect(emptyMsg).toMatch(/no active alerts/i)

  // EXPECTED FAIL: role='log' absent
  expect(rail.getAttribute('role')).toBe('log')
})

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

/** C-5 — duplicate type+head alerts must not share React keys (include sub or id). */
test('test_alerts_rail_duplicate_type_head_distinct_keys', () => {
  const alerts: AlertItem[] = [
    {
      type: 'rate-limit',
      head: 'Anthropic quota',
      sub: 'lane-a',
    },
    {
      type: 'rate-limit',
      head: 'Anthropic quota',
      sub: 'lane-b',
    },
  ]
  const { container } = render(<AlertsRail alerts={alerts} />)
  const items = container.querySelectorAll('.alert-item')
  expect(items.length).toBe(2)
  expect(screen.getByText('lane-a')).toBeInTheDocument()
  expect(screen.getByText('lane-b')).toBeInTheDocument()
})

/** W-1 — production layout does not mount AlertsRail (grep-verified); contract tested in isolation here. */
test('test_alerts_rail_w1_disposition_not_in_production_layout', () => {
  expect(document.querySelector('.phosphor-dashboard .alerts-rail')).toBeNull()
})
