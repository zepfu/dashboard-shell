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
 *   column (col 8). Sorts on combined value. Estimated shown as "(+N*)" suffix
 *   only when reasoning_estimated > 0.
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
import { useState, useMemo, type ReactElement } from 'react'
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
import { fmtCompact, numFmt } from '../lib/format-utils'
import {
  providerBrandHex,
  canonicalProvider,
  formatModelDisplayName,
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

// ---------------------------------------------------------------------------
// W33 Tool Activity — types and constants
// ---------------------------------------------------------------------------

/**
 * Shell-class tool names that are NOT shown in the left TOOLS column.
 * They are instead aggregated into the right SHELL column header count.
 * Must stay in sync with the server's shell-classification list.
 */
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
  // 4K-only optional fields
  cache_pct?: number
  queue?: number
  resets?: number
  // Wave 26 — new cache/reasoning columns (operator F#12)
  /** Percentage of total row USD cost attributed to cache miss premium
   *  (cache_miss_usd_cost / usd_cost × 100). Range 0–100. */
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
  // W33: pre-processed tool activity for TOOL cell hover tooltip
  toolActivity?: ModelToolActivity
  /** Display-only repository children for exact model drilldown. */
  repositoryChildren?: ModelRow[]
}

type LedgerLevel = 'provider' | 'family' | 'model' | 'repository'
type LedgerView = 'model' | 'repository'

interface LedgerDisplayRow extends ModelRow {
  ledgerLevel: LedgerLevel
  ledgerId: string
  ledgerLabel: string
  providerKey: string
  familyKey?: string
  repositoryKey?: string
  childCount: number
  exactModelCount: number
  isExpandable: boolean
}

interface RepositoryModelEntry {
  repository: string
  providerKey: string
  sourceRow: ModelRow
  repoRow: ModelRow
  family: ModelFamilyDefinition | null
}

interface ModelFamilyDefinition {
  key: string
  label: string
  matches: (model: string) => boolean
}

const MODEL_FAMILY_DEFINITIONS: Record<string, ModelFamilyDefinition[]> = {
  anthropic: [
    {
      key: 'opus',
      label: 'Opus',
      matches: (model) => model.includes('opus'),
    },
    {
      key: 'sonnet',
      label: 'Sonnet',
      matches: (model) => model.includes('sonnet'),
    },
    {
      key: 'haiku',
      label: 'Haiku',
      matches: (model) => model.includes('haiku'),
    },
    {
      key: 'auto-review',
      label: 'Auto Review',
      matches: (model) =>
        model.includes('auto-review') ||
        model.includes('auto_review') ||
        model.includes('auto review'),
    },
  ],
  openai: [
    {
      key: 'codex-spark',
      label: 'Codex Spark',
      matches: (model) => model.includes('codex-spark'),
    },
    {
      key: 'codex',
      label: 'Codex',
      matches: (model) => model.includes('codex'),
    },
    {
      key: 'mini',
      label: 'Mini',
      matches: (model) => model.includes('mini'),
    },
    {
      key: 'gpt',
      label: 'GPT',
      matches: (model) => model.includes('gpt'),
    },
  ],
  google: [
    {
      key: 'flash-lite',
      label: 'Flash Lite',
      matches: (model) =>
        model.includes('flash-lite') ||
        model.includes('flash_lite') ||
        model.includes('flash lite'),
    },
    {
      key: 'flash',
      label: 'Flash',
      matches: (model) => model.includes('flash'),
    },
    {
      key: 'pro',
      label: 'Pro',
      matches: (model) => model.includes('pro'),
    },
  ],
}

const OTHER_FAMILY_DEFINITION: ModelFamilyDefinition = {
  key: 'other',
  label: 'Other',
  matches: () => true,
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

function formatOpenRouterVendorLabel(vendor: string): string {
  const normalized = vendor.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'xai') return 'xAI'
  if (normalized === 'qwen') return 'Qwen'
  if (normalized === 'inclusionai') return 'InclusionAI'
  if (normalized === 'deepseek') return 'DeepSeek'
  return formatModelDisplayName(vendor)
}

