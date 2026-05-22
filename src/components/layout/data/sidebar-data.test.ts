import { describe, expect, test } from 'vitest'
import { sidebarData } from './sidebar-data'

describe('sidebarData', () => {
  test('shows one top-level entry point per remote dashboard', () => {
    const dashboardsGroup = sidebarData.navGroups.find(
      (group) => group.title === 'Dashboards'
    )

    expect(dashboardsGroup?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'AAWM',
          url: '/aawm',
        }),
        expect.objectContaining({
          title: 'AAWM TAP',
          url: '/aawm-tap/overview',
        }),
        expect.objectContaining({
          title: 'AAWM Observe',
          url: '/aawm-observe/overview',
        }),
        expect.objectContaining({
          title: 'Aegis',
          url: '/aegis',
        }),
        expect.objectContaining({
          title: 'Sluice',
          url: '/sluice/overview',
        }),
      ])
    )
    expect(dashboardsGroup?.items).toHaveLength(5)
    expect(dashboardsGroup?.items.every((item) => !('items' in item))).toBe(
      true
    )
  })
})
