/**
 * D1-451 Wave 5 — accent-color (G2).
 *
 * Tint math must handle hsl()/alpha and short hex without returning raw accent
 * unchanged (broken sidebar nav backgrounds).
 */
import { describe, expect, test } from 'vitest'
import { getAccentStyle } from './accent-color'

describe('D1-451 G2 — accent background tint formats', () => {
  test('test_get_accent_style_hsl_produces_alpha_background', () => {
    const style = getAccentStyle('hsl(220 70% 50%)', {
      colorVar: '--nav-accent',
      backgroundVar: '--nav-accent-bg',
      backgroundTint: 12,
    })

    expect(style).toBeDefined()
    const bg = (style as Record<string, string>)['--nav-accent-bg']
    // RED: current implementation may return trimmed hsl without / alpha split.
    expect(bg).toMatch(/\/\s*0\.12\s*\)/)
  })

  test('test_get_accent_style_short_hex_expands_for_tint', () => {
    const style = getAccentStyle('#abc', {
      colorVar: '--nav-accent',
      backgroundVar: '--nav-accent-bg',
      backgroundTint: 20,
    })

    const bg = (style as Record<string, string>)['--nav-accent-bg']
    // RED: #abc is not matched by 6-digit hex regex today → returns '#abc' verbatim.
    expect(bg).toMatch(/rgb\(/)
    expect(bg).toContain('/ 0.2')
  })

  test('test_get_accent_style_8_digit_hex_respects_embedded_alpha', () => {
    const style = getAccentStyle('#33669980', {
      colorVar: '--nav-accent',
      backgroundVar: '--nav-accent-bg',
      backgroundTint: 12,
    })

    const bg = (style as Record<string, string>)['--nav-accent-bg']
    expect(bg).not.toBe('#33669980')
    expect(bg).toMatch(/rgb\(|hsl\(/)
  })
})
