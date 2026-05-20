/**
 * Wave 5 — MasterLedgerTable red-phase tests.
 *
 * Component path: src/features/dashboard/components/master-ledger-table.tsx
 * Expected export: MasterLedgerTable (named)
 * Props: { rows: ModelRow[] }
 * Uses @tanstack/react-table for sorting. Sticky thead.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 *
 * Wave 31 additions:
 * - Q8: Err% hover tooltip when providerErrorObservations are provided.
 *
 * Wave 33 additions:
 * - TOOL cell hover: MCP rollup logic, shell-class filtering, empty-state.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { type UsageReportToolActivityRow } from '../api/usage-report'
import {
  buildToolActivity,
  MasterLedgerTable,
  SHELL_CLASS_TOOL_NAMES,
  type ProviderErrorObservation,
} from './master-ledger-table'

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

// ---------------------------------------------------------------------------
// Wave 31 Q8 — Err% hover tooltip
// ---------------------------------------------------------------------------

/** Minimal error observation fixture for provider+model filtering tests. */
const makeErrorObs = (
  provider: string,
  model: string,
  observedAt: string,
  statusCode: number,
  errorClass: string,
  errorCode: string
): ProviderErrorObservation => ({
  observed_at: observedAt,
  environment: 'prod',
  provider,
  model,
  model_group: 'unknown',
  route_family: 'anthropic_messages',
  status_code: statusCode,
  error_type: 'HTTPException',
  error_code: errorCode,
  error_class: errorClass,
  retry_after_seconds: null,
  expected_reset_at: null,
})

const errorRow = {
  model: 'claude-3',
  provider: 'anthropic',
  tokens_in: 1000,
  tokens_out: 2000,
  requests: 100,
  p50_ms: 200,
  p95_ms: 500,
  error_pct: 9.0,
  cost_usd: 0.1,
  cost_per_1k: 0.05,
  cache_miss_pct: 12.5,
  cache_miss_usd_cost: 0.01,
  reasoning_reported: 500,
  reasoning_estimated: 600,
}

const zeroErrorRow = {
  ...errorRow,
  model: 'gpt-4o',
  provider: 'openai',
  error_pct: 0,
}

const matchingObs: ProviderErrorObservation[] = [
  makeErrorObs(
    'anthropic',
    'claude-3',
    '2026-05-19T15:07:05.860Z',
    529,
    'capacity_exhausted',
    'unknown'
  ),
  makeErrorObs(
    'anthropic',
    'claude-3',
    '2026-05-19T14:00:00.000Z',
    500,
    'server_error',
    'internal'
  ),
]

const unmatchedObs: ProviderErrorObservation[] = [
  makeErrorObs(
    'openai',
    'gpt-4o',
    '2026-05-19T15:07:05.860Z',
    429,
    'rate_limited',
    'too_many_requests'
  ),
]

test('test_err_pct_hover_tooltip_renders_when_observations_present', () => {
  // Err% > 0 and matching observations → HoverTooltip wrapper is rendered in
  // the cell.  The tooltip content (hidden by default) should include both
  // the "most recent errors:" heading and the individual error lines.
  render(
    <MasterLedgerTable rows={[errorRow]} errorObservations={matchingObs} />
  )

  // The static (hidden) tooltip content is always in the DOM; confirm the
  // heading text is present.
  expect(screen.getByText(/most recent error/i)).toBeInTheDocument()
  // Both error class entries should appear.
  expect(screen.getByText(/capacity_exhausted/)).toBeInTheDocument()
  expect(screen.getByText(/server_error/)).toBeInTheDocument()
})

test('test_err_pct_no_tooltip_when_error_pct_is_zero', () => {
  // error_pct === 0 → no tooltip content even if observations exist.
  render(
    <MasterLedgerTable rows={[zeroErrorRow]} errorObservations={unmatchedObs} />
  )
  expect(screen.queryByText(/most recent error/i)).toBeNull()
})

