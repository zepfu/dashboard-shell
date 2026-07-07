/**
 * Accessibility contracts — D1-451 Wave 2 W-3 (AlertsRail live region) + HealthStrip (S5-40).
 *
 * AlertsRail a11y is covered here while W-1 disposition is delete-or-wire (not in production layout).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertsRail } from './alerts-rail'
import AnchorBar from './anchor-bar'
import { MasterLedgerTable } from './master-ledger-table'
import { HealthStrip } from './primitives/health-strip'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockLedgerRows = [
  {
    model: 'claude-3',
    provider: 'anthropic',
    tokens_in: 1000,
    tokens_out: 2000,
    requests: 100,
    p50_ms: 200,
    p95_ms: 500,
    error_pct: 0.5,
    cost_usd: 0.1,
    quota_pct: 25,
  },
]

const healthCells = Array.from({ length: 288 }, () => ({
  color: 'var(--card-2)',
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_anchor_bar_has_aria_label', () => {
  const { container } = render(
    <AnchorBar activeSection='status' onSectionChange={vi.fn()} />
  )

  const nav = container.firstChild as HTMLElement
  expect(nav).not.toBeNull()
  expect(nav.getAttribute('aria-label')).toBe(
    'Sections (keyboard shortcuts: bracketed letter)'
  )
})

test('test_alerts_rail_has_aria_live', () => {
  const { container } = render(<AlertsRail alerts={[]} />)

  const rail = container.firstChild as HTMLElement
  expect(rail).not.toBeNull()
  expect(rail.getAttribute('aria-live')).toBe('polite')
  expect(rail.getAttribute('role')).toBe('log')
})

test('test_master_ledger_has_aria_label', () => {
  const { container } = render(<MasterLedgerTable rows={mockLedgerRows} />)

  const table = container.querySelector('table')
  expect(table).not.toBeNull()
  expect(table!.getAttribute('aria-label')).toBe('Model usage ledger')
})

/**
 * Wave 8 (S5-40) — INVERTED from enshrined-defect pin.
 *
 * The previous test `test_health_strip_has_aria_hidden` asserted:
 *   `expect(strip.getAttribute('aria-hidden')).toBe('true')`
 * This was a THEATER test that pinned defect #93: the entire HealthStrip was
 * wrapped in a blanket `aria-hidden='true'`, making all its visual content
 * (including tooltips) invisible to assistive technology.
 *
 * Wave 8 fixes defect #93: the HealthStrip MUST NOT apply a blanket aria-hidden
 * on its outermost element. Individual decorative sub-elements (the SVG cells,
 * axis labels) may remain aria-hidden=true as appropriate, but the container
 * itself must be reachable by AT so that HoverTooltip content (accessible
 * issue counts, event details) can be announced when focused.
 *
 */
test('test_health_strip_not_blanket_aria_hidden', () => {
  const { container } = render(<HealthStrip cells={healthCells} />)

  const strip = container.firstChild as HTMLElement
  expect(strip).not.toBeNull()

  expect(strip.getAttribute('aria-hidden')).not.toBe('true')
})

/**
 * Wave 8 (S5-40) — HealthStrip tooltips are reachable by AT.
 *
 * When the HealthStrip outer wrapper is NOT aria-hidden, the HoverTooltip
 * panels inside it become accessible. This test verifies that with event-bearing
 * cells, the tooltip content is renderable and not hidden from the accessibility
 * tree by the strip container.
 *
 * Specifically: the HealthStrip wrapper must not carry aria-hidden='true' even
 * when rendered with real cell data that includes tooltip content.
 *
 */
test('test_health_strip_tooltip_container_reachable', () => {
  const cellsWithEvents = Array.from({ length: 288 }, (_, i) => ({
    color: i === 100 ? 'var(--accent-hot)' : 'var(--card-2)',
    category: (i === 100 ? 'red' : 'normal') as 'red' | 'normal',
    eventCount: i === 100 ? 5 : 0,
    events:
      i === 100
        ? [
            {
              time: '2026-06-14T10:00:00Z',
              model: 'claude-3-5-sonnet',
              errorType: 'rate_limit',
              count: 5,
            },
          ]
        : [],
  }))

  const { container } = render(<HealthStrip cells={cellsWithEvents} />)

  const strip = container.firstChild as HTMLElement
  expect(strip).not.toBeNull()

  expect(strip.getAttribute('aria-hidden')).not.toBe('true')
})

test('test_sortable_column_header_aria_sort_after_click', () => {
  render(<MasterLedgerTable rows={mockLedgerRows} />)

  const toksInHeader = screen.getByRole('columnheader', { name: /toks in/i })
  fireEvent.click(toksInHeader)

  const ariaSort = toksInHeader.getAttribute('aria-sort')
  expect(ariaSort === 'ascending' || ariaSort === 'descending').toBe(true)
})
