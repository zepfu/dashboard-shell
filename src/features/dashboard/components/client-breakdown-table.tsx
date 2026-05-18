/**
 * ClientBreakdownTable — sortable TanStack Table for per-client usage.
 *
 * Renders a sticky-header, sortable table with Client, Version, Requests,
 * Tokens, and Cost columns. The Client <td> carries a data-client attribute
 * for testability and brand-colour lookups.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the client breakdown table. */
export interface ClientRow {
  client: string
  version: string
  requests: number
  tokens: number
  cost_usd: number
}

// ---------------------------------------------------------------------------
// Column helper
// ---------------------------------------------------------------------------

const helper = createColumnHelper<ClientRow>()

function numFmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columns: ColumnDef<ClientRow, unknown>[] = [
  {
    id: 'client',
    accessorKey: 'client',
    header: 'Client',
    cell: ({ row }) => (
      <span data-client={row.original.client}>{row.original.client}</span>
    ),
  },
  helper.accessor('version', {
    header: 'Version',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('requests', {
    header: 'Requests',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('tokens', {
    header: 'Tokens',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => `$${numFmt(info.getValue() as number, 4)}`,
  }),
]

// ---------------------------------------------------------------------------
// ClientBreakdownTable
// ---------------------------------------------------------------------------

export interface ClientBreakdownTableProps {
  rows: ClientRow[]
}

/**
 * ClientBreakdownTable renders a sortable sticky-header table of client
 * usage statistics with a data-client attribute on each client cell.
 */
export function ClientBreakdownTable({
  rows,
}: ClientBreakdownTableProps): ReactElement {
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
      className='client-table-wrapper'
      style={{
        width: '100%',
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: '160px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <table
        aria-label='Client usage breakdown'
        className='client-table'
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
              {row.getVisibleCells().map((cell) => {
                // Attach data-client to the <td> for the client column
                const isClientCol = cell.column.id === 'client'
                const isText =
                  cell.column.id === 'client' || cell.column.id === 'version'
                return (
                  <td
                    key={cell.id}
                    data-client={isClientCol ? row.original.client : undefined}
                    style={{
                      padding: '3px 6px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--fg)',
                      borderRight: '1px solid var(--border)',
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
