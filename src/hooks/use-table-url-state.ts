import { useMemo } from 'react'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'

type SearchRecord = Record<string, unknown>

export type NavigateFn = (opts: {
  search:
    | true
    | SearchRecord
    | ((prev: SearchRecord) => Partial<SearchRecord> | SearchRecord)
  replace?: boolean
}) => void

const MAX_PAGE_SIZE = 100
const MIN_PAGE_SIZE = 1

type UseTableUrlStateParams = {
  search: SearchRecord
  navigate: NavigateFn
  pagination?: {
    pageKey?: string
    pageSizeKey?: string
    defaultPage?: number
    defaultPageSize?: number
  }
  globalFilter?: {
    enabled?: boolean
    key?: string
    trim?: boolean
  }
  columnFilters?: Array<
    | {
        columnId: string
        searchKey: string
        type?: 'string'
        serialize?: (value: unknown) => unknown
        deserialize?: (value: unknown) => unknown
      }
    | {
        columnId: string
        searchKey: string
        type: 'array'
        serialize?: (value: unknown) => unknown
        deserialize?: (value: unknown) => unknown
      }
  >
}

type UseTableUrlStateReturn = {
  globalFilter?: string
  onGlobalFilterChange?: OnChangeFn<string>
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  ensurePageInRange: (
    pageCount: number,
    opts?: { resetTo?: 'first' | 'last' }
  ) => void
}

function clampPageSize(raw: unknown, defaultPageSize: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return defaultPageSize
  }
  const rounded = Math.floor(raw)
  if (rounded < MIN_PAGE_SIZE) {
    return defaultPageSize
  }
  return Math.min(rounded, MAX_PAGE_SIZE)
}

function clampPage(raw: unknown, defaultPage: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return defaultPage
  }
  const rounded = Math.floor(raw)
  return rounded >= 1 ? rounded : defaultPage
}

/**
 * URL page param behavior:
 * - Omit `page=1` only when it matches the globally-normalized first page.
 * - With defaultPage > 1, writing `1` is explicit so page 2 and others stay reachable.
 */
function pageToSearchParam(
  page: number,
  defaultPage: number
): number | undefined {
  if (page <= 1) {
    return defaultPage <= 1 ? undefined : 1
  }
  return page
}

function columnFiltersFromSearch(
  search: SearchRecord,
  columnFiltersCfg: UseTableUrlStateParams['columnFilters']
): ColumnFiltersState {
  const collected: ColumnFiltersState = []
  for (const cfg of columnFiltersCfg ?? []) {
    const raw = search[cfg.searchKey]
    const deserialize = cfg.deserialize ?? ((v: unknown) => v)
    if (cfg.type === 'string') {
      const value = (deserialize(raw) as string) ?? ''
      if (typeof value === 'string' && value.trim() !== '') {
        collected.push({ id: cfg.columnId, value })
      }
    } else {
      const value = (deserialize(raw) as unknown[]) ?? []
      if (Array.isArray(value) && value.length > 0) {
        collected.push({ id: cfg.columnId, value })
      }
    }
  }
  return collected
}

export function useTableUrlState(
  params: UseTableUrlStateParams
): UseTableUrlStateReturn {
  const {
    search,
    navigate,
    pagination: paginationCfg,
    globalFilter: globalFilterCfg,
    columnFilters: columnFiltersCfg = [],
  } = params

  const pageKey = paginationCfg?.pageKey ?? ('page' as string)
  const pageSizeKey = paginationCfg?.pageSizeKey ?? ('pageSize' as string)
  const defaultPage = paginationCfg?.defaultPage ?? 1
  const defaultPageSize = paginationCfg?.defaultPageSize ?? 10

  const globalFilterKey = globalFilterCfg?.key ?? ('filter' as string)
  const globalFilterEnabled = globalFilterCfg?.enabled ?? true
  const trimGlobal = globalFilterCfg?.trim ?? true

  const columnFilters: ColumnFiltersState = useMemo(
    () => columnFiltersFromSearch(search, columnFiltersCfg),
    [search, columnFiltersCfg]
  )

  const pagination: PaginationState = useMemo(() => {
    const pageNum = clampPage((search as SearchRecord)[pageKey], defaultPage)
    const pageSizeNum = clampPageSize(
      (search as SearchRecord)[pageSizeKey],
      defaultPageSize
    )
    return { pageIndex: Math.max(0, pageNum - 1), pageSize: pageSizeNum }
  }, [search, pageKey, pageSizeKey, defaultPage, defaultPageSize])

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater
    const nextPage = next.pageIndex + 1
    const nextPageSize = clampPageSize(next.pageSize, defaultPageSize)
    navigate({
      search: (prev) => ({
        ...(prev as SearchRecord),
        [pageKey]: pageToSearchParam(nextPage, defaultPage),
        [pageSizeKey]:
          nextPageSize === defaultPageSize ? undefined : nextPageSize,
      }),
    })
  }

  const globalFilter: string | undefined = useMemo(() => {
    if (!globalFilterEnabled) return undefined
    const raw = (search as SearchRecord)[globalFilterKey]
    return typeof raw === 'string' ? raw : ''
  }, [search, globalFilterKey, globalFilterEnabled])

  const onGlobalFilterChange: OnChangeFn<string> | undefined =
    globalFilterEnabled
      ? (updater) => {
          const next =
            typeof updater === 'function'
              ? updater(globalFilter ?? '')
              : updater
          const value = trimGlobal ? next.trim() : next
          navigate({
            search: (prev) => ({
              ...(prev as SearchRecord),
              [pageKey]: pageToSearchParam(1, defaultPage),
              [globalFilterKey]: value ? value : undefined,
            }),
          })
        }
      : undefined

  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next =
      typeof updater === 'function' ? updater(columnFilters) : updater

    const patch: Record<string, unknown> = {}

    for (const cfg of columnFiltersCfg) {
      const found = next.find((f) => f.id === cfg.columnId)
      const serialize = cfg.serialize ?? ((v: unknown) => v)
      if (cfg.type === 'string') {
        const value =
          typeof found?.value === 'string' ? (found.value as string) : ''
        patch[cfg.searchKey] =
          value.trim() !== '' ? serialize(value) : undefined
      } else {
        const value = Array.isArray(found?.value)
          ? (found!.value as unknown[])
          : []
        patch[cfg.searchKey] = value.length > 0 ? serialize(value) : undefined
      }
    }

    navigate({
      search: (prev) => ({
        ...(prev as SearchRecord),
        [pageKey]: pageToSearchParam(1, defaultPage),
        ...patch,
      }),
    })
  }

  const ensurePageInRange = (
    pageCount: number,
    opts: { resetTo?: 'first' | 'last' } = { resetTo: 'first' }
  ) => {
    const pageNum = clampPage((search as SearchRecord)[pageKey], defaultPage)
    if (pageCount > 0 && pageNum > pageCount) {
      navigate({
        replace: true,
        search: (prev) => ({
          ...(prev as SearchRecord),
          [pageKey]:
            opts.resetTo === 'last'
              ? pageCount
              : pageToSearchParam(1, defaultPage),
        }),
      })
    }
  }

  return {
    globalFilter: globalFilterEnabled ? (globalFilter ?? '') : undefined,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  }
}
