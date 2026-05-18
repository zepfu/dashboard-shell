/**
 * RepoBreakdownTable — sortable TanStack Table for per-repository usage.
 *
 * Renders a sortable, sticky-header table with repository, token, cost,
 * trace, top model, and sparkline columns. Follows the same patterns as
 * MasterLedgerTable but with a simpler 6-column schema.
 */
import { useState, type ReactElement } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { Sparkline } from './primitives/sparkline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the repository breakdown table. */
export interface RepoRow {
  repository: string
  tokens: number
  cost_usd: number
  traces: number
  top_model: string
  spark?: number[]
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
// Column definitions
// ---------------------------------------------------------------------------

const columns: ColumnDef<RepoRow, unknown>[] = [
  helper.accessor('repository', {
    header: 'Repository',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('tokens', {
    header: 'Tokens',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => `$${numFmt(info.getValue() as number, 4)}`,
  }),
  helper.accessor('traces', {
    header: 'Traces',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('top_model', {
    header: 'Top Model',
    cell: (info) => info.getValue() as string,
  }),
  {
    id: 'sparkline',
    header: 'Trend',
    enableSorting: false,
    cell: ({ row }) => {
      const data = row.original.spark ?? [row.original.tokens]
      return <Sparkline data={data} color='var(--accent-cool)' />
    },
  },
]

// ---------------------------------------------------------------------------
// RepoBreakdownTable
// ---------------------------------------------------------------------------

export interface RepoBreakdownTableProps {
  rows: RepoRow[]
}

/**
 * RepoBreakdownTable renders a sortable, sticky-header table of repository
 * usage metrics with sparkline trend column.
 */
export function RepoBreakdownTable({
  rows,
}: RepoBreakdownTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

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

                return (
                  <th
                    key={header.id}
                    aria-sort={ariaSort}
                    data-sortable={isSortable ? 'true' : undefined}
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
                      letterSpacing: '0.04em',
                      borderRight: '1px solid var(--border)',
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    {sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : ''}
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
                return (
                  <td
                    key={cell.id}
                    style={{
                      padding: '4px 6px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--fg)',
                      borderRight: '1px solid var(--border)',
                      borderLeft: isFirst
                        ? '4px solid var(--accent-cool)'
                        : undefined,
                      paddingLeft: isFirst ? '6px' : undefined,
                      textAlign: isText ? 'left' : 'right',
                      whiteSpace: 'nowrap',
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
