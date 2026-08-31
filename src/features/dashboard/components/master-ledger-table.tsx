/**
 * MasterLedgerTable — sortable TanStack Table for per-model usage metrics.
 * W11: orchestration; see master-ledger-columns, tooltips, tool-activity, aggregation.
 */
import {
  memo,
  useState,
  useMemo,
  useEffect,
  type CSSProperties,
  type ReactElement,
} from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type UsageReportProviderErrorObservationRow } from '../api/usage-report'
import { fmtCompact, numFmt } from '../lib/format-utils'
import {
  providerBrandHex,
  canonicalProvider,
} from '../lib/usage-report-display'
import {
  aggregateRows,
  sortLedgerRows,
  toModelDisplayRow,
  resolveFamilyRows,
  toRepositoryDisplayRow,
  toRepositoryPerspectiveModelRow,
  type LedgerDisplayRow,
  type LedgerView,
  type ModelRow,
  type RepositoryModelEntry,
} from './master-ledger-aggregation'
import { masterLedgerAllColumns } from './master-ledger-columns'
import {
  costColor,
  errorPctColor,
  formatObservedAgo,
  providerDisplayName,
  rowSeverityColor,
  MAX_ERROR_HOVER_ROWS,
} from './master-ledger-format'
import {
  familyDefinitionsForProvider,
  modelFamilyForRow,
  OTHER_FAMILY_DEFINITION,
  type ModelFamilyDefinition,
} from './master-ledger-model-meta'
import { MasterLedgerSortHeader } from './master-ledger-table-sort-header'
import {
  buildToolHoverLeftColumns,
  chunkToolHoverRows,
  LEFT_COL_CAP,
  TOOL_HOVER_COLUMN_WIDTH_PX,
  TOOL_HOVER_GROUP_GAP_PX,
  TOOL_HOVER_MAX_SIDE_COLUMNS,
} from './master-ledger-tool-activity'
import { HoverTooltip } from './primitives/hover-tooltip'
import { Sparkline } from './primitives/sparkline'

export type ProviderErrorObservation = UsageReportProviderErrorObservationRow

export interface MasterLedgerTableProps {
  rows: ModelRow[]
  ledgerView?: LedgerView
  onLedgerViewChange?: (view: LedgerView) => void
  errorObservations?: ProviderErrorObservation[]
}

