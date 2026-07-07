/**
 * D1-451 Wave 5 — stale-asset-reload (C3) + Wave 2 L7/L4.
 */
import { describe, expect, test } from 'vitest'
import { errorText, isStaleAssetError } from './stale-asset-reload'

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

describe('D1-451 C3 — errorText cycle guard', () => {
  test('test_error_text_does_not_stack_overflow_on_cyclic_error_graph', () => {
    type Cyclic = { message?: unknown; reason?: unknown; error?: unknown }
    const a: Cyclic = {}
    const b: Cyclic = { error: a }
    a.error = b

    // RED until engineer adds visited-set / depth guard in errorText().
    expect(() => errorText(a)).not.toThrow()
    expect(errorText(a)).toBeTruthy()
  })

  test('test_error_text_self_referential_error_field_terminates', () => {
    const self: { message: string; error: unknown } = {
      message: 'outer',
      error: null,
    }
    self.error = self

    expect(() => errorText(self)).not.toThrow()
    const text = errorText(self)
    expect(text.length).toBeLessThan(10_000)
  })
})
