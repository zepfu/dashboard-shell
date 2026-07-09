/**
 * Wave 6 — Remote Dashboard Contract Tests (S6-1, S6-2, S6-T1)
 *
 * Contract assertions against live metadata and runtime utilities.
 */
import { forwardRef } from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  normalizeRemoteRoutePath,
  remoteDashboardHref,
  remoteDashboardMetadata,
  type RemoteDashboardMetadataEntry,
} from './remote-dashboard-metadata'
import {
  assertProjectModule,
  buildRemoteRouteProps,
  matchRoutePath,
} from './remote-dashboard-runtime'

// ---------------------------------------------------------------------------
// Helpers kept from the file's original theater tests (doc contracts)
// ---------------------------------------------------------------------------

function readProjectFile(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('remote dashboard doc contracts (preserved)', () => {
  test('test_tap_handoff_contract_topics_are_documented', () => {
    const integration = readProjectFile(
      'docs/remote-dashboard-integration-contract.md'
    )
    const runtime = readProjectFile('docs/runtime-contracts.md')

    expect(integration).toContain('Use the vendor-and-sync model')
    expect(integration).toContain('`accentColor`')
    expect(integration).toContain('load-bearing `.dark`')
    expect(integration).toContain(
      'tabs, tables, buttons, dialogs, forms, cards'
    )
    expect(integration).toContain('jsx-a11y')
    expect(runtime).toContain('`staleTime`: `10_000` ms')
    expect(runtime).toContain('`refetchOnWindowFocus`')
    expect(runtime).toContain('no browser-public source maps by default')
    expect(runtime).toContain('`/modules/<base>/remoteEntry.js` paths')
    expect(runtime).toContain('`/api/<dashboard>/*` paths')
  })

  test('test_static_nginx_csp_allows_same_origin_remote_and_api_loading', () => {
    const nginx = readProjectFile('nginx.conf')

    expect(nginx).toContain('add_header Content-Security-Policy')
    expect(nginx).toContain("script-src 'self'")
    expect(nginx).toContain("connect-src 'self'")
    expect(nginx).toContain("style-src 'self' 'unsafe-inline'")
    expect(nginx).toContain(
      'add_header Content-Security-Policy $dashboard_shell_csp always;'
    )
  })
})

// ---------------------------------------------------------------------------
// S6-T1 / S6-1: Real MF contract tests — metadata invariants
// ---------------------------------------------------------------------------

describe('remoteDashboardMetadata invariants (S6-1)', () => {
  test('test_metadata_keys_are_unique', () => {
    const keys = remoteDashboardMetadata.map((d) => d.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  test('test_metadata_basePaths_are_unique', () => {
    const basePaths = remoteDashboardMetadata.map((d) => d.basePath)
    const unique = new Set(basePaths)
    expect(unique.size).toBe(basePaths.length)
  })

  test('test_metadata_moduleIds_are_unique', () => {
    const moduleIds = remoteDashboardMetadata.map((d) => d.moduleId)
    const unique = new Set(moduleIds)
    expect(unique.size).toBe(moduleIds.length)
  })

  test('test_metadata_defaultRoutePath_is_resolvable_via_navItems', () => {
    // defaultRoutePath must be navigable through one of the declared navItems.
    // This asserts the nav <-> route consistency.
    for (const dashboard of remoteDashboardMetadata) {
      const normalizedDefault = normalizeRemoteRoutePath(
        dashboard.defaultRoutePath
      )
      const navPaths = dashboard.navItems.map((item) =>
        normalizeRemoteRoutePath(item.path)
      )
      expect(navPaths).toContain(normalizedDefault)
    }
  })

  test('test_metadata_navItems_paths_match_via_matchRoutePath', () => {
    // Every navItem.path must be matched (not undefined) by matchRoutePath.
    // This pins that the routing function handles the actual nav paths.
    for (const dashboard of remoteDashboardMetadata) {
      for (const navItem of dashboard.navItems) {
        const normalizedPath = normalizeRemoteRoutePath(navItem.path)
        const result = matchRoutePath(navItem.path, normalizedPath)
        expect(result).not.toBeUndefined()
      }
    }
  })

  test('test_metadata_basePath_starts_with_slash_no_trailing_slash', () => {
    for (const dashboard of remoteDashboardMetadata) {
      expect(dashboard.basePath).toMatch(/^\/[a-z][a-z0-9-]*$/)
    }
  })

  test('test_metadata_defaultRoutePath_normalized_starts_with_slash', () => {
    for (const dashboard of remoteDashboardMetadata) {
      const normalized = normalizeRemoteRoutePath(dashboard.defaultRoutePath)
      expect(normalized).toMatch(/^\//)
    }
  })
})

// ---------------------------------------------------------------------------
// S6-2: normalizeRemoteRoutePath unit tests
// ---------------------------------------------------------------------------

describe('normalizeRemoteRoutePath (S6-2)', () => {
  test('returns slash for undefined', () => {
    expect(normalizeRemoteRoutePath(undefined)).toBe('/')
  })

  test('returns slash for empty string', () => {
    expect(normalizeRemoteRoutePath('')).toBe('/')
  })

  test('strips trailing slash from non-root', () => {
    expect(normalizeRemoteRoutePath('/overview/')).toBe('/overview')
  })

  test('adds leading slash', () => {
    expect(normalizeRemoteRoutePath('overview')).toBe('/overview')
  })

  test('strips query string', () => {
    expect(normalizeRemoteRoutePath('/overview?foo=bar')).toBe('/overview')
  })

  test('strips fragment', () => {
    expect(normalizeRemoteRoutePath('/overview#section')).toBe('/overview')
  })

  test('preserves multi-segment paths', () => {
    expect(normalizeRemoteRoutePath('/admin/users/123')).toBe(
      '/admin/users/123'
    )
  })

  test('collapses multiple trailing slashes', () => {
    expect(normalizeRemoteRoutePath('/overview///')).toBe('/overview')
  })

  test('handles whitespace-only string as root', () => {
    expect(normalizeRemoteRoutePath('   ')).toBe('/')
  })
})

// ---------------------------------------------------------------------------
// S6-2: matchRoutePath unit tests
// ---------------------------------------------------------------------------

describe('matchRoutePath (S6-2)', () => {
  test('exact static match returns empty params', () => {
    expect(matchRoutePath('/overview', '/overview')).toEqual({})
  })

  test('root path exact match', () => {
    expect(matchRoutePath('/', '/')).toEqual({})
  })

  test('mismatched static paths return undefined', () => {
    expect(matchRoutePath('/overview', '/processes')).toBeUndefined()
  })

  test('dynamic param is captured', () => {
    expect(matchRoutePath('/items/:id', '/items/42')).toEqual({ id: '42' })
  })

  test('multiple dynamic params captured', () => {
    expect(matchRoutePath('/a/:x/b/:y', '/a/hello/b/world')).toEqual({
      x: 'hello',
      y: 'world',
    })
  })

  test('segment count mismatch returns undefined', () => {
    expect(matchRoutePath('/a/b', '/a')).toBeUndefined()
  })

  test('root pattern does not match non-root path', () => {
    expect(matchRoutePath('/', '/overview')).toBeUndefined()
  })

  test('non-root pattern does not match root path', () => {
    expect(matchRoutePath('/overview', '/')).toBeUndefined()
  })

  test('url-encoded segment is decoded in param', () => {
    expect(matchRoutePath('/items/:id', '/items/hello%20world')).toEqual({
      id: 'hello world',
    })
  })
})

// ---------------------------------------------------------------------------
// S6-2 / S6-5: buildRemoteRouteProps — does NOT clobber reserved params
// ---------------------------------------------------------------------------

describe('buildRemoteRouteProps (S6-5)', () => {
  const mockConfig = {
    key: 'aawm-tap' as const,
    moduleId: 'aawm-tap-dashboard',
    name: 'AAWM TAP',
    description: 'test',
    icon: () => null,
    basePath: '/aawm-tap',
    apiBase: '/api/aawm-tap',
    accentColor: 'hsl(220 70% 50%)',
    defaultRoutePath: '/overview',
    navItems: [],
    importModule: async () => ({ default: null as never }),
  }

  test('test_buildRemoteRouteProps_does_not_clobber_reserved_params', () => {
    // If a route has a dynamic param named 'moduleId', 'basePath', 'apiBase',
    // or 'routePath', the spread should NOT overwrite the config's values.
    // The fix: reserved keys come AFTER params spread (params can't shadow config).
    const params = { moduleId: 'injected-by-param', basePath: '/injected' }
    const props = buildRemoteRouteProps(mockConfig, '/overview', params)

    // Reserved keys must always reflect the config, not the route params.
    expect(props.moduleId).toBe('aawm-tap-dashboard')
    expect(props.basePath).toBe('/aawm-tap')
    expect(props.apiBase).toBe('/api/aawm-tap')
    expect(props.routePath).toBe('/overview')
  })

  test('non-reserved params are passed through', () => {
    const params = { userId: '123', orgId: 'abc' }
    const props = buildRemoteRouteProps(mockConfig, '/profile', params)

    expect(props.userId).toBe('123')
    expect(props.orgId).toBe('abc')
  })

  test('params object is always included in props', () => {
    const params = { page: 'overview' }
    const props = buildRemoteRouteProps(mockConfig, '/overview', params)

    expect(props.params).toEqual(params)
  })
})

// ---------------------------------------------------------------------------
// S6-2: assertProjectModule — throws a named error on malformed default
// ---------------------------------------------------------------------------

describe('assertProjectModule (S6-2)', () => {
  const validModule = {
    id: 'test-module',
    name: 'Test Module',
    description: 'Test',
    icon: () => null,
    basePath: '/test',
    routes: [],
    navItems: [],
  }

  test('accepts a valid ProjectModule without throwing', () => {
    expect(() => assertProjectModule(validModule)).not.toThrow()
  })

  test('accepts forwardRef and Lucide-shaped icon components', async () => {
    const { LayoutDashboard } = await import('lucide-react')
    const ForwardRefIcon = forwardRef<SVGSVGElement, { className?: string }>(
      function ForwardRefIcon(_props, _ref) {
        return null
      }
    )

    expect(() =>
      assertProjectModule({ ...validModule, icon: LayoutDashboard })
    ).not.toThrow()
    expect(() =>
      assertProjectModule({ ...validModule, icon: ForwardRefIcon })
    ).not.toThrow()
  })

  test('throws a named error (RemoteModuleContractError) when module is null', () => {
    let caughtError: unknown
    try {
      assertProjectModule(null)
    } catch (err) {
      caughtError = err
    }
    expect(caughtError).toBeDefined()
    // Must be a named error, not a bare TypeError
    expect((caughtError as Error).name).toBe('RemoteModuleContractError')
  })

  test('throws a named error when module is undefined', () => {
    let caughtError: unknown
    try {
      assertProjectModule(undefined)
    } catch (err) {
      caughtError = err
    }
    expect(caughtError).toBeDefined()
    expect((caughtError as Error).name).toBe('RemoteModuleContractError')
  })

  test('throws a named error when module is missing routes array', () => {
    let caughtError: unknown
    try {
      assertProjectModule({ ...validModule, routes: undefined })
    } catch (err) {
      caughtError = err
    }
    expect(caughtError).toBeDefined()
    expect((caughtError as Error).name).toBe('RemoteModuleContractError')
  })

  test('throws a named error when module is missing basePath', () => {
    let caughtError: unknown
    try {
      const malformed = { ...validModule }
      delete (malformed as Partial<typeof malformed>).basePath
      assertProjectModule(malformed)
    } catch (err) {
      caughtError = err
    }
    expect(caughtError).toBeDefined()
    expect((caughtError as Error).name).toBe('RemoteModuleContractError')
  })

  test('test_assert_project_module_rejects_missing_icon', () => {
    const malformed = {
      id: 'test-module',
      name: 'Test Module',
      description: 'Test',
      basePath: '/test',
      routes: [{ path: '/', component: () => null }],
    }

    let caughtError: unknown
    try {
      assertProjectModule(malformed)
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeDefined()
    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).name).toBe('RemoteModuleContractError')
    expect((caughtError as Error).message).toMatch(
      /contract|icon|name|navItems/i
    )
    expect(caughtError).not.toBeInstanceOf(TypeError)
  })

  test('error message describes the violation', () => {
    let caughtError: unknown
    try {
      assertProjectModule(null)
    } catch (err) {
      caughtError = err
    }
    expect((caughtError as Error).message).toMatch(/module|default|contract/i)
  })
})

// ---------------------------------------------------------------------------
// S6-1: remoteDashboardHref round-trip
// (already exported, test correctness for edge cases)
// ---------------------------------------------------------------------------

describe('remoteDashboardHref', () => {
  const aawmTap: Pick<RemoteDashboardMetadataEntry, 'basePath'> = {
    basePath: '/aawm-tap',
  }

  test('root routePath returns basePath only', () => {
    expect(remoteDashboardHref(aawmTap, '/')).toBe('/aawm-tap')
  })

  test('non-root routePath appends to basePath', () => {
    expect(remoteDashboardHref(aawmTap, '/overview')).toBe('/aawm-tap/overview')
  })

  test('routePath is normalized before append (trailing slash stripped)', () => {
    expect(remoteDashboardHref(aawmTap, '/overview/')).toBe(
      '/aawm-tap/overview'
    )
  })
})
