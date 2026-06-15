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
 * - Plain numeric cells with a sparkline trend column
 * - Cost/Err%/Quota% severity coloring
 * - Sparkline per-row tint from row severity
 * - tfoot removed (was off-by-N; audit C11)
 *
 * Wave 14-F refactor:
 * - gutter color via .gutter-{hot,warm,teal,cool} CSS classes (14-F.2)
 * - .number className on numeric cells (14-F.1)
 * - numeric cells use .number class; microbar overlays are intentionally absent
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
 *   column (col 8). Sorts on combined value. Estimated contribution is marked
 *   with an asterisk and exposed in a hover breakdown.
 *
 * Wave 30 operator reorder:
 * - Columns reordered per operator spec.
 * - New "Cache toks" column added at position 6 (cache_input + cache_creation).
 * - Cache miss $, Reasoning moved up before latency columns.
 * - Cache Miss % relocated after $/1k (cost group).
 * - 24h Tok/Hr sparkline moved to last position.
 *
 * Wave 35 cycle-2 (⚠-3):
 * - Sparkline column header corrected from "24h Tok/Hr" → "Tokens Trend".
 *   The column visualises 30-day daily token totals (not an hourly rate).
 *   "24h" and "Tok/Hr" were both inaccurate labels.
 *
 * W36-fix (tool-call surfacing audit):
 * - TOOL column: removed col-5k-only meta class — column was hidden at all
 *   viewports below 5120px (display:none), making tool-call data invisible to
 *   virtually all users. Column is now always visible on all display sizes.
 * - TOOL cell: formatter changed from numFmt → fmtCompact per W33 spec.
 *   Zero/null/undefined tool counts now render '—' (no hover) matching the
 *   fmtOrDash contract used by all other optional numeric columns.
 */
import { memo, useState, useMemo, useEffect, type ReactElement } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  type UsageReportProviderErrorObservationRow,
  type UsageReportToolActivityRow,
} from '../api/usage-report'
import {
  agentQualityIssueSortValue,
  type AgentQualityFamilyKey,
  type AgentQualityFamilySummary,
  type AgentQualitySummary,
} from '../lib/agent-quality'
import { fmtCompact, numFmt } from '../lib/format-utils'
import {
  providerBrandHex,
  canonicalProvider,
  formatModelDisplayName,
  formatLatency,
  formatUsd,
} from '../lib/usage-report-display'
import {
  aggregateRows,
  sortLedgerRows,
  toModelDisplayRow,
  toRepositoryDisplayRow,
  toRepositoryPerspectiveModelRow,
  type LedgerDisplayRow,
  type LedgerView,
  type ModelLatencySummary,
  type ModelRow,
  type RepositoryModelEntry,
  _sumSparkForTest,
  _aggregateRowsForTest,
} from './master-ledger-aggregation'
import {
  familyDefinitionsForProvider,
  modelFamilyForRow,
  OTHER_FAMILY_DEFINITION,
  type ModelFamilyDefinition,
} from './master-ledger-model-meta'
import { HoverTooltip } from './primitives/hover-tooltip'
import { ReasoningTokenValue } from './primitives/reasoning-token-value'
import { Sparkline } from './primitives/sparkline'

// Re-export the canonical row model, view type, and latency summary for existing
// importers (comparison-panel, phosphor-dashboard, index, testkit, tests).
// This keeps the public surface stable while the implementation lives in the
// extracted module.
export type {
  ModelRow,
  LedgerView,
  ModelLatencySummary,
} from './master-ledger-aggregation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Re-export of the API error observation type under a short name for
 * internal use.  The canonical definition lives in `../api/usage-report`.
 */
export type ProviderErrorObservation = UsageReportProviderErrorObservationRow

// ---------------------------------------------------------------------------
// W33 Tool Activity — types and constants
// ---------------------------------------------------------------------------

/**
 * Shell-class tool names that are NOT shown in the left TOOLS column.
 * They are instead aggregated into the right SHELL column header count.
 * Must stay in sync with the server's shell-classification list.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests/consumers
export const SHELL_CLASS_TOOL_NAMES = new Set([
  'Bash',
  'exec_command',
  'run_terminal_command',
  'run_command',
  'run_shell_command',
  'code_execution:run_command',
])

/** Target row count per compact TOOL hover column. */
const TOOL_HOVER_ROWS_PER_COLUMN = 14

/** Maximum compact columns retained per side before truncating source rows. */
const TOOL_HOVER_MAX_SIDE_COLUMNS = 3

/** Maximum visual rows used when an MCP column expands its subtools. */
const TOOL_HOVER_MAX_VISUAL_ROWS_PER_COLUMN = 28

/** Approximate width budget for each rendered TOOL hover column. */
const TOOL_HOVER_COLUMN_WIDTH_PX = 140

/** Gap between the Tools and Shell groups in the TOOL hover. */
const TOOL_HOVER_GROUP_GAP_PX = 12

/** Maximum non-MCP tool rows retained for the left-side hover columns. */
const LEFT_COL_CAP = TOOL_HOVER_ROWS_PER_COLUMN * TOOL_HOVER_MAX_SIDE_COLUMNS

/** Maximum shell rows retained for the tallest dynamic right-side layout. */
const RIGHT_COL_CAP =
  TOOL_HOVER_MAX_VISUAL_ROWS_PER_COLUMN * TOOL_HOVER_MAX_SIDE_COLUMNS

/** A single row in the rendered left TOOLS column (post-rollup). */
export interface ToolLeftRow {
  /** Display label: plain tool name or `MCP: <server>`. */
  label: string
  calls: number
  /** Percentage of total tool calls (left + right combined), 0–100. */
  pct: number
  /** Sub-rows for MCP server rollup entries. `undefined` for plain tools. */
  subRows?: { label: string; calls: number }[]
}

interface ToolShellRow {
  label: string
  calls: number
}

interface ToolHoverColumnEntry {
  row: ToolLeftRow
  subRows: { label: string; calls: number }[]
  hiddenSubRowCount: number
  visualRows: number
}

interface ToolHoverLeftColumn {
  label: string
  entries: ToolHoverColumnEntry[]
  sourceIndex: number
  visualRows: number
}

function chunkToolHoverRows<T>(
  rows: readonly T[],
  rowsPerColumn = TOOL_HOVER_ROWS_PER_COLUMN
): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += rowsPerColumn) {
    chunks.push(rows.slice(i, i + rowsPerColumn))
  }
  return chunks
}

function visibleMcpSubRows(row: ToolLeftRow): {
  subRows: { label: string; calls: number }[]
  hiddenSubRowCount: number
} {
  const subRows = row.subRows ?? []
  const maxSubRowsWithoutMarker = TOOL_HOVER_MAX_VISUAL_ROWS_PER_COLUMN - 1
  const visibleCount =
    subRows.length > maxSubRowsWithoutMarker
      ? maxSubRowsWithoutMarker - 1
      : subRows.length

  return {
    subRows: subRows.slice(0, visibleCount),
    hiddenSubRowCount: Math.max(0, subRows.length - visibleCount),
  }
}

function mcpColumnVisualRowCount(row: ToolLeftRow): number {
  const { subRows, hiddenSubRowCount } = visibleMcpSubRows(row)
  return 1 + subRows.length + (hiddenSubRowCount > 0 ? 1 : 0)
}

function buildToolHoverColumnEntry(row: ToolLeftRow): ToolHoverColumnEntry {
  const visible = visibleMcpSubRows(row)
  const visualRows =
    (row.subRows?.length ?? 0) > 0 ? mcpColumnVisualRowCount(row) : 1
  return {
    row,
    subRows: visible.subRows,
    hiddenSubRowCount: visible.hiddenSubRowCount,
    visualRows,
  }
}

