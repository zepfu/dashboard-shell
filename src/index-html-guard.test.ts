/**
 * Wave 11 (P13-F26) — index.html theme-color must be dark by computed luminance,
 * not a frozen hex prefix that matches whatever index.html currently contains.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

/** WCAG relative luminance for sRGB hex (#rgb or #rrggbb). */
function relativeLuminanceFromHex(hex: string): number {
  const normalized = hex.trim().toLowerCase().replace(/^#/, '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  if (!/^[0-9a-f]{6}$/.test(expanded)) {
    throw new Error(`invalid theme-color hex: ${hex}`)
  }
  const channels = [0, 2, 4].map(
    (i) => parseInt(expanded.slice(i, i + 2), 16) / 255
  )
  const linear = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

/** Dark browser chrome: luminance well below mid-gray (~0.18). */
const DARK_THEME_LUMINANCE_MAX = 0.08

describe('Wave 11 P13-F26 — index.html theme-color luminance', () => {
  test('test_index_html_theme_color_is_dark_by_luminance', () => {
    const match = indexHtml.match(
      /<meta\s+name="theme-color"\s+content="([^"]+)"/i
    )
    expect(match).not.toBeNull()
    const color = match![1]!.trim()
    const luminance = relativeLuminanceFromHex(color)
    expect(luminance).toBeLessThan(DARK_THEME_LUMINANCE_MAX)
    expect(color.toLowerCase()).not.toBe('#fff')
    expect(color.toLowerCase()).not.toBe('#ffffff')
  })
})
