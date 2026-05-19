/**
 * Wave 5 — MasterLedgerTable red-phase tests.
 *
 * Component path: src/features/dashboard/components/master-ledger-table.tsx
 * Expected export: MasterLedgerTable (named)
 * Props: { rows: ModelRow[] }
 * Uses @tanstack/react-table for sorting. Sticky thead.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MasterLedgerTable } from './master-ledger-table'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRows = [
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
    cache_miss_pct: 12.5,
    cache_miss_usd_cost: 0.01,
    reasoning_reported: 500,
    reasoning_estimated: 600,
  },
  {
    model: 'gpt-4o',
    provider: 'openai',
    tokens_in: 5000,
    tokens_out: 1000,
    requests: 200,
    p50_ms: 150,
    p95_ms: 400,
    error_pct: 0.2,
    cost_usd: 0.5,
    cost_per_1k: 0.08,
    cache_miss_pct: 8.0,
    cache_miss_usd_cost: 0.02,
    reasoning_reported: 0,
    reasoning_estimated: 100,
  },
  {
    model: 'gemini-1.5',
    provider: 'google',
    tokens_in: 2000,
    tokens_out: 1500,
    requests: 50,
    p50_ms: 300,
    p95_ms: 700,
    error_pct: 1.0,
    cost_usd: 0.2,
    cost_per_1k: 0.06,
    cache_miss_pct: undefined,
    cache_miss_usd_cost: undefined,
    reasoning_reported: undefined,
    reasoning_estimated: undefined,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_renders_sortable_column_headers', () => {
  render(<MasterLedgerTable rows={mockRows} />)

  // Each sortable header should exist and have aria-sort or data-sortable.
  // Wave 26: 'Quota%' removed (F#13); cache/reasoning columns added (F#12).
  // Use exact-match header names to avoid ambiguity between Cache Miss %/$.
  const sortableHeaders = [
    'Model',
    'Provider',
    'Toks In',
    'Cost',
    'Cache Miss %',
  ]

  for (const header of sortableHeaders) {
    const th = screen.getByRole('columnheader', {
      name: new RegExp(`^${header}$`, 'i'),
    })
    expect(th).toBeInTheDocument()

    const hasSortAttr =
      th.hasAttribute('aria-sort') ||
      th.hasAttribute('data-sortable') ||
      th.getAttribute('aria-sort') === 'none'

    expect(hasSortAttr).toBe(true)
  }
})

test('test_quota_column_removed', () => {
  // Wave 26 (operator F#13): Quota% column must not appear
  render(<MasterLedgerTable rows={mockRows} />)
  const quotaHeader = screen.queryByRole('columnheader', { name: /quota/i })
  expect(quotaHeader).toBeNull()
})

test('test_cache_reasoning_columns_present', () => {
  // Wave 26 (operator F#12): cache miss columns must appear.
  // Wave 29 Fix #7: reasoning_reported + reasoning_estimated consolidated into
  // single "Reasoning" column; old separate columns must NOT appear.
  render(<MasterLedgerTable rows={mockRows} />)
  expect(
    screen.getByRole('columnheader', { name: /cache miss %/i })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('columnheader', { name: /cache miss \$/i })
  ).toBeInTheDocument()
  // Consolidated Reasoning column
  expect(
    screen.getByRole('columnheader', { name: /^reasoning$/i })
  ).toBeInTheDocument()
  // Old separate columns must not exist
  expect(
    screen.queryByRole('columnheader', { name: /reasoning reported/i })
  ).toBeNull()
  expect(
    screen.queryByRole('columnheader', { name: /reasoning estimated/i })
  ).toBeNull()
})

test('test_click_sort_descending', () => {
  render(<MasterLedgerTable rows={mockRows} />)

  const toksInHeader = screen.getByRole('columnheader', { name: /toks in/i })
  fireEvent.click(toksInHeader)

  // After one click: descending (highest first) → gpt-4o (5000)
  const rows = screen.getAllByRole('row')
  // rows[0] is thead, rows[1] is first data row
  const firstDataRow = rows[1]
  expect(firstDataRow.textContent).toContain('gpt-4o')
})

test('test_click_sort_toggles_ascending', () => {
  render(<MasterLedgerTable rows={mockRows} />)

  const toksInHeader = screen.getByRole('columnheader', { name: /toks in/i })
  fireEvent.click(toksInHeader) // First click: descending
  fireEvent.click(toksInHeader) // Second click: ascending (lowest first)

  const rows = screen.getAllByRole('row')
  const firstDataRow = rows[1]
  expect(firstDataRow.textContent).toContain('claude-3')
})

test('test_no_tfoot_row', () => {
  // Wave 11 PR5 (C11): tfoot removed — was off-by-N and had incorrect layout
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  const tfoot = container.querySelector('tfoot')
  expect(tfoot).toBeNull()
})

test('test_sparkline_column_renders_svg', () => {
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  // Each data row should have at least one SVG (sparkline)
  const rows = container.querySelectorAll('tbody tr')
  expect(rows.length).toBe(3)

  for (const row of Array.from(rows)) {
    // Check for SVG in a sparkline-classed column
    const sparklineCol =
      (row as HTMLElement).querySelector('.sparkline svg') ??
      (row as HTMLElement).querySelector('[class*="sparkline"] svg') ??
      (row as HTMLElement).querySelector('svg')

    expect(sparklineCol).not.toBeNull()
  }
})

test('test_renders_sparkline_caption', () => {
  // Wave 29 Fix #9: caption removed per operator direction.
  // The .table-caption element must NOT be present.
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  const caption = container.querySelector('.table-caption')
  expect(caption).toBeNull()
})

test('test_4k_columns_have_responsive_class', () => {
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  const col4k =
    container.querySelector('.col-4k-only') ??
    container.querySelector('[class*="col-4k-only"]')

  expect(col4k).not.toBeNull()
})

test('test_5k_columns_have_responsive_class', () => {
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  const col5k =
    container.querySelector('.col-5k-only') ??
    container.querySelector('[class*="col-5k-only"]')

  expect(col5k).not.toBeNull()
})