function inferOpenRouterVendor(model: string): string {
  const normalized = model
    .toLowerCase()
    .replace(/^openrouter\//, '')
    .replace(/:(free|stealth)$/i, '')
  const parts = normalized.split('/').filter(Boolean)
  const pathVendor =
    parts.length > 1
      ? parts[0] === 'free' && parts[1] !== undefined
        ? parts[1]
        : parts[0]
      : undefined
  if (pathVendor !== undefined) return pathVendor
  if (normalized.startsWith('qwen')) return 'qwen'
  if (
    normalized.startsWith('gpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'openai'
  }
  if (normalized.startsWith('claude')) return 'anthropic'
  if (normalized.startsWith('gemini')) return 'google'
  if (normalized.startsWith('grok')) return 'xai'
  if (normalized.startsWith('llama')) return 'meta'
  if (normalized.startsWith('deepseek')) return 'deepseek'
  if (normalized.startsWith('cohere')) return 'cohere'
  if (normalized.startsWith('mistral')) return 'mistral'
  if (normalized.startsWith('minimax')) return 'minimax'
  if (normalized.startsWith('nvidia')) return 'nvidia'
  if (normalized.startsWith('inclusion')) return 'inclusionai'
  return 'other'
}

function openRouterFamilyForModel(model: string): ModelFamilyDefinition {
  const vendor = inferOpenRouterVendor(model)
  const key = vendor.replace(/[^a-z0-9-]+/g, '-')
  return {
    key,
    label: formatOpenRouterVendorLabel(vendor),
    matches: (candidate) =>
      inferOpenRouterVendor(candidate).replace(/[^a-z0-9-]+/g, '-') === key,
  }
}

function familyDefinitionsForProvider(
  providerKey: string,
  rows: readonly ModelRow[]
): ModelFamilyDefinition[] | undefined {
  if (providerKey !== 'openrouter') return MODEL_FAMILY_DEFINITIONS[providerKey]

  const definitions = new Map<string, ModelFamilyDefinition>()
  for (const row of rows) {
    const definition = openRouterFamilyForModel(row.model)
    definitions.set(definition.key, definition)
  }
  return [...definitions.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  )
}

function modelFamilyForRow(
  provider: string,
  model: string
): ModelFamilyDefinition | null {
  const providerKey = canonicalProvider(provider)
  if (providerKey === 'openrouter') return openRouterFamilyForModel(model)

  const definitions = MODEL_FAMILY_DEFINITIONS[providerKey]
  if (definitions === undefined) return null
  const normalizedModel = model.toLowerCase()
  return (
    definitions.find((definition) => definition.matches(normalizedModel)) ??
    OTHER_FAMILY_DEFINITION
  )
}

function formatLedgerModelDisplayName(
  providerKey: string,
  model: string
): string {
  if (providerKey === 'anthropic') {
    const normalized = model.trim()
    const match = normalized.match(
      /^claude[-_\s]+(opus|sonnet|haiku)[-_\s]+(\d+)[-_.\s]+(\d+)(.*)$/i
    )
    if (match) {
      const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
      const suffix = match[4].trim()
      return `${family} ${match[2]}.${match[3]}${suffix ? ` ${suffix}` : ''}`
    }
    return formatModelDisplayName(normalized).replace(/^Claude\s+/i, '')
  }
  return formatModelDisplayName(model)
}

function sumSpark(rows: readonly ModelRow[]): number[] | undefined {
  const maxLength = Math.max(0, ...rows.map((row) => row.spark?.length ?? 0))
  if (maxLength === 0) return undefined

  return Array.from({ length: maxLength }, (_value, index) =>
    rows.reduce((sum, row) => sum + (row.spark?.[index] ?? 0), 0)
  )
}

function aggregateRows(
  rows: readonly ModelRow[],
  overrides: Pick<
    LedgerDisplayRow,
    | 'ledgerLevel'
    | 'ledgerId'
    | 'ledgerLabel'
    | 'providerKey'
    | 'familyKey'
    | 'repositoryKey'
    | 'childCount'
    | 'exactModelCount'
    | 'isExpandable'
  >
): LedgerDisplayRow {
  const requests = rows.reduce((sum, row) => sum + row.requests, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost_usd, 0)
  const cacheToks = rows.reduce((sum, row) => sum + (row.cache_toks ?? 0), 0)
  const cacheMissCost = rows.reduce(
    (sum, row) => sum + (row.cache_miss_usd_cost ?? 0),
    0
  )
  const weightedErrorTotal = rows.reduce(
    (sum, row) => sum + row.error_pct * row.requests,
    0
  )
  const optionalSum = (
    selector: (row: ModelRow) => number | undefined,
    keepZero = false
  ): number | undefined => {
    const values = rows
      .map(selector)
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) return undefined
    const total = values.reduce((sum, value) => sum + value, 0)
    return total > 0 || keepZero ? total : undefined
  }

  return {
    model: overrides.ledgerLabel,
    provider: overrides.providerKey,
    tokens_in: rows.reduce((sum, row) => sum + row.tokens_in, 0),
    tokens_out: rows.reduce((sum, row) => sum + row.tokens_out, 0),
    requests,
    p50_ms: Math.max(0, ...rows.map((row) => row.p50_ms)),
    p95_ms: Math.max(0, ...rows.map((row) => row.p95_ms)),
    error_pct:
      requests > 0 ? Math.round((weightedErrorTotal / requests) * 10) / 10 : 0,
    cost_usd: cost,
    cache_pct:
      cacheToks > 0 && rows.some((row) => row.tokens_in > 0)
        ? Math.round(
            (cacheToks /
              Math.max(
                1,
                rows.reduce((sum, row) => sum + row.tokens_in, 0)
              )) *
              1000
          ) / 10
        : undefined,
    cache_miss_pct:
      cacheMissCost > 0 && cost > 0
        ? Math.round((cacheMissCost / cost) * 1000) / 10
        : undefined,
    cache_miss_usd_cost: cacheMissCost > 0 ? cacheMissCost : undefined,
    reasoning_reported: optionalSum((row) => row.reasoning_reported, true),
    reasoning_estimated: optionalSum((row) => row.reasoning_estimated, true),
    cache_toks: cacheToks > 0 ? cacheToks : undefined,
    tool: optionalSum((row) => row.tool),
    git_commits: optionalSum((row) => row.git_commits),
    git_pushes: optionalSum((row) => row.git_pushes),
    inval: optionalSum((row) => row.inval),
    spark: sumSpark(rows),
    toolActivity: undefined,
    ...overrides,
  }
}

function toModelDisplayRow(
  row: ModelRow,
  providerKey: string,
  familyKey?: string
): LedgerDisplayRow {
  const repositoryChildCount = row.repositoryChildren?.length ?? 0
  return {
    ...row,
    provider: providerKey,
    ledgerLevel: 'model',
    ledgerId: `model:${providerKey}:${familyKey ?? 'direct'}:${row.model}`,
    ledgerLabel: formatLedgerModelDisplayName(providerKey, row.model),
    providerKey,
    familyKey,
    childCount: repositoryChildCount,
    exactModelCount: 1,
    isExpandable: repositoryChildCount > 0,
  }
}

function toRepositoryDisplayRow(
  row: ModelRow,
  providerKey: string,
  familyKey: string | undefined,
  parentModel: string
): LedgerDisplayRow {
  const repositoryKey = row.model
  return {
    ...row,
    provider: providerKey,
    ledgerLevel: 'repository',
    ledgerId: `repository:${providerKey}:${familyKey ?? 'direct'}:${parentModel}:${repositoryKey}`,
    ledgerLabel: repositoryKey,
    providerKey,
    familyKey,
    repositoryKey,
    childCount: 0,
    exactModelCount: 0,
    isExpandable: false,
  }
}

function toRepositoryPerspectiveModelRow(
  entry: RepositoryModelEntry,
  familyKey?: string
): LedgerDisplayRow {
  return {
    ...entry.repoRow,
    model: entry.sourceRow.model,
    provider: entry.providerKey,
    ledgerLevel: 'model',
    ledgerId: `repository-model:${entry.repository}:${entry.providerKey}:${familyKey ?? 'direct'}:${entry.sourceRow.model}`,
    ledgerLabel: formatLedgerModelDisplayName(
      entry.providerKey,
      entry.sourceRow.model
    ),
    providerKey: entry.providerKey,
    familyKey,
    repositoryKey: entry.repository,
    childCount: 0,
    exactModelCount: 1,
    isExpandable: false,
  }
}

function compareLedgerValues(
  left: LedgerDisplayRow,
  right: LedgerDisplayRow,
  columnId: string
): number {
  const valueFor = (row: LedgerDisplayRow): number | string => {
    switch (columnId) {
      case 'model':
        return row.ledgerLabel
      case 'provider':
        return row.provider
      case 'reasoning':
        return (row.reasoning_reported ?? 0) + (row.reasoning_estimated ?? 0)
      case 'sparkline':
        return row.spark?.reduce((sum, value) => sum + value, 0) ?? 0
      default: {
        const value = row[columnId as keyof ModelRow]
        if (typeof value === 'number' || typeof value === 'string') {
          return value
        }
        return 0
      }
    }
  }

  const leftValue = valueFor(left)
  const rightValue = valueFor(right)
  if (typeof leftValue === 'string' || typeof rightValue === 'string') {
    return String(leftValue).localeCompare(String(rightValue), undefined, {
      sensitivity: 'base',
    })
  }
  return leftValue - rightValue
}

function sortLedgerRows<T extends LedgerDisplayRow>(
  rows: readonly T[],
  sorting: SortingState
): T[] {
  if (sorting.length === 0) return [...rows]
  return [...rows].sort((left, right) => {
    for (const sort of sorting) {
      const result = compareLedgerValues(left, right, sort.id)
      if (result !== 0) return sort.desc ? -result : result
    }
    return 0
  })
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
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, numFmt),
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
    cell: (info) =>
      fmtOrDash(info.getValue() as number | null | undefined, formatUsd),
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

// Cols 9–12: latency + error + cost group
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

// Cols 17–20: 5K-only columns
// W33/W36-fix: TOOL column has no responsive-class guard — it is always visible.
// The col-5k-only guard was the primary reason the TOOL column never appeared:
// display:none below 5120px meant virtually no user ever saw it. The column is
// intentionally ungated so it shows on 1080p/1440p/4K displays alongside the
// rest of the base ledger. GIT/INVAL columns remain col-5k-only (rarely needed).
const fiveKColumns = [
  helper.accessor('tool', {
    id: 'tool',
    header: 'TOOL',
    // No meta className — column is always visible (not 5K-gated).
    // W33: cell rendering is handled in MasterLedgerTable body so we can access
    // the full row's toolActivity field to build the 2-column hover tooltip.
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
    // Cell rendering is handled in MasterLedgerTable body to access severity color
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
 * coloring, provider/family/model drilldown, and per-row sparkline tinting.
 *
 * Wave 20-Tables (F5): caption rendered from inside the component.
 * Wave 29 Fix #9: caption removed per operator direction.
 */
export function MasterLedgerTable({
  rows,
  errorObservations = [],
}: MasterLedgerTableProps): ReactElement {
  const [ledgerView, setLedgerView] = useState<LedgerView>('model')
  const [sorting, setSorting] = useState<SortingState>([])
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedModels, setExpandedModels] = useState<Set<string>>(
    () => new Set()
  )
  const [expandedRepositories, setExpandedRepositories] = useState<Set<string>>(
    () => new Set()
  )

  const displayRows = useMemo(() => {
    if (ledgerView === 'repository') {
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
          if (!expandedProviders.has(providerRow.ledgerId)) continue

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

    const providerMap = new Map<string, ModelRow[]>()
    for (const row of rows) {
      const providerKey = canonicalProvider(row.provider)
      const providerRows = providerMap.get(providerKey) ?? []
      providerRows.push(row)
      providerMap.set(providerKey, providerRows)
    }

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
      if (!expandedProviders.has(providerRow.providerKey)) continue

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
    rows,
    sorting,
    ledgerView,
    expandedProviders,
    expandedFamilies,
    expandedModels,
    expandedRepositories,
  ])

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
      <div
        role='tablist'
        aria-label='Ledger view'
        style={{
          display: 'inline-flex',
          gap: '4px',
          marginBottom: '8px',
          padding: '3px',
          border: '1px solid var(--border)',
          background: 'var(--card)',
        }}
      >
        {(['model', 'repository'] as const).map((view) => {
          const selected = ledgerView === view
          return (
            <button
              key={view}
              type='button'
              role='tab'
              aria-selected={selected}
              onClick={() => {
                setLedgerView(view)
              }}
              style={{
                minWidth: '88px',
                padding: '5px 10px',
                border: '1px solid',
                borderColor: selected ? 'var(--accent-chrome)' : 'transparent',
                background: selected ? 'var(--card-2)' : 'transparent',
                color: selected ? 'var(--accent-chrome)' : 'var(--fg-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {view === 'model' ? 'Model' : 'Repository'}
            </button>
          )
        })}
      </div>
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
                      const rowProvider = orig.provider.toLowerCase()
                      const rowModel = orig.model.toLowerCase()
                      // Q8 (Wave 31): filter observations to this row's provider+model,
                      // sort newest-first and cap at MAX_ERROR_HOVER_ROWS.
                      const rowObs =
                        pct > 0 && orig.ledgerLevel === 'model'
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
                        ? expandedProviders.has(orig.ledgerId) ||
                          expandedProviders.has(orig.providerKey)
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
                          setExpandedProviders((current) => {
                            const next = new Set(current)
                            const expansionKey =
                              ledgerView === 'repository'
                                ? orig.ledgerId
                                : orig.providerKey
                            if (next.has(expansionKey)) {
                              next.delete(expansionKey)
                            } else {
                              next.add(expansionKey)
                            }
                            return next
                          })
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
