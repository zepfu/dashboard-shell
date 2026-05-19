/**
 * ClientBreakdownTable — sortable TanStack Table for per-client usage.
 *
 * Renders a sticky-header, sortable table with exactly 6 columns per spec:
 * Client, Version, First Seen, Requests, Tokens, Cost. The Client <td> carries
 * a data-client attribute for testability and brand-colour lookups.
 *
 * Wave 11 PR6 (11-o):
 * - Client cells colored via CLIENT_BRAND_COLORS (C13).
 * - Amber uppercase thead with letter-spacing 0.05em.
 *
 * Wave 14-F refactor:
 * - .number className added to numeric td cells (14-F.1)
 * - th letter-spacing corrected to 0.04em (audit §15 deviation 9)
 * - Client section grid 120px 1fr at ≥1600px handled via index.css .client-section
 *   media query (14-F.4 — parent wrapper in phosphor-dashboard.tsx out of scope)
 *
 * Wave 18-Tables (§6.1 / §6.2):
 * - Removed extra Trend/sparkline column — spec is 5 cols.
 * - Removed metric-cell/microbar wrappers from Requests, Tokens, Cost — spec
 *   renders plain numeric <td> values with neutral fg color.
 *
 * Wave 31:
 * - Added "First Seen" column (between Version and Requests) wired from
 *   first_seen_at API field, formatted as YYYY-MM-DD.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row in the client breakdown table. */
export interface ClientRow {
  client: string
  version: string
  /** W31: date the client was first seen, formatted YYYY-MM-DD. Empty string when unknown. */
  first_seen?: string
  requests: number
  tokens: number
  cost_usd: number
  /** W25: provider/family color from buildClientRows; preferred over legacy CLIENT_BRAND_COLORS lookup. */
  color?: string
  /** W25: family name (claude code, codex, gemini, grok build) for filtering / future use. */
  family?: string
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
// ClientBreakdownTable
// ---------------------------------------------------------------------------

export interface ClientBreakdownTableProps {
  rows: ClientRow[]
}

/**
 * ClientBreakdownTable renders a sortable sticky-header table of client usage
 * statistics with brand-colored client cells and 6 columns per spec:
 * Client, Version, First Seen, Requests, Tokens, Cost (§6.1 — no sparkline).
 * Numeric cells are plain values without microbar overlays (§6.2).
 */
export function ClientBreakdownTable({
  rows,
}: ClientBreakdownTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  // §6.1: 6 columns — Client, Version, First Seen, Requests, Tokens, Cost.
  // §6.2: no microbars on any numeric cell (plain <td> per mockup L3264-3266).
  // Sparkline/Trend column removed entirely.
  // W31: "First Seen" inserted between Version and Requests, sorted by ISO string.
  const columns = useMemo(
    () => [
      helper.display({
        id: 'client',
        header: 'Client',
        cell: ({ row }) => {
          const brandColor =
            row.original.color ??
            CLIENT_BRAND_COLORS[row.original.client] ??
            'var(--fg)'
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
      // W31: "First Seen" column — YYYY-MM-DD compact date, sorted ASC (oldest first)
      // by ISO string comparison. sortDescFirst is overridden to false so clicking
      // the header starts ascending (oldest client first).
      helper.accessor('first_seen', {
        header: 'First Seen',
        sortDescFirst: false,
        sortUndefined: 1,
        cell: (info) => (info.getValue() as string | undefined) ?? '',
      }),
      // §6.2: plain numeric value — no metric-cell/microbar wrapper
      helper.accessor('requests', {
        header: 'Requests',
        cell: (info) => numFmt(info.getValue() as number),
      }),
      // §6.2: plain numeric value — no metric-cell/microbar wrapper
      helper.accessor('tokens', {
        header: 'Tokens',
        cell: (info) => numFmt(info.getValue() as number),
      }),
      // §6.2: plain numeric value, neutral color — no metric-cell/microbar/severity
      helper.accessor('cost_usd', {
        header: 'Cost',
        cell: (info) => formatUsd(info.getValue() as number),
      }),
    ],
    []
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
                      // 14-F audit §15 fix: 0.05em → 0.04em per mockup spec
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
              {row.getVisibleCells().map((cell) => {
                // Attach data-client to the <td> for the client column
                const isClientCol = cell.column.id === 'client'
                // Text columns (left-aligned, no .number class): client, version, first_seen
                const isText =
                  cell.column.id === 'client' ||
                  cell.column.id === 'version' ||
                  cell.column.id === 'first_seen'

                // 14-F.1: .number className on numeric cells
                const tdClassName = !isText ? 'number' : undefined

                return (
                  <td
                    key={cell.id}
                    className={tdClassName}
                    data-client={isClientCol ? row.original.client : undefined}
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
