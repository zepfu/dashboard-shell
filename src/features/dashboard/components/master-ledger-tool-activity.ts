/**
 * Tool activity rollup for Master Ledger TOOL column.
 */
import { type UsageReportToolActivityRow } from '../api/usage-report'

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
export const TOOL_HOVER_ROWS_PER_COLUMN = 14

/** Maximum compact columns retained per side before truncating source rows. */
export const TOOL_HOVER_MAX_SIDE_COLUMNS = 3

/** Maximum visual rows used when an MCP column expands its subtools. */
const TOOL_HOVER_MAX_VISUAL_ROWS_PER_COLUMN = 28

/** Approximate width budget for each rendered TOOL hover column. */
export const TOOL_HOVER_COLUMN_WIDTH_PX = 140

/** Gap between the Tools and Shell groups in the TOOL hover. */
export const TOOL_HOVER_GROUP_GAP_PX = 12

/** Maximum non-MCP tool rows retained for the left-side hover columns. */
export const LEFT_COL_CAP =
  TOOL_HOVER_ROWS_PER_COLUMN * TOOL_HOVER_MAX_SIDE_COLUMNS

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

export function chunkToolHoverRows<T>(
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

export function buildToolHoverLeftColumns(rows: readonly ToolLeftRow[]): {
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
