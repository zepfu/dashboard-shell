/**
 * Wave 6 — useTableUrlState tests (S6-14, S6-15)
 *
 * Test cases:
 *  - S6-14: back/forward navigation syncs filters from search params
 *  - S6-15: pageSize is clamped when ?pageSize=500000 is supplied
 *
 * FAILING until the engineer:
 *  - Clamps pageSize to a max (e.g. 100) in useTableUrlState
 *  - Derives columnFilters/globalFilter from `search` on every render (not
 *    just initial mount), so back/forward URL changes update filter state
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
    // ?pageSize=500000 must be clamped to the allowed max (e.g. 100).
    // Currently the hook passes the raw URL value through without clamping.
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

    // The hook MUST clamp unreasonably large pageSize values.
    // 500000 is not a valid page size; the max should be enforced.
    // This test is RED because the current hook returns pageSize=500000.
    expect(result.current.pagination.pageSize).toBeLessThanOrEqual(100)
  })

  test('test_pageSize_valid_value_passes_through', () => {
    // A valid pageSize (e.g. 25) must pass through unchanged.
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
    // Negative pageSize (URL injection) must be treated as defaultPageSize.
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

    // Must not expose negative pageSize to the table.
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
    // Simulate the user navigates back: the search object changes externally.
    // The hook must react to the updated `search` prop and expose the new
    // filter values without requiring a full page reload.
    //
    // This is RED because the current implementation uses useState(initialValue)
    // for columnFilters — state doesn't update when search prop changes.

    // Render with initial search (no filters)
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

    // Initially no column filters
    expect(result.current.columnFilters).toHaveLength(0)

    // Simulate back navigation: URL now has status filter
    act(() => {
      rerender({ search: { status: ['active', 'pending'] } })
    })

    // After back navigation, filters must reflect the new URL state.
    // RED: current useState(initialValue) ignores the prop change.
    const statusFilter = result.current.columnFilters.find(
      (f) => f.id === 'status'
    )
    expect(statusFilter).toBeDefined()
    expect(statusFilter?.value).toEqual(['active', 'pending'])
  })

  test('test_global_filter_back_forward_syncs', () => {
    // Same issue for globalFilter — must sync from search on prop change.
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

    // RED: current hook ignores prop change after mount.
    expect(result.current.globalFilter).toBe('hello world')
  })

  test('test_page_back_forward_syncs', () => {
    // Page index must also sync from search on prop change.
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

    // Page 5 → pageIndex 4 (0-based)
    expect(result.current.pagination.pageIndex).toBe(4)
  })
})
