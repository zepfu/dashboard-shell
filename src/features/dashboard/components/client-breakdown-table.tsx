/**
 * ClientBreakdownTable — sortable TanStack Table for per-client usage.
 *
 * Renders a sticky-header, sortable table with Client, Version, Requests,
 * Tokens, Cost, and Sparkline columns. The Client <td> carries a data-client
 * attribute for testability and brand-colour lookups.
 *
 * Wave 11 PR6 (11-o):
 * - Client cells colored via CLIENT_BRAND_COLORS (C13).
 * - Metric-cell microbar overlays on Requests, Tokens, Cost (C14).
 * - New sparkline column at end, tinted by client brand color (C14).
 * - Amber uppercase thead with letter-spacing 0.05em.
 */
import { useMemo, useState, type ReactElement } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { CLIENT_BRAND_COLORS } from '../lib/client-brand-colors'
import { formatUsd } from '../lib/usage-report-display'
import { Sparkline } from './primitives/sparkline'

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
  /** Optional sparkline data points for trend column. */
  spark?: number[]
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
// Inline CSS — metric-cell / metric-microbar (idempotent if PR5 adds globally)
// ---------------------------------------------------------------------------

const METRIC_CELL_CSS = `
.metric-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
}
.metric-microbar {
  display: block;
  height: 2px;
  width: 100%;
  background: linear-gradient(
    to right,
    var(--accent-cool) 0%,
    var(--accent-cool) var(--fill, 0%),
    transparent var(--fill, 0%)
  );
  border-radius: 0;
  margin-top: 1px;
}
`

// ---------------------------------------------------------------------------
// ClientBreakdownTable
// ---------------------------------------------------------------------------

export interface ClientBreakdownTableProps {
  rows: ClientRow[]
}

/**
 * ClientBreakdownTable renders a sortable sticky-header table of client
 * usage statistics with brand-colored client cells, microbar overlays, and
 * a sparkline trend column.
 */
export function ClientBreakdownTable({
  rows,
}: ClientBreakdownTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  // Compute column-level maxima for microbar scaling
  const maxRequests = useMemo(
    () => Math.max(1, ...rows.map((r) => r.requests)),
    [rows]
  )
  const maxTokens = useMemo(
    () => Math.max(1, ...rows.map((r) => r.tokens)),
    [rows]
  )
  const maxCost = useMemo(
    () => Math.max(1, ...rows.map((r) => r.cost_usd)),
    [rows]
  )

  const columns = useMemo(
    () => [
      helper.display({
        id: 'client',
        header: 'Client',
        cell: ({ row }) => {
          const brandColor =
            CLIENT_BRAND_COLORS[row.original.client] ?? 'var(--fg)'
          return (
            <span
              data-client={row.original.client}
              style={{ color: brandColor }}
            >
              {row.original.client}
            </span>
          )
        },
      }),
      helper.accessor('version', {
        header: 'Version',
        cell: (info) => info.getValue() as string,
      }),
      helper.accessor('requests', {
        header: 'Requests',
        cell: (info) => {
          const val = info.getValue() as number
          const fillPct = (val / maxRequests) * 100
          return (
            <div className='metric-cell'>
              <span style={{ color: 'var(--accent-cool)' }}>{numFmt(val)}</span>
              <span
                className='metric-microbar'
                style={
                  {
                    '--fill': `${fillPct.toFixed(1)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        },
      }),
      helper.accessor('tokens', {
        header: 'Tokens',
        cell: (info) => {
          const val = info.getValue() as number
          const fillPct = (val / maxTokens) * 100
          return (
            <div className='metric-cell'>
              <span style={{ color: 'var(--accent-cool)' }}>{numFmt(val)}</span>
              <span
                className='metric-microbar'
                style={
                  {
                    '--fill': `${fillPct.toFixed(1)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        },
      }),
      helper.accessor('cost_usd', {
        header: 'Cost',
        cell: (info) => {
          const val = info.getValue() as number
          const fillPct = (val / maxCost) * 100
          const costColor =
            val > 5.0
              ? 'var(--accent-hot)'
              : val > 1.0
                ? 'var(--accent-warm)'
                : 'var(--accent-cool)'
          return (
            <div className='metric-cell'>
              <span style={{ color: costColor }}>{formatUsd(val)}</span>
              <span
                className='metric-microbar'
                style={
                  {
                    '--fill': `${fillPct.toFixed(1)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        },
      }),
      // Sparkline column — tinted by client brand color
      helper.display({
        id: 'sparkline',
        header: 'Trend',
        cell: ({ row }) => {
          const sparkData = row.original.spark ?? [row.original.tokens]
          const sparkColor =
            CLIENT_BRAND_COLORS[row.original.client] ?? 'var(--accent-cool)'
          return <Sparkline data={sparkData} color={sparkColor} />
        },
      }),
    ],
    [maxRequests, maxTokens, maxCost]
  )

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
    <>
      {/* Idempotent metric-cell CSS — safe if PR5 also emits globally */}
      <style>{METRIC_CELL_CSS}</style>
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
                        letterSpacing: '0.05em',
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
                      {sortDir === 'asc'
                        ? ' ↑'
                        : sortDir === 'desc'
                          ? ' ↓'
                          : ''}
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
                    cell.column.id === 'client' ||
                    cell.column.id === 'version' ||
                    cell.column.id === 'sparkline'
                  return (
                    <td
                      key={cell.id}
                      data-client={
                        isClientCol ? row.original.client : undefined
                      }
                      style={{
                        padding: '3px 6px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--fg)',
                        borderRight: '1px solid var(--border)',
                        textAlign: isText ? 'left' : 'right',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top',
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