const LEDGER_TOOLTIP_PANEL_STYLE = Object.freeze({
  maxWidth: 'calc(100vw - 16px)',
} satisfies CSSProperties)

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

  const errorObservationsByModelKey = useMemo(() => {
    const map = new Map<string, ProviderErrorObservation[]>()
    for (const observation of errorObservations) {
      const key = `${canonicalProvider(observation.provider)}::${observation.model.toLowerCase()}`
      const existing = map.get(key) ?? []
      existing.push(observation)
      map.set(key, existing)
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const aMs = a.observed_at ? new Date(a.observed_at).getTime() : 0
        const bMs = b.observed_at ? new Date(b.observed_at).getTime() : 0
        return bMs - aMs
      })
    }
    return map
  }, [errorObservations])

  const repositoryEntryMap = useMemo(() => {
    const repositoryMap = new Map<string, RepositoryModelEntry[]>()
    for (const sourceRow of rows) {
      const providerKey = canonicalProvider(sourceRow.provider)
      const family = modelFamilyForRow(providerKey, sourceRow.model)
      for (const repoRow of sourceRow.repositoryChildren ?? []) {
        const repository = repoRow.model
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

  /**
   * Expansion-independent aggregation tree for model view (P05-F03).
   * Provider/family aggregates are computed once per rows/sorting change so
   * toggling one provider's expansion does not re-run aggregateRows for
   * unrelated collapsed groups.
   */
  const modelLedgerTree = useMemo(() => {
    type ModelNode = {
      row: LedgerDisplayRow
      repositoryChildren: LedgerDisplayRow[]
    }
    type FamilyNode = {
      row: LedgerDisplayRow
      models: ModelNode[]
    }
    type ProviderNode = {
      row: LedgerDisplayRow
      directModels?: ModelNode[]
      families?: FamilyNode[]
    }

    const providerNodes: ProviderNode[] = []
    for (const [providerKey, providerRows] of modelProviderMap.entries()) {
      const providerRow = aggregateRows(providerRows, {
        ledgerLevel: 'provider',
        ledgerId: `provider:${providerKey}`,
        ledgerLabel: providerDisplayName(providerKey),
        providerKey,
        childCount: providerRows.length,
        exactModelCount: providerRows.length,
        isExpandable: providerRows.length > 0,
      })

      const definitions = familyDefinitionsForProvider(
        providerKey,
        providerRows
      )

      if (definitions === undefined) {
        const models: ModelNode[] = sortLedgerRows(
          providerRows.map((row) => toModelDisplayRow(row, providerKey)),
          sorting
        ).map((modelRow) => ({
          row: modelRow,
          repositoryChildren: sortLedgerRows(
            (modelRow.repositoryChildren ?? []).map((repoRow) =>
              toRepositoryDisplayRow(
                repoRow,
                providerKey,
                modelRow.familyKey,
                modelRow.model
              )
            ),
            sorting
          ),
        }))
        providerNodes.push({ row: providerRow, directModels: models })
        continue
      }

      const familyRows = new Map<
        string,
        { definition: ModelFamilyDefinition; rows: ModelRow[] }
      >()
      for (const row of providerRows) {
        const definition =
          modelFamilyForRow(providerKey, row.model) ?? OTHER_FAMILY_DEFINITION
        const existing = familyRows.get(definition.key) ?? {
          definition,
          rows: [],
        }
        existing.rows.push(row)
        familyRows.set(definition.key, existing)
      }

      const families: FamilyNode[] = sortLedgerRows(
        [...familyRows.values()].map(({ definition, rows: familyModelRows }) =>
          aggregateRows(familyModelRows, {
            ledgerLevel: 'family',
            ledgerId: `family:${providerKey}:${definition.key}`,
            ledgerLabel: definition.label,
            providerKey,
            familyKey: definition.key,
            childCount: familyModelRows.length,
            exactModelCount: familyModelRows.length,
            isExpandable: familyModelRows.length > 0,
          })
        ),
        sorting
      ).map((familyRow) => {
        const exactRows = resolveFamilyRows(familyRows, familyRow.familyKey)
        const models: ModelNode[] = sortLedgerRows(
          exactRows.map((row) =>
            toModelDisplayRow(row, providerKey, familyRow.familyKey)
          ),
          sorting
        ).map((modelRow) => ({
          row: modelRow,
          repositoryChildren: sortLedgerRows(
            (modelRow.repositoryChildren ?? []).map((repoRow) =>
              toRepositoryDisplayRow(
                repoRow,
                providerKey,
                familyRow.familyKey,
                modelRow.model
              )
            ),
            sorting
          ),
        }))
        return { row: familyRow, models }
      })

      providerNodes.push({ row: providerRow, families })
    }

    const sortedProviderRows = sortLedgerRows(
      providerNodes.map((node) => node.row),
      sorting
    )
    const nodeById = new Map(providerNodes.map((n) => [n.row.ledgerId, n]))
    return sortedProviderRows
      .map((row) => nodeById.get(row.ledgerId))
      .filter((node): node is ProviderNode => node !== undefined)
  }, [modelProviderMap, sorting])

  /**
   * Expansion-independent aggregation tree for repository view (P05-F03).
   */
  const repositoryLedgerTree = useMemo(() => {
    type ModelNode = {
      row: LedgerDisplayRow
    }
    type FamilyNode = {
      row: LedgerDisplayRow
      models: ModelNode[]
    }
    type ProviderNode = {
      row: LedgerDisplayRow
      directModels?: ModelNode[]
      families?: FamilyNode[]
    }
    type RepositoryNode = {
      row: LedgerDisplayRow
      providers: ProviderNode[]
    }

    const repositoryNodes: RepositoryNode[] = []
    for (const [repository, entries] of repositoryEntryMap.entries()) {
      const repositoryRow = aggregateRows(
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

      const providerMap = new Map<string, RepositoryModelEntry[]>()
      for (const entry of entries) {
        const providerEntries = providerMap.get(entry.providerKey) ?? []
        providerEntries.push(entry)
        providerMap.set(entry.providerKey, providerEntries)
      }

      const providers: ProviderNode[] = []
      for (const [providerKey, providerEntries] of providerMap.entries()) {
        const providerRow = aggregateRows(
          providerEntries.map((entry) => entry.repoRow),
          {
            ledgerLevel: 'provider',
            ledgerId: `repository-provider:${repository}:${providerKey}`,
            ledgerLabel: providerDisplayName(providerKey),
            providerKey,
            repositoryKey: repository,
            childCount: providerEntries.length,
            exactModelCount: providerEntries.length,
            isExpandable: providerEntries.length > 0,
          }
        )

        const definitions = familyDefinitionsForProvider(
          providerKey,
          providerEntries.map((entry) => entry.sourceRow)
        )

        if (definitions === undefined) {
          const models: ModelNode[] = sortLedgerRows(
            providerEntries.map((entry) =>
              toRepositoryPerspectiveModelRow(entry)
            ),
            sorting
          ).map((row) => ({ row }))
          providers.push({ row: providerRow, directModels: models })
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

        const families: FamilyNode[] = sortLedgerRows(
          [...familyMap.values()].map(
            ({ definition, entries: familyEntries }) =>
              aggregateRows(
                familyEntries.map((entry) => entry.repoRow),
                {
                  ledgerLevel: 'family',
                  ledgerId: `repository-family:${repository}:${providerKey}:${definition.key}`,
                  ledgerLabel: definition.label,
                  providerKey,
                  familyKey: definition.key,
                  repositoryKey: repository,
                  childCount: familyEntries.length,
                  exactModelCount: familyEntries.length,
                  isExpandable: familyEntries.length > 0,
                }
              )
          ),
          sorting
        ).map((familyRow) => {
          const exactEntries =
            familyMap.get(familyRow.familyKey ?? '')?.entries ?? []
          const models: ModelNode[] = sortLedgerRows(
            exactEntries.map((entry) =>
              toRepositoryPerspectiveModelRow(entry, familyRow.familyKey)
            ),
            sorting
          ).map((row) => ({ row }))
          return { row: familyRow, models }
        })

        providers.push({ row: providerRow, families })
      }

      const sortedProviderRows = sortLedgerRows(
        providers.map((p) => p.row),
        sorting
      )
      const providerById = new Map(providers.map((p) => [p.row.ledgerId, p]))
      repositoryNodes.push({
        row: repositoryRow,
        providers: sortedProviderRows
          .map((row) => providerById.get(row.ledgerId))
          .filter((node): node is ProviderNode => node !== undefined),
      })
    }

    const sortedRepoRows = sortLedgerRows(
      repositoryNodes.map((n) => n.row),
      sorting
    )
    const repoById = new Map(repositoryNodes.map((n) => [n.row.ledgerId, n]))
    return sortedRepoRows
      .map((row) => repoById.get(row.ledgerId))
      .filter((node): node is RepositoryNode => node !== undefined)
  }, [repositoryEntryMap, sorting])

  // Cheap flatten: expansion Sets only control which pre-aggregated nodes are
  // emitted — no aggregateRows calls here (P05-F03).
  const displayRows = useMemo(() => {
    if (ledgerView === 'repository') {
      const result: LedgerDisplayRow[] = []
      for (const repositoryNode of repositoryLedgerTree) {
        result.push(repositoryNode.row)
        if (!expandedRepositories.has(repositoryNode.row.ledgerId)) continue

        for (const providerNode of repositoryNode.providers) {
          result.push(providerNode.row)
          if (!expandedProvidersRepository.has(providerNode.row.ledgerId)) {
            continue
          }

          if (providerNode.directModels !== undefined) {
            result.push(...providerNode.directModels.map((m) => m.row))
            continue
          }

          for (const familyNode of providerNode.families ?? []) {
            result.push(familyNode.row)
            if (!expandedFamilies.has(familyNode.row.ledgerId)) continue
            result.push(...familyNode.models.map((m) => m.row))
          }
        }
      }
      return result
    }

    const result: LedgerDisplayRow[] = []
    for (const providerNode of modelLedgerTree) {
      result.push(providerNode.row)
      if (!expandedProvidersModel.has(providerNode.row.ledgerId)) continue

      if (providerNode.directModels !== undefined) {
        for (const modelNode of providerNode.directModels) {
          result.push(modelNode.row)
          if (!expandedModels.has(modelNode.row.ledgerId)) continue
          result.push(...modelNode.repositoryChildren)
        }
        continue
      }

      for (const familyNode of providerNode.families ?? []) {
        result.push(familyNode.row)
        if (!expandedFamilies.has(familyNode.row.ledgerId)) continue
        for (const modelNode of familyNode.models) {
          result.push(modelNode.row)
          if (!expandedModels.has(modelNode.row.ledgerId)) continue
          result.push(...modelNode.repositoryChildren)
        }
      }
    }
    return result
  }, [
    repositoryLedgerTree,
    modelLedgerTree,
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
    columns: masterLedgerAllColumns,
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
      <div className='table-wrapper'>
        <table aria-label='Model usage ledger' className='master-ledger-table'>
          <thead className='master-ledger-table-head'>
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
                    <MasterLedgerSortHeader
                      key={header.id}
                      headerId={header.id}
                      className={meta?.className}
                      ariaSort={ariaSort}
                      isSortable={isSortable}
                      sortDirAttr={sortDirAttr}
                      onToggleSort={
                        isSortable
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </MasterLedgerSortHeader>
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
              const costCellColor = costColor(orig.cost_usd)
              const errorCellColor =
                orig.error_pct !== undefined
                  ? errorPctColor(orig.error_pct)
                  : 'var(--fg-muted)'

              return (
                <tr
                  key={row.id}
                  className='master-ledger-row'
                  style={
                    {
                      '--ledger-provider-color': providerColor,
                      '--ledger-cost-color': costCellColor,
                      '--ledger-error-color': errorCellColor,
                    } as CSSProperties
                  }
                >
                  {row.getVisibleCells().map((cell, cellIdx) => {
                    const meta = cell.column.columnDef.meta as
                      | { className?: string }
                      | undefined
                    const colId = cell.column.id
                    const isFirst = cellIdx === 0

                    let cellContent: ReactElement | string

                    if (colId === 'provider') {
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else if (colId === 'cost_usd') {
                      // C6: cost severity color. D1-065 removes non-sparkline
                      // cell microbars from the Model Ledger.
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    } else if (colId === 'error_pct') {
                      const pct = orig.error_pct
                      const baseLabel = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                      if (
                        pct !== undefined &&
                        pct > 0 &&
                        orig.ledgerLevel === 'model'
                      ) {
                        const obsKey = `${orig.providerKey}::${orig.model.toLowerCase()}`
                        cellContent = (
                          <HoverTooltip
                            content={() => {
                              const rowObs = (
                                errorObservationsByModelKey.get(obsKey) ?? []
                              ).slice(0, MAX_ERROR_HOVER_ROWS)
                              if (rowObs.length === 0) return null
                              return (
                                <div>
                                  <div className='v9-tip-head'>
                                    {rowObs.length} most recent error
                                    {rowObs.length === 1 ? '' : 's'}
                                    {orig.repositoryKey !== undefined
                                      ? ' (model-wide on repo row)'
                                      : ''}
                                    :
                                  </div>
                                  {rowObs.map((e, idx) => (
                                    <div
                                      key={`${e.observed_at ?? 'null'}-${(e.status_code ?? 0).toString()}-${e.error_class}-${idx.toString()}`}
                                      className='master-ledger-error-tooltip-row'
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
                            }}
                          >
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
                      const sparkRaw = orig.spark
                      const sparkData =
                        sparkRaw != null && sparkRaw.length > 0
                          ? sparkRaw
                          : orig.tokens_in !== undefined && orig.tokens_in > 0
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
                      const toolCount = orig.tool
                      // Render '—' for undefined/null; for 0 also render '—' (no calls).
                      const toolLabel =
                        toolCount != null && toolCount > 0
                          ? fmtCompact(toolCount)
                          : '—'
                      const ta = orig.toolActivity
                      if (ta !== undefined && ta.totalCalls > 0) {
                        cellContent = (
                          <HoverTooltip
                            variant='quota-bar'
                            content={() => {
                              const leftLayout = buildToolHoverLeftColumns(
                                ta.leftRows
                              )
                              const leftColumns = leftLayout.columns
                              const displayLeftColumns = [
                                ...leftColumns,
                              ].reverse()
                              const leftHiddenCount =
                                leftLayout.hiddenRowCount +
                                (ta.leftTruncated
                                  ? Math.max(
                                      0,
                                      ta.leftTotalCount - LEFT_COL_CAP
                                    )
                                  : 0)
                              const shellDisplayCap =
                                leftLayout.rowsPerColumn *
                                TOOL_HOVER_MAX_SIDE_COLUMNS
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
                              const leftColumnCount = Math.max(
                                1,
                                leftColumns.length
                              )
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
                              return (
                                <div
                                  className='master-ledger-tool-tooltip'
                                  style={{
                                    gridTemplateColumns: `minmax(0, ${leftColumnCount.toString()}fr) minmax(0, ${shellColumnCount.toString()}fr)`,
                                    minWidth: `min(${tooltipWidthPx.toString()}px, calc(100vw - 16px))`,
                                  }}
                                >
                                  <div className='master-ledger-tooltip-section'>
                                    <div className='v9-tip-head'>
                                      {orig.ledgerLabel} — tool breakdown
                                    </div>
                                    <div className='master-ledger-tooltip-section-heading'>
                                      Tools
                                    </div>
                                    <div
                                      className='master-ledger-tooltip-columns'
                                      style={{
                                        gridTemplateColumns: `repeat(${leftColumnCount.toString()}, minmax(0, 1fr))`,
                                      }}
                                    >
                                      {displayLeftColumns.map(
                                        (column, columnIdx) => (
                                          <div
                                            key={`tools-${column.label}-${column.sourceIndex.toString()}`}
                                            data-tool-left-column='true'
                                            data-source-index={
                                              column.sourceIndex
                                            }
                                            className='master-ledger-tooltip-column'
                                          >
                                            {column.entries.map(
                                              (entry, entryIdx) => (
                                                <div
                                                  key={`${entry.row.label}-${entryIdx.toString()}`}
                                                >
                                                  <div className='master-ledger-tooltip-entry-row'>
                                                    <span className='master-ledger-tooltip-entry-label'>
                                                      {entry.row.label}
                                                    </span>
                                                    <span className='master-ledger-tooltip-entry-value'>
                                                      {numFmt(entry.row.calls)}
                                                      {'  '}
                                                      {entry.row.pct.toFixed(0)}
                                                      %
                                                    </span>
                                                  </div>
                                                  {entry.subRows.length > 0 && (
                                                    <div className='master-ledger-tooltip-subrows'>
                                                      {entry.subRows.map(
                                                        (sr, srIdx, arr) => {
                                                          const isLastVisible =
                                                            entry.hiddenSubRowCount ===
                                                              0 &&
                                                            srIdx ===
                                                              arr.length - 1
                                                          const prefix =
                                                            isLastVisible
                                                              ? '└─'
                                                              : '├─'
                                                          return (
                                                            <div
                                                              key={`${sr.label}-${srIdx.toString()}`}
                                                              className='master-ledger-tooltip-subrow'
                                                            >
                                                              {prefix}{' '}
                                                              {sr.label}{' '}
                                                              {numFmt(sr.calls)}
                                                            </div>
                                                          )
                                                        }
                                                      )}
                                                      {entry.hiddenSubRowCount >
                                                        0 && (
                                                        <div>
                                                          {`+${entry.hiddenSubRowCount.toString()} more`}
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              )
                                            )}
                                            {columnIdx === 0 &&
                                              leftHiddenCount > 0 && (
                                                <div className='master-ledger-tooltip-more'>
                                                  {`+${leftHiddenCount.toString()} more`}
                                                </div>
                                              )}
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                  <div className='master-ledger-tooltip-section'>
                                    <div className='v9-tip-head'>&nbsp;</div>
                                    <div className='master-ledger-tooltip-section-heading'>
                                      {`Shell (${numFmt(ta.shellTotalCalls)} calls)`}
                                    </div>
                                    <div
                                      className='master-ledger-tooltip-columns'
                                      style={{
                                        gridTemplateColumns: `repeat(${shellColumnCount.toString()}, minmax(0, 1fr))`,
                                      }}
                                    >
                                      {shellColumns.map(
                                        (columnRows, columnIdx) => (
                                          <div
                                            key={`shell-${columnIdx.toString()}`}
                                            className='master-ledger-tooltip-column'
                                          >
                                            {columnRows.map((sr) => (
                                              <div
                                                key={sr.label}
                                                className='master-ledger-tooltip-entry-row'
                                              >
                                                <span className='master-ledger-tooltip-entry-label'>
                                                  {sr.label}
                                                </span>
                                                <span className='master-ledger-tooltip-entry-value'>
                                                  {numFmt(sr.calls)}
                                                </span>
                                              </div>
                                            ))}
                                            {columnIdx ===
                                              shellColumns.length - 1 &&
                                              shellHiddenCount > 0 && (
                                                <div className='master-ledger-tooltip-more'>
                                                  {`+${shellHiddenCount.toString()} more`}
                                                </div>
                                              )}
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                            panelStyle={LEDGER_TOOLTIP_PANEL_STYLE}
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
                      const isProviderRow = orig.ledgerLevel === 'provider'
                      const isFamilyRow = orig.ledgerLevel === 'family'
                      const isModelRow = orig.ledgerLevel === 'model'
                      const isRepositoryRow = orig.ledgerLevel === 'repository'
                      const isExpanded = isProviderRow
                        ? ledgerView === 'repository'
                          ? expandedProvidersRepository.has(orig.ledgerId)
                          : expandedProvidersModel.has(orig.ledgerId)
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
                              if (next.has(orig.ledgerId)) {
                                next.delete(orig.ledgerId)
                              } else {
                                next.add(orig.ledgerId)
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
                          className={`master-ledger-model-cell master-ledger-model-cell-indent-${indentPx.toString()}`}
                        >
                          {orig.isExpandable ? (
                            <button
                              type='button'
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${orig.ledgerLabel} ${orig.ledgerLevel} rows`}
                              onClick={(event) => {
                                event.stopPropagation()
                                toggleExpansion()
                              }}
                              className='master-ledger-expander'
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
                              className='master-ledger-expander-placeholder'
                            />
                          )}
                          <span className='master-ledger-model-label'>
                            {orig.ledgerLabel}
                          </span>
                          {orig.ledgerLevel !== 'repository' &&
                            (orig.ledgerLevel !== 'model' ||
                              orig.childCount > 0) && (
                              <span className='master-ledger-model-count'>
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
                      cellContent = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      ) as ReactElement | string
                    }

                    // 14-F.1: add .number class to numeric cells for CSS class system parity
                    const isNumericCell =
                      colId !== 'model' &&
                      colId !== 'provider' &&
                      colId !== 'sparkline'

                    // Build className: meta class + optional number class
                    const tdClassName =
                      [
                        'master-ledger-cell',
                        meta?.className,
                        isNumericCell ? 'number' : undefined,
                        isFirst ? 'master-ledger-cell-first' : undefined,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined

                    return (
                      <td
                        key={cell.id}
                        data-col-id={colId}
                        className={tdClassName}
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