function buildToolHoverLeftColumns(rows: readonly ToolLeftRow[]): {
  columns: ToolHoverLeftColumn[]
  rowsPerColumn: number
  hiddenRowCount: number
} {
  const entries = rows.map(buildToolHoverColumnEntry)

  const rowsPerColumn = Math.min(
    TOOL_HOVER_MAX_VISUAL_ROWS_PER_COLUMN,
    Math.max(
      TOOL_HOVER_ROWS_PER_COLUMN,
      ...entries.map((entry) => entry.visualRows)
    )
  )

  const columns: ToolHoverLeftColumn[] = []
  let active: ToolHoverLeftColumn = {
    label: 'Tools',
    entries: [],
    sourceIndex: 0,
    visualRows: 0,
  }
  let hiddenRowCount = 0
  let atCapacity = false

  for (const entry of entries) {
    if (atCapacity) {
      hiddenRowCount += 1
      continue
    }

    if (
      active.entries.length > 0 &&
      active.visualRows + entry.visualRows > rowsPerColumn
    ) {
      columns.push(active)
      if (columns.length >= TOOL_HOVER_MAX_SIDE_COLUMNS) {
        hiddenRowCount += 1
        atCapacity = true
        active = {
          label: '',
          entries: [],
          sourceIndex: columns.length,
          visualRows: 0,
        }
        continue
      }
      const sourceIndex = columns.length
      active = {
        label: `Tools ${sourceIndex + 1}`,
        entries: [],
        sourceIndex,
        visualRows: 0,
      }
    }

    if (columns.length >= TOOL_HOVER_MAX_SIDE_COLUMNS) {
      hiddenRowCount += 1
      continue
    }

    active.entries.push(entry)
    active.visualRows += entry.visualRows
  }

  if (
    active.entries.length > 0 &&
    columns.length < TOOL_HOVER_MAX_SIDE_COLUMNS
  ) {
    columns.push(active)
  }

  return {
    columns,
    rowsPerColumn,
    hiddenRowCount,
  }
}

/**
 * Pre-processed tool activity data attached to each ModelRow.
 * Computed in `buildModelRows` (phosphor-dashboard) and consumed by the TOOL
 * cell renderer in `MasterLedgerTable`.
 */
export interface ModelToolActivity {
  /** Total call count across ALL outer rows (left + shell-class). */
  totalCalls: number
  /** Total calls attributed to shell-class tools (Bash, exec_command, …). */
  shellTotalCalls: number
  /** Left-column rows (plain tools + MCP rollups), capped at LEFT_COL_CAP. */
  leftRows: ToolLeftRow[]
  /** Whether leftRows was truncated (more rows exist beyond the cap). */
  leftTruncated: boolean
  /** Original count of non-truncated left rows (used for "+N more" display). */
  leftTotalCount: number
  /** Right-column shell command rows, capped at RIGHT_COL_CAP. */
  shellRows: ToolShellRow[]
  /** Whether shellRows was truncated. */
  shellTruncated: boolean
  /** Original count of non-truncated shell rows (for "+N more" display). */
  shellTotalCount: number
}

function isShellAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function cleanShellToken(token: string | undefined): string {
  if (token === undefined) return ''
  const unquoted = token
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\$/, '')
  const normalized = unquoted.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return (parts.length > 0 ? parts[parts.length - 1] : normalized).toLowerCase()
}

/**
 * Normalizes shell labels before the TOOL hover groups them.
 *
 * The server intentionally emits compact command labels, but some Bash commands
 * arrive with executable paths or assignment prefixes, for example
 * `/home/.../.venv/bin/python`, `./.venv/bin/python`, or
 * `worktree="/tmp/x"\ngit`. Those should roll up with `python` and `git`.
 */
function normalizeShellCommandLabel(label: string | null | undefined): string {
  const tokens = (label ?? '')
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  let commandIdx = 0
  while (
    commandIdx < tokens.length &&
    (tokens[commandIdx] === '\\' ||
      tokens[commandIdx] === 'env' ||
      isShellAssignmentToken(tokens[commandIdx]))
  ) {
    commandIdx += 1
  }

  const command = cleanShellToken(tokens[commandIdx])
  if (command === '' || command.startsWith('#')) return ''

  return command
}

/**
 * Builds pre-processed {@link ModelToolActivity} from raw `toolActivity` rows
 * for a single (provider, model) pair.
 *
 * This pure function is exported so it can be unit-tested directly without
 * rendering the full component.
 *
 * MCP sub-rows ({@link ToolLeftRow.subRows}) are sorted by `calls` descending
 * before being attached, providing a defensive guarantee independent of the
 * server's ORDER BY.  This ensures the slice-to-3 cap in the renderer always
 * shows the highest-call sub-tools even if API ordering changes (W35 ⚠-9).
 *
 * @param rows - All `toolActivity` rows for one (provider, model) pair.
 *   Both `kind === 'outer'` and `kind === 'shell'` rows are expected.
 */
// eslint-disable-next-line react-refresh/only-export-components -- unit-tested helper
export function buildToolActivity(
  rows: UsageReportToolActivityRow[]
): ModelToolActivity {
  // Split by kind
  const outerRows = rows.filter((r) => r.kind === 'outer')
  const shellRows = rows.filter((r) => r.kind === 'shell')

  // Compute total shell calls from outer rows that match shell-class names
  const shellTotalCalls = outerRows
    .filter((r) => SHELL_CLASS_TOOL_NAMES.has(r.label))
    .reduce((s, r) => s + r.calls, 0)

  // Total calls = sum of ALL outer rows (includes shell-class outer rows)
  const totalCalls = outerRows.reduce((s, r) => s + r.calls, 0)

  // Build left-column rows: exclude shell-class outer rows, group MCP names
  // MCP: label starts with 'mcp__' → group by split('__')[1] (server name)
  const mcpServerMap = new Map<
    string,
    { calls: number; subRows: { label: string; calls: number }[] }
  >()
  const plainToolRows: { label: string; calls: number }[] = []

  for (const r of outerRows) {
    if (SHELL_CLASS_TOOL_NAMES.has(r.label)) continue // excluded from left col

    if (r.label.startsWith('mcp__')) {
      const parts = r.label.split('__')
      const server = parts[1] ?? 'unknown'
      const subLabel = parts.slice(2).join('__') || r.label
      const existing = mcpServerMap.get(server)
      if (existing === undefined) {
        mcpServerMap.set(server, {
          calls: r.calls,
          subRows: [{ label: subLabel, calls: r.calls }],
        })
      } else {
        existing.calls += r.calls
        existing.subRows.push({ label: subLabel, calls: r.calls })
      }
    } else {
      plainToolRows.push({ label: r.label, calls: r.calls })
    }
  }

  // Combine plain tools + MCP server entries into a single sortable list
  const combinedLeft: { label: string; calls: number; isMcp: boolean }[] = [
    ...plainToolRows.map((r) => ({ ...r, isMcp: false })),
    ...[...mcpServerMap.entries()].map(([server, data]) => ({
      label: `MCP: ${server}`,
      calls: data.calls,
      isMcp: true,
    })),
  ]

  // Sort descending by total call count
  combinedLeft.sort((a, b) => b.calls - a.calls)

  const leftTotalCount = combinedLeft.length
  const leftTruncated = leftTotalCount > LEFT_COL_CAP
  const capped = combinedLeft.slice(0, LEFT_COL_CAP)

  const leftRows: ToolLeftRow[] = capped.map((item) => {
    let subRows: { label: string; calls: number }[] | undefined
    if (item.isMcp) {
      const mcpData = mcpServerMap.get(item.label.slice('MCP: '.length))
      if (mcpData !== undefined) {
        // W35 ⚠-9: Sort sub-rows by calls descending before the slice-to-3 cap
        // in the renderer. Defensive against API ordering changes — the server
        // emits calls DESC but we must not rely on push-order being stable.
        subRows = [...mcpData.subRows].sort((a, b) => b.calls - a.calls)
      }
    }
    return {
      label: item.label,
      calls: item.calls,
      pct:
        totalCalls > 0 ? Math.round((item.calls / totalCalls) * 1000) / 10 : 0,
      subRows,
    }
  })

  const shellRollup = new Map<string, number>()
  for (const row of shellRows) {
    const label = normalizeShellCommandLabel(row.label)
    if (label === '') continue
    shellRollup.set(label, (shellRollup.get(label) ?? 0) + row.calls)
  }

  // Right-column: normalized shell command rows sorted by calls desc, capped
  const sortedShell = [...shellRollup.entries()]
    .map(([label, calls]) => ({ label, calls }))
    .sort((a, b) => b.calls - a.calls)
  const shellTotalCount = sortedShell.length
  const shellTruncated = shellTotalCount > RIGHT_COL_CAP
  const shellRowsCapped = sortedShell.slice(0, RIGHT_COL_CAP).map((r) => ({
    label: r.label,
    calls: r.calls,
  }))

  return {
    totalCalls,
    shellTotalCalls,
    leftRows,
    leftTruncated,
    leftTotalCount,
    shellRows: shellRowsCapped,
    shellTruncated,
    shellTotalCount,
  }
}

