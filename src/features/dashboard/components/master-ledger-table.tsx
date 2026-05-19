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
 *
 * Wave 14-F refactor:
 * - gutter color via .gutter-{hot,warm,teal,cool} CSS classes (14-F.2)
 * - .number className on numeric cells (14-F.1)
 * - .microbar class replacing .metric-microbar (14-F.1)
 *
 * Wave 18-Tables (§2.16 / §2.17 / §2.18):
 * - Sparkline column header renamed Trend → 24h Tok/Hr (§2.18 / mockup L2844).
 * - Quota% moved to col 16 (after fourKColumns, before sparkline) per spec
 *   mockup L2843 (§2.16). Previously at col 11 in baseColumns.
 * - Sparkline (24h Tok/Hr) moved to col 17 (before fiveKColumns) per spec
 *   mockup L2844 (§2.17). Previously last at col 21.
 *
 * Wave 29 Fix #7:
 * - Requests moved up to col 3 (right after Provider).
 * - reasoning_reported + reasoning_estimated consolidated into single "Reasoning"
 *   column (col 8). Sorts on combined value. Estimated shown as "(+N*)" suffix
 *   only when reasoning_estimated > 0.
 *
 * Wave 30 operator reorder:
 * - Columns reordered per operator spec.
 * - New "Cache toks" column added at position 6 (cache_input + cache_creation).
 * - Cache miss $, Reasoning moved up before latency columns.
 * - Cache Miss % relocated after $/1k (cost group).
 * - 24h Tok/Hr sparkline moved to last position.
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
import { type UsageReportProviderErrorObservationRow } from '../api/usage-report'
import {
  providerBrandHex,
  formatLatency,
  formatUsd,
} from '../lib/usage-report-display'
import { HoverTooltip } from './primitives/hover-tooltip'
import { Sparkline } from './primitives/sparkline'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Re-export of the API error observation type under a short name for
 * internal use.  The canonical definition lives in `../api/usage-report`.
 */
