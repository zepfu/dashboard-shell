/**
 * Unit tests for the canonical dashboard formatter utilities.
 *
 * Source: src/features/dashboard/lib/format-utils.ts
 *
 * These tests lock in the canonical output format for `fmtCompact` and
 * `numFmt` so that any future divergence (e.g. a caller introducing a
 * local copy with lowercase "k") is caught immediately.
 */
import { describe, expect, it } from 'vitest'
import { fmtCompact, numFmt } from './format-utils'

// ---------------------------------------------------------------------------
// fmtCompact
// ---------------------------------------------------------------------------

describe('fmtCompact', () => {
  // Sub-1K: raw integer string
  it('test_fmtCompact_zero', () => {
    expect(fmtCompact(0)).toBe('0')
  })

  it('test_fmtCompact_small_integer', () => {
    expect(fmtCompact(5)).toBe('5')
  })

  it('test_fmtCompact_just_below_1k', () => {
    expect(fmtCompact(999)).toBe('999')
  })

  // 1K–1M: uppercase K suffix
  it('test_fmtCompact_exact_1k', () => {
    expect(fmtCompact(1_000)).toBe('1.0K')
  })

  it('test_fmtCompact_thousands_uppercase_K', () => {
    expect(fmtCompact(587_234)).toBe('587.2K')
  })

  it('test_fmtCompact_just_below_1m', () => {
    expect(fmtCompact(999_999)).toBe('1000.0K')
  })

  // 1M–1B: M suffix
  it('test_fmtCompact_exact_1m', () => {
    expect(fmtCompact(1_000_000)).toBe('1.0M')
  })

  it('test_fmtCompact_millions', () => {
    expect(fmtCompact(1_200_000)).toBe('1.2M')
  })

  it('test_fmtCompact_large_millions', () => {
    expect(fmtCompact(999_500_000)).toBe('999.5M')
  })

  // 1B+: B suffix
  it('test_fmtCompact_exact_1b', () => {
    expect(fmtCompact(1_000_000_000)).toBe('1.0B')
  })

  it('test_fmtCompact_billions', () => {
    expect(fmtCompact(19_471_800_848)).toBe('19.5B')
  })

  it('test_fmtCompact_very_large_billions', () => {
    expect(fmtCompact(100_000_000_000)).toBe('100.0B')
  })

  // Canonical: uppercase K not lowercase k
  it('test_fmtCompact_uses_uppercase_K_not_lowercase_k', () => {
    const result = fmtCompact(23_500)
    expect(result).toBe('23.5K')
    expect(result).not.toContain('k')
  })
})

// ---------------------------------------------------------------------------
// numFmt
// ---------------------------------------------------------------------------

describe('numFmt', () => {
  it('test_numFmt_integer_default_decimals', () => {
    expect(numFmt(1_234_567)).toBe('1,234,567')
  })

  it('test_numFmt_zero', () => {
    expect(numFmt(0)).toBe('0')
  })

  it('test_numFmt_two_decimal_places', () => {
    // In 'en-US'-like locale (vitest default) this should produce "3.14"
    expect(numFmt(3.14159, 2)).toBe('3.14')
  })

  it('test_numFmt_one_decimal_place', () => {
    expect(numFmt(0.5, 1)).toBe('0.5')
  })

  it('test_numFmt_four_decimal_places', () => {
    expect(numFmt(0.00012345, 4)).toBe('0.0001')
  })

  it('test_numFmt_rounds_at_decimal_boundary', () => {
    // toFixed-style rounding at the requested precision
    expect(numFmt(1.005, 2)).toBe('1.01')
  })
})
