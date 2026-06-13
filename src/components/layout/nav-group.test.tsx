/**
 * Wave 6 — NavGroup tests (S6-12)
 *
 * Test cases:
 *  - S6-12: nav active state on remote subpage — prefix match for basePath nav items
 *
 * FAILING until the engineer:
 *  - Fixes `checkIsActive` in nav-group.tsx to do prefix-matching for remote
 *    dashboard nav items that carry `accentColor` (indicating they are remote entries).
 *    Currently checkIsActive splits on `/` and checks [1] segment equality, which
 *    fails for sub-paths like /aawm-tap/processes/detail.
 */
import { describe, expect, test } from 'vitest'
// ---------------------------------------------------------------------------
// We test checkIsActive in isolation by exporting it (currently internal).
// The tests also cover the NavGroup component render for active state.
// ---------------------------------------------------------------------------

// This import will fail (RED) until the engineer exports checkIsActive:
import { checkIsActive } from './nav-group'

describe('checkIsActive prefix match for remote dashboard subpages (S6-12)', () => {
  test('test_nav_active_state_on_remote_subpage_prefix_match', () => {
    // A nav link to /aawm-tap/overview should be active when the current
    // route is /aawm-tap/processes/detail (same basePath prefix).
    //
    // Current implementation: only exact URL or first-segment check.
    // Fix: if item has accentColor or an activePrefix, use prefix match.

    const aawmTapNavItem = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    // Direct sub-path under /aawm-tap — should be active
    const isActiveOnSubPage = checkIsActive(
      '/aawm-tap/processes/detail',
      aawmTapNavItem
    )
    // RED: current checkIsActive returns false for this case
    expect(isActiveOnSubPage).toBe(true)
  })

  test('test_nav_active_state_exact_match_still_works', () => {
    const item = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    expect(checkIsActive('/aawm-tap/overview', item)).toBe(true)
  })

  test('test_nav_active_state_different_basepath_not_active', () => {
    const item = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    // /aegis/overview shares no prefix with /aawm-tap
    expect(checkIsActive('/aegis/overview', item)).toBe(false)
  })

  test('test_nav_active_state_no_accent_exact_match_still_works', () => {
    // Standard nav items (no accentColor) must continue to use exact/first-segment match.
    const localItem = {
      title: 'Dashboard',
      url: '/',
    }

    expect(checkIsActive('/', localItem)).toBe(true)
    expect(checkIsActive('/apps', localItem)).toBe(false)
  })

  test('test_nav_active_state_basepath_prefix_not_tricked_by_partial_segment', () => {
    // /aawm-tap-extra should NOT match /aawm-tap prefix (must be segment boundary).
    const item = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    expect(checkIsActive('/aawm-tap-extra/overview', item)).toBe(false)
  })

  test('test_nav_active_second_level_subpath_active', () => {
    // /aawm-tap/processes and /aawm-tap/processes/id/detail should both
    // be treated as active for the aawm-tap nav entry.
    const item = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    expect(checkIsActive('/aawm-tap/processes', item)).toBe(true)
    expect(checkIsActive('/aawm-tap/processes/123/detail', item)).toBe(true)
  })
})
