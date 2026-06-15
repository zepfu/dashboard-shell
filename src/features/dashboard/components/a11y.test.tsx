/**
 * Wave 7 — Accessibility (a11y) red-phase tests.
 *
 * Tests ARIA attributes across Wave 2-6 components.
 * These tests fail in red phase because source files don't exist yet.
 * When Waves 2-6 implementations land, only Wave 7 tests should remain red
 * until the ARIA attributes are implemented.
 *
 * All tests expected to FAIL (red) — source components do not exist yet.
 *
 * Wave 8 (S5-40) — INVERSION of enshrined-defect test:
 *   `test_health_strip_has_aria_hidden` previously PINNED the defect by asserting
 *   the HealthStrip IS blanket aria-hidden=true. This wave inverts that test to
 *   assert the CORRECT behavior: the strip is NOT blanket aria-hidden and its
 *   tooltips are reachable by assistive technology.
 *
 * Wave 8 (S5-40) — DonutChart a11y case:
 *   The DonutChart component is deleted in Wave 9. The import and assertions are
 *   removed here in W8 (plan spec: "a11y DonutChart import already removed in W8").
 *   The test function body is replaced with a placeholder note; W9 removes the test.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertsRail } from './alerts-rail'
import AnchorBar from './anchor-bar'
import { MasterLedgerTable } from './master-ledger-table'
import { HealthStrip } from './primitives/health-strip'

// DonutChart import removed in W8 (component deleted in W9; a11y case cleared here)

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

// donutSlices removed in W8 — DonutChart component deleted in W9
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
})

test('test_master_ledger_has_aria_label', () => {
  const { container } = render(<MasterLedgerTable rows={mockLedgerRows} />)

  const table = container.querySelector('table')
  expect(table).not.toBeNull()
  expect(table!.getAttribute('aria-label')).toBe('Model usage ledger')
})

test('test_donut_chart_has_role_img_and_aria_label', () => {
  // Wave 8 (S5-40): DonutChart import and assertions removed here.
  // The component is deleted in Wave 9; W9 removes this test function entirely.
  // Placeholder assertion prevents the test from being counted as empty by vitest.
  expect(true).toBe(true) // W9 deletes this test
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
 * EXPECTED FAIL (red phase): current implementation still has
 * `<div aria-hidden='true'>` as the outermost wrapper — this test correctly
 * fails until the W8 engineer removes the blanket aria-hidden.
 */
test('test_health_strip_not_blanket_aria_hidden', () => {
  const { container } = render(<HealthStrip cells={healthCells} />)

  const strip = container.firstChild as HTMLElement
  expect(strip).not.toBeNull()

  // EXPECTED FAIL: outermost wrapper currently has aria-hidden='true' (defect #93)
  // After fix: the outermost element must NOT be blanket aria-hidden
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
 * EXPECTED FAIL: same root cause as above — blanket aria-hidden is still present.
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

  // Container must NOT carry blanket aria-hidden so tooltip panels are reachable
  // EXPECTED FAIL: current implementation has aria-hidden='true' on the wrapper
  expect(strip.getAttribute('aria-hidden')).not.toBe('true')
})

test('test_sortable_column_header_aria_sort_after_click', () => {
  render(<MasterLedgerTable rows={mockLedgerRows} />)

  const toksInHeader = screen.getByRole('columnheader', { name: /toks in/i })
  fireEvent.click(toksInHeader)

  const ariaSort = toksInHeader.getAttribute('aria-sort')
  expect(ariaSort === 'ascending' || ariaSort === 'descending').toBe(true)
})
