/**
 * Wave 5 — RepoBreakdownTable red-phase tests.
 *
 * Component path: src/features/dashboard/components/repo-breakdown-table.tsx
 * Expected export: RepoBreakdownTable (named)
 * Props: { rows: RepoRow[] }
 * Columns: Repository, Tokens, Cost, Traces, Top Model, Sparkline.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
// @ts-expect-error -- module does not exist yet (red phase)
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoBreakdownTable } from './repo-breakdown-table'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRepos = [
  {
    repository: 'aawm-project',
    tokens: 5000,
    cost_usd: 0.3,
    traces: 12,
    top_model: 'claude-3',
    spark: [10, 20, 15, 30],
  },
  {
    repository: 'dashboard-shell',
    tokens: 2000,
    cost_usd: 0.1,
    traces: 5,
    top_model: 'gpt-4o',
    spark: [5, 8, 12, 7],
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_renders_repository_rows', () => {
  render(<RepoBreakdownTable rows={mockRepos} />)

  expect(screen.getByText('aawm-project')).toBeInTheDocument()
  expect(screen.getByText('dashboard-shell')).toBeInTheDocument()
})

test('test_sortable_by_tokens_descending', () => {
  render(<RepoBreakdownTable rows={mockRepos} />)

  const tokensHeader = screen.getByRole('columnheader', { name: /tokens/i })
  fireEvent.click(tokensHeader)

  // After clicking: descending sort → aawm-project (5000) first
  const rows = screen.getAllByRole('row')
  // rows[0] is thead, rows[1] is first data row
  const firstDataRow = rows[1]
  expect(firstDataRow.textContent).toContain('aawm-project')
})
