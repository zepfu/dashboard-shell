import { describe, expect, test } from 'vitest'
import { isStaleAssetError } from './stale-asset-reload'

describe('isStaleAssetError (Wave 2 L7/L4)', () => {
  test('test_is_stale_asset_error_matches_chunkload_name', () => {
    const chunkLoad = new Error('network timeout')
    chunkLoad.name = 'ChunkLoadError'
    expect(isStaleAssetError(chunkLoad)).toBe(true)

    expect(
      isStaleAssetError(
        new Error('Failed to fetch dynamically imported module')
      )
    ).toBe(true)
    expect(
      isStaleAssetError(new Error('Importing a module script failed'))
    ).toBe(true)
    expect(
      isStaleAssetError(new Error('error loading dynamically imported module'))
    ).toBe(true)
    expect(isStaleAssetError(new Error('ChunkLoadError: timeout'))).toBe(true)
    expect(isStaleAssetError(new Error('loading chunk vendors failed'))).toBe(
      true
    )

    expect(isStaleAssetError(new Error('Something else went wrong'))).toBe(
      false
    )
    expect(isStaleAssetError(null)).toBe(false)
  })
})
