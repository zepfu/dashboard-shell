/**
 * Wave 6 — sidebar-data tests (S6-T2)
 *
 * D1-451 Wave 5 (W2, C4): Dead DEV auth links removed; accent/base-path heuristic
 * deduped with nav-active.ts (shared export consumed by sidebar-data).
 */
import {
  remoteDashboardHref,
  remoteDashboardMetadata,
  normalizeRemoteRoutePath,
} from '@/shell/remote-dashboard-metadata'
import { describe, expect, test } from 'vitest'
import { checkIsActive, remoteNavBasePath } from '../nav-active'
import { sidebarData } from './sidebar-data'

const DEAD_DEV_AUTH_URLS = [
  '/sign-in',
  '/sign-in-2',
  '/sign-up',
  '/forgot-password',
  '/otp',
] as const

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

describe('sidebarData uniqueness (S6-T2)', () => {
  function collectAllUrls(groups: typeof sidebarData.navGroups): string[] {
    const urls: string[] = []
    for (const group of groups) {
      for (const item of group.items) {
        if ('url' in item && item.url) {
          urls.push(item.url)
        }
        if ('items' in item && item.items) {
          for (const subItem of item.items) {
            if ('url' in subItem && subItem.url) {
              urls.push(subItem.url)
            }
          }
        }
      }
    }
    return urls
  }

  test('test_sidebarData_no_duplicate_leaf_urls', () => {
    const urls = collectAllUrls(sidebarData.navGroups)
    const unique = new Set(urls)
    const duplicates = urls.filter((url, idx) => urls.indexOf(url) !== idx)

    expect(duplicates).toHaveLength(0)
    expect(unique.size).toBe(urls.length)
  })

  test('test_dashboard_groups_no_duplicate_titles', () => {
    const titles = sidebarData.navGroups.map((g) => g.title)
    const unique = new Set(titles)
    expect(unique.size).toBe(titles.length)
  })
})

describe('sidebarData navItems↔route reachability (S6-T2)', () => {
  test('test_dashboards_nav_urls_match_metadata_defaultRoutePaths', () => {
    const dashboardsGroup = sidebarData.navGroups.find(
      (g) => g.title === 'Dashboards'
    )
    expect(dashboardsGroup).toBeDefined()

    for (const dashboard of remoteDashboardMetadata) {
      const expectedUrl = remoteDashboardHref(
        dashboard,
        dashboard.defaultRoutePath
      )
      const matchingItem = dashboardsGroup!.items.find(
        (item) => 'title' in item && item.title === dashboard.name
      )
      expect(matchingItem).toBeDefined()
      expect((matchingItem as { url: string }).url).toBe(expectedUrl)
    }
  })

  test('test_dashboards_nav_count_matches_metadata_count', () => {
    const dashboardsGroup = sidebarData.navGroups.find(
      (g) => g.title === 'Dashboards'
    )
    expect(dashboardsGroup).toBeDefined()
    expect(dashboardsGroup!.items).toHaveLength(remoteDashboardMetadata.length)
  })

  test('test_sidebar_teams_include_all_remote_dashboards', () => {
    expect(sidebarData.teams).toHaveLength(remoteDashboardMetadata.length + 1)

    for (const dashboard of remoteDashboardMetadata) {
      const matchingTeam = sidebarData.teams.find(
        (t) => t.name === dashboard.name
      )
      expect(matchingTeam).toBeDefined()
    }
  })

  test('test_dashboards_nav_item_defaultRoutePath_is_normalizable', () => {
    for (const dashboard of remoteDashboardMetadata) {
      const normalized = normalizeRemoteRoutePath(dashboard.defaultRoutePath)
      expect(normalized).toMatch(/^\//)
      expect(normalized.length).toBeGreaterThan(0)
    }
  })
})

describe('D1-451 Wave 5 — sidebar-data (W2, C4)', () => {
  function collectAllUrls(groups: typeof sidebarData.navGroups): string[] {
    const urls: string[] = []
    for (const group of groups) {
      for (const item of group.items) {
        if ('url' in item && item.url) {
          urls.push(item.url)
        }
        if ('items' in item && item.items) {
          for (const subItem of item.items) {
            if ('url' in subItem && subItem.url) {
              urls.push(subItem.url)
            }
          }
        }
      }
    }
    return urls
  }

  test('test_dev_scaffold_excludes_dead_upstream_auth_routes', () => {
    const urls = collectAllUrls(sidebarData.navGroups)
    for (const dead of DEAD_DEV_AUTH_URLS) {
      expect(urls).not.toContain(dead)
    }
    // With import.meta.env.DEV=true (Vitest default), scaffold nav is included; dead auth
    // routes must still be absent from scaffoldNavGroups.
  })

  test('test_sidebar_data_active_state_behavior', () => {
    const dashboardsGroup = sidebarData.navGroups.find(
      (group) => group.title === 'Dashboards'
    )
    expect(dashboardsGroup).toBeDefined()

    const aawmTapNav = dashboardsGroup!.items.find(
      (item) => 'title' in item && item.title === 'AAWM TAP'
    )
    expect(aawmTapNav).toBeDefined()
    expect('url' in aawmTapNav! && aawmTapNav!.url).toBeTruthy()

    const navItem = aawmTapNav as {
      title: string
      url: string
      accentColor?: string
    }

    expect(remoteNavBasePath(navItem.url)).toBe('/aawm-tap')
    expect(checkIsActive('/aawm-tap/processes/detail', navItem)).toBe(true)
    expect(checkIsActive('/tasks', navItem)).toBe(false)
    expect(checkIsActive('/aawm-tap/overview', navItem)).toBe(true)
  })
})
