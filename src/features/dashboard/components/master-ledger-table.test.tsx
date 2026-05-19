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
    quota_pct: 25,
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
    quota_pct: 60,
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
    quota_pct: 40,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_renders_sortable_column_headers', () => {
  render(<MasterLedgerTable rows={mockRows} />)

  // Each sortable header should exist and have aria-sort or data-sortable
  const sortableHeaders = ['Model', 'Provider', 'Toks In', 'Cost$', 'Quota%']

  for (const header of sortableHeaders) {
    const th = screen.getByRole('columnheader', {
      name: new RegExp(header, 'i'),
    })
    expect(th).toBeInTheDocument()

    const hasSortAttr =
      th.hasAttribute('aria-sort') ||
      th.hasAttribute('data-sortable') ||
      th.getAttribute('aria-sort') === 'none'

    expect(hasSortAttr).toBe(true)
  }
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
  // Wave 20-Tables F5: mockup L2822 — caption text must match exactly
  const { container } = render(<MasterLedgerTable rows={mockRows} />)

  const caption = container.querySelector('.table-caption')
  expect(caption).not.toBeNull()
  expect(caption?.textContent?.trim()).toBe(
    'sparkline: 24h hourly trend · tok/hr per model'
  )
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
