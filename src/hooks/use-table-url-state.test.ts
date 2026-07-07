/**
 * Wave 6 — useTableUrlState tests (S6-14, S6-15)
 *
 * D1-451 Wave 5 (P4 info, G4 info):
 *  - P4: decorative useMemo on columnFilters documented / justified.
 *  - G4: defaultPage > 1 edge when URL omits page param.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { type NavigateFn, useTableUrlState } from './use-table-url-state'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNavigate(searchRef: {
  current: Record<string, unknown>
}): NavigateFn {
  return ({ search }) => {
    if (search === true) return
    if (typeof search === 'function') {
      searchRef.current = search(searchRef.current) as Record<string, unknown>
    } else {
      searchRef.current = search as Record<string, unknown>
    }
  }
}

// ---------------------------------------------------------------------------
// S6-15: pageSize clamping
// ---------------------------------------------------------------------------

describe('useTableUrlState — pageSize clamping (S6-15)', () => {
  test('test_pageSize_clamped_when_absurdly_large', () => {
    const searchRef = { current: { pageSize: 500_000, page: 1 } }
    const navigate = makeNavigate(searchRef)

    const { result } = renderHook(() =>
      useTableUrlState({
        search: searchRef.current,
        navigate,
        pagination: {
          defaultPageSize: 10,
        },
      })
    )

    expect(result.current.pagination.pageSize).toBeLessThanOrEqual(100)
  })

  test('test_pageSize_valid_value_passes_through', () => {
    const searchRef = { current: { pageSize: 25, page: 1 } }
    const navigate = makeNavigate(searchRef)

    const { result } = renderHook(() =>
      useTableUrlState({
        search: searchRef.current,
        navigate,
        pagination: {
          defaultPageSize: 10,
        },
      })
    )

    expect(result.current.pagination.pageSize).toBe(25)
  })

  test('test_pageSize_negative_is_clamped_to_minimum', () => {
    const searchRef = { current: { pageSize: -5, page: 1 } }
    const navigate = makeNavigate(searchRef)

    const { result } = renderHook(() =>
      useTableUrlState({
        search: searchRef.current,
        navigate,
        pagination: {
          defaultPageSize: 10,
        },
      })
    )

    expect(result.current.pagination.pageSize).toBeGreaterThan(0)
  })

  test('test_pageSize_zero_is_clamped', () => {
    const searchRef = { current: { pageSize: 0, page: 1 } }
    const navigate = makeNavigate(searchRef)

    const { result } = renderHook(() =>
      useTableUrlState({
        search: searchRef.current,
        navigate,
        pagination: {
          defaultPageSize: 10,
        },
      })
    )

    expect(result.current.pagination.pageSize).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// S6-14: back/forward navigation syncs filters from URL
// ---------------------------------------------------------------------------

describe('useTableUrlState — back/forward sync (S6-14)', () => {
  test('test_use_table_url_state_back_forward_syncs_filters', () => {
    const initialSearch: Record<string, unknown> = {}
    const navigateSpy = vi.fn()

    const { result, rerender } = renderHook(
      ({ search }: { search: Record<string, unknown> }) =>
        useTableUrlState({
          search,
          navigate: navigateSpy,
          columnFilters: [
            {
              columnId: 'status',
              searchKey: 'status',
              type: 'array' as const,
            },
          ],
        }),
      { initialProps: { search: initialSearch } }
    )

    expect(result.current.columnFilters).toHaveLength(0)

    act(() => {
      rerender({ search: { status: ['active', 'pending'] } })
    })

    const statusFilter = result.current.columnFilters.find(
      (f) => f.id === 'status'
    )
    expect(statusFilter).toBeDefined()
    expect(statusFilter?.value).toEqual(['active', 'pending'])
  })

  test('test_global_filter_back_forward_syncs', () => {
    const initialSearch: Record<string, unknown> = {}
    const navigateSpy = vi.fn()

    const { result, rerender } = renderHook(
      ({ search }: { search: Record<string, unknown> }) =>
        useTableUrlState({
          search,
          navigate: navigateSpy,
          globalFilter: { enabled: true, key: 'q' },
        }),
      { initialProps: { search: initialSearch } }
    )

    expect(result.current.globalFilter).toBe('')

    act(() => {
      rerender({ search: { q: 'hello world' } })
    })

    expect(result.current.globalFilter).toBe('hello world')
  })

  test('test_page_back_forward_syncs', () => {
    const initialSearch: Record<string, unknown> = { page: 1 }
    const navigateSpy = vi.fn()

    const { result, rerender } = renderHook(
      ({ search }: { search: Record<string, unknown> }) =>
        useTableUrlState({
          search,
          navigate: navigateSpy,
          pagination: { defaultPage: 1 },
        }),
      { initialProps: { search: initialSearch } }
    )

    expect(result.current.pagination.pageIndex).toBe(0)

    act(() => {
      rerender({ search: { page: 5 } })
    })

    expect(result.current.pagination.pageIndex).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// D1-451 Wave 5 — pagination edge + decorative memo guard
// ---------------------------------------------------------------------------

describe('D1-451 Wave 5 — useTableUrlState edges', () => {
  test('test_default_page_gt_one_when_url_omits_page', () => {
    const searchRef = { current: {} }
    const navigate = makeNavigate(searchRef)

    const { result } = renderHook(() =>
      useTableUrlState({
        search: searchRef.current,
        navigate,
        pagination: { defaultPage: 3 },
      })
    )

    // G4: missing ?page= must honour defaultPage (1-based page 3 → index 2).
    expect(result.current.pagination.pageIndex).toBe(2)
  })

  test('test_column_filters_derived_from_search_not_stale_after_back_forward', () => {
    const initialSearch: Record<string, unknown> = { status: ['a'] }
    const navigateSpy = vi.fn()

    const { result, rerender } = renderHook(
      ({ search }: { search: Record<string, unknown> }) =>
        useTableUrlState({
          search,
          navigate: navigateSpy,
          columnFilters: [
            { columnId: 'status', searchKey: 'status', type: 'array' as const },
          ],
        }),
      { initialProps: { search: initialSearch } }
    )

    expect(result.current.columnFilters[0]?.value).toEqual(['a'])

    act(() => {
      rerender({ search: {} })
    })

    expect(result.current.columnFilters).toHaveLength(0)
  })
})
