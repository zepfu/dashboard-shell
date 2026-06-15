/**
 * TanStack column definitions for MasterLedgerTable (W11 split).
 */
import { createColumnHelper } from '@tanstack/react-table'
import { agentQualityIssueSortValue } from '../lib/agent-quality'
import { numFmt } from '../lib/format-utils'
import { formatModelDisplayName, formatUsd } from '../lib/usage-report-display'
import type { LedgerDisplayRow } from './master-ledger-aggregation'
import {
  fmtOrDash,
  formatPercent,
  providerDisplayName,
} from './master-ledger-format'
import {
  renderAgentQualityCell,
  renderLatencyCell,
} from './master-ledger-tooltips'
import { ReasoningTokenValue } from './primitives/reasoning-token-value'

const helper = createColumnHelper<LedgerDisplayRow>()

// Cols 1–5: identity + volume
const baseVolumeColumns = [
  helper.accessor('model', {
    header: 'Model',
    cell: (info) => formatModelDisplayName(info.getValue() as string),
  }),
  helper.accessor('provider', {
    header: 'Provider',
    cell: ({ row }) => {
      if (
        row.original.ledgerLevel === 'repository' ||
        row.original.ledgerLevel === 'provider'
      ) {
        return '—'
      }
      return providerDisplayName(row.original.providerKey)
    },
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
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
]

// Cols 7–8: Cache Miss $ + Reasoning (moved up before latency)
// Wave 26 — cache/reasoning columns (operator F#12, F#13).
// Wave 29 Fix #7: reasoning_reported + reasoning_estimated consolidated into
// a single "Reasoning" column. Sorts on combined value. Estimated contribution
// is marked with an asterisk and exposed in a hover breakdown.
const cacheMissDollarAndReasoningColumns = [
  helper.accessor('cache_miss_usd_cost', {
    id: 'cache_miss_usd_cost',
    header: 'Cache Miss $',
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, formatUsd),
  }),
  // Consolidated Reasoning column: reported + estimated in one cell.
  // sortingFn uses combined value (reported + estimated).
  helper.accessor(
    (row) => (row.reasoning_reported ?? 0) + (row.reasoning_estimated ?? 0),
    {
      id: 'reasoning',
      header: 'Reasoning',
      enableSorting: true,
      cell: ({ row }) => {
        const reported = row.original.reasoning_reported
        const estimated = row.original.reasoning_estimated
        return <ReasoningTokenValue reported={reported} estimated={estimated} />
      },
    }
  ),
]

const agentQualityColumn = [
  helper.display({
    id: 'agent_quality',
    header: 'Score',
    enableSorting: true,
    sortingFn: (rowA, rowB) =>
      agentQualityIssueSortValue(rowA.original.agentQuality) -
      agentQualityIssueSortValue(rowB.original.agentQuality),
    cell: ({ row }) => renderAgentQualityCell(row.original.agentQuality),
  }),
]

// Cols 9–12: latency + error + cost group
const latencyCostColumns = [
  helper.accessor('p50_ms', {
    header: 'p50ms',
    cell: ({ row, getValue }) =>
      renderLatencyCell(getValue() as number, row.original.latencySummary),
  }),
  helper.accessor('p95_ms', {
    header: 'p95ms',
    cell: ({ row, getValue }) =>
      renderLatencyCell(getValue() as number, row.original.latencySummary),
  }),
  helper.accessor('error_pct', {
    header: 'Err%',
    cell: (info) => `${numFmt(info.getValue() as number, 1)}%`,
  }),
  helper.accessor('cost_usd', {
    header: 'Cost',
    cell: (info) => formatUsd(info.getValue() as number),
  }),
]

// Col 13: Cache Miss % — stays in cost group (relocated from col 11)
const cacheMissPctColumn = [
  helper.accessor('cache_miss_pct', {
    id: 'cache_miss_pct',
    header: 'Cache Miss %',
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, formatPercent),
  }),
]

// Cols 14–16: 4K-only columns
const fourKColumns = [
  helper.accessor('cache_pct', {
    id: 'cache_pct',
    header: 'Cache%',
    meta: { className: 'col-4k-only' },
    cell: (info) =>
      fmtOrDash(
        info.getValue() as number | null | undefined,
        (v) => `${numFmt(v, 1)}%`
      ),
  }),
  helper.accessor('queue', {
    id: 'queue',
    header: 'Queue',
    meta: { className: 'col-4k-only' },
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
  helper.accessor('resets', {
    id: 'resets',
    header: 'Resets',
    meta: { className: 'col-4k-only' },
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
]

// Cols 17–20: extended columns (5K-only except TOOL, which is always visible).
// W33/W36-fix: TOOL column has no responsive-class guard — it is always visible.
// The col-5k-only guard was the primary reason the TOOL column never appeared:
// display:none below 5120px meant virtually no user ever saw it. The column is
// intentionally ungated so it shows on 1080p/1440p/4K displays alongside the
// rest of the base ledger. GIT/INVAL columns remain col-5k-only (rarely needed).
const extendedColumns = [
  helper.accessor('tool', {
    id: 'tool',
    header: 'TOOL',
    // No meta className — column is always visible (not 5K-gated).
    // Body renderer owns TOOL hover; column def intentionally has no cell output.
    cell: () => null,
  }),
  helper.accessor('git_commits', {
    id: 'git_commits',
    header: 'GIT commits',
    meta: { className: 'col-5k-only' },
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
  helper.accessor('git_pushes', {
    id: 'git_pushes',
    header: 'GIT pushes',
    meta: { className: 'col-5k-only' },
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
  helper.accessor('inval', {
    id: 'inval',
    header: 'INVAL',
    meta: { className: 'col-5k-only' },
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
  }),
]

// Col 21: sparkline — last per Wave 30 operator spec
// W35 ⚠-3: header renamed from "24h Tok/Hr" to "Tokens Trend".
// The data is 30-day daily token totals, not a 24-hour hourly rate.
const sparklineColumn = [
  {
    id: 'sparkline',
    header: 'Tokens Trend',
    enableSorting: false,
    // Body renderer owns sparkline tint; column def intentionally has no cell output.
    cell: () => null,
  },
]

// Wave 30 column order, revised after removing $/1k columns:
//   baseVolumeColumns (1–5: Model, Provider, Requests, Toks In, Toks Out)
//   → cacheToksColumn (6: Cache toks)
//   → cacheMissDollarAndReasoningColumns (7–8: Cache Miss $, Reasoning)
//   → latencyCostColumns (9–12: p50ms, p95ms, Err%, Cost)
//   → cacheMissPctColumn (13: Cache Miss %)
//   → fourKColumns (14–16: Cache%, Queue, Resets; col-4k-only)
//   → fiveKColumns (17: TOOL [always visible]; 18–20: GIT commits, GIT pushes,
//                   INVAL [col-5k-only])
//   → sparklineColumn (21: Tokens Trend)
// W36-fix: TOOL column ungated — col-5k-only removed so it renders at all
// viewport widths. GIT commits, GIT pushes, INVAL remain col-5k-only.
export const masterLedgerAllColumns = [
  ...baseVolumeColumns,
  ...cacheToksColumn,
  ...cacheMissDollarAndReasoningColumns,
  ...agentQualityColumn,
  ...latencyCostColumns,
  ...cacheMissPctColumn,
  ...fourKColumns,
  ...extendedColumns,
  ...sparklineColumn,
]
