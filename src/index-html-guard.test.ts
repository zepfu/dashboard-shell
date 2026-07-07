/**
 * D1-451 Wave 5 — index.html (G1).
 *
 * Plan: no runtime test; static guard that theme-color matches dark-only shell.
 * Engineer fixes index.html meta to dark chrome (e.g. #020817).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

describe('D1-451 G1 — index.html theme-color', () => {
  test('test_theme_color_meta_is_dark_not_white', () => {
    const match = indexHtml.match(
      /<meta\s+name="theme-color"\s+content="([^"]+)"/i
    )
    expect(match).not.toBeNull()
    const color = match![1]!.toLowerCase()
    // RED: current value is #fff per fork review G1.
    expect(color).not.toBe('#fff')
    expect(color).not.toBe('#ffffff')
    expect(color).toMatch(/#0[0-9a-f]{5}|#020817/i)
  })
})
