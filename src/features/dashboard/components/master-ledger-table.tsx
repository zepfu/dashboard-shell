/**
 * MasterLedgerTable — sortable TanStack Table for per-model usage metrics.
 *
 * Implements a full-width, sortable, sticky-header table with base columns,
 * 4K-responsive columns, 5K-responsive columns, and a sparkline column.
 * Column headers carry data-sortable and aria-sort attributes for
 * accessibility and testing.
 *
 * Wave 11 PR5 visual upgrades:
 * - Provider cell brand color via providerColorFor()
 * - Severity-derived first-cell gutter color per row
 * - Microbar overlays on numeric cells (Toks In/Out, Requests, Quota%)
 * - Cost/Err%/Quota% severity coloring
 * - Sparkline per-row tint from row severity
 * - tfoot removed (was off-by-N; audit C11)
 */
import { useState, useMemo, type ReactElement } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import {
  providerBrandHex,
  formatLatency,
  formatUsd,
} from '../lib/usage-report-display'
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
// Severity helpers
// ---------------------------------------------------------------------------

/**
 * Returns a CSS color variable string representing the severity of a row,
 * derived from error_pct, quota_pct, and cost_usd thresholds.
 */
function rowSeverityColor(row: ModelRow): string {
  if (row.error_pct >= 2) return 'var(--accent-hot)'
  if (row.error_pct >= 0.5) return 'var(--accent-warm)'
  if (row.quota_pct >= 75) return 'var(--accent-warm)'
  if (row.cost_usd >= 1) return 'var(--accent-teal)'
  return 'var(--accent-cool)'
}

/** Returns cost cell color based on cost_usd severity thresholds (C6). */
function costColor(cost: number): string {
  if (cost >= 5) return 'var(--accent-hot)'
  if (cost >= 1) return 'var(--accent-warm)'
  return 'var(--accent-cool)'
}

/** Returns error-pct cell color based on error_pct severity thresholds (C7). */
function errorPctColor(pct: number): string {
  if (pct >= 2) return 'var(--accent-hot)'
  if (pct >= 0.5) return 'var(--accent-warm)'
  return 'var(--accent-teal)'
}

/** Returns quota-pct cell color based on quota_pct severity thresholds (C8). */
function quotaPctColor(pct: number): string {
  if (pct >= 90) return 'var(--accent-hot)'
  if (pct >= 75) return 'var(--accent-warm)'
  return 'var(--accent-cool)'
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

const baseColumns = [
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
    cell: (info) => formatLatency(info.getValue() as number),
  }),
  helper.accessor('p95_ms', {
    header: 'p95ms',
    cell: (info) => formatLatency(info.getValue() as number),
  }),
  helper.accessor('error_pct', {
    header: 'Err%',
    cell: (info) => `${numFmt(info.getValue() as number, 1)}%`,
  }),
  helper.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => formatUsd(info.getValue() as number),
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