test('test_err_pct_no_tooltip_when_no_matching_observations', () => {
  // error_pct > 0 but no observations match the row's provider+model →
  // no HoverTooltip; the cell renders a plain text percentage.
  render(
    <MasterLedgerTable rows={[errorRow]} errorObservations={unmatchedObs} />
  )
  expect(screen.queryByText(/most recent error/i)).toBeNull()
})

test('test_err_pct_no_tooltip_when_observations_omitted', () => {
  // errorObservations defaults to [] → no tooltip rendered.
  render(<MasterLedgerTable rows={[errorRow]} />)
  expect(screen.queryByText(/most recent error/i)).toBeNull()
})

test('test_err_pct_tooltip_caps_at_ten_rows', () => {
  // Provide 12 matching observations; tooltip should show at most 10 rows.
  const manyObs = Array.from({ length: 12 }, (_, i) =>
    makeErrorObs(
      'anthropic',
      'claude-3',
      `2026-05-19T${String(i).padStart(2, '0')}:00:00.000Z`,
      529,
      'capacity_exhausted',
      'unknown'
    )
  )
  render(<MasterLedgerTable rows={[errorRow]} errorObservations={manyObs} />)

  // The heading says "10 most recent errors:" — not "12".
  expect(screen.getByText(/10 most recent errors/i)).toBeInTheDocument()
  // "12 most recent" must NOT appear.
  expect(screen.queryByText(/12 most recent/i)).toBeNull()
})

// ---------------------------------------------------------------------------
// Wave 33 — TOOL cell hover: buildToolActivity unit tests
// ---------------------------------------------------------------------------

/** Helper to build a UsageReportToolActivityRow fixture. */
function makeToolActivityRow(
  label: string,
  kind: 'outer' | 'shell',
  calls: number,
  provider = 'anthropic',
  model = 'claude-opus-4-7'
): UsageReportToolActivityRow {
  return { provider, model, kind, label, calls }
}

test('test_buildToolActivity_mcp_rollup_groups_by_server', () => {
  // mcp__aawm__search (35 calls) and mcp__aawm__tristore_add (18 calls) should
  // be rolled up into a single "MCP: aawm" entry with calls = 53.
  const rows: UsageReportToolActivityRow[] = [
    makeToolActivityRow('mcp__aawm__search', 'outer', 35),
    makeToolActivityRow('mcp__aawm__tristore_add', 'outer', 18),
    makeToolActivityRow('Read', 'outer', 245),
  ]
  const result = buildToolActivity(rows)

  // Should have 2 left rows: Read (245) and MCP: aawm (53)
  expect(result.leftRows).toHaveLength(2)

  // Sorted descending by calls → Read first, then MCP: aawm
  const readRow = result.leftRows.find((r) => r.label === 'Read')
  expect(readRow).toBeDefined()
  expect(readRow?.calls).toBe(245)

  const mcpRow = result.leftRows.find((r) => r.label === 'MCP: aawm')
  expect(mcpRow).toBeDefined()
  expect(mcpRow?.calls).toBe(53)

  // MCP row should have subRows listing individual tools
  expect(mcpRow?.subRows).toHaveLength(2)
  const subLabels = mcpRow?.subRows?.map((s) => s.label) ?? []
  expect(subLabels).toContain('search')
  expect(subLabels).toContain('tristore_add')
})

test('test_buildToolActivity_shell_class_excluded_from_left_column', () => {
  // All SHELL_CLASS_TOOL_NAMES entries must NOT appear in leftRows.
  // They should only contribute to shellTotalCalls.
  const shellClassNames = [...SHELL_CLASS_TOOL_NAMES]
  const rows: UsageReportToolActivityRow[] = [
    ...shellClassNames.map((name, i) =>
      makeToolActivityRow(name, 'outer', (i + 1) * 10)
    ),
    makeToolActivityRow('Read', 'outer', 100),
    makeToolActivityRow('git commit', 'shell', 45),
    makeToolActivityRow('npm test', 'shell', 30),
  ]

  const result = buildToolActivity(rows)

  // Left rows must only contain 'Read' — no shell-class names
  const leftLabels = result.leftRows.map((r) => r.label)
  for (const shellName of shellClassNames) {
    expect(leftLabels).not.toContain(shellName)
  }
  expect(leftLabels).toContain('Read')

  // shellTotalCalls should be the sum of all shell-class outer rows
  const expectedShellTotal = shellClassNames.reduce(
    (s, _name, i) => s + (i + 1) * 10,
    0
  )
  expect(result.shellTotalCalls).toBe(expectedShellTotal)

  // Shell command rows should be captured
  expect(result.shellRows).toHaveLength(2)
  expect(result.shellRows[0].label).toBe('git commit')
  expect(result.shellRows[0].calls).toBe(45)
})

