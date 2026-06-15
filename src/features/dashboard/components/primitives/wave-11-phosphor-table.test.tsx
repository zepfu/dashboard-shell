/**
 * Wave 11 — PhosphorTable<T> generic keyboard sort contract (S5-16 / S5-14).
 *
 * ENGINEER: C
 *
 * The W11 decomposition extracts the sortable-table shell used by MasterLedgerTable
 * and the token-trend table into a generic `primitives/phosphor-table.tsx` component.
 *
 * NEW BEHAVIORS pinned here (beyond what existing MasterLedgerTable tests cover):
 *   1. Generic column-def API: column defs render headers and cells correctly.
 *   2. Keyboard-operable sort: sortable headers must be focusable (tabIndex="0"),
 *      respond to Enter and Space keys to toggle sort, and carry proper `aria-sort`.
 *   3. `align` column meta: columns with `meta.align = 'right'` render right-aligned.
 *
 * WHY NEW (not in existing master-ledger-table.test.tsx):
 *   MasterLedgerTable tests cover the TABLE's behavior but not the PRIMITIVE's API.
 *   After decomposition, the primitive is independently testable.  The keyboard-
 *   operability gap (S5-14) is a NEW requirement — current th elements have only
 *   onClick, not onKeyDown + tabIndex, so keyboard users cannot sort.
 *
 * RED until Engineer C creates `primitives/phosphor-table.tsx`.
 *
 * Module path (post-W11): `./phosphor-table`
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PhosphorTable } from './phosphor-table'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface LedgerRow {
  model: string
  provider: string
  cost: number
  requests: number
}

const COLUMNS: Array<{
  key: keyof LedgerRow
  header: string
  sortable?: boolean
  meta?: { align?: 'left' | 'right' }
  cell?: (row: LedgerRow) => string | number
}> = [
  { key: 'model', header: 'Model', sortable: true },
  { key: 'provider', header: 'Provider', sortable: true },
  {
    key: 'cost',
    header: 'Cost',
    sortable: true,
    meta: { align: 'right' },
    cell: (row) => `$${row.cost.toFixed(2)}`,
  },
  { key: 'requests', header: 'Requests', sortable: false },
]

const ROWS: LedgerRow[] = [
  { model: 'claude-3-opus', provider: 'anthropic', cost: 1.5, requests: 100 },
  { model: 'gpt-4o', provider: 'openai', cost: 0.8, requests: 200 },
  {
    model: 'gemini-1.5-pro',
    provider: 'google',
    cost: 0.3,
    requests: 50,
  },
]

// ---------------------------------------------------------------------------
// Column def rendering (S5-16)
// ---------------------------------------------------------------------------

describe('PhosphorTable column def rendering (S5-16)', () => {
  test('test_phosphor_table_renders_column_headers', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    expect(
      screen.getByRole('columnheader', { name: /^Model$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /^Provider$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /^Cost$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /^Requests$/i })
    ).toBeInTheDocument()
  })

  test('test_phosphor_table_renders_row_data', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    expect(screen.getByText('claude-3-opus')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('gemini-1.5-pro')).toBeInTheDocument()
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  test('test_phosphor_table_cell_renderer_applied', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    // Cost column uses a custom cell renderer — should show $ prefix.
    expect(screen.getByText('$1.50')).toBeInTheDocument()
    expect(screen.getByText('$0.80')).toBeInTheDocument()
    expect(screen.getByText('$0.30')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Keyboard-operable sort (S5-14 / S5-16)
// RED: current MasterLedgerTable th elements have onClick but no onKeyDown
// and no tabIndex — keyboard users cannot sort.
// After W11 PhosphorTable must fix this.
// ---------------------------------------------------------------------------

describe('PhosphorTable keyboard-operable sort (S5-14)', () => {
  test('test_phosphor_table_sortable_headers_have_tab_index', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const modelHeader = screen.getByRole('columnheader', { name: /^Model$/i })
    const providerHeader = screen.getByRole('columnheader', {
      name: /^Provider$/i,
    })
    const costHeader = screen.getByRole('columnheader', { name: /^Cost$/i })

    // RED: current implementation has no tabIndex on th elements.
    // After W11: sortable headers must have tabIndex="0" (keyboard-reachable).
    expect(modelHeader).toHaveAttribute('tabindex', '0')
    expect(providerHeader).toHaveAttribute('tabindex', '0')
    expect(costHeader).toHaveAttribute('tabindex', '0')
  })

  test('test_phosphor_table_non_sortable_header_not_focusable', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const requestsHeader = screen.getByRole('columnheader', {
      name: /^Requests$/i,
    })

    // Non-sortable column must NOT have tabIndex="0" — it is not interactive.
    // (tabIndex="-1" or absent are both acceptable.)
    const tabIndex = requestsHeader.getAttribute('tabindex')
    expect(tabIndex === null || tabIndex === '-1').toBe(true)
  })

  test('test_phosphor_table_enter_key_triggers_sort_ascending', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const modelHeader = screen.getByRole('columnheader', { name: /^Model$/i })

    // Initial state: unsorted (aria-sort="none" or absent).
    const initialSort = modelHeader.getAttribute('aria-sort')
    expect(initialSort === 'none' || initialSort === null).toBe(true)

    // Press Enter on the sortable header.
    fireEvent.keyDown(modelHeader, { key: 'Enter', code: 'Enter' })

    // After Enter: should be sorted ascending.
    expect(modelHeader.getAttribute('aria-sort')).toBe('ascending')
  })

  test('test_phosphor_table_space_key_triggers_sort_ascending', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const costHeader = screen.getByRole('columnheader', { name: /^Cost$/i })

    // Initial state: unsorted.
    expect(
      costHeader.getAttribute('aria-sort') === 'none' ||
        costHeader.getAttribute('aria-sort') === null
    ).toBe(true)

    // Press Space on the sortable header.
    fireEvent.keyDown(costHeader, { key: ' ', code: 'Space' })

    expect(costHeader.getAttribute('aria-sort')).toBe('ascending')
  })

  test('test_phosphor_table_enter_key_toggles_sort_ascending_to_descending', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const modelHeader = screen.getByRole('columnheader', { name: /^Model$/i })

    // First Enter: ascending.
    fireEvent.keyDown(modelHeader, { key: 'Enter', code: 'Enter' })
    expect(modelHeader.getAttribute('aria-sort')).toBe('ascending')

    // Second Enter: descending.
    fireEvent.keyDown(modelHeader, { key: 'Enter', code: 'Enter' })
    expect(modelHeader.getAttribute('aria-sort')).toBe('descending')
  })

  test('test_phosphor_table_click_and_keyboard_sort_parity', () => {
    /**
     * Clicking a sortable header and pressing Enter must produce the same
     * sort outcome.  This ensures keyboard users experience identical behavior
     * to mouse users.
     */
    const { rerender } = render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const providerHeader = screen.getByRole('columnheader', {
      name: /^Provider$/i,
    })

    // Click to sort.
    fireEvent.click(providerHeader)
    const afterClick = providerHeader.getAttribute('aria-sort')

    // Remount so sort state resets (parity with a fresh click interaction).
    rerender(
      <PhosphorTable key='keyboard-parity' columns={COLUMNS} rows={ROWS} />
    )

    // Keyboard Enter to sort.
    const providerHeaderFresh = screen.getByRole('columnheader', {
      name: /^Provider$/i,
    })
    fireEvent.keyDown(providerHeaderFresh, { key: 'Enter', code: 'Enter' })
    const afterKeyboard = providerHeaderFresh.getAttribute('aria-sort')

    // Both must produce the same result.
    expect(afterClick).toBe(afterKeyboard)
  })

  test('test_phosphor_table_aria_sort_none_on_sortable_unsorted_headers', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    // All sortable headers must have aria-sort="none" initially (not absent,
    // not "ascending"/"descending") so AT can discover them as sortable.
    const sortableHeaderNames = ['Model', 'Provider', 'Cost']
    for (const name of sortableHeaderNames) {
      const header = screen.getByRole('columnheader', {
        name: new RegExp(`^${name}$`, 'i'),
      })
      expect(header.getAttribute('aria-sort')).toBe('none')
    }
  })

  test('test_phosphor_table_non_sortable_header_has_no_aria_sort', () => {
    render(<PhosphorTable columns={COLUMNS} rows={ROWS} />)

    const requestsHeader = screen.getByRole('columnheader', {
      name: /^Requests$/i,
    })

    // Non-sortable columns must NOT have aria-sort (it implies interactivity).
    expect(requestsHeader.getAttribute('aria-sort')).toBeNull()
  })

  test('test_phosphor_table_sort_reorders_rows', () => {
    const { container } = render(
      <PhosphorTable columns={COLUMNS} rows={ROWS} />
    )

    const modelHeader = screen.getByRole('columnheader', { name: /^Model$/i })

    // Sort ascending by model name.
    fireEvent.keyDown(modelHeader, { key: 'Enter', code: 'Enter' })

    // Get all cells in the model column.
    const cells = container.querySelectorAll('td:first-child')
    const texts = Array.from(cells).map((c) => c.textContent ?? '')

    // After ascending sort by model: alphabetical order.
    const sorted = [...texts].sort()
    expect(texts).toEqual(sorted)
    // Also assert actual values are present (non-vacuous).
    expect(texts).toContain('claude-3-opus')
    expect(texts).toContain('gemini-1.5-pro')
    expect(texts).toContain('gpt-4o')
  })
})