const fourKColumns = [
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

const fiveKColumns = [
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

const sparklineColumn = [
  {
    id: 'sparkline',
    header: 'Trend',
    enableSorting: false,
    // Cell rendering is handled in MasterLedgerTable body to access severity color
    cell: () => null,
  },
]

const allColumns = [
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
 * usage metrics with sticky header, responsive column classes, severity
 * coloring, microbar overlays, and per-row sparkline tinting.
 */
export function MasterLedgerTable({
  rows,
}: MasterLedgerTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  // Column maxes for microbar fill computation
  const maxTokensIn = useMemo(
    () => Math.max(1, ...rows.map((r) => r.tokens_in)),
    [rows]
  )
  const maxTokensOut = useMemo(
    () => Math.max(1, ...rows.map((r) => r.tokens_out)),
    [rows]
  )
  const maxRequests = useMemo(
    () => Math.max(1, ...rows.map((r) => r.requests)),
    [rows]
  )
  const maxQuotaPct = useMemo(
    () => Math.max(1, ...rows.map((r) => r.quota_pct)),
    [rows]
  )
  const maxCostUsd = useMemo(
    () => Math.max(1, ...rows.map((r) => r.cost_usd)),
    [rows]
  )

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

  return (
    <>
      {/* Inline styles for microbar overlay (C5) */}
      <style>{`
        .metric-cell { position: relative; }
        .metric-microbar {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 2px;
          width: var(--fill, 0%);
          background: currentColor;
          opacity: 0.4;
        }
      `}</style>

      <div
        className='table-wrapper'
        style={{
          width: '100%',
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: '400px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
        }}
      >
        <table
          aria-label='Model usage ledger'
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'clamp(11px, 0.6vw, 16px)',
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
                        padding: '6px 8px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: 'var(--accent-chrome)',
                        background: 'var(--card-2)',
                        fontSize: '10px',
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
            {table.getRowModel().rows.map((row) => {
              const orig = row.original
              const severityColor = rowSeverityColor(orig)
              // Wave 12 Fix 1: use reference brand hex for Provider column cell.
              // providerColorFor() returns legacy palette (blue/purple) which was
              // the false-fix in Wave 11 — swap to providerBrandHex() here.
              // providerColorFor() is still used for severity gutter (rowSeverityColor).
              const providerColor = providerBrandHex(orig.provider)

              return (
                <tr
                  key={row.id}
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  {row.getVisibleCells().map((cell, cellIdx) => {
                    const meta = cell.column.columnDef.meta as
                      | { className?: string }
                      | undefined
                    const colId = cell.column.id
                    const isFirst = cellIdx === 0

                    // Determine per-column styles
                    let cellColor: string
                    let cellContent: ReactElement | string

                    if (colId === 'provider') {
                      // C4: brand color for provider name
                      cellColor = providerColor
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else if (colId === 'cost_usd') {
                      // C6: cost severity color + microbar
                      cellColor = costColor(orig.cost_usd)
                      cellContent = (
                        <div
                          className='metric-cell'
                          style={{ position: 'relative' }}
                        >
                          <span>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </span>
                          <span
                            className='metric-microbar'
                            style={
                              {
                                '--fill': `${(orig.cost_usd / maxCostUsd) * 100}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      )
                    } else if (colId === 'error_pct') {
                      // C7: err% severity color
                      cellColor = errorPctColor(orig.error_pct)
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else if (colId === 'quota_pct') {
                      // C8: quota% severity color + microbar
                      cellColor = quotaPctColor(orig.quota_pct)
                      const fillPct = (orig.quota_pct / maxQuotaPct) * 100
                      cellContent = (
                        <div
                          className='metric-cell'
                          style={{ position: 'relative' }}
                        >
                          <span>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </span>
                          <span
                            className='metric-microbar'
                            style={
                              {
                                '--fill': `${fillPct}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      )
                    } else if (colId === 'tokens_in') {
                      // C5: microbar proportional to column max
                      cellColor = 'var(--accent-cool)'
                      const fillPct = (orig.tokens_in / maxTokensIn) * 100
                      cellContent = (
                        <div
                          className='metric-cell'
                          style={{ position: 'relative' }}
                        >
                          <span>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </span>
                          <span
                            className='metric-microbar'
                            style={
                              {
                                '--fill': `${fillPct}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      )
                    } else if (colId === 'tokens_out') {
                      // C5: microbar proportional to column max
                      cellColor = 'var(--accent-cool)'
                      const fillPct = (orig.tokens_out / maxTokensOut) * 100
                      cellContent = (
                        <div
                          className='metric-cell'
                          style={{ position: 'relative' }}
                        >
                          <span>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </span>
                          <span
                            className='metric-microbar'
                            style={
                              {
                                '--fill': `${fillPct}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      )
                    } else if (colId === 'requests') {
                      // C5: microbar proportional to column max
                      cellColor = 'var(--accent-cool)'
                      const fillPct = (orig.requests / maxRequests) * 100
                      cellContent = (
                        <div
                          className='metric-cell'
                          style={{ position: 'relative' }}
                        >
                          <span>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </span>
                          <span
                            className='metric-microbar'
                            style={
                              {
                                '--fill': `${fillPct}%`,
                              } as React.CSSProperties
                            }
                          />
                        </div>
                      )
                    } else if (colId === 'sparkline') {
                      // C9: sparkline tinted by row severity
                      cellColor = 'var(--fg)'
                      const sparkData = orig.spark ?? [orig.tokens_in]
                      cellContent = (
                        <Sparkline data={sparkData} color={severityColor} />
                      )
                    } else if (colId === 'model') {
                      // Model name: default foreground
                      cellColor = 'var(--fg)'
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else {
                      // Other numeric columns (p50ms, p95ms, $/1k, 4K/5K cols)
                      cellColor = 'var(--accent-cool)'
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    }

                    const isNumericAlign =
                      colId !== 'model' &&
                      colId !== 'provider' &&
                      colId !== 'sparkline'

                    return (
                      <td
                        key={cell.id}
                        className={meta?.className}
                        style={{
                          padding: '6px 8px',
                          fontFamily: 'var(--font-mono)',
                          color: cellColor,
                          borderRight: '1px solid var(--border)',
                          // C4: severity-derived gutter on first cell
                          borderLeft: isFirst
                            ? `4px solid ${severityColor}`
                            : undefined,
                          paddingLeft: isFirst ? '6px' : undefined,
                          textAlign: isNumericAlign ? 'right' : 'left',
                        }}
                      >
                        {cellContent}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
