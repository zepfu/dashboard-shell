/**
 * D1-454 Wave 1 — Provider token-trend slice/swatch hex must match PROVIDER_SERIES.
 *
 * TRIPWIRE: raw-text grep against `index.css` `.tt-*` rules and
 * `PROVIDER_SERIES` in phosphor-dashboard.tsx (same guard class as quota-burn tiers).
 */
import fs from 'node:fs'
import path from 'node:path'

const css = fs.readFileSync(path.resolve('src/styles/index.css'), 'utf8')
const dashboardSource = fs.readFileSync(
  path.resolve('src/features/dashboard/components/phosphor-dashboard.tsx'),
  'utf8'
)

function readTtProviderHex(cssClass: string): string {
  const escaped = cssClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(
    new RegExp(
      `\\.tt-slice\\.${escaped},\\s*\\n\\.tt-swatch\\.${escaped}\\s*\\{[^}]*background:\\s*(#[0-9a-fA-F]{3,8})`,
      's'
    )
  )
  if (!match) {
    const fallback = css.match(
      new RegExp(
        `\\.tt-slice\\.${escaped}[^}]*background:\\s*(#[0-9a-fA-F]{3,8})`,
        's'
      )
    )
    return fallback?.[1]?.toLowerCase() ?? ''
  }
  return match[1].toLowerCase()
}

function parseProviderSeries(): Array<{ cssClass: string; color: string }> {
  const blockMatch = dashboardSource.match(
    /const PROVIDER_SERIES[^=]*=\s*\[([\s\S]*?)\n\]/
  )
  if (!blockMatch) return []

  const entries: Array<{ cssClass: string; color: string }> = []
  const objectRe = /\{[^{}]*\}/g
  let obj: RegExpExecArray | null
  while ((obj = objectRe.exec(blockMatch[1])) !== null) {
    const color = obj[0].match(/color:\s*'(#[0-9a-fA-F]{3,8})'/)?.[1]
    const cssClass = obj[0].match(/cssClass:\s*'([^']+)'/)?.[1]
    if (color && cssClass) {
      entries.push({ cssClass, color: color.toLowerCase() })
    }
  }
  return entries
}

const providerSeries = parseProviderSeries()

test('test_css_and_provider_series_hex_match', () => {
  /**
   * I-2: each `.tt-*` provider slice hex in index.css must equal
   * PROVIDER_SERIES[].color for the same cssClass key.
   */
  expect(providerSeries.length).toBeGreaterThan(0)

  for (const { cssClass, color } of providerSeries) {
    const cssHex = readTtProviderHex(cssClass)
    expect(
      cssHex,
      `${cssClass}: index.css .tt-slice/.tt-swatch background`
    ).toBe(color)
  }
})