// ---------------------------------------------------------------------------
// Column align meta (S5-16)
// ---------------------------------------------------------------------------

describe('PhosphorTable column align meta (S5-16)', () => {
  test('test_phosphor_table_right_align_applied_to_cost_column', () => {
    const { container } = render(
      <PhosphorTable columns={COLUMNS} rows={ROWS} />
    )

    // The Cost column header has meta.align='right' — its th must be right-aligned.
    const costHeader = screen.getByRole('columnheader', { name: /^Cost$/i })

    // Accept either CSS class or inline style for alignment.
    const isRightAligned =
      costHeader.classList.contains('text-right') ||
      costHeader.style.textAlign === 'right' ||
      costHeader.getAttribute('data-align') === 'right'

    expect(isRightAligned).toBe(true)

    // Also check at least one data cell in the cost column.
    const costCells = container.querySelectorAll('td[data-col="cost"]')
    if (costCells.length > 0) {
      const firstCell = costCells[0] as HTMLElement
      const cellRightAligned =
        firstCell.classList.contains('text-right') ||
        firstCell.style.textAlign === 'right' ||
        firstCell.getAttribute('data-align') === 'right'
      expect(cellRightAligned).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('PhosphorTable empty state', () => {
  test('test_phosphor_table_renders_with_empty_rows', () => {
    render(<PhosphorTable columns={COLUMNS} rows={[]} />)

    // Headers must still be rendered.
    expect(
      screen.getByRole('columnheader', { name: /^Model$/i })
    ).toBeInTheDocument()
    // No data rows.
    const dataRows = screen.queryAllByRole('row')
    // Only the header row (1 row total).
    expect(dataRows.length).toBe(1)
  })
})
