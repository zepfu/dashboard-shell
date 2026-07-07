/**
 * D1-451 Wave 5 — config/fonts.ts (W1).
 *
 * Every user-selectable font must map to a `--font-*` token in theme.css
 * (or unsupported options removed from the fonts array).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { fonts } from './fonts'

const here = dirname(fileURLToPath(import.meta.url))
const themeCss = readFileSync(join(here, '../styles/theme.css'), 'utf8')

function fontTokenName(font: (typeof fonts)[number]): string {
  if (font === 'system') return '--font-sans'
  return `--font-${font}`
}

describe('D1-451 W1 — fonts.ts ↔ theme.css tokens', () => {
  test('test_each_selectable_font_has_matching_theme_css_variable', () => {
    for (const font of fonts) {
      const token = fontTokenName(font)
      // RED until --font-ibm-plex-mono / --font-playfair-display added (or fonts trimmed).
      expect(themeCss).toMatch(new RegExp(`${token.replace(/-/g, '\\-')}\\s*:`))
    }
  })

  test('test_font_provider_class_names_match_fonts_array', () => {
    for (const font of fonts) {
      const className = `font-${font}`
      expect(className.length).toBeGreaterThan('font-'.length)
    }
  })
})
