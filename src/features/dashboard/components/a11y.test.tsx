/**
 * Wave 7 — Accessibility (a11y) red-phase tests.
 *
 * Tests ARIA attributes across Wave 2-6 components.
 * These tests fail in red phase because source files don't exist yet.
 * When Waves 2-6 implementations land, only Wave 7 tests should remain red
 * until the ARIA attributes are implemented.
 *
 * All tests expected to FAIL (red) — source components do not exist yet.
 */
// @ts-expect-error -- module does not exist yet (red phase)
import { render, screen, fireEvent } from '@testing-library/react'
// @ts-expect-error -- module does not exist yet (red phase)
import { AlertsRail } from './alerts-rail'
import AnchorBar from './anchor-bar'
// @ts-expect-error -- module does not exist yet (red phase)
import { DonutChart } from './donut-chart'
// @ts-expect-error -- module does not exist yet (red phase)
import { MasterLedgerTable } from './master-ledger-table'
// @ts-expect-error -- module does not exist yet (red phase)
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
    cost_per_1k: 0.05,
    quota_pct: 25,
  },
]

const donutSlices = [
  { client: 'claude-code', tokens: 500, color: '#cc7855' },
  { client: 'gemini-cli', tokens: 500, color: '#4285f4' },
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
})

test('test_master_ledger_has_aria_label', () => {
  const { container } = render(<MasterLedgerTable rows={mockLedgerRows} />)

  const table = container.querySelector('table')
  expect(table).not.toBeNull()
  expect(table!.getAttribute('aria-label')).toBe('Model usage ledger')
})

test('test_donut_chart_has_role_img_and_aria_label', () => {
  const { container } = render(<DonutChart slices={donutSlices} />)

  const svg = container.querySelector('svg')
  expect(svg).not.toBeNull()
  expect(svg!.getAttribute('role')).toBe('img')
  expect(svg!.getAttribute('aria-label')).toBe(
    'Client token distribution donut chart'
  )
})

test('test_health_strip_has_aria_hidden', () => {
  const { container } = render(<HealthStrip cells={healthCells} />)

  const strip = container.firstChild as HTMLElement
  expect(strip).not.toBeNull()
  expect(strip.getAttribute('aria-hidden')).toBe('true')
})

test('test_sortable_column_header_aria_sort_after_click', () => {
  render(<MasterLedgerTable rows={mockLedgerRows} />)

  const toksInHeader = screen.getByRole('columnheader', { name: /toks in/i })
  fireEvent.click(toksInHeader)

  const ariaSort = toksInHeader.getAttribute('aria-sort')
  expect(ariaSort === 'ascending' || ariaSort === 'descending').toBe(true)
})
