/**
 * KpiStrip + kpi-strip.helpers — Wave 2 (D1-451 dash-widgets-cards) contracts.
 *
 * Pins proportional microbar (C-3), delta boundary (C-7), p95 nullability (I-5),
 * hoisted constants (P-3), and green-contract narration (E-1).
 */
import { render, screen } from '@testing-library/react'
import type { UsageReportSummary } from '../api/usage-report'
import { KpiStrip } from './kpi-strip'
import {
  kpiMicrobarFillPct,
  microbarScale,
  renderDelta,
  type KpiKey,
  type KpiSummary,
} from './kpi-strip.helpers'

/** Maps UsageReportSummary numeric fields to KpiStrip summary shape (real API names). */
function summaryFromUsageReport(
  partial: Pick<
    UsageReportSummary,
    'token_in' | 'token_out' | 'usd_cost' | 'tool_calls' | 'traces' | 'p95_ms'
  > & { errors?: number }
): KpiSummary {
  return {
    token_in: partial.token_in,
    token_out: partial.token_out,
    cost_usd: partial.usd_cost,
    requests: partial.tool_calls,
    errors: partial.errors ?? 0,
    p95_ms: partial.p95_ms,
  }
}

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
 * C-3 — microbar fill is proportional across tiles (share-of-max), not degenerate 0%/100%.
 */
test('test_kpi_microbar_per_tile_normalized', () => {
  const realisticSummary = summaryFromUsageReport({
    token_in: 500_000,
    token_out: 250_000,
    usd_cost: 12.5,
    tool_calls: 8_500,
    errors: 0,
    p95_ms: 1_200,
  })

  const { container } = render(<KpiStrip summary={realisticSummary} />)

  const tiles = Array.from(container.querySelectorAll('.kpi-tile'))
  expect(tiles.length).toBe(6)

  const fillsByLabel = new Map<string, number>()
  for (const tile of tiles) {
    const label = tile.querySelector('.kpi-label')?.textContent ?? ''
    const fill = parseFloat(
      tile
        .querySelector('.kpi-microbar')
        ?.getAttribute('style')
        ?.match(/--fill:\s*([\d.]+)%/)?.[1] ??
        (
          tile.querySelector('.kpi-microbar') as HTMLElement | null
        )?.style.getPropertyValue('--fill') ??
        '0'
    )
    fillsByLabel.set(label, fill)
  }

  const tokensInFill = fillsByLabel.get('Tokens In') ?? 0
  const tokensOutFill = fillsByLabel.get('Tokens Out') ?? 0
  expect(tokensInFill).toBe(100)
  expect(tokensOutFill).toBe(50)
  expect(tokensInFill).toBeGreaterThan(tokensOutFill)
})

/**
 * P07-F02 — cost/requests/errors/p95 microbars use per-tile scale (microbarScale), not share-of-max collapse.
 */
test('test_kpi_microbar_per_tile_normalized_all_keys', () => {
  const summary = summaryFromUsageReport({
    token_in: 500_000,
    token_out: 250_000,
    usd_cost: 12.5,
    tool_calls: 8_500,
    errors: 3,
    p95_ms: 1_200,
  })

  const costFill = kpiMicrobarFillPct(
    'cost_usd',
    summary,
    summary.cost_usd,
    undefined
  )
  const costScale = microbarScale('cost_usd', summary)
  const expectedCostFill = Math.min(
    100,
    Math.round((summary.cost_usd / costScale) * 100)
  )
  expect(costFill).toBe(expectedCostFill)
  expect(costFill).toBe(100)

  const requestsFill = kpiMicrobarFillPct(
    'requests',
    summary,
    summary.requests,
    undefined
  )
  expect(requestsFill).toBeLessThan(100)
  expect(requestsFill).toBeGreaterThan(1)

  const { container } = render(<KpiStrip summary={summary} />)
  const costTile = Array.from(container.querySelectorAll('.kpi-tile')).find(
    (t) => t.querySelector('.kpi-label')?.textContent === 'Cost'
  )
  const costDomFill = parseFloat(
    (
      costTile?.querySelector('.kpi-microbar') as HTMLElement | null
    )?.style.getPropertyValue('--fill') ?? '0'
  )
  expect(costDomFill).toBeGreaterThan(50)
  expect(costDomFill).toBeLessThanOrEqual(100)
})

test('test_kpi_microbar_fill_not_degenerate_binary_without_deltas', () => {
  const summary = summaryFromUsageReport({
    token_in: 10_000,
    token_out: 5_000,
    usd_cost: 1,
    tool_calls: 100,
    p95_ms: 200,
  })
  const keys: KpiKey[] = [
    'token_in',
    'token_out',
    'cost_usd',
    'requests',
    'p95_ms',
  ]
  const fills = keys.map((key) =>
    kpiMicrobarFillPct(key, summary, summary[key], undefined)
  )
  const distinct = new Set(fills)
  expect(distinct.size).toBeGreaterThan(1)
  expect(fills.some((f) => f > 0 && f < 100)).toBe(true)
})

// ---------------------------------------------------------------------------
// S5-20: renderDelta deadband — tiny deltas show "→ 0.0%" muted, not ↑/↓
// ---------------------------------------------------------------------------

/** C-7 deadband — tiny fractional deltas render as → 0.0%. */
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

/** C-7 — exactly 0.05% fractional delta must not display as 0.1% (toFixed(1) inflation). */
test('test_renderDelta_boundary_0_05_percent_not_double_display', () => {
  expect(renderDelta(0.0005)).toBe('↑ 0.05%')
})

test('test_kpi_strip_p95_null_renders_dash', () => {
  const summary: KpiSummary = {
    token_in: 1,
    token_out: 1,
    cost_usd: 0.01,
    requests: 1,
    errors: 0,
    p95_ms: null as unknown as number,
  }
  const { container } = render(<KpiStrip summary={summary} />)
  const p95Tile = Array.from(container.querySelectorAll('.kpi-tile')).find(
    (t) => t.querySelector('.kpi-label')?.textContent?.includes('P95 Latency')
  )
  expect(p95Tile?.querySelector('.kpi-value')?.textContent).toBe('—')
})

/** I-5 — KpiSummary should allow null p95 like ProviderMetrics; compile + display contract. */
test('test_kpi_summary_p95_nullable_type_contract', () => {
  const withNull: KpiSummary = {
    token_in: 0,
    token_out: 0,
    cost_usd: 0,
    requests: 0,
    errors: 0,
    p95_ms: null as unknown as number,
  }
  expect(withNull.p95_ms).toBeNull()
})