test('test_buildToolActivity_empty_state_zero_calls', () => {
  // Empty input → totalCalls is 0 → TOOL cell should suppress the hover.
  const result = buildToolActivity([])

  expect(result.totalCalls).toBe(0)
  expect(result.leftRows).toHaveLength(0)
  expect(result.shellRows).toHaveLength(0)
  expect(result.shellTotalCalls).toBe(0)
})

test('test_tool_cell_hover_tooltip_rendered_when_tool_activity_present', () => {
  // When toolActivity with non-zero totalCalls is attached to the ModelRow,
  // the TOOL cell should render the HoverTooltip with the shell breakdown header.
  const toolRow = {
    model: 'claude-opus-4-7',
    provider: 'anthropic',
    tokens_in: 1000,
    tokens_out: 2000,
    requests: 100,
    p50_ms: 200,
    p95_ms: 500,
    error_pct: 0,
    cost_usd: 0.5,
    cost_per_1k: 0.05,
    tool: 380,
    toolActivity: buildToolActivity([
      makeToolActivityRow('Read', 'outer', 245),
      makeToolActivityRow('Edit', 'outer', 135),
      makeToolActivityRow('Bash', 'outer', 80),
      makeToolActivityRow('git commit', 'shell', 45),
      makeToolActivityRow('npm test', 'shell', 30),
    ]),
  }

  render(<MasterLedgerTable rows={[toolRow]} />)

  // The shell header text should be present in the (hidden) tooltip DOM.
  // Pattern matches "SHELL (80 calls)" — Bash contributes 80 to shellTotalCalls.
  expect(screen.getByText(/shell.*80.*calls/i)).toBeInTheDocument()
  // Tool names in the left column should be visible in the tooltip DOM.
  expect(screen.getByText('Read')).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// Wave 34 — TOOL cell scalar renders count (Critical #4 fix)
// ---------------------------------------------------------------------------

test('test_tool_cell_renders_count_when_tool_scalar_is_set', () => {
  // Wave 34 fix (wave34-data-flow-audit Critical #4): buildModelRows now sets
  // the scalar `tool` field to toolActivity.totalCalls. The TOOL cell must
  // render the numeric count (not '—') when tool > 0.
  const totalCalls = 460
  const toolActivity = buildToolActivity([
    makeToolActivityRow('Read', 'outer', 245),
    makeToolActivityRow('Edit', 'outer', 135),
    makeToolActivityRow('Bash', 'outer', 80),
  ])

  const toolRow = {
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    tokens_in: 5000,
    tokens_out: 2000,
    requests: 200,
    p50_ms: 150,
    p95_ms: 400,
    error_pct: 0,
    cost_usd: 1.0,
    cost_per_1k: 0.05,
    // Scalar `tool` mirrors toolActivity.totalCalls as produced by buildModelRows
    tool: totalCalls,
    toolActivity,
  }

  const { container } = render(<MasterLedgerTable rows={[toolRow]} />)

  // Locate the TOOL column cell — it should display the numeric count, not '—'.
  // The count (460) must appear as text within the table body.
  const cells = container.querySelectorAll('tbody td')
  const cellTexts = Array.from(cells).map((c) => (c as HTMLElement).textContent)
  const toolCellText = cellTexts.find((t) => t?.includes('460'))
  expect(toolCellText).toBeDefined()

  // Ensure the em-dash placeholder is NOT the content of the TOOL cell for this row.
  // We verify by checking the count appears — the TOOL cell renderer returns numFmt
  // when tool !== undefined, which formats 460 as "460".
  expect(toolCellText).not.toBe('—')
})
