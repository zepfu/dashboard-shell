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

  // Wave 10 (S5 test gap): assert exactly 6 skeleton placeholders — one per KPI tile.
  // Previously only asserted `> 0`; now locks in the 6-tile contract so a future
  // refactor that accidentally drops or adds tiles is immediately caught.
  const skeletonElements = container.querySelectorAll(
    '.skeleton.animate-pulse[data-loading="true"]'
  )
  expect(skeletonElements.length).toBe(6)

  // Each tile must show its label even while loading, so the skeleton is
  // identifiable by tile name. This guards the UX contract: labels remain
  // visible as placeholders during data fetch.
  for (const label of KPI_LABELS) {
    const elements = screen.getAllByText((_content, element) => {
      return element?.textContent?.toLowerCase() === label.toLowerCase()
    })
    expect(elements.length).toBeGreaterThan(0)
  }
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

// ---------------------------------------------------------------------------
// S5-17: kpi microbar --fill must be non-zero for each tile with realistic data
// ---------------------------------------------------------------------------

/**
 * S5-17 — each KPI tile's microbar must have a non-zero --fill CSS custom
 * property when the summary has realistic (non-zero) token counts.
 *
 * The current implementation computes fillPct = Math.round((rawValue / maxRaw) * 100)
 * and applies it as `--fill: ${fillPct}%`. The tile with the maximum rawValue
 * gets --fill: 100%; other tiles get a proportional value. All tiles with
 * non-zero rawValue must have --fill > 0%.
 *
 * This test also validates that Cost/Requests/P95 Latency tiles each receive
 * a non-zero --fill when fed realistic values.
 *
 * EXPECTED FAIL: if the implementation doesn't set --fill properly on
 * individual tiles, or if some tiles always get 0%, this will catch it.
 * The test specifically fails today if the implementation normalises only
 * token counts and leaves cost/request/latency tiles at 0.
 */
test('test_kpi_microbar_per_tile_normalized', () => {
  const realisticSummary = {
    token_in: 500_000,
    token_out: 250_000,
    cost_usd: 12.5,
    requests: 8_500,
    errors: 0,
    p95_ms: 1_200,
  }

  const { container } = render(<KpiStrip summary={realisticSummary} />)

  const microbars = container.querySelectorAll('.kpi-microbar')
  // Six tiles = six microbars
  expect(microbars.length).toBe(6)

  // For tiles where rawValue > 0, --fill must be > "0%"
  // Cost, Requests, P95 Latency are all non-zero in the fixture
  const nonZeroTileLabels = ['Cost', 'Requests', 'P95 Latency']
  const tiles = Array.from(container.querySelectorAll('.kpi-tile'))

  for (const tile of tiles) {
    const labelEl = tile.querySelector('.kpi-label')
    const label = labelEl?.textContent ?? ''
    if (!nonZeroTileLabels.some((l) => label.includes(l))) continue

    const microbar = tile.querySelector('.kpi-microbar') as HTMLElement | null
    expect(microbar).not.toBeNull()

    // --fill must be a non-zero percentage
    const fill = microbar?.style.getPropertyValue('--fill') ?? ''
    // Parse the numeric value; must be > 0
    const fillNum = parseFloat(fill)
    expect(fillNum).toBeGreaterThan(0)
  }
})

// ---------------------------------------------------------------------------
// S5-20: renderDelta deadband — tiny deltas show "→ 0.0%" muted, not ↑/↓
// ---------------------------------------------------------------------------

/**
 * S5-20 — a delta of -0.0004 (absolute value < 0.05%) is within the deadband
 * and should render as "→ 0.0%" with muted styling, NOT as "↓ 0.0%".
 * An exact-zero delta must also be muted.
 *
 * The current `renderDelta` implementation:
 *   - delta >= 0 → "↑ X.X%"
 *   - delta < 0  → "↓ X.X%"
 * …with no deadband. So -0.0004 renders as "↓ 0.0%" not "→ 0.0%".
 *
 * EXPECTED FAIL: current renderDelta has no deadband logic, so -0.0004
 * renders "↓ 0.0%" which does NOT match "→ 0.0%".
 */
test('test_renderDelta_deadband', () => {
  const summary = {
    token_in: 100_000,
    token_out: 50_000,
    cost_usd: 5.0,
    requests: 1_000,
    errors: 0,
    p95_ms: 500,
  }

  // -0.0004 fractional delta (absolute magnitude < 0.05%) should show "→ 0.0%"
  const tinyDelta = { cost_usd: -0.0004 }

  const { container: costContainer, unmount: unmountCost } = render(
    <KpiStrip summary={summary} deltas={tinyDelta} />
  )

  const costTile = Array.from(costContainer.querySelectorAll('.kpi-tile')).find(
    (t) => t.querySelector('.kpi-label')?.textContent?.includes('Cost')
  )
  const deltaSpan = costTile?.querySelector('.kpi-delta span')
  const deltaText = deltaSpan?.textContent ?? ''

  expect(deltaText).toMatch(/→\s*0\.0%/)
  expect(deltaText).not.toContain('↓')

  unmountCost()

  const exactZeroDelta = { requests: 0 }
  const { container: zeroContainer } = render(
    <KpiStrip summary={summary} deltas={exactZeroDelta} />
  )
  const reqTile = Array.from(zeroContainer.querySelectorAll('.kpi-tile')).find(
    (t) => t.querySelector('.kpi-label')?.textContent?.includes('Requests')
  )
  const reqDeltaSpan = reqTile?.querySelector('.kpi-delta span')
  expect(reqDeltaSpan?.textContent).toMatch(/→\s*0\.0%/)
})
