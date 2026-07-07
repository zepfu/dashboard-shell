/**
 * D1-451 Wave 5 — nav-active (C4, I3).
 *
 * Remote dashboard items with accentColor must use one shared base-path helper
 * for active state; phosphor-sidebar must not fork a separate prefix heuristic.
 */
import { describe, expect, test } from 'vitest'
import { checkIsActive } from './nav-active'

const aawmTapItem = {
  title: 'AAWM TAP',
  url: '/aawm-tap/overview',
  accentColor: 'hsl(220 70% 50%)',
}

describe('checkIsActive remote routes (S6-12 / C4)', () => {
  test('test_nav_active_state_on_remote_subpage_prefix_match', () => {
    expect(checkIsActive('/aawm-tap/processes/detail', aawmTapItem)).toBe(true)
  })

  test('test_nav_inactive_on_unrelated_path', () => {
    expect(checkIsActive('/tasks', aawmTapItem)).toBe(false)
  })

  test('test_nav_active_on_exact_remote_path', () => {
    expect(checkIsActive('/aawm-tap/overview', aawmTapItem)).toBe(true)
  })

  test('test_remote_nav_ignores_query_string_for_base_match', () => {
    expect(
      checkIsActive('/aawm-tap/overview?tab=quota', {
        ...aawmTapItem,
        url: '/aawm-tap/overview?tab=status',
      })
    ).toBe(true)
  })
})

describe('D1-451 I3 — shared remoteNavBasePath export', () => {
  test('test_remote_nav_base_path_exported_for_sidebar_data_dedup', async () => {
    // Engineer must export remoteNavBasePath (or equivalent) from nav-active.ts
    // and consume it from phosphor-sidebar + sidebar-data accent heuristics.
    const navActive = await import('./nav-active')
    expect(
      'remoteNavBasePath' in navActive &&
        typeof (navActive as { remoteNavBasePath?: (url: string) => string })
          .remoteNavBasePath === 'function'
    ).toBe(true)
  })
})
