/**
 * MasterLedgerTable — sortable TanStack Table for per-model usage metrics.
 *
 * Implements a full-width, sortable, sticky-header table with base columns,
 * 4K-responsive columns, 5K-responsive columns, and a sparkline column.
 * A tfoot row shows aggregate totals. Column headers carry data-sortable and
 * aria-sort attributes for accessibility and testing.
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

/** One row in the master ledger table. */
export interface ModelRow {
  model: string
  provider: string
  tokens_in: number
  tokens_out: number
  requests: number
  p50_ms: number
  p95_ms: number
  error_pct: number
  cost_usd: number
  cost_per_1k: number
  quota_pct: number
  // 4K-only optional fields
  cost_per_1k_in?: number
  cost_per_1k_out?: number
  cache_pct?: number
  queue?: number
  resets?: number
  // 5K-only optional fields
  tool?: number
  git_commits?: number
  git_pushes?: number
  inval?: number
  // Sparkline data
  spark?: number[]
}

// ---------------------------------------------------------------------------
// Column helper
// ---------------------------------------------------------------------------

const helper = createColumnHelper<ModelRow>()

function numFmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const baseColumns: ColumnDef<ModelRow, unknown>[] = [
  helper.accessor('model', {
    header: 'Model',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('provider', {
    header: 'Provider',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('tokens_in', {
    header: 'Toks In',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('tokens_out', {
    header: 'Toks Out',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('requests', {
    header: 'Requests',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('p50_ms', {
    header: 'p50ms',
    cell: (info) => `${numFmt(info.getValue() as number)}ms`,
  }),
  helper.accessor('p95_ms', {
    header: 'p95ms',
    cell: (info) => `${numFmt(info.getValue() as number)}ms`,
  }),
  helper.accessor('error_pct', {
    header: 'Err%',
    cell: (info) => `${numFmt(info.getValue() as number, 1)}%`,
  }),
  helper.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => `$${numFmt(info.getValue() as number, 4)}`,
  }),
  helper.accessor('cost_per_1k', {
    header: '$/1k',
    cell: (info) => `$${numFmt(info.getValue() as number, 4)}`,
  }),
  helper.accessor('quota_pct', {
    header: 'Quota%',
    cell: (info) => `${numFmt(info.getValue() as number, 1)}%`,
  }),
]

const fourKColumns: ColumnDef<ModelRow, unknown>[] = [
  helper.accessor('cost_per_1k_in', {
    id: 'cost_per_1k_in',
    header: '$/1k In',
    meta: { className: 'col-4k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? `$${numFmt(v, 4)}` : '—'
    },
  }),
  helper.accessor('cost_per_1k_out', {
    id: 'cost_per_1k_out',
    header: '$/1k Out',
    meta: { className: 'col-4k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? `$${numFmt(v, 4)}` : '—'
    },
  }),
  helper.accessor('cache_pct', {
    id: 'cache_pct',
    header: 'Cache%',
    meta: { className: 'col-4k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? `${numFmt(v, 1)}%` : '—'
    },
  }),
  helper.accessor('queue', {
    id: 'queue',
    header: 'Queue',
    meta: { className: 'col-4k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
  helper.accessor('resets', {
    id: 'resets',
    header: 'Resets',
    meta: { className: 'col-4k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
]

const fiveKColumns: ColumnDef<ModelRow, unknown>[] = [
  helper.accessor('tool', {
    id: 'tool',
    header: 'TOOL',
    meta: { className: 'col-5k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
  helper.accessor('git_commits', {
    id: 'git_commits',
    header: 'GIT commits',
    meta: { className: 'col-5k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
  helper.accessor('git_pushes', {
    id: 'git_pushes',
    header: 'GIT pushes',
    meta: { className: 'col-5k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
  helper.accessor('inval', {
    id: 'inval',
    header: 'INVAL',
    meta: { className: 'col-5k-only' },
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
]

const sparklineColumn: ColumnDef<ModelRow, unknown>[] = [
  {
    id: 'sparkline',
    header: 'Trend',
    enableSorting: false,
    cell: ({ row }) => {
      const data = row.original.spark ?? [row.original.tokens_in]
      return <Sparkline data={data} color='var(--accent-cool)' />
    },
  },
]

const allColumns: ColumnDef<ModelRow, unknown>[] = [
  ...baseColumns,
  ...fourKColumns,
  ...fiveKColumns,
  ...sparklineColumn,
]

// ---------------------------------------------------------------------------
// MasterLedgerTable
// ---------------------------------------------------------------------------

export interface MasterLedgerTableProps {
  rows: ModelRow[]
}

/**
 * MasterLedgerTable renders a sortable, responsive TanStack Table for model
 * usage metrics with sticky header, responsive column classes, and sparklines.
 */
export function MasterLedgerTable({
  rows,
}: MasterLedgerTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data: rows,
    columns: allColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Sort descending first so highest values appear at top on first click
    sortDescFirst: true,
  })

  // Compute totals for tfoot
  const totalTokensIn = rows.reduce((s, r) => s + r.tokens_in, 0)
  const totalTokensOut = rows.reduce((s, r) => s + r.tokens_out, 0)
  const totalRequests = rows.reduce((s, r) => s + r.requests, 0)
  const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0)

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table
        aria-label='Model usage ledger'
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '11px',
          fontFamily: 'inherit',
        }}
      >
        <thead
          style={{
            position: 'sticky',
            top: 0,
            background: 'var(--card)',
            zIndex: 1,
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortDir = header.column.getIsSorted()
                const isSortable = header.column.getCanSort()

                // Determine aria-sort value
                let ariaSort: 'ascending' | 'descending' | 'none' | undefined
                if (isSortable) {
                  ariaSort =
                    sortDir === 'asc'
                      ? 'ascending'
                      : sortDir === 'desc'
                        ? 'descending'
                        : 'none'
                }

                const meta = header.column.columnDef.meta as
                  | { className?: string }
                  | undefined

                return (
                  <th
                    key={header.id}
                    className={meta?.className}
                    aria-sort={ariaSort}
                    data-sortable={isSortable ? 'true' : undefined}
                    onClick={
                      isSortable
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    style={{
                      padding: '4px 8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      color: 'var(--fg-muted)',
                      borderBottom: '1px solid var(--border)',
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
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as
                  | { className?: string }
                  | undefined
                return (
                  <td
                    key={cell.id}
                    className={meta?.className}
                    style={{
                      padding: '4px 8px',
                      fontFamily:
                        cell.column.id !== 'model' &&
                        cell.column.id !== 'provider' &&
                        cell.column.id !== 'sparkline'
                          ? 'monospace'
                          : 'inherit',
                      color: 'var(--fg)',
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr
            style={{
              borderTop: '2px solid var(--border)',
              fontWeight: 600,
              background: 'var(--card-2)',
            }}
          >
            <td style={{ padding: '4px 8px' }}>Totals</td>
            <td style={{ padding: '4px 8px' }} />
            <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
              {numFmt(totalTokensIn)}
            </td>
            <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
              {numFmt(totalTokensOut)}
            </td>
            <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
              {numFmt(totalRequests)}
            </td>
            {/* Remaining base + 4K + 5K + sparkline cells */}
            {Array.from({
              length: allColumns.length - 5,
            }).map((_, i) => (
              <td key={i} style={{ padding: '4px 8px' }}>
                {i === 3 ? `$${numFmt(totalCost, 4)}` : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
