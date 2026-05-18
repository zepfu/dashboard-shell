/**
 * RepoBreakdownTable — sortable TanStack Table for per-repository usage.
 *
 * Renders a sortable, sticky-header table with repository, token, cost,
 * request, top model, and sparkline columns. Follows the same patterns as
 * MasterLedgerTable: severity gutter on first cell, metric-cell microbars
 * on numeric columns, and provider-tinted sparkline.
 *
 * Wave 11 PR6 (11-n):
 * - Severity gutter on first cell — dynamic color based on row thresholds.
 * - Microbar overlays on Tokens, Cost, Requests columns.
 * - Provider-tinted sparkline via providerColorFor / rowSeverityColor.
 * - Column rename: Traces → Requests, Trend → 24h Tok/Hr.
 * - Amber uppercase thead with letter-spacing 0.05em.
 *
 * Wave 14-F refactor (14-F.3):
 * - Gutter locked to .gutter-cool (var(--accent-cool)) — mockup spec
 *   §14 line 1440: td:first-child { border-left: 4px solid var(--accent-cool) }
 * - metric-microbar → .microbar class (14-F.1 CSS class system)
 * - .number className added to numeric cells (14-F.1)
 * - th letter-spacing corrected to 0.04em (audit §14 deviation 2)
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
 * usage metrics with a uniform cool-blue gutter (14-F.3), microbar overlays
 * via .microbar class (14-F.1), and a tinted sparkline trend column.
 */
export function RepoBreakdownTable({
  rows,
}: RepoBreakdownTableProps): ReactElement {
  const [sorting, setSorting] = useState<SortingState>([])

  // Compute column-level maxima for microbar scaling
  const maxTokens = useMemo(
    () => Math.max(1, ...rows.map((r) => r.tokens)),
    [rows]
  )
  const maxCost = useMemo(
    () => Math.max(1, ...rows.map((r) => r.cost_usd)),
    [rows]
  )
  const maxTraces = useMemo(
    () => Math.max(1, ...rows.map((r) => r.traces)),
    [rows]
  )

  const columns = useMemo(
    () => [
      helper.accessor('repository', {
        header: 'Repository',
        cell: (info) => info.getValue() as string,
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
                className='microbar'
                style={
                  {
                    '--microbar-fill': `${fillPct.toFixed(1)}%`,
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
            val > 1.0
              ? 'var(--accent-hot)'
              : val > 0.5
                ? 'var(--accent-warm)'
                : 'var(--accent-cool)'
          return (
            <div className='metric-cell'>
              <span style={{ color: costColor }}>{formatUsd(val)}</span>
              <span
                className='microbar'
                style={
                  {
                    '--microbar-fill': `${fillPct.toFixed(1)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        },
      }),
      // C40: renamed from Traces → Requests
      helper.accessor('traces', {
        header: 'Requests',
        cell: (info) => {
          const val = info.getValue() as number
          const fillPct = (val / maxTraces) * 100
          return (
            <div className='metric-cell'>
              <span style={{ color: 'var(--accent-cool)' }}>{numFmt(val)}</span>
              <span
                className='microbar'
                style={
                  {
                    '--microbar-fill': `${fillPct.toFixed(1)}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          )
        },
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
    ],
    [maxTokens, maxCost, maxTraces]
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