function providerDisplayName(provider: string): string {
  const key = canonicalProvider(provider)
  switch (key) {
    case 'anthropic':
      return 'Anthropic'
    case 'openai':
      return 'OpenAI'
    case 'google':
      return 'Google'
    case 'xai':
      return 'xAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'nvidia_nim':
      return 'NVIDIA'
    case 'local':
      return 'Local'
    default:
      return formatModelDisplayName(provider)
  }
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

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

const helper = createColumnHelper<LedgerDisplayRow>()

/**
 * Returns a formatted string for a value, or the em-dash placeholder `—`
 * when the value is null or undefined.  Uses `== null` to catch both
 * null and undefined without treating `0` or `false` as missing.
 *
 * @param value - The value to format.
 * @param formatter - Optional formatter applied when value is non-null.
 * @returns Formatted string or `'—'`.
 */
function fmtOrDash<T>(
  value: T | null | undefined,
  formatter?: (v: T) => string
): string {
  if (value == null) return '—'
  return formatter ? formatter(value) : String(value)
}

/**
 * Percent formatter: renders a ratio (0–100) as "XX.X%".
 * Used for cache_miss_pct column (operator F#12).
 */
function formatPercent(pct: number): string {
  return `${pct.toFixed(1)}%`
}

const AGENT_FAMILY_LABELS: Record<AgentQualityFamilyKey, string> = {
  quality: 'Quality',
  instruction: 'Instruction',
  tool: 'Tool',
  contract: 'Contract',
  progress: 'Progress',
  risk: 'Risk',
  discoveryInventoryCoverage: 'Discovery inventory',
  terminalCompletion: 'Terminal completion',
}

function formatAgentPercent(score: number | null): string {
  return score === null ? '--' : `${Math.round(score * 100).toString()}%`
}

function humanizeReasonCode(value: string): string {
  return value
    .replace(/[:/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function agentFamilyColor(
  family: AgentQualityFamilyKey,
  summary: AgentQualityFamilySummary
): string {
  if (summary.score === null) return 'var(--fg-muted, #64748b)'
  if (family === 'risk') {
    if (summary.score >= 0.1) return 'var(--accent-hot, #ef4444)'
    if (summary.score > 0) return 'var(--accent-warm, #f59e0b)'
    return 'var(--accent-teal, #14b8a6)'
  }
  if (summary.score < 0.9) return 'var(--accent-hot, #ef4444)'
  if (summary.score < 0.98) return 'var(--accent-warm, #f59e0b)'
  return 'var(--accent-teal, #14b8a6)'
}

function formatCoverage(summary: AgentQualityFamilySummary): string {
  const coverage =
    summary.possible > 0 ? (summary.evaluated / summary.possible) * 100 : 0
  return `${numFmt(summary.evaluated)} / ${numFmt(summary.possible)} checks (${numFmt(coverage, 0)}%)`
}

function formatSignalRate(count: number, evaluated: number): string {
  if (evaluated <= 0) return `${numFmt(count)} / --`
  return `${numFmt(count)} / ${numFmt(evaluated)} (${numFmt((count / evaluated) * 100, 0)}%)`
}

interface AgentQualityDisplaySummary {
  label: string
  color: string
  state: 'review' | 'watch' | 'healthy' | 'unscored'
}

const AGENT_NO_DATA_COLOR = 'var(--accent-cool, #38bdf8)'

function summarizeAgentQuality(
  summary: AgentQualitySummary
): AgentQualityDisplaySummary {
  const passFamilies: AgentQualityFamilyKey[] = [
    'quality',
    'instruction',
    'tool',
    'contract',
    'progress',
  ]
  const passScores = passFamilies
    .map((family) => summary[family].score)
    .filter((score): score is number => score !== null)
  const discovery = summary.discoveryInventoryCoverage
  const terminal = summary.terminalCompletion
  if (discovery.score !== null) passScores.push(discovery.score)
  if (terminal.score !== null) passScores.push(terminal.score)
  const worstPassScore = passScores.length > 0 ? Math.min(...passScores) : null
  const evaluated = passFamilies.reduce(
    (sum, family) => sum + summary[family].evaluated,
    0
  )
  const possible = passFamilies.reduce(
    (sum, family) => sum + summary[family].possible,
    0
  )
  const coveragePct = possible > 0 ? (evaluated / possible) * 100 : null
  const riskScore = summary.risk.score ?? 0
  const handoffIncidentCount =
    (summary.ignoredPathTracking?.violationCount ?? 0) +
    (summary.baselineDeflection?.incidentIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.incidentIncidents ?? 0) +
    discovery.issueCount +
    terminal.issueCount
  const handoffAttemptCount =
    (summary.baselineDeflection?.attemptedIncidents ?? 0) +
    (summary.sleepWellnessInterruption?.attemptedIncidents ?? 0)
  const issueCount =
    passFamilies.reduce((sum, family) => sum + summary[family].issueCount, 0) +
    summary.risk.issueCount +
    discovery.issueCount +
    summary.discoveryInventoryMissingCount +
    terminal.issueCount +
    summary.emptyCompletionFailures +
    summary.invalidToolCallErrors +
    summary.destructiveCheckoutFailures +
    summary.largePayloadRisks +
    summary.readOnlyPolicyViolations +
    handoffIncidentCount +
    handoffAttemptCount

  if (
    summary.destructiveCheckoutFailures > 0 ||
    summary.emptyCompletionFailures > 0 ||
    discovery.issueCount > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    terminal.issueCount > 0 ||
    handoffIncidentCount > 0 ||
    riskScore >= 0.1 ||
    (worstPassScore !== null && worstPassScore < 0.9)
  ) {
    return {
      label: 'Review',
      color: 'var(--accent-hot, #ef4444)',
      state: 'review',
    }
  }

  if (
    issueCount > 0 ||
    riskScore > 0 ||
    (worstPassScore !== null && worstPassScore < 0.98) ||
    (coveragePct !== null && coveragePct < 20)
  ) {
    return {
      label:
        coveragePct !== null && coveragePct < 20 && issueCount === 0
          ? 'Low cov'
          : 'Watch',
      color: 'var(--accent-warm, #f59e0b)',
      state: 'watch',
    }
  }

  return {
    label: worstPassScore === null ? 'Unscored' : 'Healthy',
    color:
      worstPassScore === null
        ? AGENT_NO_DATA_COLOR
        : 'var(--accent-teal, #14b8a6)',
    state: worstPassScore === null ? 'unscored' : 'healthy',
  }
}

function renderAgentQualityTooltip(summary: AgentQualitySummary): ReactElement {
  const families: AgentQualityFamilyKey[] = [
    'quality',
    'instruction',
    'tool',
    'contract',
    'progress',
    'risk',
    'discoveryInventoryCoverage',
    'terminalCompletion',
  ]
  const flags = [
    ['Empty completions', summary.emptyCompletionFailures],
    ['Invalid tool calls', summary.invalidToolCallErrors],
    ['Destructive checkout', summary.destructiveCheckoutFailures],
    ['Large payload risk', summary.largePayloadRisks],
    ['Read-only violations', summary.readOnlyPolicyViolations],
  ] as const
  const visibleFlags = flags.filter(([, count]) => count > 0)
  const ignoredPath = summary.ignoredPathTracking ?? {
    score: null,
    evaluated: 0,
    possible: 0,
    violationCount: 0,
  }
  const baseline = summary.baselineDeflection ?? {
    attemptedScore: null,
    attemptedEvaluated: 0,
    attemptedIncidents: 0,
    incidentScore: null,
    incidentEvaluated: 0,
    incidentIncidents: 0,
    attemptCount: 0,
    toolCallCount: 0,
    inputTokens: 0,
    elapsedMs: 0,
    qualityGateTriggerCount: 0,
    qualityGateFixAttemptCount: 0,
    qualityGateRerunCount: 0,
  }
  const sleep = summary.sleepWellnessInterruption ?? {
    attemptedScore: null,
    attemptedEvaluated: 0,
    attemptedIncidents: 0,
    incidentScore: null,
    incidentEvaluated: 0,
    incidentIncidents: 0,
    interruptionCount: 0,
    outputTokens: 0,
    inputTokens: 0,
    elapsedMs: 0,
    afterUserPushbackCount: 0,
    repeatedCount: 0,
  }
  const discovery = summary.discoveryInventoryCoverage
  const terminal = summary.terminalCompletion
  const compact = summary.compactSummary ?? {
    eventCount: 0,
    threadCount: 0,
    idCount: 0,
    resumeContextCount: 0,
    verifyContextCount: 0,
    sourceCounts: {},
  }
  const compactSources = Object.entries(compact.sourceCounts)
    .filter(([, count]) => count > 0)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
  const hasBehaviorSignals =
    ignoredPath.evaluated > 0 ||
    ignoredPath.violationCount > 0 ||
    baseline.attemptedEvaluated > 0 ||
    baseline.incidentEvaluated > 0 ||
    baseline.attemptCount > 0 ||
    sleep.attemptedEvaluated > 0 ||
    sleep.incidentEvaluated > 0 ||
    sleep.interruptionCount > 0 ||
    discovery.evaluated > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    terminal.evaluated > 0 ||
    compact.eventCount > 0 ||
    compact.resumeContextCount > 0 ||
    compact.verifyContextCount > 0

  return (
    <div style={{ minWidth: '260px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Agent health
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: '12px',
          rowGap: '2px',
          fontSize: '9px',
        }}
      >
        {families.map((family) => {
          const item = summary[family]
          const issueLabel = family === 'risk' ? 'risk' : 'fail'
          return (
            <div
              key={family}
              style={{
                display: 'contents',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span style={{ color: agentFamilyColor(family, item) }}>
                {AGENT_FAMILY_LABELS[family]} {formatAgentPercent(item.score)}
              </span>
              <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
                {formatCoverage(item)} · {numFmt(item.issueCount)} {issueLabel}
              </span>
            </div>
          )
        })}
      </div>
      {visibleFlags.length > 0 ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Failure flags
          </div>
          {visibleFlags.map(([label, count]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '9px',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span>{label}</span>
              <span>{numFmt(count)}</span>
            </div>
          ))}
        </>
      ) : null}
      {hasBehaviorSignals ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Handoff signals
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto auto',
              columnGap: '12px',
              rowGap: '2px',
              fontSize: '9px',
            }}
          >
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Ignored paths</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(ignoredPath.score)} ·{' '}
              {formatSignalRate(
                ignoredPath.violationCount,
                ignoredPath.evaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Baseline attempted
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                baseline.attemptedIncidents,
                baseline.attemptedEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Baseline incident
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                baseline.incidentIncidents,
                baseline.incidentEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Gate path</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(baseline.qualityGateTriggerCount)} triggers ·{' '}
              {numFmt(baseline.qualityGateFixAttemptCount)} fixes ·{' '}
              {numFmt(baseline.qualityGateRerunCount)} reruns
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep attempted</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                sleep.attemptedIncidents,
                sleep.attemptedEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep incident</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                sleep.incidentIncidents,
                sleep.incidentEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep severity</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(sleep.afterUserPushbackCount)} after pushback ·{' '}
              {numFmt(sleep.repeatedCount)} repeated
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Discovery inventory
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(discovery.score)} ·{' '}
              {formatSignalRate(discovery.issueCount, discovery.evaluated)} ·{' '}
              {numFmt(summary.discoveryInventoryMissingCount)} missing
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Terminal completion
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(terminal.score)} ·{' '}
              {formatSignalRate(terminal.issueCount, terminal.evaluated)}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Compact summaries
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(compact.eventCount)} events ·{' '}
              {numFmt(compact.threadCount)} threads
              {compact.resumeContextCount > 0 || compact.verifyContextCount > 0
                ? ` · ${numFmt(compact.resumeContextCount)} resume · ${numFmt(compact.verifyContextCount)} verify`
                : ''}
            </span>
            {compactSources.length > 0 ? (
              <>
                <span style={{ color: 'var(--fg, #e2e8f0)' }}>
                  Compact sources
                </span>
                <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
                  {compactSources
                    .map(([source, count]) => `${source} ${numFmt(count)}`)
                    .join(' · ')}
                </span>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {summary.reasons.length > 0 ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Top reason codes
          </div>
          {summary.reasons.map((reason) => (
            <div
              key={`${reason.family}:${reason.reason}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '9px',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {humanizeReasonCode(reason.family)} ·{' '}
                {humanizeReasonCode(reason.reason)}
              </span>
              <span style={{ flex: '0 0 auto' }}>{numFmt(reason.count)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

function renderNoAgentQualityTooltip(): ReactElement {
  return (
    <div style={{ minWidth: '220px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Agent health
      </div>
      <div style={{ fontSize: '9px', color: 'var(--fg, #e2e8f0)' }}>
        No score data
      </div>
      <div style={{ fontSize: '9px', color: 'var(--fg-muted, #94a3b8)' }}>
        No evaluated session-history score fields were reported for this row.
      </div>
    </div>
  )
}

function renderAgentScoreIndicator(
  label: string,
  color: string,
  state: AgentQualityDisplaySummary['state'] | 'none'
): ReactElement {
  return (
    <span
      aria-label={`Score: ${label.toLowerCase()}`}
      data-agent-score-indicator='true'
      data-agent-score-state={state}
      style={{
        display: 'inline-block',
        width: '9px',
        height: '9px',
        borderRadius: '999px',
        background: color,
        border: '1px solid rgba(255, 255, 255, 0.34)',
        boxShadow: `0 0 7px ${color}`,
        verticalAlign: 'middle',
      }}
    />
  )
}

function renderAgentQualityCell(
  summary: AgentQualitySummary | undefined
): ReactElement {
  if (summary === undefined) {
    return (
      <HoverTooltip content={renderNoAgentQualityTooltip()}>
        {renderAgentScoreIndicator('no data', AGENT_NO_DATA_COLOR, 'none')}
      </HoverTooltip>
    )
  }

  const displaySummary = summarizeAgentQuality(summary)

  return (
    <HoverTooltip content={renderAgentQualityTooltip(summary)}>
      {renderAgentScoreIndicator(
        displaySummary.label,
        displaySummary.color,
        displaySummary.state
      )}
    </HoverTooltip>
  )
}

function formatCoverageCount(count: number | null | undefined): string {
  return count != null && count > 0 ? `${numFmt(count)} rows` : 'no coverage'
}

function formatThroughput(value: number | null | undefined): string {
  return value == null ? '—' : `${numFmt(value, 1)} tok/s`
}

function renderLatencyTooltip(summary: ModelLatencySummary): ReactElement {
  const rows = [
    [
      'Server total p50/p95',
      `${formatLatency(summary.totalServerP50Ms)} / ${formatLatency(
        summary.totalServerP95Ms
      )}`,
      summary.totalServerCount,
    ],
    [
      'Upstream elapsed p50/p95',
      `${formatLatency(summary.upstreamElapsedP50Ms)} / ${formatLatency(
        summary.upstreamElapsedP95Ms
      )}`,
      summary.upstreamElapsedCount,
    ],
    ['TTFT p95', formatLatency(summary.ttftP95Ms), summary.ttftCount],
    [
      'LiteLLM local p95',
      formatLatency(summary.litellmProcessingP95Ms),
      summary.litellmProcessingCount,
    ],
    [
      'Upstream stream p95',
      formatLatency(summary.upstreamStreamP95Ms),
      summary.upstreamStreamCount,
    ],
    [
      'Unclassified p95',
      formatLatency(summary.unclassifiedP95Ms),
      summary.unclassifiedCount,
    ],
    [
      'Session gap p95',
      formatLatency(summary.previousResponseGapP95Ms),
      summary.previousResponseGapCount,
    ],
    [
      'Upstream output tok/s',
      `${formatThroughput(
        summary.upstreamOutputTokensPerSecondP50
      )} / ${formatThroughput(summary.upstreamOutputTokensPerSecondP95)}`,
      summary.upstreamOutputTokensPerSecondCount,
    ],
    [
      'Stream output tok/s',
      `${formatThroughput(
        summary.streamOutputTokensPerSecondP50
      )} / ${formatThroughput(summary.streamOutputTokensPerSecondP95)}`,
      summary.streamOutputTokensPerSecondCount,
    ],
  ] as const

  return (
    <div style={{ minWidth: '280px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Latency split
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto auto',
          columnGap: '12px',
          rowGap: '2px',
          fontSize: '9px',
        }}
      >
        {rows.map(([label, value, count]) => (
          <div key={label} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>{label}</span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>{value}</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatCoverageCount(count)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderLatencyCell(
  value: number,
  summary: ModelLatencySummary | undefined
): ReactElement {
  const label = formatLatency(value)
  if (summary === undefined) return <>{label}</>
  return (
    <HoverTooltip content={renderLatencyTooltip(summary)}>{label}</HoverTooltip>
  )
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

// Wave 30 operator-specified column order, revised after removing low-signal
// blended $/1k cost-rate columns:
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
//   13. Cache Miss %
//   14. Cache%     (col-4k-only)
//   15. Queue      (col-4k-only)
//   16. Resets     (col-4k-only)
//   17. TOOL       (always visible — W36-fix: was col-5k-only, now ungated)
//   18. GIT commits (col-5k-only)
//   19. GIT pushes (col-5k-only)
//   20. INVAL      (col-5k-only)
//   21. Tokens Trend (sparkline, last)

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
const allColumns = [
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

// ---------------------------------------------------------------------------
// MasterLedgerTable
// ---------------------------------------------------------------------------

export interface MasterLedgerTableProps {
  rows: ModelRow[]
  ledgerView?: LedgerView
  onLedgerViewChange?: (view: LedgerView) => void
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
 * coloring, provider/family/model drilldown, and per-row sparkline tinting.
 *
 * Wave 20-Tables (F5): caption rendered from inside the component.
 * Wave 29 Fix #9: caption removed per operator direction.
 */
function MasterLedgerTableInner({
  rows,
  ledgerView: ledgerViewProp,
  onLedgerViewChange,
  errorObservations = [],
}: MasterLedgerTableProps): ReactElement {
  const [internalLedgerView, setInternalLedgerView] = useState<LedgerView>(
    () => ledgerViewProp ?? 'model'
  )
  const isControlled =
    ledgerViewProp !== undefined && onLedgerViewChange !== undefined
  const ledgerView = isControlled ? ledgerViewProp! : internalLedgerView
  const setLedgerView = isControlled
    ? onLedgerViewChange!
    : setInternalLedgerView
  const showInternalTabs = !isControlled

  useEffect(() => {
    if (
      ledgerViewProp !== undefined &&
      onLedgerViewChange === undefined &&
      import.meta.env.DEV
    ) {
      // eslint-disable-next-line no-console -- S2-4: intentional half-controlled dev warning
      console.warn(
        'MasterLedgerTable: ledgerView was provided without onLedgerViewChange; using internal state only (half-controlled).'
      )
    }
  }, [ledgerViewProp, onLedgerViewChange])

  const [sorting, setSorting] = useState<SortingState>([])
  const [expandedProvidersModel, setExpandedProvidersModel] = useState<
    Set<string>
  >(() => new Set())
  const [expandedProvidersRepository, setExpandedProvidersRepository] =
    useState<Set<string>>(() => new Set())
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedModels, setExpandedModels] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedRepositories, setExpandedRepositories] = useState<Set<string>>(
    () => new Set()
  )

  const repositoryEntryMap = useMemo(() => {
    const repositoryMap = new Map<string, RepositoryModelEntry[]>()
    for (const sourceRow of rows) {
      const providerKey = canonicalProvider(sourceRow.provider)
      for (const repoRow of sourceRow.repositoryChildren ?? []) {
        const repository = repoRow.model
        const family = modelFamilyForRow(providerKey, sourceRow.model)
        const entries = repositoryMap.get(repository) ?? []
        entries.push({
          repository,
          providerKey,
          sourceRow,
          repoRow,
          family,
        })
        repositoryMap.set(repository, entries)
      }
    }
    return repositoryMap
  }, [rows])

  const modelProviderMap = useMemo(() => {
    const providerMap = new Map<string, ModelRow[]>()
    for (const row of rows) {
      const providerKey = canonicalProvider(row.provider)
      const providerRows = providerMap.get(providerKey) ?? []
      providerRows.push(row)
      providerMap.set(providerKey, providerRows)
    }
    return providerMap
  }, [rows])

  const displayRows = useMemo(() => {
    if (ledgerView === 'repository') {
      const repositoryMap = repositoryEntryMap

      const result: LedgerDisplayRow[] = []
      const repositoryRows = sortLedgerRows(
        [...repositoryMap.entries()].map(([repository, entries]) =>
          aggregateRows(
            entries.map((entry) => entry.repoRow),
            {
              ledgerLevel: 'repository',
              ledgerId: `repository-root:${repository}`,
              ledgerLabel: repository,
              providerKey: 'repository',
              repositoryKey: repository,
              childCount: entries.length,
              exactModelCount: entries.length,
              isExpandable: entries.length > 0,
            }
          )
        ),
        sorting
      )

      for (const repositoryRow of repositoryRows) {
        result.push(repositoryRow)
        if (!expandedRepositories.has(repositoryRow.ledgerId)) continue

        const entries =
          repositoryMap.get(repositoryRow.repositoryKey ?? '') ?? []
        const providerMap = new Map<string, RepositoryModelEntry[]>()
        for (const entry of entries) {
          const providerEntries = providerMap.get(entry.providerKey) ?? []
          providerEntries.push(entry)
          providerMap.set(entry.providerKey, providerEntries)
        }

        const providerRows = sortLedgerRows(
          [...providerMap.entries()].map(([providerKey, providerEntries]) =>
            aggregateRows(
              providerEntries.map((entry) => entry.repoRow),
              {
                ledgerLevel: 'provider',
                ledgerId: `repository-provider:${repositoryRow.repositoryKey}:${providerKey}`,
                ledgerLabel: providerDisplayName(providerKey),
                providerKey,
                repositoryKey: repositoryRow.repositoryKey,
                childCount: providerEntries.length,
                exactModelCount: providerEntries.length,
                isExpandable: providerEntries.length > 0,
              }
            )
          ),
          sorting
        )

        for (const providerRow of providerRows) {
          result.push(providerRow)
          if (!expandedProvidersRepository.has(providerRow.ledgerId)) continue

          const providerEntries = providerMap.get(providerRow.providerKey) ?? []
          const definitions = familyDefinitionsForProvider(
            providerRow.providerKey,
            providerEntries.map((entry) => entry.sourceRow)
          )

          if (definitions === undefined) {
            result.push(
              ...sortLedgerRows(
                providerEntries.map((entry) =>
                  toRepositoryPerspectiveModelRow(entry)
                ),
                sorting
              )
            )
            continue
          }

          const familyMap = new Map<
            string,
            {
              definition: ModelFamilyDefinition
              entries: RepositoryModelEntry[]
            }
          >()
          for (const entry of providerEntries) {
            const definition = entry.family ?? OTHER_FAMILY_DEFINITION
            const existing = familyMap.get(definition.key) ?? {
              definition,
              entries: [],
            }
            existing.entries.push(entry)
            familyMap.set(definition.key, existing)
          }

          const orderedFamilyGroups =
            sorting.length === 0
              ? [
                  ...definitions,
                  ...(definitions.some(
                    (definition) =>
                      definition.key === OTHER_FAMILY_DEFINITION.key
                  )
                    ? []
                    : [OTHER_FAMILY_DEFINITION]),
                ]
                  .map((definition) => familyMap.get(definition.key))
                  .filter(
                    (
                      value
                    ): value is {
                      definition: ModelFamilyDefinition
                      entries: RepositoryModelEntry[]
                    } => value !== undefined
                  )
              : [...familyMap.values()]

          const familyRows = sortLedgerRows(
            orderedFamilyGroups.map(({ definition, entries: familyEntries }) =>
              aggregateRows(
                familyEntries.map((entry) => entry.repoRow),
                {
                  ledgerLevel: 'family',
                  ledgerId: `repository-family:${repositoryRow.repositoryKey}:${providerRow.providerKey}:${definition.key}`,
                  ledgerLabel: definition.label,
                  providerKey: providerRow.providerKey,
                  familyKey: definition.key,
                  repositoryKey: repositoryRow.repositoryKey,
                  childCount: familyEntries.length,
                  exactModelCount: familyEntries.length,
                  isExpandable: familyEntries.length > 0,
                }
              )
            ),
            sorting
          )

          for (const familyRow of familyRows) {
            result.push(familyRow)
            if (!expandedFamilies.has(familyRow.ledgerId)) continue
            const exactEntries =
              familyMap.get(familyRow.familyKey ?? '')?.entries ?? []
            result.push(
              ...sortLedgerRows(
                exactEntries.map((entry) =>
                  toRepositoryPerspectiveModelRow(entry, familyRow.familyKey)
                ),
                sorting
              )
            )
          }
        }
      }

      return result
    }

    const providerMap = modelProviderMap

    const result: LedgerDisplayRow[] = []
    const sortedProviderEntries = sortLedgerRows(
      [...providerMap.entries()].map(([providerKey, providerRows]) =>
        aggregateRows(providerRows, {
          ledgerLevel: 'provider',
          ledgerId: `provider:${providerKey}`,
          ledgerLabel: providerDisplayName(providerKey),
          providerKey,
          childCount: providerRows.length,
          exactModelCount: providerRows.length,
          isExpandable: providerRows.length > 0,
        })
      ),
      sorting
    )

    for (const providerRow of sortedProviderEntries) {
      result.push(providerRow)
      if (!expandedProvidersModel.has(providerRow.providerKey)) continue

      const providerRows = providerMap.get(providerRow.providerKey) ?? []
      const definitions = familyDefinitionsForProvider(
        providerRow.providerKey,
        providerRows
      )

      if (definitions === undefined) {
        const exactRows = sortLedgerRows(
          providerRows.map((row) =>
            toModelDisplayRow(row, providerRow.providerKey)
          ),
          sorting
        )
        for (const exactRow of exactRows) {
          result.push(exactRow)
          if (!expandedModels.has(exactRow.ledgerId)) continue
          result.push(
            ...sortLedgerRows(
              (exactRow.repositoryChildren ?? []).map((repoRow) =>
                toRepositoryDisplayRow(
                  repoRow,
                  providerRow.providerKey,
                  exactRow.familyKey,
                  exactRow.model
                )
              ),
              sorting
            )
          )
        }
        continue
      }

      const familyRows = new Map<
        string,
        { definition: ModelFamilyDefinition; rows: ModelRow[] }
      >()
      for (const row of providerRows) {
        const definition =
          modelFamilyForRow(providerRow.providerKey, row.model) ??
          OTHER_FAMILY_DEFINITION
        const existing = familyRows.get(definition.key) ?? {
          definition,
          rows: [],
        }
        existing.rows.push(row)
        familyRows.set(definition.key, existing)
      }

      const orderedFamilyGroups =
        sorting.length === 0
          ? [
              ...definitions,
              ...(definitions.some(
                (definition) => definition.key === OTHER_FAMILY_DEFINITION.key
              )
                ? []
                : [OTHER_FAMILY_DEFINITION]),
            ]
              .map((definition) => familyRows.get(definition.key))
              .filter(
                (
                  value
                ): value is {
                  definition: ModelFamilyDefinition
                  rows: ModelRow[]
                } => value !== undefined
              )
          : [...familyRows.values()]

      const sortedFamilies = sortLedgerRows(
        orderedFamilyGroups.map(({ definition, rows: familyModelRows }) =>
          aggregateRows(familyModelRows, {
            ledgerLevel: 'family',
            ledgerId: `family:${providerRow.providerKey}:${definition.key}`,
            ledgerLabel: definition.label,
            providerKey: providerRow.providerKey,
            familyKey: definition.key,
            childCount: familyModelRows.length,
            exactModelCount: familyModelRows.length,
            isExpandable: familyModelRows.length > 0,
          })
        ),
        sorting
      )

      for (const familyRow of sortedFamilies) {
        result.push(familyRow)
        if (!expandedFamilies.has(familyRow.ledgerId)) continue

        const exactRows =
          familyRows.get(familyRow.familyKey ?? '')?.rows ??
          familyRows.get(OTHER_FAMILY_DEFINITION.key)?.rows ??
          []
        const modelRows = sortLedgerRows(
          exactRows.map((row) =>
            toModelDisplayRow(row, providerRow.providerKey, familyRow.familyKey)
          ),
          sorting
        )
        for (const modelRow of modelRows) {
          result.push(modelRow)
          if (!expandedModels.has(modelRow.ledgerId)) continue
          result.push(
            ...sortLedgerRows(
              (modelRow.repositoryChildren ?? []).map((repoRow) =>
                toRepositoryDisplayRow(
                  repoRow,
                  providerRow.providerKey,
                  familyRow.familyKey,
                  modelRow.model
                )
              ),
              sorting
            )
          )
        }
      }
    }

    return result
  }, [
    repositoryEntryMap,
    modelProviderMap,
    sorting,
    ledgerView,
    expandedProvidersModel,
    expandedProvidersRepository,
    expandedFamilies,
    expandedModels,
    expandedRepositories,
  ])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API
  const table = useReactTable({
    data: displayRows,
    columns: allColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.ledgerId,
    getCoreRowModel: getCoreRowModel(),
    // Sort descending first so highest values appear at top on first click
    sortDescFirst: true,
  })

  return (
    <>
      {showInternalTabs ? (
        <div role='tablist' aria-label='Ledger view' className='section-tabs'>
          {(['model', 'repository'] as const).map((view) => {
            const selected = ledgerView === view
            return (
              <button
                key={view}
                type='button'
                role='tab'
                aria-selected={selected}
                className={selected ? 'is-active' : undefined}
                onClick={() => {
                  setLedgerView(view)
                }}
              >
                {view === 'model' ? 'Model' : 'Repository'}
              </button>
            )
          })}
        </div>
      ) : null}
      <div
        className='table-wrapper'
        style={{
          width: '100%',
          overflowX: 'auto',
          overflowY: 'auto',
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
                      // C6: cost severity color. D1-065 removes non-sparkline
                      // cell microbars from the Model Ledger.
                      cellColor = costColor(orig.cost_usd)
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else if (colId === 'error_pct') {
                      // C7: err% severity color
                      cellColor = errorPctColor(orig.error_pct)
                      const pct = orig.error_pct
                      const rowProviderKey = orig.providerKey
                      const rowModelKey = orig.model.toLowerCase()
                      const repoScopeKey = orig.repositoryKey
                      // Q8 (Wave 31): filter observations by canonical providerKey + model;
                      // repository-view model rows annotate tooltip with repo scope (S2-3).
                      const rowObs =
                        pct > 0 && orig.ledgerLevel === 'model'
                          ? errorObservations
                              .filter(
                                (o) =>
                                  canonicalProvider(o.provider) ===
                                    rowProviderKey &&
                                  o.model.toLowerCase() === rowModelKey
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
                              {rowObs.length === 1 ? '' : 's'}
                              {repoScopeKey !== undefined
                                ? ` (scoped to: ${repoScopeKey})`
                                : ''}
                              :
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
                    } else if (colId === 'sparkline') {
                      // C9: sparkline tinted by row severity.
                      // ⚠10 fix: an empty spark array causes Sparkline to return
                      // null, which renders as "" in text content.  Guard: treat
                      // undefined and [] the same — fall back to tokens_in when
                      // the array is non-empty, else render the em-dash placeholder.
                      cellColor = 'var(--fg)'
                      const sparkRaw = orig.spark
                      const sparkData =
                        sparkRaw != null && sparkRaw.length > 0
                          ? sparkRaw
                          : orig.tokens_in > 0
                            ? [orig.tokens_in]
                            : null
                      cellContent =
                        sparkData != null ? (
                          <Sparkline data={sparkData} color={severityColor} />
                        ) : (
                          '—'
                        )
                    } else if (colId === 'tool') {
                      // W33: TOOL cell — plain count + optional 2-column hover breakdown.
                      // W36-fix: use fmtCompact per spec; fmtOrDash handles null/undefined
                      // and zero-call rows (renders em-dash, no hover trigger).
                      cellColor = 'var(--accent-cool)'
                      const toolCount = orig.tool
                      // Render '—' for undefined/null; for 0 also render '—' (no calls).
                      const toolLabel =
                        toolCount != null && toolCount > 0
                          ? fmtCompact(toolCount)
                          : '—'
                      const ta = orig.toolActivity
                      if (ta !== undefined && ta.totalCalls > 0) {
                        const leftLayout = buildToolHoverLeftColumns(
                          ta.leftRows
                        )
                        const leftColumns = leftLayout.columns
                        const displayLeftColumns = [...leftColumns].reverse()
                        const leftHiddenCount =
                          leftLayout.hiddenRowCount +
                          (ta.leftTruncated
                            ? Math.max(0, ta.leftTotalCount - LEFT_COL_CAP)
                            : 0)
                        const shellDisplayCap =
                          leftLayout.rowsPerColumn * TOOL_HOVER_MAX_SIDE_COLUMNS
                        const displayedShellRows = ta.shellRows.slice(
                          0,
                          shellDisplayCap
                        )
                        const shellHiddenCount = Math.max(
                          0,
                          ta.shellTotalCount - displayedShellRows.length
                        )
                        const shellColumns = chunkToolHoverRows(
                          displayedShellRows,
                          leftLayout.rowsPerColumn
                        )
                        const leftColumnCount = Math.max(1, leftColumns.length)
                        const shellColumnCount = Math.max(
                          1,
                          shellColumns.length
                        )
                        const tooltipWidthPx = Math.max(
                          340,
                          (leftColumnCount + shellColumnCount) *
                            TOOL_HOVER_COLUMN_WIDTH_PX +
                            TOOL_HOVER_GROUP_GAP_PX
                        )

                        const tooltipContent = (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: `minmax(0, ${leftColumnCount.toString()}fr) minmax(0, ${shellColumnCount.toString()}fr)`,
                              columnGap: `${TOOL_HOVER_GROUP_GAP_PX.toString()}px`,
                              minWidth: 0,
                              width: '100%',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div
                                className='v9-tip-head'
                                style={{ marginBottom: '4px' }}
                              >
                                {orig.ledgerLabel} — tool breakdown
                              </div>
                              <div
                                style={{
                                  fontSize: '9px',
                                  color: 'var(--accent-chrome, #94a3b8)',
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  marginBottom: '2px',
                                  textTransform: 'uppercase',
                                }}
                              >
                                Tools
                              </div>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: `repeat(${leftColumnCount.toString()}, minmax(0, 1fr))`,
                                  columnGap: '8px',
                                  alignItems: 'start',
                                }}
                              >
                                {displayLeftColumns.map((column, columnIdx) => (
                                  <div
                                    key={`tools-${column.label}-${column.sourceIndex.toString()}`}
                                    data-tool-left-column='true'
                                    data-source-index={column.sourceIndex}
                                    style={{ minWidth: 0 }}
                                  >
                                    {column.entries.map((entry, entryIdx) => (
                                      <div
                                        key={`${entry.row.label}-${entryIdx.toString()}`}
                                      >
                                        <div
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            gap: '4px',
                                            fontSize: '9px',
                                            color: 'var(--fg, #e2e8f0)',
                                            padding: '1px 0',
                                            lineHeight: 1.5,
                                            minWidth: 0,
                                          }}
                                        >
                                          <span
                                            style={{
                                              flex: '1 1 auto',
                                              minWidth: 0,
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {entry.row.label}
                                          </span>
                                          <span
                                            style={{
                                              flex: '0 0 auto',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {numFmt(entry.row.calls)}
                                            {'  '}
                                            {entry.row.pct.toFixed(0)}%
                                          </span>
                                        </div>
                                        {entry.subRows.length > 0 && (
                                          <div
                                            style={{
                                              paddingLeft: '8px',
                                              fontSize: '8px',
                                              color: 'var(--fg-muted, #94a3b8)',
                                            }}
                                          >
                                            {entry.subRows.map(
                                              (sr, srIdx, arr) => {
                                                const isLastVisible =
                                                  entry.hiddenSubRowCount ===
                                                    0 &&
                                                  srIdx === arr.length - 1
                                                const prefix = isLastVisible
                                                  ? '└─'
                                                  : '├─'
                                                return (
                                                  <div
                                                    key={`${sr.label}-${srIdx.toString()}`}
                                                    style={{
                                                      padding: '0.5px 0',
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap',
                                                    }}
                                                  >
                                                    {prefix} {sr.label}{' '}
                                                    {numFmt(sr.calls)}
                                                  </div>
                                                )
                                              }
                                            )}
                                            {entry.hiddenSubRowCount > 0 && (
                                              <div>
                                                {`+${entry.hiddenSubRowCount.toString()} more`}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {columnIdx === 0 && leftHiddenCount > 0 && (
                                      <div
                                        style={{
                                          fontSize: '9px',
                                          color: 'var(--fg-muted, #94a3b8)',
                                          fontStyle: 'italic',
                                          padding: '1px 0',
                                        }}
                                      >
                                        {`+${leftHiddenCount.toString()} more`}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div style={{ minWidth: 0 }}>
                              <div
                                className='v9-tip-head'
                                style={{ marginBottom: '4px' }}
                              >
                                &nbsp;
                              </div>
                              <div
                                style={{
                                  fontSize: '9px',
                                  color: 'var(--accent-chrome, #94a3b8)',
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  marginBottom: '2px',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {`Shell (${numFmt(ta.shellTotalCalls)} calls)`}
                              </div>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: `repeat(${shellColumnCount.toString()}, minmax(0, 1fr))`,
                                  columnGap: '8px',
                                  alignItems: 'start',
                                }}
                              >
                                {shellColumns.map((columnRows, columnIdx) => (
                                  <div
                                    key={`shell-${columnIdx.toString()}`}
                                    style={{ minWidth: 0 }}
                                  >
                                    {columnRows.map((sr) => (
                                      <div
                                        key={sr.label}
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          gap: '4px',
                                          fontSize: '9px',
                                          color: 'var(--fg, #e2e8f0)',
                                          padding: '1px 0',
                                          lineHeight: 1.5,
                                          minWidth: 0,
                                        }}
                                      >
                                        <span
                                          style={{
                                            flex: '1 1 auto',
                                            minWidth: 0,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {sr.label}
                                        </span>
                                        <span
                                          style={{
                                            flex: '0 0 auto',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {numFmt(sr.calls)}
                                        </span>
                                      </div>
                                    ))}
                                    {columnIdx === shellColumns.length - 1 &&
                                      shellHiddenCount > 0 && (
                                        <div
                                          style={{
                                            fontSize: '9px',
                                            color: 'var(--fg-muted, #94a3b8)',
                                            fontStyle: 'italic',
                                            padding: '1px 0',
                                          }}
                                        >
                                          {`+${shellHiddenCount.toString()} more`}
                                        </div>
                                      )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                        cellContent = (
                          <HoverTooltip
                            variant='quota-bar'
                            content={tooltipContent}
                            panelStyle={{
                              maxWidth: 'calc(100vw - 16px)',
                              width: `min(${tooltipWidthPx.toString()}px, calc(100vw - 16px))`,
                            }}
                          >
                            {toolLabel}
                          </HoverTooltip>
                        )
                      } else {
                        // Zero tool calls or no toolActivity data: no hover
                        cellContent = toolLabel
                      }
                    } else if (colId === 'model') {
                      // Model hierarchy: provider rows expand to family/model/
                      // repository rows without changing the raw data shape.
                      cellColor = 'var(--fg)'
                      const isProviderRow = orig.ledgerLevel === 'provider'
                      const isFamilyRow = orig.ledgerLevel === 'family'
                      const isModelRow = orig.ledgerLevel === 'model'
                      const isRepositoryRow = orig.ledgerLevel === 'repository'
                      const isExpanded = isProviderRow
                        ? ledgerView === 'repository'
                          ? expandedProvidersRepository.has(orig.ledgerId)
                          : expandedProvidersModel.has(orig.providerKey)
                        : isFamilyRow
                          ? expandedFamilies.has(orig.ledgerId)
                          : isModelRow
                            ? expandedModels.has(orig.ledgerId)
                            : isRepositoryRow
                              ? expandedRepositories.has(orig.ledgerId)
                              : false
                      const indentPx =
                        orig.ledgerLevel === 'repository'
                          ? orig.isExpandable
                            ? 0
                            : 44
                          : orig.ledgerLevel === 'model'
                            ? 30
                            : orig.ledgerLevel === 'family'
                              ? 16
                              : 0
                      const toggleExpansion = (): void => {
                        if (isProviderRow) {
                          if (ledgerView === 'repository') {
                            setExpandedProvidersRepository((current) => {
                              const next = new Set(current)
                              if (next.has(orig.ledgerId)) {
                                next.delete(orig.ledgerId)
                              } else {
                                next.add(orig.ledgerId)
                              }
                              return next
                            })
                          } else {
                            setExpandedProvidersModel((current) => {
                              const next = new Set(current)
                              if (next.has(orig.providerKey)) {
                                next.delete(orig.providerKey)
                              } else {
                                next.add(orig.providerKey)
                              }
                              return next
                            })
                          }
                          return
                        }
                        if (isRepositoryRow && orig.isExpandable) {
                          setExpandedRepositories((current) => {
                            const next = new Set(current)
                            if (next.has(orig.ledgerId)) {
                              next.delete(orig.ledgerId)
                            } else {
                              next.add(orig.ledgerId)
                            }
                            return next
                          })
                          return
                        }
                        if (isFamilyRow) {
                          setExpandedFamilies((current) => {
                            const next = new Set(current)
                            if (next.has(orig.ledgerId)) {
                              next.delete(orig.ledgerId)
                            } else {
                              next.add(orig.ledgerId)
                            }
                            return next
                          })
                          return
                        }
                        if (isModelRow) {
                          setExpandedModels((current) => {
                            const next = new Set(current)
                            if (next.has(orig.ledgerId)) {
                              next.delete(orig.ledgerId)
                            } else {
                              next.add(orig.ledgerId)
                            }
                            return next
                          })
                        }
                      }

                      cellContent = (
                        <div
                          data-ledger-level={orig.ledgerLevel}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            minWidth: 0,
                            paddingLeft: `${indentPx.toString()}px`,
                          }}
                        >
                          {orig.isExpandable ? (
                            <button
                              type='button'
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${orig.ledgerLabel} ${orig.ledgerLevel} rows`}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpansion()
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '16px',
                                height: '16px',
                                flex: '0 0 16px',
                                padding: 0,
                                border: '0',
                                background: 'transparent',
                                color: providerColor,
                                cursor: 'pointer',
                              }}
                            >
                              {isExpanded ? (
                                <ChevronDown size={13} aria-hidden='true' />
                              ) : (
                                <ChevronRight size={13} aria-hidden='true' />
                              )}
                            </button>
                          ) : (
                            <span
                              aria-hidden='true'
                              style={{ width: '16px', flex: '0 0 16px' }}
                            />
                          )}
                          <span
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color:
                                orig.ledgerLevel === 'model' ||
                                orig.ledgerLevel === 'repository'
                                  ? 'var(--fg)'
                                  : providerColor,
                              fontWeight:
                                orig.ledgerLevel === 'repository'
                                  ? 400
                                  : orig.ledgerLevel === 'model'
                                    ? 500
                                    : 700,
                            }}
                          >
                            {orig.ledgerLabel}
                          </span>
                          {orig.ledgerLevel !== 'repository' &&
                            (orig.ledgerLevel !== 'model' ||
                              orig.childCount > 0) && (
                              <span
                                style={{
                                  flex: '0 0 auto',
                                  color: 'var(--fg-muted)',
                                  fontSize: '9px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {orig.ledgerLevel === 'model'
                                  ? `${orig.childCount.toString()} ${
                                      orig.childCount === 1 ? 'repo' : 'repos'
                                    }`
                                  : `${orig.exactModelCount.toString()} ${
                                      orig.exactModelCount === 1
                                        ? 'model'
                                        : 'models'
                                    }`}
                              </span>
                            )}
                        </div>
                      )
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

                    // Build className: meta class + optional number class
                    const tdClassName =
                      [meta?.className, isNumericCell ? 'number' : undefined]
                        .filter(Boolean)
                        .join(' ') || undefined

                    return (
                      <td
                        key={cell.id}
                        data-col-id={colId}
                        className={tdClassName}
                        style={{
                          padding: '6px 8px',
                          fontFamily: 'var(--font-mono)',
                          color: cellColor,
                          borderRight: '1px solid var(--border)',
                          borderLeft: isFirst ? '4px solid' : undefined,
                          borderLeftColor: isFirst ? providerColor : undefined,
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

export const MasterLedgerTable = memo(MasterLedgerTableInner)
