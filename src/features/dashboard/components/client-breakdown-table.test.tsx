/**
 * Wave 6 — ClientBreakdownTable red-phase tests.
 *
 * Component path: src/features/dashboard/components/client-breakdown-table.tsx
 * Expected export: ClientBreakdownTable (named)
 * Props: { rows: ClientRow[] }
 * Columns: Client, Version, Requests, Tokens, Cost.
 * Client <td> carries data-client attribute.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { ClientBreakdownTable } from './client-breakdown-table'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockClients = [
  {
    client: 'claude-code',
    version: '1.2.3',
    requests: 200,
    tokens: 50000,
    cost_usd: 2.5,
  },
  {
    client: 'gemini-cli',
    version: '0.9.0',
    requests: 100,
    tokens: 20000,
    cost_usd: 1.0,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_client_table_name_column_brand_color_attribute', () => {
  const { container } = render(<ClientBreakdownTable rows={mockClients} />)

  // Client <td> should carry data-client="claude-code"
  const claudeTd = container.querySelector('td[data-client="claude-code"]')
  expect(claudeTd).not.toBeNull()
})

test('test_client_table_sortable_by_tokens_descending', () => {
  render(<ClientBreakdownTable rows={mockClients} />)

  const tokensHeader = screen.getByRole('columnheader', { name: /tokens/i })
  fireEvent.click(tokensHeader)

  // After click: descending → claude-code (50000) is first
  const rows = screen.getAllByRole('row')
  const firstDataRow = rows[1]
  expect(firstDataRow.textContent).toContain('claude-code')
})
