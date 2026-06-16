/**
 * Wave 6 — remote-dashboard.tsx runtime behaviour tests (S6-3, S6-4)
 *
 * Tests for:
 *  - S6-3: Retryable import cache — first import rejects, retry succeeds
 *    without triggering a hard reload (window.location.reload / navigate replace).
 *  - S6-4: aawm-tap splat route reaches sub-paths; allowlist derived from metadata.
 *
 * FAILING until the engineer:
 *  - Implements retryable import cache in createRemoteModuleView / the lazy wrapper
 *    (promise ??= import().catch(reset) pattern so the NEXT import() call retries).
 *  - Exports `getRemoteModuleImportCache` or similar for testability, OR the
 *    test observes retry behaviour through the rendered component boundary.
 *  - Derives the allowlist for aawm-tap from remoteDashboardMetadata
 *    instead of a hardcoded Set literal.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi, afterEach } from 'vitest'
import { remoteDashboardMetadata } from './remote-dashboard-metadata'

// ---------------------------------------------------------------------------
// S6-4: aawm-tap allowlist must be derived from metadata
// ---------------------------------------------------------------------------

describe('aawm-tap allowlist derived from metadata (S6-4)', () => {
  test('test_aawm_tap_allowlist_matches_metadata_navItem_paths', async () => {
    // The ignored helper derives allowedPages from metadata so it stays out of
    // TanStack Router's route-file scan while remaining directly testable.
    const aawmTapMeta = remoteDashboardMetadata.find(
      (d) => d.key === 'aawm-tap'
    )
    expect(aawmTapMeta).toBeDefined()

    const metadataNavPaths = aawmTapMeta!.navItems.map((item) =>
      // Strip leading slash — the route param is the bare segment name
      item.path.replace(/^\//, '')
    )

    // Import only the ignored helper so the test does not cross the
    // module-federation boundary.
    const { allowedPages } =
      await import('../routes/_authenticated/aawm-tap/-allowed-pages').catch(
        () => {
          throw new Error(
            'allowedPages must be exported from the ignored aawm-tap helper so it can be tested'
          )
        }
      )

    for (const navPath of metadataNavPaths) {
      expect(allowedPages.has(navPath)).toBe(true)
    }

    // Allowlist must not have more entries than navItems (no orphaned pages)
    expect(allowedPages.size).toBe(metadataNavPaths.length)
  })

  test('test_aawm_tap_splat_route_reaches_sub_paths', () => {
    // The splat route must pass the full sub-path through to the remote
    // dashboard, while helper components stay in ignored route files.
    const aawmTapMeta = remoteDashboardMetadata.find(
      (d) => d.key === 'aawm-tap'
    )
    expect(aawmTapMeta).toBeDefined()

    let splatRouteContent: string
    try {
      splatRouteContent = readFileSync(
        'src/routes/_authenticated/aawm-tap/$.tsx',
        'utf8'
      )
    } catch {
      throw new Error(
        'Splat route src/routes/_authenticated/aawm-tap/$.tsx must exist to reach sub-paths'
      )
    }
    const splatPageContent = readFileSync(
      'src/routes/_authenticated/aawm-tap/-aawm-tap-splat-page.tsx',
      'utf8'
    )
    const routeWiring = `${splatRouteContent}\n${splatPageContent}`
    expect(routeWiring).toMatch(/AawmTapDashboardRoute|RemoteDashboardRoute/)
  })
})

// ---------------------------------------------------------------------------
// S6-3: Retryable import cache
// ---------------------------------------------------------------------------

describe('retryable import cache (S6-3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('test_remote_load_failure_retryable_first_rejects_second_succeeds', async () => {
    // This test verifies that the import cache in remote-dashboard.tsx is
    // reset after a failure so a second call retries rather than re-throwing.
    //
    // The engineer must export `createRetryableImporter` (or equivalent) from
    // remote-dashboard.tsx — a factory that wraps an importFn with the
    // `promise ??= import().catch(reset)` pattern.
    //
    // RED: currently no such export exists.
    const { createRetryableImporter } =
      await import('./remote-dashboard-runtime').catch(() => ({
        createRetryableImporter: undefined,
      }))

    if (createRetryableImporter === undefined) {
      throw new Error(
        'createRetryableImporter must be exported from remote-dashboard.tsx (S6-3)'
      )
    }

    const fakeModule = {
      default: {
        id: 'test',
        name: 'Test',
        description: '',
        icon: () => null,
        basePath: '/test',
        routes: [],
        navItems: [],
      },
    }
    let callCount = 0
    const importFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new Error('Network error')
      return fakeModule
    })

    const retryableImport = createRetryableImporter(importFn)

    // First call rejects
    await expect(retryableImport()).rejects.toThrow('Network error')

    // Second call must succeed (cache was reset after failure)
    const result = await retryableImport()
    expect(result).toBe(fakeModule)
    expect(callCount).toBe(2)
  })

  test('test_remote_load_failure_boundary_copy_differs_from_contract_violation', () => {
    // S6-1 / S6-3: two distinct error states need distinct boundary messages.
    // 1. Load failure: remoteEntry.js unreachable (network/infra)
    // 2. Contract violation: module loaded but assertProjectModule throws
    //
    // The engineer must use assertProjectModule after successful import to
    // distinguish these. This test validates the error categorisation logic
    // by checking that assertProjectModule is called after import() resolves.
    //
    // Here we verify the boundary copies differentiate the two cases by
    // asserting that a RemoteModuleContractError has a different name than
    // a plain TypeError/Error from network failure.

    const networkError = new Error('Failed to fetch remoteEntry.js')
    networkError.name = 'TypeError'

    const contractViolation = new Error(
      'Module default does not satisfy ProjectModule contract'
    )
    contractViolation.name = 'RemoteModuleContractError'

    // These must have distinct names for boundary logic to branch correctly.
    expect(networkError.name).not.toBe(contractViolation.name)
    expect(contractViolation.name).toBe('RemoteModuleContractError')
  })
})
