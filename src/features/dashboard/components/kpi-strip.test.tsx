/**
 * Wave 2 — KpiStrip red-phase tests.
 *
 * Component path: src/features/dashboard/components/kpi-strip.tsx
 * Expected export: KpiStrip (named)
 * Props: { summary: { token_in: number; token_out: number; cost_usd: number; requests: number; errors: number; p95_ms: number } | undefined; loading?: boolean }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { KpiStrip } from './kpi-strip'

const mockSummary = {
  token_in: 1000,
  token_out: 2000,
  cost_usd: 0.5,
  requests: 100,
  errors: 5,
  p95_ms: 800,
}

// Wave 11 PR7-lite: labels updated per audit C27.
// Wave 29 Fix #6: 'Cost (24h)' renamed to 'Cost'.
const KPI_LABELS = [
  'Tokens In',
  'Tokens Out',
  'Cost',
  'Requests',
  'Errors',
  'P95 Latency',
]

test('test_kpi_strip_renders_six_tiles', () => {
  const { container } = render(<KpiStrip summary={mockSummary} />)

  // Assert 6 tile elements present
  const tiles = container.querySelectorAll('.kpi-tile')
  expect(tiles.length).toBe(6)

  // Each label should be present (use string literal match for consistency).
  for (const label of KPI_LABELS) {
    const elements = screen.getAllByText((_content, element) => {
      return element?.textContent?.toLowerCase() === label.toLowerCase()
    })
    expect(elements.length).toBeGreaterThan(0)
  }
})

test('test_kpi_strip_formats_large_numbers_compact_M', () => {
  const { container } = render(
    <KpiStrip summary={{ ...mockSummary, token_in: 1_200_000 }} />
  )

  // The Tokens In tile should show compact format "1.2M"
  const toksInTile = container.querySelector('.kpi-tile')
  expect(toksInTile).not.toBeNull()

  const compactText = screen.getByText(/1\.2\s?M/i)
  expect(compactText).toBeInTheDocument()
})

test('test_kpi_strip_formats_large_numbers_compact_B', () => {
  // Values ≥ 1e9 should use B suffix (operator F#9)
  render(<KpiStrip summary={{ ...mockSummary, token_in: 19_471_800_848 }} />)
  const compactText = screen.getByText(/19\.\d\s?B/i)
  expect(compactText).toBeInTheDocument()
})

test('test_kpi_strip_formats_large_numbers_compact_K', () => {
  // Values ≥ 1e3 but < 1e6 should use K suffix (operator F#9)
  render(<KpiStrip summary={{ ...mockSummary, token_in: 587_234 }} />)
  const compactText = screen.getByText(/587\.\d\s?K/i)
  expect(compactText).toBeInTheDocument()
})

test('test_kpi_strip_formats_cost_with_comma_separators', () => {
  // Cost ≥ $1000 should render with comma thousand-separators (operator F#10)
  render(<KpiStrip summary={{ ...mockSummary, cost_usd: 7196.6 }} />)
  // Should show "$7,196.60" not "$7196.60"
  const costText = screen.getByText(/\$7,196\.60/)
  expect(costText).toBeInTheDocument()
})

test('test_kpi_strip_loading_shows_skeletons', () => {
  const { container } = render(<KpiStrip summary={undefined} loading={true} />)

  // At least one skeleton/loading element must be present
  const skeletons =
    container.querySelectorAll('.skeleton').length +
    container.querySelectorAll('.animate-pulse').length +
    container.querySelectorAll('[data-loading]').length

  expect(skeletons).toBeGreaterThan(0)
})

// Wave 35 (⚠-5 R-B): KPI delta rendering tests

test('test_kpi_strip_renders_signed_percent_when_prior_data_exists', () => {
  // Fractional deltas: 0.124 = +12.4%, -0.05 = -5.0%
  const deltas = {
    cost_usd: 0.124,
    requests: -0.05,
    token_in: 0.3,
    token_out: -0.1,
  }
  render(<KpiStrip summary={mockSummary} deltas={deltas} />)

  // ↑ direction for positive delta (cost_usd = +12.4%)
  expect(screen.getByText('↑ 12.4%')).toBeInTheDocument()

  // ↓ direction for negative delta (requests = -5.0%)
  expect(screen.getByText('↓ 5.0%')).toBeInTheDocument()
})

test('test_kpi_strip_renders_em_dash_when_no_deltas_provided', () => {
  render(<KpiStrip summary={mockSummary} deltas={{}} />)

  // All 6 delta cells should show em-dash when deltas map is empty
  const deltaCells = screen.getAllByText('—')
  expect(deltaCells.length).toBe(6)
})

test('test_kpi_strip_renders_em_dash_when_deltas_prop_absent', () => {
  render(<KpiStrip summary={mockSummary} />)

  // All 6 delta cells should show em-dash when deltas prop is not provided
  const deltaCells = screen.getAllByText('—')
  expect(deltaCells.length).toBe(6)
})

test('test_kpi_strip_applies_classname_to_wrapper', () => {
  const { container } = render(
    <KpiStrip summary={mockSummary} className='kpi-strip' />
  )

  // The outermost element must carry the class (Wave 35 S1)
  const strip = container.querySelector('.kpi-strip')
  expect(strip).not.toBeNull()
})

test('test_kpi_strip_applies_classname_to_loading_wrapper', () => {
  const { container } = render(
    <KpiStrip summary={undefined} loading={true} className='kpi-strip' />
  )

  // className must also apply in loading state
  const strip = container.querySelector('.kpi-strip')
  expect(strip).not.toBeNull()
})
