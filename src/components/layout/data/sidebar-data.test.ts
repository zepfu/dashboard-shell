/**
 * Wave 6 — sidebar-data tests (S6-T2)
 *
 * Test cases (S6-T2):
 *  - Uniqueness: every nav item has a unique url (no duplicate routes)
 *  - navItems↔route reachability: Dashboards nav items resolve to real routes
 *
 * Extends the existing "shows one top-level entry point per remote dashboard" test
 * with uniqueness and reachability assertions.
 *
 * FAILING (new tests only) until the engineer ensures:
 *  - No duplicate nav item URLs in any group
 *  - All Dashboards group URLs resolve via remoteDashboardHref to paths that
 *    match the declared defaultRoutePath in metadata
 */
import {
  remoteDashboardHref,
  remoteDashboardMetadata,
  normalizeRemoteRoutePath,
} from '@/shell/remote-dashboard-metadata'
import { describe, expect, test } from 'vitest'
import { sidebarData } from './sidebar-data'

// ---------------------------------------------------------------------------
// Existing test (preserved)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// S6-T2: Uniqueness
// ---------------------------------------------------------------------------

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
    // No two navigable leaf nodes should share the same URL.
    // Duplicates would cause confusion about which item is "active" and
    // could mask routing errors.
    const urls = collectAllUrls(sidebarData.navGroups)
    const unique = new Set(urls)

    // If there are duplicates, report them.
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

// ---------------------------------------------------------------------------
// S6-T2: navItems↔route reachability
// ---------------------------------------------------------------------------

describe('sidebarData navItems↔route reachability (S6-T2)', () => {
  test('test_dashboards_nav_urls_match_metadata_defaultRoutePaths', () => {
    // Each Dashboards group item URL should equal remoteDashboardHref(dashboard, defaultRoutePath).
    // This pins that the sidebar data and metadata are in sync.
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
    // The Dashboards group must have exactly as many items as remoteDashboardMetadata.
    const dashboardsGroup = sidebarData.navGroups.find(
      (g) => g.title === 'Dashboards'
    )
    expect(dashboardsGroup).toBeDefined()
    expect(dashboardsGroup!.items).toHaveLength(remoteDashboardMetadata.length)
  })

  test('test_sidebar_teams_include_all_remote_dashboards', () => {
    // The teams array should include one entry per remote dashboard (for team-switcher).
    // It should also include the host dashboard team.
    expect(sidebarData.teams).toHaveLength(remoteDashboardMetadata.length + 1)

    for (const dashboard of remoteDashboardMetadata) {
      const matchingTeam = sidebarData.teams.find(
        (t) => t.name === dashboard.name
      )
      expect(matchingTeam).toBeDefined()
    }
  })

  test('test_dashboards_nav_item_defaultRoutePath_is_normalizable', () => {
    // All defaultRoutePath values in metadata normalize to non-empty paths.
    for (const dashboard of remoteDashboardMetadata) {
      const normalized = normalizeRemoteRoutePath(dashboard.defaultRoutePath)
      expect(normalized).toMatch(/^\//)
      expect(normalized.length).toBeGreaterThan(0)
    }
  })
})
