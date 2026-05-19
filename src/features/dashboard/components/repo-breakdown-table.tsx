/**
 * RepoBreakdownTable — sortable TanStack Table for per-repository usage.
 *
 * Renders a sortable, sticky-header table with Repository, Tokens, Cost,
 * Requests, Top Model, and 24h Tok/Hr (sparkline) columns.
 *
 * Wave 11 PR6 (11-n):
 * - Severity gutter on first cell — dynamic color based on row thresholds.
 * - Provider-tinted sparkline via providerColorFor / rowSeverityColor.
 * - Column rename: Traces → Requests, Trend → 24h Tok/Hr.
 * - Amber uppercase thead with letter-spacing 0.05em.
 *
 * Wave 14-F refactor (14-F.3):
 * - Gutter locked to .gutter-cool (var(--accent-cool)) — mockup spec
 *   §14 line 1440: td:first-child { border-left: 4px solid var(--accent-cool) }
 * - .number className added to numeric cells (14-F.1)
 * - th letter-spacing corrected to 0.04em (audit §14 deviation 2)
 *
 * Wave 18-Tables (§5.14 / §5.15):
 * - Removed metric-cell/microbar wrappers from Tokens, Cost, Requests — spec
 *   renders plain `<td style="text-align: right;">` values (mockup L3152-3154).
 * - Removed cost severity color thresholds — spec is neutral fg (§5.15).
 */
import { useState, type ReactElement } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { providerColorFor, formatUsd } from '../lib/usage-report-display'
import { Sparkline } from './primitives/sparkline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the repository breakdown table. */
export interface RepoRow {
  repository: string
  tokens: number
  cost_usd: number
  /** Request/trace count — renamed from 'traces' in C40 fix. */
  traces: number
  top_model: string
  /** Provider hint for sparkline tinting (optional). */
  top_model_provider?: string
  spark?: number[]
}

// ---------------------------------------------------------------------------
// Severity helpers (retained for sparkline tinting only)
// ---------------------------------------------------------------------------

/**
 * Computes a severity color for sparkline tinting.
 * Note: gutter color is no longer severity-derived (14-F.3 — locked to cool).
 *
 * Thresholds (per-row):
 *   cost > 1.0 → hot (red)
 *   cost > 0.5 → warm (amber)
 *   traces < 5  → warm (low-activity amber)
 *   otherwise   → cool (blue)
 */
function rowSeverityColor(row: RepoRow): string {
  if (row.cost_usd > 1.0) return 'var(--accent-hot)'
  if (row.cost_usd > 0.5) return 'var(--accent-warm)'
  if (row.traces < 5) return 'var(--accent-warm)'
  return 'var(--accent-cool)'
}

// ---------------------------------------------------------------------------
// Column helper
// ---------------------------------------------------------------------------

const helper = createColumnHelper<RepoRow>()

function numFmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ---------------------------------------------------------------------------
// RepoBreakdownTable
// ---------------------------------------------------------------------------

export interface RepoBreakdownTableProps {
  rows: RepoRow[]
}

/**
 * RepoBreakdownTable renders a sortable, sticky-header table of repository
 * usage metrics with a uniform cool-blue gutter (14-F.3), plain numeric cells
 * without microbar overlays (§5.14), and a tinted sparkline trend column.
 */
export function RepoBreakdownTable({
  rows,
}: RepoBreakdownTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = [
    helper.accessor('repository', {
      header: 'Repository',
      cell: (info) => info.getValue() as string,
    }),
    // §5.14: plain numeric cell — no microbar wrapper (spec mockup L3152)
    helper.accessor('tokens', {
      header: 'Tokens',
      cell: (info) => numFmt(info.getValue() as number),
    }),
    // §5.14 / §5.15: plain numeric cell, neutral fg color — no microbar, no
    // severity color threshold (spec mockup L3153: plain <td>$124.32</td>)
    helper.accessor('cost_usd', {
      header: 'Cost',
      cell: (info) => formatUsd(info.getValue() as number),
    }),
    // C40: renamed from Traces → Requests; §5.14: plain numeric cell — no microbar
    helper.accessor('traces', {
      header: 'Requests',
      cell: (info) => numFmt(info.getValue() as number),
    }),
    helper.accessor('top_model', {
      header: 'Top Model',
      cell: (info) => info.getValue() as string,
    }),
    // C40: renamed from Trend → 24h Tok/Hr
    helper.display({
      id: 'sparkline',
      header: '24h Tok/Hr',
      cell: ({ row }) => {
        const sparkData = row.original.spark ?? [row.original.tokens]
        // Tint by provider if hint available, fall back to severity color
        const sparkColor =
          (row.original.top_model_provider != null
            ? providerColorFor(row.original.top_model_provider)
            : null) ?? rowSeverityColor(row.original)
        return <Sparkline data={sparkData} color={sparkColor} />
      },
    }),
  ]

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: true,
  })

  return (
    <div
      className='repo-table-wrapper'
      style={{
        width: '100%',
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: '240px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        marginBottom: '8px',
      }}
    >
      <table
        aria-label='Repository usage breakdown'
        className='repo-table'
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'var(--card-2)',
            borderBottom: '1px solid rgba(245,158,11,0.25)',
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortDir = header.column.getIsSorted()
                const isSortable = header.column.getCanSort()
                let ariaSort: 'ascending' | 'descending' | 'none' | undefined
                if (isSortable) {
                  ariaSort =
                    sortDir === 'asc'
                      ? 'ascending'
                      : sortDir === 'desc'
                        ? 'descending'
                        : 'none'
                }

                /* 14-H.4: data-sort-dir drives CSS ::after pseudo (⇅/↑/↓ + amber) */
                const sortDirAttr =
                  sortDir === 'asc'
                    ? 'asc'
                    : sortDir === 'desc'
                      ? 'desc'
                      : undefined

                return (
                  <th
                    key={header.id}
                    aria-sort={ariaSort}
                    data-sortable={isSortable ? 'true' : undefined}
                    data-sort-dir={sortDirAttr}
                    onClick={
                      isSortable
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    style={{
                      padding: '4px 6px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--accent-chrome)',
                      background: 'var(--card-2)',
                      fontSize: '9px',
                      textTransform: 'uppercase',
                      // 14-F.3 incidental fix: corrected to 0.04em per mockup §14 audit
                      letterSpacing: '0.04em',
                      borderRight: '1px solid var(--border)',
                      borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              {row.getVisibleCells().map((cell, cellIdx) => {
                const isFirst = cellIdx === 0
                const isText =
                  cell.column.id === 'repository' ||
                  cell.column.id === 'top_model' ||
                  cell.column.id === 'sparkline'

                // 14-F.1: add .number class to numeric cells; .gutter-cool on first cell
                const tdClassName =
                  [
                    isFirst ? 'gutter-cool' : undefined,
                    !isText ? 'number' : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined

                return (
                  <td
                    key={cell.id}
                    className={tdClassName}
                    style={{
                      padding: '4px 6px',
                      fontFamily: 'var(--font-mono)',
                      color: isText ? 'var(--fg)' : 'var(--accent-cool)',
                      borderRight: '1px solid var(--border)',
                      // 14-F.3: always cool — gutter color from .gutter-cool class
                      borderLeft: isFirst ? '4px solid' : undefined,
                      paddingLeft: isFirst ? '6px' : undefined,
                      textAlign: isText ? 'left' : 'right',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
