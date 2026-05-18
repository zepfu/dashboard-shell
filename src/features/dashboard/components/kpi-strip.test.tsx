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
const KPI_LABELS = [
  'Tokens In',
  'Tokens Out',
  'Cost (24h)',
  'Requests',
  'Errors (24h)',
  'P95 Latency',
]

test('test_kpi_strip_renders_six_tiles', () => {
  const { container } = render(<KpiStrip summary={mockSummary} />)

  // Assert 6 tile elements present
  const tiles = container.querySelectorAll('.kpi-tile')
  expect(tiles.length).toBe(6)

  // Each label should be present (use string literal match to avoid regex
  // special-char issues with parentheses in "Cost (24h)", "Errors (24h)").
  for (const label of KPI_LABELS) {
    const elements = screen.getAllByText((_content, element) => {
      return element?.textContent?.toLowerCase() === label.toLowerCase()
    })
    expect(elements.length).toBeGreaterThan(0)
  }
})

test('test_kpi_strip_formats_large_numbers_compact', () => {
  const { container } = render(
    <KpiStrip summary={{ ...mockSummary, token_in: 1_200_000 }} />
  )

  // The Toks In tile should show compact format "1.2M"
  // Allow either "1.2M" or "1.2 M"
  const toksInTile = container.querySelector('.kpi-tile')
  expect(toksInTile).not.toBeNull()

  // Find the element that contains the compact number
  const compactText = screen.getByText(/1\.2\s?M/i)
  expect(compactText).toBeInTheDocument()
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
