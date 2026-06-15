/**
 * Wave 6 — NavGroup tests (S6-12)
 */
import { describe, expect, test } from 'vitest'
import { checkIsActive } from './nav-active'

describe('checkIsActive prefix match for remote dashboard subpages (S6-12)', () => {
  test('test_nav_active_state_on_remote_subpage_prefix_match', () => {
    const aawmTapNavItem = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    const isActiveOnSubPage = checkIsActive(
      '/aawm-tap/processes/detail',
      aawmTapNavItem
    )
    expect(isActiveOnSubPage).toBe(true)
  })

  test('test_nav_inactive_on_unrelated_path', () => {
    const aawmTapNavItem = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }

    expect(checkIsActive('/tasks', aawmTapNavItem)).toBe(false)
  })

  test('test_nav_active_on_exact_remote_path', () => {
    const item = {
      title: 'AAWM TAP',
      url: '/aawm-tap/overview',
      accentColor: 'hsl(220 70% 50%)',
    }
    expect(checkIsActive('/aawm-tap/overview', item)).toBe(true)
  })
})
