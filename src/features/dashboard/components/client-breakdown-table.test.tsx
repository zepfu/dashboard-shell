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
 *
 * Wave 25-ClientTable:
 * - ClientRow.color field takes priority over CLIENT_BRAND_COLORS legacy map.
 * - ClientRow.family field added for filtering / future use (optional).
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

/**
 * W25-ClientTable: ClientRow.color takes priority over legacy CLIENT_BRAND_COLORS.
 *
 * buildClientRows now emits one row per (client_name, client_version) pair with
 * color populated from PROVIDER_BRAND_HEX. The cell renderer must prefer that
 * explicit color over the legacy map so family-collapsed clients (e.g. 'claude code',
 * 'gemini') receive the correct hue even when their raw name has no legacy entry.
 */
test('test_client_table_uses_row_color_field_over_legacy_map', () => {
  // '#d97757' is the Anthropic brand color supplied by buildClientRows W25.
  const rows = [
    {
      client: 'claude-code',
      version: '2.0.0',
      requests: 50,
      tokens: 10000,
      cost_usd: 1.0,
      color: '#d97757',
      family: 'claude code',
    },
  ]

  const { container } = render(<ClientBreakdownTable rows={rows} />)

  // The <span> inside the client cell should carry the explicit color.
  const span = container.querySelector('span[data-client="claude-code"]')
  expect(span).not.toBeNull()
  expect((span as HTMLElement).style.color).toBe('rgb(217, 119, 87)')
})