export type ProviderErrorObservation = UsageReportProviderErrorObservationRow

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
  // 4K-only optional fields
  cost_per_1k_in?: number
  cost_per_1k_out?: number
  cache_pct?: number
  queue?: number
  resets?: number
  // Wave 26 — new cache/reasoning columns (operator F#12)
  /** Percentage of cache misses relative to total tokens (0–100). */
  cache_miss_pct?: number
  /** Dollar cost attributed to cache misses. */
  cache_miss_usd_cost?: number
  /** Reasoning tokens as reported by the provider. */
  reasoning_reported?: number
  /** Reasoning tokens estimated (may be approximate). */
  reasoning_estimated?: number
  // Wave 30 operator reorder — total cache tokens (cache_input + cache_creation)
  /** Total cache tokens used: token_cache_input + token_cache_creation. */
  cache_toks?: number
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
 * Returns the CSS gutter class name representing the severity of a row,
 * derived from error_pct and cost_usd thresholds.
 *
 * 14-F.2: Maps severity to .gutter-* class names from the Wave 14-F CSS
 * class system instead of inline color values.
 *
 * Wave 26 (F#13): quota_pct removed; severity now based on error_pct + cost.
 */
function rowSeverityClass(row: ModelRow): string {
  if (row.error_pct >= 2) return 'gutter-hot'
  if (row.error_pct >= 0.5) return 'gutter-warm'
  if (row.cost_usd >= 1) return 'gutter-teal'
  return 'gutter-cool'
}

/**
 * Returns the CSS color variable for sparkline tinting (still needed for
 * Sparkline color prop which accepts a color string, not a class name).
 *
 * Wave 26 (F#13): quota_pct removed from severity computation.
 */
function rowSeverityColor(row: ModelRow): string {
  if (row.error_pct >= 2) return 'var(--accent-hot)'
  if (row.error_pct >= 0.5) return 'var(--accent-warm)'
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

/** Maximum number of recent error events shown in the Err% hover tooltip. */
const MAX_ERROR_HOVER_ROWS = 10

/**
 * Formats an ISO timestamp as a compact "N ago" string for the error hover
 * tooltip.  Returns `'—'` for null/invalid inputs.
 *
 * Q8 (Wave 31): used to show how long ago each error observation occurred in
 * the Model Ledger Err% hover panel.
 */
function formatObservedAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return '—'
    const diffMs = Date.now() - date.getTime()
    if (diffMs < 0) return 'just now'
    const totalMins = Math.floor(diffMs / 60_000)
    const days = Math.floor(totalMins / 1440)
    const hours = Math.floor((totalMins % 1440) / 60)
    const mins = totalMins % 60
    if (days > 0) return `${days.toString()}d ${hours.toString()}h ago`
    if (hours > 0) return `${hours.toString()}h ${mins.toString()}m ago`
    if (mins > 0) return `${mins.toString()}m ago`
    return 'just now'
  } catch {
    return '—'
  }
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

/**
 * Compact B/M/K formatter for token counts (operator F#12).
 *
 * Thresholds: ≥1e9 → B, ≥1e6 → M, ≥1e3 → K, else as-is.
 */
function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Percent formatter: renders a ratio (0–100) as "XX.X%".
 * Used for cache_miss_pct column (operator F#12).
 */
function formatPercent(pct: number): string {
  return `${pct.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

// Wave 30 operator-specified column order (24 columns):
//   1.  Model
//   2.  Provider
//   3.  Requests
//   4.  Toks In
//   5.  Toks Out
//   6.  Cache toks  ← NEW (cache_input + cache_creation)
//   7.  Cache Miss $
//   8.  Reasoning
//   9.  p50ms
//   10. p95ms
//   11. Err%
//   12. Cost
//   13. $/1k
//   14. Cache Miss %
//   15. $/1k In    (col-4k-only)
//   16. $/1k Out   (col-4k-only)
//   17. Cache%     (col-4k-only)
//   18. Queue      (col-4k-only)
//   19. Resets     (col-4k-only)
//   20. TOOL       (col-5k-only)
//   21. GIT commits (col-5k-only)
//   22. GIT pushes (col-5k-only)
//   23. INVAL      (col-5k-only)
//   24. 24h Tok/Hr (sparkline, last)

// Cols 1–5: identity + volume
const baseVolumeColumns = [
  helper.accessor('model', {
    header: 'Model',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('provider', {
    header: 'Provider',
    cell: (info) => info.getValue() as string,
  }),
  helper.accessor('requests', {
    header: 'Requests',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('tokens_in', {
    header: 'Toks In',
    cell: (info) => numFmt(info.getValue() as number),
  }),
  helper.accessor('tokens_out', {
    header: 'Toks Out',
    cell: (info) => numFmt(info.getValue() as number),
  }),
]

// Col 6: Cache toks — NEW (token_cache_input + token_cache_creation)
// Sortable numeric descending (same behaviour as Toks In/Out).
const cacheToksColumn = [
  helper.accessor('cache_toks', {
    id: 'cache_toks',
    header: 'Cache toks',
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? numFmt(v) : '—'
    },
  }),
]

// Cols 7–8: Cache Miss $ + Reasoning (moved up before latency)
// Wave 26 — cache/reasoning columns (operator F#12, F#13).
// Wave 29 Fix #7: reasoning_reported + reasoning_estimated consolidated into
// a single "Reasoning" column. Sorts on combined value. Estimated shown as
// "(+N*)" suffix only when reasoning_estimated > 0.
const cacheMissDollarAndReasoningColumns = [
  helper.accessor('cache_miss_usd_cost', {
    id: 'cache_miss_usd_cost',
    header: 'Cache Miss $',
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? formatUsd(v) : '—'
    },
  }),
  // Consolidated Reasoning column: reported + estimated in one cell.
  // sortingFn uses combined value (reported + estimated).
  helper.display({
    id: 'reasoning',
    header: 'Reasoning',
    enableSorting: true,
    sortingFn: (rowA, rowB) => {
      const sumA =
        (rowA.original.reasoning_reported ?? 0) +
        (rowA.original.reasoning_estimated ?? 0)
      const sumB =
        (rowB.original.reasoning_reported ?? 0) +
        (rowB.original.reasoning_estimated ?? 0)
      return sumA - sumB
    },
    cell: ({ row }) => {
      const reported = row.original.reasoning_reported
      const estimated = row.original.reasoning_estimated
      if (reported === undefined && estimated === undefined) return '—'
      const reportedStr = fmtCompact(reported ?? 0)
      if ((estimated ?? 0) > 0) {
        return (
          <>
            {reportedStr}
            {' ('}
            {`+${fmtCompact(estimated ?? 0)}`}
            <sup>*</sup>
            {')'}
          </>
        )
      }
      return reportedStr
    },
  }),
]

// Cols 9–13: latency + error + cost group
const latencyCostColumns = [
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
]

// Col 14: Cache Miss % — stays in cost group (relocated from col 11)
const cacheMissPctColumn = [
  helper.accessor('cache_miss_pct', {
    id: 'cache_miss_pct',
    header: 'Cache Miss %',
    cell: (info) => {
      const v = info.getValue() as number | undefined
      return v !== undefined ? formatPercent(v) : '—'
    },
  }),
]

// Cols 15–19: 4K-only columns
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

// Cols 20–23: 5K-only columns
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

// Col 24: sparkline — last per Wave 30 operator spec
const sparklineColumn = [
  {
    id: 'sparkline',
    header: '24h Tok/Hr',
    enableSorting: false,
    // Cell rendering is handled in MasterLedgerTable body to access severity color
    cell: () => null,
  },
]

// Wave 30 column order (operator-specified, 24 columns):
//   baseVolumeColumns (1–5: Model, Provider, Requests, Toks In, Toks Out)
//   → cacheToksColumn (6: Cache toks)
//   → cacheMissDollarAndReasoningColumns (7–8: Cache Miss $, Reasoning)
//   → latencyCostColumns (9–13: p50ms, p95ms, Err%, Cost, $/1k)
//   → cacheMissPctColumn (14: Cache Miss %)
//   → fourKColumns (15–19: $/1k In, $/1k Out, Cache%, Queue, Resets; col-4k-only)
//   → fiveKColumns (20–23: TOOL, GIT commits, GIT pushes, INVAL; col-5k-only)
//   → sparklineColumn (24: 24h Tok/Hr)
const allColumns = [
  ...baseVolumeColumns,
  ...cacheToksColumn,
  ...cacheMissDollarAndReasoningColumns,
  ...latencyCostColumns,
  ...cacheMissPctColumn,
  ...fourKColumns,
  ...fiveKColumns,
  ...sparklineColumn,
]

// ---------------------------------------------------------------------------
// MasterLedgerTable
// ---------------------------------------------------------------------------

export interface MasterLedgerTableProps {
  rows: ModelRow[]
  /**
   * Raw per-event error observations from the API (`report.providerErrorObservations`).
   * When provided, non-zero Err% cells will show a hover tooltip listing the
   * most recent matching events for that row's provider+model pair.
   *
   * Q8 (Wave 31): wired from `PhosphorDashboard` → `report?.providerErrorObservations`.
   */
  errorObservations?: ProviderErrorObservation[]
}

/**
 * MasterLedgerTable renders a sortable, responsive TanStack Table for model
 * usage metrics with sticky header, responsive column classes, severity
 * coloring, microbar overlays, and per-row sparkline tinting.
 *
 * Wave 20-Tables (F5): caption rendered from inside the component.
 * Wave 29 Fix #9: caption removed per operator direction.
 */
export function MasterLedgerTable({
  rows,
  errorObservations = [],
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
  const maxCostUsd = useMemo(
    () => Math.max(1, ...rows.map((r) => r.cost_usd)),
    [rows]
  )
  const maxCacheToks = useMemo(
    () => Math.max(1, ...rows.map((r) => r.cache_toks ?? 0)),
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

                /* 14-H.4: data-sort-dir drives CSS ::after pseudo (⇅/↑/↓ + amber)
                   per mockup lines 2234-2255. Inline glyph removed. */
                const sortDirAttr =
                  sortDir === 'asc'
                    ? 'asc'
                    : sortDir === 'desc'
                      ? 'desc'
                      : undefined

                return (
                  <th
                    key={header.id}
                    className={meta?.className}
                    aria-sort={ariaSort}
                    data-sortable={isSortable ? 'true' : undefined}
                    data-sort-dir={sortDirAttr}
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
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => {
            const orig = row.original
            const gutterClass = rowSeverityClass(orig)
            const severityColor = rowSeverityColor(orig)
            // Wave 12 Fix 1: use reference brand hex for Provider column cell.
            // providerColorFor() returns legacy palette (blue/purple) which was
            // the false-fix in Wave 11 — swap to providerBrandHex() here.
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
                    // C6: cost severity color + microbar (14-F.1 .microbar class)
                    cellColor = costColor(orig.cost_usd)
                    const fillPct = (orig.cost_usd / maxCostUsd) * 100
                    cellContent = (
                      <div className='metric-cell'>
                        <span>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                        <span
                          className='microbar'
                          title={`${fillPct.toFixed(1)}% of max cost`}
                          aria-label={`${fillPct.toFixed(1)}% of max cost`}
                          style={
                            {
                              '--microbar-fill': `${fillPct.toFixed(1)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                    )
                  } else if (colId === 'error_pct') {
                    // C7: err% severity color
                    cellColor = errorPctColor(orig.error_pct)
                    const pct = orig.error_pct
                    const rowProvider = orig.provider.toLowerCase()
                    const rowModel = orig.model.toLowerCase()
                    // Q8 (Wave 31): filter observations to this row's provider+model,
                    // sort newest-first and cap at MAX_ERROR_HOVER_ROWS.
                    const rowObs =
                      pct > 0
                        ? errorObservations
                            .filter(
                              (o) =>
                                o.provider.toLowerCase() === rowProvider &&
                                o.model.toLowerCase() === rowModel
                            )
                            .sort((a, b) => {
                              const aMs = a.observed_at
                                ? new Date(a.observed_at).getTime()
                                : 0
                              const bMs = b.observed_at
                                ? new Date(b.observed_at).getTime()
                                : 0
                              return bMs - aMs
                            })
                            .slice(0, MAX_ERROR_HOVER_ROWS)
                        : []
                    const baseLabel = flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext()
                    ) as ReactElement | string
                    if (pct > 0 && rowObs.length > 0) {
                      const tooltipContent = (
                        <div>
                          <div
                            className='v9-tip-head'
                            style={{ marginBottom: '4px' }}
                          >
                            {rowObs.length} most recent error
                            {rowObs.length === 1 ? '' : 's'}:
                          </div>
                          {rowObs.map((e, idx) => (
                            <div
                              key={`${e.observed_at ?? 'null'}-${(e.status_code ?? 0).toString()}-${e.error_class}-${idx.toString()}`}
                              style={{
                                fontSize: '9px',
                                padding: '1px 0',
                                lineHeight: 1.5,
                                color: 'var(--fg, #e2e8f0)',
                              }}
                            >
                              {formatObservedAgo(e.observed_at)}
                              {' · '}
                              {e.status_code !== null
                                ? e.status_code.toString()
                                : '???'}{' '}
                              {e.error_class} ({e.error_code})
                            </div>
                          ))}
                        </div>
                      )
                      cellContent = (
                        <HoverTooltip content={tooltipContent}>
                          {baseLabel}
                        </HoverTooltip>
                      )
                    } else {
                      cellContent = baseLabel
                    }
                  } else if (colId === 'tokens_in') {
                    // C5: microbar proportional to column max (14-F.1 .microbar class)
                    cellColor = 'var(--accent-cool)'
                    const fillPct = (orig.tokens_in / maxTokensIn) * 100
                    cellContent = (
                      <div className='metric-cell'>
                        <span>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                        <span
                          className='microbar'
                          title={`${fillPct.toFixed(1)}% of max tokens in`}
                          aria-label={`${fillPct.toFixed(1)}% of max tokens in`}
                          style={
                            {
                              '--microbar-fill': `${fillPct.toFixed(1)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                    )
                  } else if (colId === 'tokens_out') {
                    // C5: microbar proportional to column max (14-F.1 .microbar class)
                    cellColor = 'var(--accent-cool)'
                    const fillPct = (orig.tokens_out / maxTokensOut) * 100
                    cellContent = (
                      <div className='metric-cell'>
                        <span>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                        <span
                          className='microbar'
                          title={`${fillPct.toFixed(1)}% of max tokens out`}
                          aria-label={`${fillPct.toFixed(1)}% of max tokens out`}
                          style={
                            {
                              '--microbar-fill': `${fillPct.toFixed(1)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                    )
                  } else if (colId === 'cache_toks') {
                    // ⚠9 fix: microbar proportional to column max (matching sibling token columns)
                    cellColor = 'var(--accent-cool)'
                    const fillPct =
                      ((orig.cache_toks ?? 0) / maxCacheToks) * 100
                    cellContent = (
                      <div className='metric-cell'>
                        <span>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                        <span
                          className='microbar'
                          title={`${fillPct.toFixed(1)}% of max cache toks`}
                          aria-label={`${fillPct.toFixed(1)}% of max cache toks`}
                          style={
                            {
                              '--microbar-fill': `${fillPct.toFixed(1)}%`,
                            } as React.CSSProperties
                          }
                        />
                      </div>
                    )
                  } else if (colId === 'requests') {
                    // C5: microbar proportional to column max (14-F.1 .microbar class)
                    cellColor = 'var(--accent-cool)'
                    const fillPct = (orig.requests / maxRequests) * 100
                    cellContent = (
                      <div className='metric-cell'>
                        <span>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </span>
                        <span
                          className='microbar'
                          title={`${fillPct.toFixed(1)}% of max requests`}
                          aria-label={`${fillPct.toFixed(1)}% of max requests`}
                          style={
                            {
                              '--microbar-fill': `${fillPct.toFixed(1)}%`,
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

                  // 14-F.1: add .number class to numeric cells for CSS class system parity
                  const isNumericCell =
                    colId !== 'model' &&
                    colId !== 'provider' &&
                    colId !== 'sparkline'

                  // Build className: meta class + optional gutter class + optional number class
                  const tdClassName =
                    [
                      meta?.className,
                      isFirst ? gutterClass : undefined,
                      isNumericCell ? 'number' : undefined,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined

                  return (
                    <td
                      key={cell.id}
                      className={tdClassName}
                      style={{
                        padding: '6px 8px',
                        fontFamily: 'var(--font-mono)',
                        color: cellColor,
                        borderRight: '1px solid var(--border)',
                        // 14-F.2: gutter now applied via .gutter-* class; keep borderLeft
                        // for the 4px solid base with inherited color from class
                        borderLeft: isFirst ? '4px solid' : undefined,
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
  )
}
