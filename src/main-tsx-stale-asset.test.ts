/**
 * D1-451 Wave 5 — src/main.tsx (W4).
 *
 * main.tsx must reuse stale-asset-reload exports; no duplicated pattern list.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const mainTsx = readFileSync(join(repoRoot, 'main.tsx'), 'utf8')

describe('D1-451 W4 — main.tsx stale asset wiring', () => {
  test('test_main_imports_stale_asset_reload_module', () => {
    expect(mainTsx).toMatch(
      /from\s+['"]@\/lib\/stale-asset-reload['"]|from\s+['"]\.\/lib\/stale-asset-reload['"]/
    )
    expect(mainTsx).toMatch(/isStaleAssetError/)
    expect(mainTsx).toMatch(/reloadForStaleAsset/)
  })

  test('test_main_does_not_duplicate_stale_asset_pattern_array', () => {
    // RED if engineer reintroduces a second chunkLoadFailurePatterns / staleAssetErrorPatterns block.
    const duplicatePatternDecl =
      (mainTsx.match(/failed to fetch dynamically imported module/gi) ?? [])
        .length <= 1
    expect(duplicatePatternDecl).toBe(true)
    expect(mainTsx).not.toMatch(/chunkLoadFailurePatterns\s*=/)
    expect(mainTsx).not.toMatch(/function\s+isChunkLoadFailure\s*\(/)
  })
})
