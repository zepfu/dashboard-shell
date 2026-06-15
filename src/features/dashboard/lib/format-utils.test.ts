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

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-16: numFmt must produce locale-independent output (en-US)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-16: `numFmt` currently calls `n.toLocaleString(undefined, …)` which
 * uses the Node/V8 runtime locale, producing different separators in different
 * CI environments (e.g. "1.234.567" in de-DE vs "1,234,567" in en-US).
 * The fix is to pin `'en-US'`.
 *
 * These tests are RED in any environment that resolves `undefined` to a
 * non-en-US locale, and will be GREEN once the engineer pins `'en-US'`.
 *
 * In the vitest worktree environment the locale is likely en-US already, so
 * the primary red signal comes from verifying the *separator character* is
 * exactly a comma (not a period or other) — plus explicit documentation that
 * this must hold across environments.
 */
describe('numFmt locale-independence (S4-16)', () => {
  it('test_numFmt_pins_en_US_thousand_separator_is_comma', () => {
    // In en-US: 1,234,567
    // In de-DE: 1.234.567
    // The separator MUST be a comma.
    const result = numFmt(1_234_567)
    expect(result).toBe('1,234,567')
    expect(result).toContain(',')
    expect(result).not.toMatch(/^\d{1,3}\.\d{3}/) // not German-style period grouping
  })

  it('test_numFmt_pins_en_US_decimal_separator_is_dot', () => {
    // In en-US: 3.14
    // In de-DE: 3,14
    const result = numFmt(3.14159, 2)
    expect(result).toBe('3.14')
    expect(result).toContain('.')
    expect(result).not.toContain(',')
  })

  it('test_numFmt_pins_en_US_large_decimal', () => {
    // 1,234.56 in en-US
    const result = numFmt(1_234.5678, 2)
    expect(result).toBe('1,234.57')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T7: format-utils negative and NaN inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T7: `fmtCompact` and `numFmt` have no guard for NaN or negative values.
 * The engineer must decide: either guard or document. These tests pin the
 * expected post-fix behavior (guarded / returning a sentinel) and will be RED
 * until the engineer adds the guard or explicit handling.
 */
describe('fmtCompact negative and NaN inputs (S4-T7)', () => {
  it('test_fmtCompact_negative_does_not_produce_NaN_string', () => {
    // Negative values currently hit the `else` branch → String(-500) = "-500"
    // If the engineer adds a guard this will change — pin the guarded form.
    const result = fmtCompact(-500)
    expect(result).not.toBe('NaN')
    expect(result).not.toContain('NaN')
    // Must be a recognisable numeric-ish string
    expect(result).toMatch(/^-?\d/)
  })

  it('test_fmtCompact_NaN_returns_sentinel_not_NaN_string', () => {
    // NaN should not propagate as the string "NaN" to the UI.
    // The engineer must add a guard returning '--' or '0' or similar.
    const result = fmtCompact(Number.NaN)
    expect(result).not.toBe('NaN')
    // After fix: expect either '0' or '--'
    expect(['0', '--', '—']).toContain(result)
  })

  it('test_numFmt_NaN_returns_sentinel_not_NaN_string', () => {
    // numFmt(NaN) currently returns 'NaN' via toLocaleString — must be guarded.
    const result = numFmt(Number.NaN)
    expect(result).not.toBe('NaN')
    expect(['0', '--', '—']).toContain(result)
  })

  it('test_numFmt_negative_one_thousand_formatted', () => {
    // -1000 → '-1,000' in en-US
    const result = numFmt(-1_000)
    expect(result).toBe('-1,000')
  })
})
